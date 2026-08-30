import { CanActivate, ForbiddenException, Injectable } from '@nestjs/common';
import { LlmConfigService } from 'src/llm/llm-config.service';
import { MCP_NOT_ENABLED } from 'src/errors';

/**
 * Gates /mcp on the admin toggle.
 *
 * Runs before PATAuthGuard so a disabled server does not become a token
 * validation oracle.
 */
@Injectable()
export class McpEnabledGuard implements CanActivate {
  constructor(private readonly llmConfig: LlmConfigService) {}

  async canActivate(): Promise<boolean> {
    const config = await this.llmConfig.get();
    if (!config.mcpEnabled) throw new ForbiddenException(MCP_NOT_ENABLED);
    return true;
  }
}
