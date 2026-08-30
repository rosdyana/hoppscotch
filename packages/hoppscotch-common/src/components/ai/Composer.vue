<template>
  <div class="border-t border-divider p-3">
    <div
      v-if="aiChat.pendingAttachments.value.length > 0"
      class="mb-2 flex flex-wrap gap-2"
    >
      <HoppSmartFileChip
        v-for="attachment in aiChat.pendingAttachments.value"
        :key="attachment.localId"
        class="cursor-pointer"
        :title="t('ai_chat.attachment_remove')"
        @click="aiChat.removeAttachment(attachment.localId)"
      >
        {{ attachment.filename }}
      </HoppSmartFileChip>
    </div>

    <div
      class="flex items-end gap-2 rounded border border-divider bg-primaryLight p-2"
    >
      <textarea
        ref="textarea"
        v-model="draft"
        :placeholder="t('ai_chat.placeholder')"
        :disabled="disabled"
        rows="1"
        class="max-h-40 flex-1 resize-none bg-transparent text-secondaryDark placeholder-secondaryLight focus:outline-none"
        @input="autoGrow"
        @keydown="onKeydown"
      />

      <HoppButtonSecondary
        v-tippy="{ theme: 'tooltip' }"
        :icon="IconPaperclip"
        :disabled="disabled"
        :title="t('ai_chat.attach')"
        @click="pickFiles()"
      />

      <HoppButtonSecondary
        v-if="streaming"
        :icon="IconSquare"
        :title="t('ai_chat.stop')"
        filled
        outline
        @click="emit('stop')"
      />
      <HoppButtonPrimary
        v-else
        :icon="IconSend"
        :disabled="!canSend || disabled"
        :title="t('ai_chat.send')"
        @click="submit"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { useFileDialog } from "@vueuse/core"
import { useService } from "dioc/vue"
import { computed, nextTick, ref, watch } from "vue"
import IconPaperclip from "~icons/lucide/paperclip"
import IconSend from "~icons/lucide/send"
import IconSquare from "~icons/lucide/square"
import { useI18n } from "@composables/i18n"
import { useToast } from "@composables/toast"
import {
  AiChatService,
  ATTACHMENT_ACCEPT,
  MAX_ATTACHMENTS_PER_MESSAGE,
} from "~/services/ai-chat.service"

const t = useI18n()
const toast = useToast()
const aiChat = useService(AiChatService)

const props = defineProps<{ disabled: boolean; streaming: boolean }>()
const emit = defineEmits<{
  (e: "send", text: string): void
  (e: "stop"): void
}>()

const draft = ref("")
const textarea = ref<HTMLTextAreaElement | null>(null)

const canSend = computed(
  () => !!draft.value.trim() || aiChat.pendingAttachments.value.length > 0
)

const {
  files: pickedFiles,
  open: pickFiles,
  reset: resetPicker,
} = useFileDialog({
  accept: ATTACHMENT_ACCEPT,
  multiple: true,
  reset: true,
})

watch(pickedFiles, async (list) => {
  if (!list) return

  for (const file of Array.from(list).slice(0, MAX_ATTACHMENTS_PER_MESSAGE)) {
    const error = await aiChat.addAttachment(file)
    if (error) toast.error(`${t(`ai_chat.attachment_error_${error}`)}`)
  }

  resetPicker()
})

const autoGrow = () => {
  const el = textarea.value
  if (!el) return
  el.style.height = "auto"
  el.style.height = `${el.scrollHeight}px`
}

const submit = () => {
  if (!canSend.value || props.disabled) return

  emit("send", draft.value.trim())
  draft.value = ""
  void nextTick(autoGrow)
}

const onKeydown = (event: KeyboardEvent) => {
  // Enter sends; Shift+Enter is a newline.
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault()
    submit()
  }
}
</script>
