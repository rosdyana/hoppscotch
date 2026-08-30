import { platform } from "@hoppscotch/common/platform"
import { ExperimentsPlatformDef } from "@hoppscotch/common/platform/experiments"
import * as E from "fp-ts/Either"

const AI_BASE = `${import.meta.env.VITE_BACKEND_API_URL}/ai`

/**
 * Call an inline AI endpoint.
 *
 * The backend holds the vendor credentials, so the browser only ever sees the
 * generated text. A 403 means the admin has AI switched off - the composables
 * already surface that through their E.isLeft branches.
 */
const post = async <T>(
  path: string,
  body: unknown
): Promise<E.Either<string, T>> => {
  try {
    const res = await fetch(`${AI_BASE}${path}`, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...platform.auth.getBackendHeaders(),
      },
      body: JSON.stringify(body),
    })

    if (!res.ok) return E.left(`AI_REQUEST_FAILED_${res.status}`)

    return E.right((await res.json()) as T)
  } catch {
    return E.left("AI_NETWORK_ERROR")
  }
}

export const ExperimentsPlatform: ExperimentsPlatformDef = {
  aiExperiments: {
    // "This platform CAN do AI" - PlatformDef is frozen before login, so the
    // admin's runtime toggle is enforced by the endpoints returning 403.
    enableAIExperiments: true,

    generateRequestName: (requestInfo, namingStyle) =>
      post("/generate-request-name", { requestInfo, namingStyle }),

    modifyRequestBody: (requestBody, userPrompt) =>
      post("/modify-request-body", { requestBody, userPrompt }),

    modifyPreRequestScript: (requestInfo, userPrompt) =>
      post("/modify-pre-request-script", { requestInfo, userPrompt }),

    modifyTestScript: (requestInfo, userPrompt) =>
      post("/modify-test-script", { requestInfo, userPrompt }),

    submitFeedback: async (rating, traceID) => {
      const res = await post("/feedback", { positive: rating === 1, traceID })
      return E.isLeft(res) ? E.left(res.left) : E.right(undefined)
    },
  },
}
