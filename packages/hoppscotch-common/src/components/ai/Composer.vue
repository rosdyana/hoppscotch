<template>
  <div class="border-t border-divider p-3">
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
        :disabled="!draft.trim() || disabled"
        :title="t('ai_chat.send')"
        @click="submit"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { nextTick, ref } from "vue"
import IconSend from "~icons/lucide/send"
import IconSquare from "~icons/lucide/square"
import { useI18n } from "@composables/i18n"

const t = useI18n()

const props = defineProps<{ disabled: boolean; streaming: boolean }>()
const emit = defineEmits<{
  (e: "send", text: string): void
  (e: "stop"): void
}>()

const draft = ref("")
const textarea = ref<HTMLTextAreaElement | null>(null)

const autoGrow = () => {
  const el = textarea.value
  if (!el) return
  el.style.height = "auto"
  el.style.height = `${el.scrollHeight}px`
}

const submit = () => {
  const text = draft.value.trim()
  if (!text || props.disabled) return

  emit("send", text)
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
