<template>
  <div class="flex h-full flex-col">
    <header
      class="flex flex-shrink-0 items-center gap-2 border-b border-divider px-4 py-2"
    >
      <icon-lucide-sparkles class="svg-icons flex-shrink-0 text-accent" />
      <h2 class="truncate text-secondaryDark">{{ t("ai_chat.title") }}</h2>

      <!-- The panel lives in a ~30% sidebar column now: the model chip is the
           first thing to go when there is no room for it. -->
      <span
        v-if="aiChat.model.value"
        class="hidden truncate rounded bg-primaryLight px-2 py-0.5 font-mono text-tiny text-secondaryLight lg:inline"
      >
        {{ aiChat.model.value }}
      </span>

      <HoppButtonSecondary
        v-tippy="{ theme: 'tooltip' }"
        class="ml-auto flex-shrink-0"
        :class="{ '!text-accent': aiChat.autoApprove.value }"
        :icon="aiChat.autoApprove.value ? IconZap : IconShieldCheck"
        :title="
          aiChat.autoApprove.value
            ? t('ai_chat.auto_approve_on')
            : t('ai_chat.auto_approve_off')
        "
        @click="onToggleAutoApprove"
      />

      <HoppButtonSecondary
        v-tippy="{ theme: 'tooltip' }"
        class="flex-shrink-0"
        :icon="IconPlus"
        :title="t('ai_chat.new_chat')"
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
        @answer="onAnswer"
      />

      <div
        v-if="aiChat.lastError.value"
        class="mx-4 my-2 rounded border border-red-500/50 bg-primaryLight px-3 py-2 text-tiny text-red-500"
      >
        {{ errorMessage }}
      </div>
    </div>

    <div
      v-if="aiChat.pendingApprovals.value.length > 1"
      class="flex flex-wrap items-center gap-2 border-t border-divider px-3 py-2 text-tiny"
    >
      <span class="text-secondaryLight">
        {{
          t("ai_chat.pending_count", {
            count: aiChat.pendingApprovals.value.length,
          })
        }}
      </span>
      <HoppButtonPrimary
        class="ml-auto"
        :label="t('ai_chat.approve_all')"
        @click="aiChat.respondToAllApprovals('approve')"
      />
      <HoppButtonSecondary
        :label="t('ai_chat.reject_all')"
        filled
        outline
        @click="aiChat.respondToAllApprovals('reject')"
      />
    </div>

    <AiContextChip />

    <AiComposer
      :disabled="!aiChat.isEnabled.value"
      :streaming="aiChat.status.value === 'streaming'"
      @send="onSend"
      @stop="aiChat.stop()"
    />

    <HoppSmartConfirmModal
      :show="confirmingAutoApprove"
      :title="t('ai_chat.auto_approve_confirm')"
      :confirm="t('ai_chat.auto_approve_enable')"
      @hide-modal="confirmingAutoApprove = false"
      @resolve="enableAutoApprove"
    />
  </div>
</template>

<script setup lang="ts">
import { useService } from "dioc/vue"
import { computed, nextTick, ref, watch } from "vue"
import IconPlus from "~icons/lucide/plus"
import IconShieldCheck from "~icons/lucide/shield-check"
import IconZap from "~icons/lucide/zap"
import { useI18n } from "@composables/i18n"
import { applySetting } from "~/newstore/settings"
import { AiChatService } from "~/services/ai-chat.service"

const t = useI18n()
const aiChat = useService(AiChatService)

const scroller = ref<HTMLElement | null>(null)
const confirmingAutoApprove = ref(false)

const errorMessage = computed(() => {
  const code = aiChat.lastError.value
  if (!code) return ""
  if (code === "ai/not_enabled") return t("ai_chat.error_disabled")
  if (code === "ai/not_configured") return t("ai_chat.error_not_configured")
  if (code === "ai/attachment_upload_failed")
    return t("ai_chat.error_attachment_upload")
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

const onAnswer = (id: string, answer: string) => {
  void aiChat.answerQuestion(id, answer).then(scrollToBottom)
}

// Turning it off is harmless; turning it on is the direction that needs saying
// out loud, so only that way round asks.
const onToggleAutoApprove = () => {
  if (aiChat.autoApprove.value) {
    applySetting("AI_CHAT_AUTO_APPROVE", false)
    return
  }
  confirmingAutoApprove.value = true
}

const enableAutoApprove = () => {
  applySetting("AI_CHAT_AUTO_APPROVE", true)
  confirmingAutoApprove.value = false

  // Anything already waiting was proposed under the old rule; clear it in one
  // batch rather than leaving cards the user now has to click anyway.
  if (aiChat.pendingApprovals.value.length > 0) {
    void aiChat.respondToAllApprovals("approve").then(scrollToBottom)
  }
}
</script>
