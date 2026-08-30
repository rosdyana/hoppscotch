import { HoppRESTRequest } from "@hoppscotch/data"
import { getService } from "~/modules/dioc"
import { getCurrentEnvironment } from "~/newstore/environments"
import { settingsStore } from "~/newstore/settings"
import { WorkspaceService } from "~/services/workspace.service"
import { WorkspaceTabsService } from "~/services/tab/workspace-tabs"
import { HoppTabSaveContext } from "../tab/document"
import { HoppRESTResponse } from "../types/HoppRESTResponse"

/** Hard cap on what the chat ships as context. Pointers, never payloads. */
export const MAX_CONTEXT_CHARS = 4000

const MAX_BODY_PREVIEW_CHARS = 1500

export const REDACTED = "<redacted>"

/**
 * Header names whose value must never leave the browser.
 *
 * The name itself stays visible so the model can still reason about how a
 * request authenticates - it just never learns the credential.
 */
const SENSITIVE_HEADER_NAMES = /^(authorization|cookie|proxy-authorization)$/i
const SENSITIVE_HEADER_HINT = /(token|secret|key|password|auth)/i

export const isSensitiveHeaderName = (name: string) =>
  SENSITIVE_HEADER_NAMES.test(name.trim()) ||
  SENSITIVE_HEADER_HINT.test(name.trim())

export const redactHeaderValue = (name: string, value: string) =>
  isSensitiveHeaderName(name) && value !== "" ? REDACTED : value

export type AiChatContextRequest = {
  name: string
  method: string
  endpoint: string
  refId?: string
  origin?:
    | { type: "user-collection"; folderPath: string; requestIndex?: number }
    | { type: "team-collection"; requestID: string; collectionID?: string }
  headers: { key: string; value: string }[]
  params: { key: string; value: string }[]
  contentType: string | null
  bodyPreview?: string
  hasPreRequestScript: boolean
  hasTestScript: boolean
  lastResponse?: {
    statusCode: number
    statusText: string
    durationMs: number
    sizeBytes: number
  }
}

export type AiChatContext = {
  workspace:
    { type: "personal" } | { type: "team"; teamID: string; teamName: string }
  activeRequest: AiChatContextRequest | null
  environment: { name: string; keys: string[]; secretKeys: string[] } | null
  /**
   * Whether personal collections are synced to the backend. When they are not,
   * the server-side tools cannot see them at all and the assistant would
   * otherwise answer as if the workspace were empty.
   */
  syncEnabled: boolean
}

const toOrigin = (
  saveContext: HoppTabSaveContext | undefined
): AiChatContextRequest["origin"] => {
  if (!saveContext) return undefined

  return saveContext.originLocation === "user-collection"
    ? {
        type: "user-collection",
        folderPath: saveContext.folderPath,
        requestIndex: saveContext.requestIndex,
      }
    : {
        type: "team-collection",
        requestID: saveContext.requestID,
        collectionID: saveContext.collectionID,
      }
}

const toLastResponse = (
  response: HoppRESTResponse | null | undefined
): AiChatContextRequest["lastResponse"] => {
  if (!response) return undefined
  if (response.type !== "success" && response.type !== "failure")
    return undefined

  return {
    statusCode: response.statusCode,
    statusText: response.statusText,
    durationMs: response.meta.responseDuration,
    sizeBytes: response.meta.responseSize,
  }
}

const toContextRequest = (
  request: HoppRESTRequest,
  saveContext: HoppTabSaveContext | undefined,
  response: HoppRESTResponse | null | undefined
): AiChatContextRequest => {
  const body = request.body

  return {
    name: request.name,
    method: request.method,
    endpoint: request.endpoint,
    refId: request._ref_id,
    origin: toOrigin(saveContext),
    headers: request.headers
      .filter((header) => header.active !== false && header.key !== "")
      .map((header) => ({
        key: header.key,
        value: redactHeaderValue(header.key, header.value),
      })),
    params: request.params
      .filter((param) => param.active !== false && param.key !== "")
      .map((param) => ({ key: param.key, value: param.value })),
    contentType: body.contentType,
    bodyPreview:
      typeof body.body === "string" && body.body !== ""
        ? body.body.slice(0, MAX_BODY_PREVIEW_CHARS)
        : undefined,
    hasPreRequestScript: request.preRequestScript.trim() !== "",
    hasTestScript: request.testScript.trim() !== "",
    lastResponse: toLastResponse(response),
  }
}

/**
 * Snapshot of what the user is currently looking at, for the assistant.
 *
 * Deliberately pointers rather than payloads: ids and names the backend tools
 * can resolve, never the collection tree itself.
 */
export const buildAiChatContext = (): AiChatContext => {
  const workspaceService = getService(WorkspaceService)
  const tabsService = getService(WorkspaceTabsService)

  const workspace = workspaceService.currentWorkspace.value
  const document = tabsService.currentActiveTab.value?.document

  // The active tab can be a test-runner or a saved example - neither carries a
  // live request.
  const activeRequest =
    document?.type === "request"
      ? toContextRequest(
          document.request,
          document.saveContext ?? undefined,
          document.response
        )
      : null

  const currentEnv = getCurrentEnvironment()

  return {
    workspace:
      workspace.type === "team"
        ? {
            type: "team",
            teamID: workspace.teamID,
            teamName: workspace.teamName,
          }
        : { type: "personal" },
    activeRequest,
    environment:
      currentEnv.id === "" && currentEnv.variables.length === 0
        ? null
        : {
            name: currentEnv.name,
            keys: currentEnv.variables.map((variable) => variable.key),
            secretKeys: currentEnv.variables
              .filter((variable) => variable.secret)
              .map((variable) => variable.key),
          },
    syncEnabled: settingsStore.value.syncCollections,
  }
}

const renderKeyValues = (entries: { key: string; value: string }[]) =>
  entries.map(({ key, value }) => `  ${key}: ${value}`).join("\n")

/** Flatten the context into the text block the backend prepends to the turn. */
export const renderContextText = (context: AiChatContext): string => {
  const lines: string[] = []

  lines.push(
    context.workspace.type === "team"
      ? `Workspace: team "${context.workspace.teamName}" (workspaceId: ${context.workspace.teamID})`
      : "Workspace: personal"
  )

  if (!context.syncEnabled) {
    lines.push(
      "WARNING: collection sync is off, so personal collections are not visible to your tools."
    )
  }

  const request = context.activeRequest
  if (request) {
    lines.push("", "Open request tab:")
    lines.push(`  name: ${request.name}`)
    lines.push(`  ${request.method} ${request.endpoint}`)
    if (request.refId) lines.push(`  refId: ${request.refId}`)
    if (request.origin?.type === "user-collection") {
      // Deliberately not the folderPath: that is a slash-joined list of
      // indices that shifts on any insert or delete, and the tools take
      // collection ids. Naming it would invite the model to pass it as one.
      lines.push(
        "  saved in a collection in the personal workspace (find its id with hopp_search)"
      )
    } else if (request.origin?.type === "team-collection") {
      lines.push(`  requestId: ${request.origin.requestID}`)
      if (request.origin.collectionID) {
        lines.push(`  collectionId: ${request.origin.collectionID}`)
      }
    } else {
      lines.push("  not saved to any collection yet")
    }
    if (request.params.length > 0) {
      lines.push("  params:", renderKeyValues(request.params))
    }
    if (request.headers.length > 0) {
      lines.push(
        "  headers (secret values redacted):",
        renderKeyValues(request.headers)
      )
    }
    if (request.bodyPreview) {
      lines.push(`  body (${request.contentType}):`, `  ${request.bodyPreview}`)
    }
    if (request.hasPreRequestScript) lines.push("  has a pre-request script")
    if (request.hasTestScript) lines.push("  has a test script")
    if (request.lastResponse) {
      const { statusCode, statusText, durationMs, sizeBytes } =
        request.lastResponse
      lines.push(
        `  last response: ${statusCode} ${statusText}, ${durationMs}ms, ${sizeBytes} bytes`
      )
    }
  } else {
    lines.push("", "No HTTP request tab is open.")
  }

  if (context.environment) {
    lines.push("", `Selected environment: ${context.environment.name}`)
    if (context.environment.keys.length > 0) {
      lines.push(`  variables: ${context.environment.keys.join(", ")}`)
    }
    if (context.environment.secretKeys.length > 0) {
      lines.push(
        `  secret (values withheld): ${context.environment.secretKeys.join(", ")}`
      )
    }
  }

  const text = lines.join("\n")
  return text.length > MAX_CONTEXT_CHARS
    ? `${text.slice(0, MAX_CONTEXT_CHARS)}\n...[context truncated]`
    : text
}
