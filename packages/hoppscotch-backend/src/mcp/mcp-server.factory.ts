import { Injectable } from '@nestjs/common';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { AgentToolExecutor } from 'src/agent-tools/agent-tool.executor';
import { AgentToolRegistry } from 'src/agent-tools/agent-tool.registry';
import { AuthUser } from 'src/types/AuthUser';

/** Shape MCP expects back from a tool handler. */
type McpToolResponse = {
  content: { type: 'text'; text: string }[];
  isError?: boolean;
};

@Injectable()
export class McpServerFactory {
  constructor(
    private readonly registry: AgentToolRegistry,
    private readonly executor: AgentToolExecutor,
  ) {}

  /**
   * Build a fresh server + transport for one request.
   *
   * Stateless (`sessionIdGenerator: undefined`) on purpose: the app SIGTERMs
   * itself on infra-config writes, so any session map would be both a
   * liability and a leak. It also keeps the door open for horizontal scaling.
   */
  create(user: AuthUser, pinnedWorkspaceId?: string) {
    const server = new McpServer({
      name: 'hoppscotch',
      version: '1.0.0',
    });

    // registerTool infers deeply over the Zod shape; with a heterogeneous
    // registry that tips TypeScript into TS2589. The runtime contract is
    // exercised by the tests below, so widen just this call signature.
    const registerTool = server.registerTool.bind(server) as (
      name: string,
      config: Record<string, unknown>,
      cb: (args: Record<string, unknown>) => Promise<McpToolResponse>,
    ) => void;

    for (const tool of this.registry.list()) {
      registerTool(
        tool.name,
        {
          title: tool.title,
          description: tool.description,
          // The same Zod shape the LLM providers get as JSON Schema.
          inputSchema: tool.input,
          annotations: {
            readOnlyHint: tool.readOnly,
            destructiveHint: tool.destructive,
            idempotentHint: tool.idempotent,
            openWorldHint: tool.openWorld,
          },
        },
        async (args: Record<string, unknown>) => {
          const result = await this.executor.run({
            name: tool.name,
            input: args,
            user,
            workspaceId: pinnedWorkspaceId ?? (args?.workspaceId as string),
            source: 'mcp',
            // MCP clients do their own confirmation via the annotations above;
            // there is no channel here to render a diff or hold a JSON-RPC
            // call open pending human input.
            policy: 'client-confirms',
          });

          if (result.kind === 'proposal') {
            // Unreachable under client-confirms, but fail loudly rather than
            // silently dropping a write if that ever changes.
            return {
              content: [
                {
                  type: 'text' as const,
                  text: `This action needs confirmation: ${result.proposal.summary}`,
                },
              ],
              isError: true,
            };
          }

          return {
            content: [{ type: 'text' as const, text: result.content }],
            isError: result.isError,
          };
        },
      );
    }

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });

    return { server, transport };
  }
}
