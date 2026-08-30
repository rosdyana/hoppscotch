import { computed } from "vue"
import { useService } from "dioc/vue"
import { useSetting } from "~/composables/settings"
import { useReadonlyStream } from "~/composables/stream"
import { platform } from "~/platform"
import { AiChatService } from "~/services/ai-chat.service"

/**
 * Whether the AI chat surface should be shown.
 *
 * Three gates: the admin enabled it server-side, the user has not opted out
 * locally, and someone is signed in (the backend scopes everything by user).
 */
export function useAiChatVisibility() {
  const ENABLE_AI_CHAT = useSetting("ENABLE_AI_CHAT")
  const aiChat = useService(AiChatService)

  const currentUser = useReadonlyStream(
    platform.auth.getCurrentUserStream(),
    platform.auth.getCurrentUser()
  )

  const isAiChatVisible = computed(
    () => aiChat.isEnabled.value && ENABLE_AI_CHAT.value && !!currentUser.value
  )

  return { isAiChatVisible }
}
