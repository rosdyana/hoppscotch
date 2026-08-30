import { Module } from '@nestjs/common';
import { AccessTokenModule } from 'src/access-token/access-token.module';
import { AgentToolsModule } from 'src/agent-tools/agent-tools.module';
import { LlmModule } from 'src/llm/llm.module';
import { McpEnabledGuard } from './mcp-enabled.guard';
import { McpServerFactory } from './mcp-server.factory';
import { McpController } from './mcp.controller';

@Module({
  imports: [AgentToolsModule, LlmModule, AccessTokenModule],
  providers: [McpServerFactory, McpEnabledGuard],
  controllers: [McpController],
})
export class McpModule {}
