import { Injectable } from '@nestjs/common';
import * as E from 'fp-ts/Either';
import { AIProvider } from 'src/types/InfraConfig';
import { LlmConfigService } from './llm-config.service';
import { AiConfig, NormalizedTurn, StreamTurnParams } from './llm.types';
import { AnthropicFoundryProvider } from './providers/anthropic-foundry.provider';
import { AzureOpenAIProvider } from './providers/azure-openai.provider';
import { LlmProvider } from './providers/llm-provider.interface';

@Injectable()
export class LlmService {
  // Providers cannot be bound at boot: admins change credentials and model
  // without restarting the server. Memoise on the settings that define the
  // client so we are not rebuilding an HTTP client per turn either.
  private cached: { key: string; provider: LlmProvider } | null = null;

  constructor(private readonly llmConfig: LlmConfigService) {}

  private providerKey(config: AiConfig): string {
    return config.provider === AIProvider.AZURE_OPENAI
      ? [
          config.provider,
          config.azureOpenAI.endpoint,
          config.azureOpenAI.apiKey,
          config.azureOpenAI.deployment,
          config.azureOpenAI.apiVersion,
        ].join('|')
      : [
          config.provider,
          config.foundry.resource,
          config.foundry.apiKey,
          config.model,
          String(config.enableThinking),
        ].join('|');
  }

  getProvider(config: AiConfig): LlmProvider {
    const key = this.providerKey(config);
    if (this.cached?.key === key) return this.cached.provider;

    const provider: LlmProvider =
      config.provider === AIProvider.AZURE_OPENAI
        ? new AzureOpenAIProvider({
            endpoint: config.azureOpenAI.endpoint,
            apiKey: config.azureOpenAI.apiKey,
            deployment: config.azureOpenAI.deployment,
            apiVersion: config.azureOpenAI.apiVersion,
          })
        : new AnthropicFoundryProvider({
            resource: config.foundry.resource,
            apiKey: config.foundry.apiKey,
            model: config.model,
            enableThinking: config.enableThinking,
          });

    this.cached = { key, provider };
    return provider;
  }

  /**
   * Stream one assistant turn using the currently configured provider.
   *
   * Returns a Left when AI is off or misconfigured, or when the provider
   * rejected the call - the caller surfaces that to the client rather than
   * leaking a provider stack trace.
   */
  async streamTurn(
    params: StreamTurnParams,
  ): Promise<E.Either<string, NormalizedTurn>> {
    const configResult = await this.llmConfig.getEnabled();
    if (E.isLeft(configResult)) return E.left(configResult.left);

    try {
      const provider = this.getProvider(configResult.right);
      return E.right(await provider.streamTurn(params));
    } catch (e) {
      // Providers throw our mapped error constant as the message.
      return E.left(e instanceof Error ? e.message : String(e));
    }
  }
}
