<template>
  <div class="border-t border-divider px-3 pt-2 text-tiny">
    <div class="flex items-center gap-2">
      <button
        class="flex min-w-0 flex-1 items-center gap-2 text-left text-secondaryLight hover:text-secondaryDark"
        :aria-expanded="expanded"
        @click="expanded = !expanded"
      >
        <icon-lucide-at-sign class="svg-icons flex-shrink-0" />
        <span class="truncate">{{ summary }}</span>
        <icon-lucide-chevron-down
          class="svg-icons flex-shrink-0 transition"
          :class="{ 'rotate-180': expanded }"
        />
      </button>

      <span
        v-tippy="{ theme: 'tooltip' }"
        :title="t('ai_chat.context_toggle')"
        class="flex-shrink-0"
      >
        <HoppSmartToggle
          :on="aiChat.contextEnabled.value"
          @change="aiChat.contextEnabled.value = !aiChat.contextEnabled.value"
        >
          <span class="sr-only">{{ t("ai_chat.context_toggle") }}</span>
        </HoppSmartToggle>
      </span>
    </div>

    <p
      v-if="aiChat.contextEnabled.value && !context.syncEnabled"
      class="mt-1 flex items-start gap-1 text-yellow-500"
    >
      <icon-lucide-alert-triangle class="svg-icons mt-0.5 flex-shrink-0" />
      <span>{{ t("ai_chat.context_sync_off") }}</span>
    </p>

    <pre
      v-if="expanded"
      class="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-primaryLight p-2 font-mono text-secondaryLight"
      >{{ contextText }}</pre>
  </div>
</template>

<script setup lang="ts">
import { useService } from "dioc/vue"
import { computed, ref } from "vue"
import { useI18n } from "@composables/i18n"
import { renderContextText } from "~/helpers/ai/context"
import { AiChatService } from "~/services/ai-chat.service"

const t = useI18n()
const aiChat = useService(AiChatService)

const expanded = ref(false)

const context = computed(() => aiChat.context.value)
const contextText = computed(() => renderContextText(context.value))

const summary = computed(() => {
  if (!aiChat.contextEnabled.value) return t("ai_chat.context_off")

  const workspace =
    context.value.workspace.type === "team"
      ? context.value.workspace.teamName
      : t("workspace.personal")

  const request = context.value.activeRequest
  return request
    ? `${workspace} · ${request.method} ${request.name}`
    : `${workspace} · ${t("ai_chat.context_no_request")}`
})
</script>
