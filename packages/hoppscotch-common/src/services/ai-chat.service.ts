import { Service } from "dioc"
import { computed, ref } from "vue"
import {
  AiChatContext,
  buildAiChatContext,
  renderContextText,
} from "~/helpers/ai/context"
import { useSettingStatic } from "~/composables/settings"
import { platform } from "~/platform"
import { PersistenceService } from "~/services/persistence"

export type AiToolCallStatus =
  | "running"
  | "ok"
  | "failed"
  | "awaiting-approval"
  | "awaiting-input"
  | "approving"
  | "applied"
  | "rejected"
  | "answered"

export type AiToolPreview = {
  summary: string
  before: unknown | null
  after: unknown
  warnings: string[]
}

export type AiToolQuestion = {
  question: string
  options: string[]
  allowFreeText: boolean
}

export type AiToolCall = {
  id: string
  name: string
  status: AiToolCallStatus
  args?: Record<string, unknown>
  preview?: AiToolPreview
  question?: AiToolQuestion
}

export type AiAttachment = {
  id: string
  filename: string
  byteSize: number
}

/** A file picked in the composer, before it has been uploaded. */
export type AiAttachmentDraft = {
  localId: string
  filename: string
  mimeType: string
  byteSize: number
  content: string
  /** Set once stored server-side, so a retry after a partial failure does not
   *  upload the same file twice. */
  uploadedId?: string
}

export type AiChatMessage = {
  id: string
  role: "user" | "assistant"
  content: string
  toolCalls: AiToolCall[]
  attachments?: AiAttachment[]
  createdAt: number
  isStreaming: boolean
}

export type AiChatScope =
  | { type: "none" }
  | { type: "collection"; id: string; name: string }
  | { type: "request"; id: string; name: string }

export type AiChatStatus =
  "idle" | "streaming" | "awaiting-approval" | "awaiting-input" | "error"

const PERSIST_KEY = "ai-chat-conversation"

/** Mirrors MAX_ATTACHMENT_BYTES on the server. */
export const MAX_ATTACHMENT_BYTES = 2_000_000

export const MAX_ATTACHMENTS_PER_MESSAGE = 5

/**
 * Text-ish files only. The server sniffs the content too - this is the check
 * that gives the user an answer before a 2 MB upload, not the one that holds.
 */
export const ATTACHMENT_ACCEPT =
  ".txt,.json,.yaml,.yml,.har,.csv,.md,.markdown,text/*,application/json,application/yaml,application/x-yaml"

const ATTACHMENT_EXTENSIONS = [
  ".txt",
  ".json",
  ".yaml",
  ".yml",
  ".har",
  ".csv",
  ".md",
  ".markdown",
]

export type AiAttachmentError =
  "too-large" | "too-many" | "not-text" | "upload-failed"

/**
 * Drives the in-app AI chat.
 *
 * Streams over SSE rather than a GraphQL subscription: the backend's PubSub is
 * in-memory with no Redis adapter, so a mutation-plus-subscription design would
 * silently drop tokens. Here the POST *is* the stream.
 */
export class AiChatService extends Service {
  public static readonly ID = "AI_CHAT_SERVICE"

  private readonly persistence = this.bind(PersistenceService)

  public readonly messages = ref<AiChatMessage[]>([])
  public readonly conversationID = ref<string | null>(null)
  public readonly status = ref<AiChatStatus>("idle")
  public readonly lastError = ref<string | null>(null)
  public readonly scope = ref<AiChatScope>({ type: "none" })
  public readonly isEnabled = ref(false)
  public readonly model = ref<string | null>(null)

  /**
   * Whether the current workspace and open request tab are shipped with each
   * message. On by default - it is the whole point of living in the sidebar.
   */
  public readonly contextEnabled = ref(true)

  /**
   * "YOLO mode". Mirrors the AI_CHAT_AUTO_APPROVE setting so the header toggle
   * and the settings page stay the same switch.
   */
  public readonly autoApprove = useSettingStatic("AI_CHAT_AUTO_APPROVE")[0]

  /** What the assistant would see right now, recomputed on every read. */
  public readonly context = computed<AiChatContext>(() => buildAiChatContext())

  /** Files picked in the composer, uploaded when the message is sent. */
  public readonly pendingAttachments = ref<AiAttachmentDraft[]>([])

  private abortController: AbortController | null = null
  private pendingText = ""
  private flushHandle: number | null = null

  public readonly pendingApprovals = computed(() =>
    this.messages.value.flatMap((message) =>
      message.toolCalls
        .filter((call) => call.status === "awaiting-approval")
        .map((call) => ({ messageID: message.id, toolCall: call }))
    )
  )

  override onServiceInit() {
    void this.restore()
    void this.refreshConfig()
  }

  /** Ask the server whether AI is on, and which model it will use. */
  public async refreshConfig() {
    const result = await platform.infra?.getAiChatConfig?.()
    if (!result) return

    if (result._tag === "Right") {
      this.isEnabled.value = result.right.enabled
      this.model.value = result.right.defaultModel
    } else {
      this.isEnabled.value = false
    }
  }

  public setScope(scope: AiChatScope) {
    this.scope.value = scope
  }

  public newConversation() {
    this.stop()
    this.conversationID.value = null
    this.messages.value = []
    this.status.value = "idle"
    this.lastError.value = null
    this.persist()
  }

  public stop() {
    this.abortController?.abort()
    this.abortController = null
    this.flushText()
    const last = this.messages.value.at(-1)
    if (last?.isStreaming) last.isStreaming = false
    if (this.status.value === "streaming") this.status.value = "idle"
  }

  /**
   * Reads a picked file as text and queues it.
   *
   * Rejects by extension, size and a NUL sniff here so the user hears about a
   * bad file immediately rather than after uploading it.
   */
  public async addAttachment(
    file: File
  ): Promise<AiAttachmentError | undefined> {
    if (this.pendingAttachments.value.length >= MAX_ATTACHMENTS_PER_MESSAGE) {
      return "too-many"
    }
    if (file.size > MAX_ATTACHMENT_BYTES) return "too-large"

    const name = file.name.toLowerCase()
    const extensionAllowed = ATTACHMENT_EXTENSIONS.some((extension) =>
      name.endsWith(extension)
    )
    const typeAllowed =
      file.type.startsWith("text/") ||
      file.type === "application/json" ||
      file.type === "application/yaml" ||
      file.type === "application/x-yaml"

    if (!extensionAllowed && !typeAllowed) return "not-text"

    const content = await file.text().catch(() => null)
    if (content === null || content === "" || content.includes("\u0000")) {
      return "not-text"
    }

    this.pendingAttachments.value.push({
      localId: `attachment-${Date.now()}-${this.pendingAttachments.value.length}`,
      filename: file.name,
      mimeType: file.type || "text/plain",
      byteSize: file.size,
      content,
    })
  }

  public removeAttachment(localId: string) {
    this.pendingAttachments.value = this.pendingAttachments.value.filter(
      (attachment) => attachment.localId !== localId
    )
  }

  private async uploadAttachments(
    conversationID: string
  ): Promise<AiAttachment[] | null> {
    const uploaded: AiAttachment[] = []

    for (const draft of this.pendingAttachments.value) {
      if (draft.uploadedId) {
        uploaded.push({
          id: draft.uploadedId,
          filename: draft.filename,
          byteSize: draft.byteSize,
        })
        continue
      }

      const res = await this.request(
        `/conversations/${conversationID}/attachments`,
        {
          filename: draft.filename,
          mimeType: draft.mimeType,
          content: draft.content,
        }
      )

      if (!res || !res.ok) return null

      const body = await res.json().catch(() => null)
      if (!body?.id) return null

      // Remember it before moving on: if a later file fails, the retry resumes
      // from here instead of storing this one a second time.
      draft.uploadedId = body.id
      uploaded.push({
        id: body.id,
        filename: body.filename,
        byteSize: body.byteSize,
      })
    }

    return uploaded
  }

  public async send(text: string) {
    const trimmed = text.trim()
    if (this.status.value === "streaming") return
    if (!trimmed && this.pendingAttachments.value.length === 0) return

    const conversationID = await this.ensureConversation()
    if (!conversationID) return

    // Upload before anything is shown, so a failure leaves the drafts in the
    // composer for the user to retry rather than half-sending the message.
    const attachments = await this.uploadAttachments(conversationID)
    if (attachments === null) {
      this.fail("ai/attachment_upload_failed")
      return
    }
    this.pendingAttachments.value = []

    this.messages.value.push({
      id: `user-${Date.now()}`,
      role: "user",
      content: trimmed,
      toolCalls: [],
      attachments: attachments.length > 0 ? attachments : undefined,
      createdAt: Date.now(),
      isStreaming: false,
    })

    await this.openStream(`/conversations/${conversationID}/messages`, {
      text: trimmed,
      workspaceId: this.workspaceId(),
      contextText: this.contextText(),
      attachmentIds: attachments.map((attachment) => attachment.id),
      autoApprove: this.autoApprove.value,
    })
  }

  public async respondToApproval(
    toolUseId: string,
    decision: "approve" | "reject"
  ) {
    const conversationID = this.conversationID.value
    if (!conversationID) return

    // openStream() aborts whatever is in flight, so a second decision sent
    // while the first is still applying would cut that write off mid-way.
    if (this.status.value === "streaming") return

    const call = this.findToolCall(toolUseId)
    if (call) call.status = decision === "approve" ? "approving" : "rejected"

    await this.openStream(`/conversations/${conversationID}/approvals`, {
      toolUseId,
      decision,
      workspaceId: this.workspaceId(),
      autoApprove: this.autoApprove.value,
    })
  }

  public async answerQuestion(toolUseId: string, answer: string) {
    const conversationID = this.conversationID.value
    if (!conversationID) return
    if (this.status.value === "streaming") return

    const call = this.findToolCall(toolUseId)
    if (call) call.status = "answered"

    await this.openStream(`/conversations/${conversationID}/answers`, {
      toolUseId,
      answer,
      workspaceId: this.workspaceId(),
      autoApprove: this.autoApprove.value,
    })
  }

  /**
   * Settle every proposal still pending on the turn in one request.
   *
   * Deliberately one call rather than a loop over respondToApproval: each of
   * those opens its own stream against the same conversation.
   */
  public async respondToAllApprovals(decision: "approve" | "reject") {
    const conversationID = this.conversationID.value
    if (!conversationID) return
    if (this.status.value === "streaming") return

    for (const { toolCall } of this.pendingApprovals.value) {
      toolCall.status = decision === "approve" ? "approving" : "rejected"
    }

    await this.openStream(`/conversations/${conversationID}/approvals`, {
      decision: decision === "approve" ? "approve_all" : "reject_all",
      workspaceId: this.workspaceId(),
      autoApprove: this.autoApprove.value,
    })
  }

  /**
   * The workspace the turn is scoped to. A hint only - the server re-resolves
   * it and re-checks the caller's role.
   */
  private workspaceId(): string | undefined {
    const workspace = this.context.value.workspace
    return workspace.type === "team" ? workspace.teamID : undefined
  }

  private contextText(): string | undefined {
    if (!this.contextEnabled.value) return undefined
    return renderContextText(this.context.value)
  }

  private async ensureConversation(): Promise<string | null> {
    if (this.conversationID.value) return this.conversationID.value

    const res = await this.request("/conversations", { title: "New chat" })
    if (!res || !res.ok) {
      this.fail("ai/conversation_create_failed")
      return null
    }

    const body = await res.json()
    this.conversationID.value = body.id
    return body.id
  }

  private baseUrl() {
    return `${import.meta.env.VITE_BACKEND_API_URL}/ai`
  }

  private request(path: string, body: unknown, stream = false) {
    return fetch(`${this.baseUrl()}${path}`, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...(stream ? { Accept: "text/event-stream" } : {}),
        ...platform.auth.getBackendHeaders(),
      },
      body: JSON.stringify(body),
      signal: stream ? this.abortController?.signal : undefined,
    }).catch(() => null)
  }

  private async openStream(path: string, body: unknown) {
    this.abortController?.abort()
    this.abortController = new AbortController()
    this.status.value = "streaming"
    this.lastError.value = null

    this.messages.value.push({
      id: `assistant-${Date.now()}`,
      role: "assistant",
      content: "",
      toolCalls: [],
      createdAt: Date.now(),
      isStreaming: true,
    })

    let res = await this.request(path, body, true)

    // SSE bypasses urql's authExchange, so mirror its refresh-once behaviour.
    if (res?.status === 401) {
      await platform.auth.refreshAuthToken?.()
      res = await this.request(path, body, true)
    }

    if (!res || !res.ok || !res.body) {
      this.fail(`ai/request_failed_${res?.status ?? "network"}`)
      return
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ""

    try {
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })

        let separator: number
        while ((separator = buffer.indexOf("\n\n")) !== -1) {
          const frame = buffer.slice(0, separator)
          buffer = buffer.slice(separator + 2)
          this.handleFrame(frame)
        }
      }
    } catch {
      // An aborted stream is a user action, not an error.
      if (!this.abortController?.signal.aborted) {
        this.fail("ai/stream_interrupted")
        return
      }
    }

    this.flushText()
    const last = this.messages.value.at(-1)
    if (last?.isStreaming) last.isStreaming = false
    if (this.status.value === "streaming") this.status.value = "idle"
    this.persist()
  }

  private handleFrame(raw: string) {
    let event = "message"
    const dataLines: string[] = []

    for (const line of raw.split("\n")) {
      if (line.startsWith("event: ")) event = line.slice(7).trim()
      else if (line.startsWith("data: ")) dataLines.push(line.slice(6))
    }

    if (dataLines.length === 0) return

    let data: any
    try {
      data = JSON.parse(dataLines.join("\n"))
    } catch {
      return
    }

    const current = this.messages.value.at(-1)
    if (!current) return

    switch (event) {
      case "token":
        // Coalesce per frame so a fast stream does not re-render per token.
        this.pendingText += data.text ?? ""
        this.scheduleFlush()
        break

      case "tool_call_started":
        current.toolCalls.push({
          id: data.id,
          name: data.name,
          status: "running",
        })
        break

      case "tool_call_result": {
        const call = this.findToolCall(data.id)
        if (!call) break
        if (data.answered) call.status = "answered"
        else if (data.rejected) call.status = "rejected"
        else if (data.isError) call.status = "failed"
        else call.status = call.status === "approving" ? "applied" : "ok"
        break
      }

      case "question_required": {
        const existing = this.findToolCall(data.toolUseId)
        const call: AiToolCall = existing ?? {
          id: data.toolUseId,
          name: data.name,
          status: "awaiting-input",
        }
        call.status = "awaiting-input"
        call.question = {
          question: data.question,
          options: data.options ?? [],
          allowFreeText: data.allowFreeText ?? true,
        }
        if (!existing) current.toolCalls.push(call)
        this.status.value = "awaiting-input"
        break
      }

      case "approval_required": {
        const existing = this.findToolCall(data.toolUseId)
        const call: AiToolCall = existing ?? {
          id: data.toolUseId,
          name: data.name,
          status: "awaiting-approval",
        }
        call.status = "awaiting-approval"
        call.args = data.args
        call.preview = data.preview
        if (!existing) current.toolCalls.push(call)
        this.status.value = "awaiting-approval"
        break
      }

      case "done":
        this.flushText()
        if (data.conversationID) this.conversationID.value = data.conversationID
        if (data.stopReason === "awaiting_approval") {
          this.status.value = "awaiting-approval"
        } else if (data.stopReason === "awaiting_input") {
          this.status.value = "awaiting-input"
        } else {
          this.status.value = "idle"
        }
        break

      case "error":
        this.fail(data.code ?? "ai/unknown_error")
        break
    }
  }

  private findToolCall(id: string): AiToolCall | undefined {
    for (let i = this.messages.value.length - 1; i >= 0; i--) {
      const found = this.messages.value[i].toolCalls.find(
        (call) => call.id === id
      )
      if (found) return found
    }
    return undefined
  }

  private scheduleFlush() {
    if (this.flushHandle !== null) return
    this.flushHandle = requestAnimationFrame(() => {
      this.flushHandle = null
      this.flushText()
    })
  }

  private flushText() {
    if (this.pendingText === "") return
    const current = this.messages.value.at(-1)
    if (current) current.content += this.pendingText
    this.pendingText = ""
  }

  private fail(code: string) {
    this.flushText()
    this.lastError.value = code
    this.status.value = "error"
    const last = this.messages.value.at(-1)
    if (last?.isStreaming) last.isStreaming = false
  }

  private persist() {
    // eslint bans localStorage outright - PersistenceService is the only path.
    void this.persistence.setLocalConfig(
      PERSIST_KEY,
      JSON.stringify({
        conversationID: this.conversationID.value,
        contextEnabled: this.contextEnabled.value,
        // Cap history so long conversations do not bloat storage.
        messages: this.messages.value.slice(-50),
      })
    )
  }

  private async restore() {
    const raw = await this.persistence.getLocalConfig(PERSIST_KEY)
    if (!raw) return

    try {
      const parsed = JSON.parse(raw)
      this.conversationID.value = parsed.conversationID ?? null
      this.contextEnabled.value = parsed.contextEnabled ?? true
      this.messages.value = Array.isArray(parsed.messages)
        ? parsed.messages
        : []
    } catch {
      // Corrupt state is not worth surfacing - start clean.
    }
  }
}
