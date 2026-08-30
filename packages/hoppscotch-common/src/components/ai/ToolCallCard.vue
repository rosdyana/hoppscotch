<template>
  <div
    class="my-2 rounded border border-divider bg-primaryLight text-tiny"
    :class="{ 'border-red-500/50': call.status === 'failed' }"
  >
    <button
      class="flex w-full items-center gap-2 px-3 py-2 text-left"
      @click="expanded = !expanded"
    >
      <component
        :is="statusIcon"
        class="svg-icons flex-shrink-0"
        :class="statusClass"
      />
      <span class="font-mono text-secondaryDark">{{ call.name }}</span>
      <span class="ml-auto text-secondaryLight">{{ statusLabel }}</span>
      <icon-lucide-chevron-down
        class="svg-icons transition"
        :class="{ 'rotate-180': expanded }"
      />
    </button>

    <div v-if="expanded && call.args" class="border-t border-divider px-3 py-2">
      <pre class="overflow-x-auto font-mono text-secondaryLight">{{
        JSON.stringify(call.args, null, 2)
      }}</pre>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue"
import IconCheck from "~icons/lucide/check"
import IconLoader from "~icons/lucide/loader"
import IconX from "~icons/lucide/x"
import { useI18n } from "@composables/i18n"
import { AiToolCall } from "~/services/ai-chat.service"

const t = useI18n()
const props = defineProps<{ call: AiToolCall }>()

const expanded = ref(false)

const statusIcon = computed(() => {
  if (props.call.status === "running") return IconLoader
  if (props.call.status === "failed" || props.call.status === "rejected")
    return IconX
  return IconCheck
})

const statusClass = computed(() => {
  if (props.call.status === "running") return "animate-spin text-secondaryLight"
  if (props.call.status === "failed" || props.call.status === "rejected")
    return "text-red-500"
  return "text-green-500"
})

const statusLabel = computed(() => {
  switch (props.call.status) {
    case "running":
      return t("ai_chat.tool_running")
    case "failed":
      return t("ai_chat.tool_failed")
    case "rejected":
      return t("ai_chat.rejected")
    case "applied":
      return t("ai_chat.applied")
    default:
      return ""
  }
})
</script>
