import * as E from "fp-ts/Either"

type ProxyAppUrl = {
  value: string
  name: string
}

/**
 * AI availability, as reported by the server.
 *
 * Deliberately carries no credentials - only whether the feature is usable and
 * which model the server will use.
 */
export type AiChatConfig = {
  enabled: boolean
  mcpEnabled: boolean
  requestExecutionEnabled: boolean
  models: string[]
  defaultModel: string | null
}

export type InfraPlatformDef = {
  getIsSMTPEnabled?: () => Promise<E.Either<string, boolean>>
  getProxyAppUrl?: () => Promise<E.Either<string, ProxyAppUrl>>
  getAiChatConfig?: () => Promise<E.Either<string, AiChatConfig>>
}
