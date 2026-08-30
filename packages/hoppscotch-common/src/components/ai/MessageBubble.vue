<template>
  <div class="flex gap-3 px-4 py-3">
    <div class="flex-shrink-0 pt-0.5">
      <icon-lucide-user
        v-if="message.role === 'user'"
        class="svg-icons text-secondaryLight"
      />
      <icon-lucide-sparkles v-else class="svg-icons text-accent" />
    </div>

    <div class="min-w-0 flex-1">
      <p
        v-if="message.role === 'user'"
        class="whitespace-pre-wrap text-secondaryDark"
      >
        {{ message.content }}
      </p>

      <template v-else>
        <AiMarkdown v-if="message.content" :source="message.content" />

        <span
          v-if="message.isStreaming && !message.content"
          class="text-tiny text-secondaryLight"
        >
          {{ t("ai_chat.thinking") }}
        </span>

        <template v-for="call in message.toolCalls" :key="call.id">
          <AiWriteConfirmCard
            v-if="
              call.status === 'awaiting-approval' || call.status === 'approving'
            "
            :call="call"
            @approve="emit('approve', $event)"
            @reject="emit('reject', $event)"
          />
          <AiToolCallCard v-else :call="call" />
        </template>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from "@composables/i18n"
import { AiChatMessage } from "~/services/ai-chat.service"

const t = useI18n()

defineProps<{ message: AiChatMessage }>()
const emit = defineEmits<{
  (e: "approve", id: string): void
  (e: "reject", id: string): void
}>()
</script>
