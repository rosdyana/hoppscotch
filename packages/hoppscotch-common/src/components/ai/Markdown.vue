<template>
  <!-- eslint-disable-next-line vue/no-v-html -->
  <div class="ai-markdown" v-html="rendered" />
</template>

<script setup lang="ts">
import DOMPurify from "dompurify"
import MarkdownIt from "markdown-it"
import { computed } from "vue"

const props = defineProps<{ source: string }>()

// Model output is untrusted: it can contain script tags or event handlers,
// so everything is sanitized before it reaches v-html. (app/Markdown.vue does
// no sanitization, which is why it is not reused here.)
const md = new MarkdownIt({ html: false, linkify: true, breaks: true })

const rendered = computed(() =>
  DOMPurify.sanitize(md.render(props.source ?? ""), {
    ADD_ATTR: ["target", "rel"],
  })
)
</script>

<style lang="scss" scoped>
.ai-markdown {
  @apply text-secondaryDark;
  @apply leading-relaxed;

  :deep(p) {
    @apply my-2;
  }

  :deep(ul),
  :deep(ol) {
    @apply my-2 pl-5;
    @apply list-disc;
  }

  :deep(ol) {
    @apply list-decimal;
  }

  :deep(code) {
    @apply bg-primaryDark;
    @apply text-tiny;
    @apply px-1 py-0.5 rounded;
    @apply font-mono;
  }

  :deep(pre) {
    @apply bg-primaryDark;
    @apply p-3 my-2 rounded;
    @apply overflow-x-auto;

    code {
      @apply bg-transparent p-0;
    }
  }

  :deep(a) {
    @apply text-accent underline;
  }

  :deep(h1),
  :deep(h2),
  :deep(h3) {
    @apply font-semibold my-2;
  }

  :deep(table) {
    @apply my-2 w-full;

    th,
    td {
      @apply border border-divider px-2 py-1 text-left;
    }
  }
}
</style>
