import { Injectable, OnModuleInit } from '@nestjs/common';
import * as E from 'fp-ts/Either';
import { AI_NOT_CONFIGURED, AI_NOT_ENABLED } from 'src/errors';
import { InfraConfigService } from 'src/infra-config/infra-config.service';
import { PubSubService } from 'src/pubsub/pubsub.service';
import { AIProvider, InfraConfigEnum } from 'src/types/InfraConfig';
import { AiConfig } from './llm.types';

@Injectable()
export class LlmConfigService implements OnModuleInit {
  private cache: AiConfig | null = null;

  constructor(
    private readonly infraConfigService: InfraConfigService,
    private readonly pubsub: PubSubService,
  ) {}

  async onModuleInit() {
    // AI config is written through `updateAIConfigs`, which deliberately does
    // NOT restart the app. That means ConfigService's boot-time snapshot goes
    // stale, so this service reads from the DB and invalidates on the topic
    // updateAIConfigs publishes.
    const iterator = this.pubsub.asyncIterator<string>(
      `infra_config/${InfraConfigEnum.AI_ENABLED}/updated`,
    );

    void (async () => {
      // PubSubService exposes a bare AsyncIterator, so pull it by hand rather
      // than for-await (which needs Symbol.asyncIterator).
      while (true) {
        const next = await iterator.next();
        if (next.done) break;
        this.cache = null;
      }
    })();
  }

  /** Drop the cached config. Exposed for tests and for explicit refreshes. */
  invalidate() {
    this.cache = null;
  }

  async get(): Promise<AiConfig> {
    if (this.cache) return this.cache;

    const map = await this.infraConfigService.getInfraConfigsMap();
    const read = (key: InfraConfigEnum) => (map[key] ?? '').trim();
    const readInt = (key: InfraConfigEnum, fallback: number) => {
      const parsed = Number(read(key));
      return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
    };

    const provider =
      read(InfraConfigEnum.AI_PROVIDER) === AIProvider.AZURE_OPENAI
        ? AIProvider.AZURE_OPENAI
        : AIProvider.AZURE_FOUNDRY_ANTHROPIC;

    const config: AiConfig = {
      enabled: read(InfraConfigEnum.AI_ENABLED) === 'true',
      provider,
      model:
        provider === AIProvider.AZURE_OPENAI
          ? read(InfraConfigEnum.AI_AZURE_OPENAI_DEPLOYMENT)
          : read(InfraConfigEnum.AI_AZURE_FOUNDRY_MODEL),
      maxOutputTokens: readInt(InfraConfigEnum.AI_MAX_OUTPUT_TOKENS, 8192),
      maxToolIterations: readInt(InfraConfigEnum.AI_MAX_TOOL_ITERATIONS, 20),
      enableThinking: read(InfraConfigEnum.AI_ENABLE_THINKING) === 'true',
      mcpEnabled: read(InfraConfigEnum.AI_MCP_ENABLED) === 'true',
      foundry: {
        resource: read(InfraConfigEnum.AI_AZURE_FOUNDRY_RESOURCE),
        apiKey: read(InfraConfigEnum.AI_AZURE_FOUNDRY_API_KEY),
      },
      azureOpenAI: {
        endpoint: read(InfraConfigEnum.AI_AZURE_OPENAI_ENDPOINT),
        apiKey: read(InfraConfigEnum.AI_AZURE_OPENAI_API_KEY),
        deployment: read(InfraConfigEnum.AI_AZURE_OPENAI_DEPLOYMENT),
        apiVersion:
          read(InfraConfigEnum.AI_AZURE_OPENAI_API_VERSION) ||
          '2025-04-01-preview',
      },
      requestExecution: {
        enabled:
          read(InfraConfigEnum.AGENT_REQUEST_EXECUTION_ENABLED) === 'true',
        allowedHosts: read(InfraConfigEnum.AGENT_REQUEST_ALLOWED_HOSTS)
          .split(',')
          .map((host) => host.trim().toLowerCase())
          .filter((host) => host !== ''),
        timeoutMs: readInt(InfraConfigEnum.AGENT_REQUEST_TIMEOUT_MS, 30000),
        maxResponseBytes: readInt(
          InfraConfigEnum.AGENT_REQUEST_MAX_RESPONSE_BYTES,
          5242880,
        ),
      },
    };

    this.cache = config;
    return config;
  }

  /** Whether the selected provider has every credential it needs. */
  isConfigured(config: AiConfig): boolean {
    return config.provider === AIProvider.AZURE_OPENAI
      ? config.azureOpenAI.endpoint !== '' &&
          config.azureOpenAI.apiKey !== '' &&
          config.azureOpenAI.deployment !== ''
      : config.foundry.resource !== '' &&
          config.foundry.apiKey !== '' &&
          config.model !== '';
  }

  /** Config, or a Left explaining why AI is unusable. */
  async getEnabled(): Promise<E.Either<string, AiConfig>> {
    const config = await this.get();
    if (!config.enabled) return E.left(AI_NOT_ENABLED);
    if (!this.isConfigured(config)) return E.left(AI_NOT_CONFIGURED);
    return E.right(config);
  }
}
