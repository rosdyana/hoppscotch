import { mockDeep } from 'jest-mock-extended';
import * as E from 'fp-ts/Either';
import { AI_NOT_CONFIGURED, AI_NOT_ENABLED } from 'src/errors';
import { InfraConfigService } from 'src/infra-config/infra-config.service';
import { PubSubService } from 'src/pubsub/pubsub.service';
import { AIProvider, InfraConfigEnum } from 'src/types/InfraConfig';
import { LlmConfigService } from './llm-config.service';

const mockInfraConfig = mockDeep<InfraConfigService>();
const mockPubsub = mockDeep<PubSubService>();

const service = new LlmConfigService(mockInfraConfig, mockPubsub);

const FOUNDRY_MAP = {
  [InfraConfigEnum.AI_ENABLED]: 'true',
  [InfraConfigEnum.AI_PROVIDER]: AIProvider.AZURE_FOUNDRY_ANTHROPIC,
  [InfraConfigEnum.AI_AZURE_FOUNDRY_RESOURCE]: 'demo.azure.anthropic.com',
  [InfraConfigEnum.AI_AZURE_FOUNDRY_API_KEY]: 'secret',
  [InfraConfigEnum.AI_AZURE_FOUNDRY_MODEL]: 'claude-opus-5',
  [InfraConfigEnum.AI_MAX_OUTPUT_TOKENS]: '8192',
  [InfraConfigEnum.AI_MAX_TOOL_ITERATIONS]: '20',
};

describe('LlmConfigService', () => {
  beforeEach(() => {
    service.invalidate();
    jest.clearAllMocks();
  });

  describe('get', () => {
    it('should resolve Foundry config and select the Foundry model', async () => {
      mockInfraConfig.getInfraConfigsMap.mockResolvedValue({ ...FOUNDRY_MAP });

      const config = await service.get();

      expect(config.provider).toBe(AIProvider.AZURE_FOUNDRY_ANTHROPIC);
      expect(config.model).toBe('claude-opus-5');
      expect(config.foundry.resource).toBe('demo.azure.anthropic.com');
      expect(config.maxToolIterations).toBe(20);
    });

    it('should use the deployment name as the model for Azure OpenAI', async () => {
      mockInfraConfig.getInfraConfigsMap.mockResolvedValue({
        [InfraConfigEnum.AI_ENABLED]: 'true',
        [InfraConfigEnum.AI_PROVIDER]: AIProvider.AZURE_OPENAI,
        [InfraConfigEnum.AI_AZURE_OPENAI_DEPLOYMENT]: 'gpt-4o-prod',
      });

      const config = await service.get();

      expect(config.provider).toBe(AIProvider.AZURE_OPENAI);
      expect(config.model).toBe('gpt-4o-prod');
      expect(config.azureOpenAI.apiVersion).toBe('2025-04-01-preview');
    });

    it('should fall back to defaults for absent or invalid numeric config', async () => {
      mockInfraConfig.getInfraConfigsMap.mockResolvedValue({
        ...FOUNDRY_MAP,
        [InfraConfigEnum.AI_MAX_TOOL_ITERATIONS]: 'not-a-number',
        [InfraConfigEnum.AI_MAX_OUTPUT_TOKENS]: '0',
      });

      const config = await service.get();

      expect(config.maxToolIterations).toBe(20);
      expect(config.maxOutputTokens).toBe(8192);
    });

    it('should parse the allowed-hosts CSV, trimming and lowercasing', async () => {
      mockInfraConfig.getInfraConfigsMap.mockResolvedValue({
        ...FOUNDRY_MAP,
        [InfraConfigEnum.AGENT_REQUEST_ALLOWED_HOSTS]:
          ' API.example.com , *.internal.dev ,, ',
      });

      const config = await service.get();

      expect(config.requestExecution.allowedHosts).toEqual([
        'api.example.com',
        '*.internal.dev',
      ]);
    });

    it('should cache until invalidated', async () => {
      mockInfraConfig.getInfraConfigsMap.mockResolvedValue({ ...FOUNDRY_MAP });

      await service.get();
      await service.get();
      expect(mockInfraConfig.getInfraConfigsMap).toHaveBeenCalledTimes(1);

      service.invalidate();
      await service.get();
      expect(mockInfraConfig.getInfraConfigsMap).toHaveBeenCalledTimes(2);
    });
  });

  describe('getEnabled', () => {
    it('should reject when AI is switched off', async () => {
      mockInfraConfig.getInfraConfigsMap.mockResolvedValue({
        ...FOUNDRY_MAP,
        [InfraConfigEnum.AI_ENABLED]: 'false',
      });

      expect(await service.getEnabled()).toEqualLeft(AI_NOT_ENABLED);
    });

    it('should reject when enabled but credentials are incomplete', async () => {
      mockInfraConfig.getInfraConfigsMap.mockResolvedValue({
        ...FOUNDRY_MAP,
        [InfraConfigEnum.AI_AZURE_FOUNDRY_API_KEY]: '',
      });

      expect(await service.getEnabled()).toEqualLeft(AI_NOT_CONFIGURED);
    });

    it('should return the config when enabled and configured', async () => {
      mockInfraConfig.getInfraConfigsMap.mockResolvedValue({ ...FOUNDRY_MAP });

      const result = await service.getEnabled();

      expect(E.isRight(result)).toBe(true);
      if (E.isRight(result)) expect(result.right.model).toBe('claude-opus-5');
    });
  });
});
