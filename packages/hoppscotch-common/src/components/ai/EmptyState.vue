<template>
  <div class="flex flex-1 flex-col items-center justify-center gap-4 p-8">
    <icon-lucide-sparkles class="svg-icons text-4xl text-accent opacity-60" />
    <h3 class="text-secondaryDark">{{ t("ai_chat.empty_state_title") }}</h3>

    <div class="flex max-w-md flex-wrap justify-center gap-2">
      <button
        v-for="suggestion in suggestions"
        :key="suggestion"
        class="rounded border border-divider bg-primaryLight px-3 py-1.5 text-tiny text-secondaryLight hover:text-secondaryDark"
        @click="emit('pick', suggestion)"
      >
        {{ suggestion }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue"
import { useI18n } from "@composables/i18n"

const t = useI18n()
const emit = defineEmits<{ (e: "pick", text: string): void }>()

const suggestions = computed(() => [
  t("ai_chat.suggestion_list_collections"),
  t("ai_chat.suggestion_explain_collection"),
  t("ai_chat.suggestion_generate_tests"),
])
</script>
