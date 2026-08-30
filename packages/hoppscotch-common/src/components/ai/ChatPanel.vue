<template>
  <div class="flex h-full flex-col">
    <header class="flex items-center gap-2 border-b border-divider px-4 py-2">
      <icon-lucide-sparkles class="svg-icons text-accent" />
      <h2 class="text-secondaryDark">{{ t("ai_chat.title") }}</h2>

      <span
        v-if="aiChat.model.value"
        class="rounded bg-primaryLight px-2 py-0.5 font-mono text-tiny text-secondaryLight"
      >
        {{ aiChat.model.value }}
      </span>

      <HoppButtonSecondary
        class="ml-auto"
        :icon="IconPlus"
        :label="t('ai_chat.new_chat')"
        filled
        outline
        @click="aiChat.newConversation()"
      />
    </header>

    <div ref="scroller" class="flex flex-1 flex-col overflow-y-auto">
      <AiEmptyState v-if="aiChat.messages.value.length === 0" @pick="onSend" />

      <AiMessageBubble
        v-for="message in aiChat.messages.value"
        v-else
        :key="message.id"
        :message="message"
        @approve="onApprove"
        @reject="onReject"
      />

      <div
        v-if="aiChat.lastError.value"
        class="mx-4 my-2 rounded border border-red-500/50 bg-primaryLight px-3 py-2 text-tiny text-red-500"
      >
        {{ errorMessage }}
      </div>
    </div>

    <AiComposer
      :disabled="!aiChat.isEnabled.value"
      :streaming="aiChat.status.value === 'streaming'"
      @send="onSend"
      @stop="aiChat.stop()"
    />
  </div>
</template>

<script setup lang="ts">
import { useService } from "dioc/vue"
import { computed, nextTick, ref, watch } from "vue"
import IconPlus from "~icons/lucide/plus"
import { useI18n } from "@composables/i18n"
import { AiChatService } from "~/services/ai-chat.service"

const t = useI18n()
const aiChat = useService(AiChatService)

const scroller = ref<HTMLElement | null>(null)

const errorMessage = computed(() => {
  const code = aiChat.lastError.value
  if (!code) return ""
  if (code === "ai/not_enabled") return t("ai_chat.error_disabled")
  if (code === "ai/not_configured") return t("ai_chat.error_not_configured")
  if (code.startsWith("ai/request_failed")) return t("ai_chat.error_network")
  return code
})

const scrollToBottom = async () => {
  await nextTick()
  const el = scroller.value
  if (el) el.scrollTop = el.scrollHeight
}

// Follow the stream as it grows.
watch(
  () => [
    aiChat.messages.value.length,
    aiChat.messages.value.at(-1)?.content.length,
  ],
  scrollToBottom
)

const onSend = (text: string) => {
  void aiChat.send(text).then(scrollToBottom)
}

const onApprove = (id: string) => {
  void aiChat.respondToApproval(id, "approve").then(scrollToBottom)
}

const onReject = (id: string) => {
  void aiChat.respondToApproval(id, "reject").then(scrollToBottom)
}
</script>
