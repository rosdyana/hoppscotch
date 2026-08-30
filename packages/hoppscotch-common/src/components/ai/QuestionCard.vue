<template>
  <div class="my-2 rounded border border-accent/50 bg-primaryLight">
    <div class="flex items-start gap-2 px-3 py-2">
      <icon-lucide-help-circle
        class="svg-icons mt-0.5 flex-shrink-0 text-accent"
      />
      <p class="flex-1 text-secondaryDark">{{ question.question }}</p>
    </div>

    <div
      v-if="question.options.length > 0"
      class="flex flex-wrap gap-2 px-3 pb-2"
    >
      <HoppButtonSecondary
        v-for="option in question.options"
        :key="option"
        :label="option"
        filled
        outline
        @click="emit('answer', call.id, option)"
      />
    </div>

    <div
      v-if="question.allowFreeText"
      class="flex items-end gap-2 border-t border-divider px-3 py-2"
    >
      <input
        v-model="freeText"
        type="text"
        :placeholder="t('ai_chat.answer_placeholder')"
        class="flex-1 bg-transparent text-secondaryDark placeholder-secondaryLight focus:outline-none"
        @keydown.enter.prevent="submit"
      />
      <HoppButtonPrimary
        :icon="IconSend"
        :disabled="!freeText.trim()"
        :title="t('ai_chat.send')"
        @click="submit"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue"
import IconSend from "~icons/lucide/send"
import { useI18n } from "@composables/i18n"
import { AiToolCall, AiToolQuestion } from "~/services/ai-chat.service"

const t = useI18n()

const props = defineProps<{ call: AiToolCall }>()
const emit = defineEmits<{
  (e: "answer", id: string, answer: string): void
}>()

const freeText = ref("")

const question = computed<AiToolQuestion>(
  () =>
    props.call.question ?? {
      question: props.call.name,
      options: [],
      allowFreeText: true,
    }
)

const submit = () => {
  const answer = freeText.value.trim()
  if (!answer) return
  emit("answer", props.call.id, answer)
  freeText.value = ""
}
</script>
