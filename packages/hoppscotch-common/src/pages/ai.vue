<template>
  <div class="flex h-full flex-1 flex-col">
    <AiChatPanel />
  </div>
</template>

<script setup lang="ts">
import { watch } from "vue"
import { useRouter } from "vue-router"
import { useAiChatVisibility } from "~/composables/aiChatVisibility"

const router = useRouter()
const { isAiChatVisible } = useAiChatVisibility()

// A stale deep-link should not strand the user once an admin disables the
// feature. Wait for the config fetch before deciding.
watch(
  isAiChatVisible,
  (visible) => {
    if (!visible) router.replace("/")
  },
  { immediate: false }
)
</script>
