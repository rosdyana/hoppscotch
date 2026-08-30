import { Injectable } from '@nestjs/common';
import * as E from 'fp-ts/Either';
import { z } from 'zod';
import { AI_TOOL_INPUT_INVALID, AI_TOOL_NOT_FOUND } from 'src/errors';
import { AuthUser } from 'src/types/AuthUser';
import { AgentToolRegistry } from './agent-tool.registry';
import {
  AgentToolContext,
  AgentToolPolicy,
  ToolRunResult,
} from './agent-tool.types';
import { WorkspaceResolverService } from './workspace.resolver';

/** Cap a serialized tool result so one call cannot flood the context window. */
const MAX_RESULT_BYTES = 100_000;

export type RunToolParams = {
  name: string;
  input: unknown;
  user: AuthUser;
  workspaceId?: string | null;
  source: 'chat' | 'mcp';
  policy: AgentToolPolicy;
};

@Injectable()
export class AgentToolExecutor {
  constructor(
    private readonly registry: AgentToolRegistry,
    private readonly workspaceResolver: WorkspaceResolverService,
  ) {}

  /**
   * Validate, authorize, gate and run one tool call.
   *
   * Never throws across this boundary: failures come back as an error result
   * so the model receives them as a tool_result it can recover from.
   */
  async run(params: RunToolParams): Promise<ToolRunResult> {
    const { name, input, user, workspaceId, source, policy } = params;

    const tool = this.registry.get(name);
    if (!tool) return this.error(AI_TOOL_NOT_FOUND);

    const parsed = z.object(tool.input).safeParse(input ?? {});
    if (!parsed.success) {
      // Hand the model the actual schema violations - it self-corrects on the
      // next turn rather than repeating the same malformed call.
      const issues = parsed.error.issues
        .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
        .join('; ');
      return this.error(`${AI_TOOL_INPUT_INVALID}: ${issues}`);
    }

    const workspace = await this.workspaceResolver.resolve(
      user,
      workspaceId ?? (parsed.data as any).workspaceId,
      !tool.readOnly,
    );
    if (E.isLeft(workspace)) return this.error(workspace.left);

    const ctx: AgentToolContext = {
      user,
      workspace: workspace.right,
      source,
      policy,
    };

    // An interactive tool never runs: it exists to hand a question back to the
    // surface, which answers it as an ordinary tool_result.
    if (tool.interactive) {
      const input = parsed.data as {
        question: string;
        options?: string[];
        allowFreeText?: boolean;
      };
      return {
        kind: 'question',
        question: {
          question: input.question,
          options: input.options ?? [],
          allowFreeText: input.allowFreeText ?? true,
        },
      };
    }

    // The guardrail. Under `require-approval` every write is previewed and held;
    // under `auto-approve` only the destructive ones are. `client-confirms`
    // (MCP) never holds - the client already confirmed.
    const needsApproval =
      !tool.readOnly &&
      (policy === 'require-approval' ||
        (policy === 'auto-approve' && tool.destructive));

    if (needsApproval) {
      if (!tool.preview) {
        return this.error(
          `${AI_TOOL_NOT_FOUND}: ${tool.name} has no preview and cannot be confirmed`,
        );
      }

      const proposal = await tool.preview(parsed.data, ctx);
      if (E.isLeft(proposal)) return this.error(proposal.left);
      return { kind: 'proposal', proposal: proposal.right };
    }

    try {
      const result = await tool.execute(parsed.data, ctx);
      if (E.isLeft(result)) return this.error(result.left);
      return { kind: 'result', content: this.serialize(result.right), isError: false };
    } catch (e) {
      return this.error(e instanceof Error ? e.message : String(e));
    }
  }

  private error(message: string): ToolRunResult {
    return { kind: 'result', content: message, isError: true };
  }

  private serialize(value: unknown): string {
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    if (!text) return '';

    return text.length > MAX_RESULT_BYTES
      ? `${text.slice(0, MAX_RESULT_BYTES)}\n...[truncated, ${
          text.length - MAX_RESULT_BYTES
        } more characters]`
      : text;
  }
}
