<template>
  <div
    class="my-2 rounded border bg-primaryLight"
    :class="isDestructive ? 'border-red-500/60' : 'border-divider'"
  >
    <div class="flex items-start gap-2 px-3 py-2">
      <icon-lucide-shield-alert
        v-if="isDestructive"
        class="svg-icons mt-0.5 flex-shrink-0 text-red-500"
      />
      <icon-lucide-pencil
        v-else
        class="svg-icons mt-0.5 flex-shrink-0 text-secondaryLight"
      />
      <div class="flex-1">
        <p class="text-secondaryDark">{{ preview.summary }}</p>
        <p
          v-for="warning in preview.warnings"
          :key="warning"
          class="mt-1 text-tiny text-red-500"
        >
          {{ warning }}
        </p>
      </div>
    </div>

    <!-- Text-shaped changes get a real diff; structural ones read better as JSON.
         The card lives in a ~30% sidebar column, where a side-by-side merge view
         is unreadable, so it stays folded until asked for. -->
    <div v-if="showDiff" class="border-t border-divider">
      <button
        class="flex w-full items-center gap-2 px-3 py-2 text-left text-tiny text-secondaryLight"
        @click="diffOpen = !diffOpen"
      >
        <icon-lucide-chevron-down
          class="svg-icons transition"
          :class="{ 'rotate-180': diffOpen }"
        />
        {{ diffOpen ? t("ai_chat.hide_diff") : t("ai_chat.view_diff") }}
      </button>
      <div
        v-if="diffOpen"
        class="max-h-64 overflow-auto border-t border-divider"
      >
        <AiexperimentsMergeView
          :content-left="{ content: beforeText, langMime: 'application/json' }"
          :content-right="{ content: afterText, langMime: 'application/json' }"
        />
      </div>
    </div>

    <div
      class="flex flex-wrap items-center gap-2 border-t border-divider px-3 py-2"
      :class="{ 'opacity-60 pointer-events-none': isBusy }"
    >
      <HoppButtonPrimary
        :label="t('ai_chat.confirm_approve')"
        :loading="call.status === 'approving'"
        @click="emit('approve', call.id)"
      />
      <HoppButtonSecondary
        :label="t('ai_chat.confirm_reject')"
        filled
        outline
        @click="emit('reject', call.id)"
      />
      <span class="ml-auto text-tiny text-secondaryLight">
        {{ t("ai_chat.confirm_hint") }}
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue"
import { useI18n } from "@composables/i18n"
import { AiToolCall, AiToolPreview } from "~/services/ai-chat.service"

const t = useI18n()

const props = defineProps<{ call: AiToolCall }>()
const emit = defineEmits<{
  (e: "approve", id: string): void
  (e: "reject", id: string): void
}>()

const preview = computed<AiToolPreview>(
  () =>
    props.call.preview ?? {
      summary: props.call.name,
      before: null,
      after: null,
      warnings: [],
    }
)

const isDestructive = computed(() => preview.value.warnings.length > 0)
const isBusy = computed(() => props.call.status === "approving")

const diffOpen = ref(false)

const stringify = (value: unknown) =>
  value === null || value === undefined ? "" : JSON.stringify(value, null, 2)

const beforeText = computed(() => stringify(preview.value.before))
const afterText = computed(() => stringify(preview.value.after))

// A diff of "" against "" is noise; only show one when there is something to compare.
const showDiff = computed(
  () => beforeText.value !== "" || afterText.value !== ""
)
</script>
