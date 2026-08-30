import { runGQLQuery } from "@hoppscotch/common/helpers/backend/GQLClient"
import { InfraPlatformDef } from "@hoppscotch/common/platform/infra"
import {
  GetAiChatConfigDocument,
  GetProxyAppUrlDocument,
  GetSmtpStatusDocument,
} from "@app/api/generated/graphql"
import * as E from "fp-ts/Either"

const getSMTPStatus = () => {
  return runGQLQuery({
    query: GetSmtpStatusDocument,
    variables: {},
  })
}

const getProxyAppUrl = () => {
  return runGQLQuery({
    query: GetProxyAppUrlDocument,
    variables: {},
  })
}

const getAiChatConfig = () => {
  return runGQLQuery({
    query: GetAiChatConfigDocument,
    variables: {},
  })
}

export const InfraPlatform: InfraPlatformDef = {
  getAiChatConfig: async () => {
    const res = await getAiChatConfig()

    if (E.isRight(res)) {
      return E.right(res.right.aiChatConfig)
    }

    return E.left("AI_CHAT_CONFIG_FETCH_FAILED")
  },
  getIsSMTPEnabled: async () => {
    const res = await getSMTPStatus()

    if (E.isRight(res)) {
      return E.right(res.right.isSMTPEnabled)
    }

    return E.left("SMTP_STATUS_FETCH_FAILED")
  },
  getProxyAppUrl: async () => {
    const res = await getProxyAppUrl()

    if (E.isRight(res)) {
      return E.right(res.right.proxyAppUrl)
    }

    return E.left("PROXY_APP_URL_FETCH_FAILED")
  },
}
