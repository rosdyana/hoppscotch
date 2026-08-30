import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { AgentToolSpec } from 'src/llm/llm.types';
import { AgentTool } from './agent-tool.types';

/**
 * The one place tools are declared. Both the chat agent loop and the MCP
 * server enumerate this registry, so a tool added here appears on both
 * surfaces with no further wiring.
 */
@Injectable()
export class AgentToolRegistry {
  private readonly tools = new Map<string, AgentTool<any>>();

  register(tool: AgentTool<any>) {
    this.tools.set(tool.name, tool);
  }

  registerAll(tools: AgentTool<any>[]) {
    tools.forEach((tool) => this.register(tool));
  }

  get(name: string): AgentTool<any> | undefined {
    return this.tools.get(name);
  }

  list(): AgentTool<any>[] {
    return [...this.tools.values()];
  }

  /**
   * Tool specs for the LLM providers, with JSON Schema derived from the same
   * Zod shapes MCP consumes directly.
   */
  toLlmSpecs(): AgentToolSpec[] {
    return this.list().map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: zodToJsonSchema(z.object(tool.input), {
        target: 'jsonSchema7',
        $refStrategy: 'none',
      }) as Record<string, unknown>,
    }));
  }
}
