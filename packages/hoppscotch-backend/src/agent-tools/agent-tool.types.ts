import * as E from 'fp-ts/Either';
import { z } from 'zod';
import { TeamAccessRole } from 'src/team/team.model';
import { AuthUser } from 'src/types/AuthUser';

export type AgentWorkspace =
  | { type: 'personal' }
  | { type: 'team'; teamID: string; role: TeamAccessRole };

/**
 * How write tools behave for the calling surface.
 *
 * `require-approval` (chat): a write is previewed and held, never executed on
 * the first pass - the user approves it in the UI first.
 *
 * `client-confirms` (MCP): executed directly. MCP has no channel to render a
 * diff and cannot hold a JSON-RPC call open pending human input, so
 * confirmation is delegated to the MCP client via tool annotations.
 */
export type AgentToolPolicy = 'require-approval' | 'client-confirms';

export type AgentToolContext = {
  user: AuthUser;
  workspace: AgentWorkspace;
  source: 'chat' | 'mcp';
  policy: AgentToolPolicy;
};

/** What a held write would do, rendered as the chat's confirmation card. */
export type ToolProposal = {
  summary: string;
  before: unknown | null;
  after: unknown;
  warnings: string[];
};

export type AgentTool<S extends z.ZodRawShape = z.ZodRawShape> = {
  name: string;
  title: string;
  description: string;
  /**
   * Zod raw shape - the single source of truth for this tool's input.
   * MCP's registerTool consumes it directly; the LLM providers get JSON Schema
   * derived from it. One declaration, two transports.
   */
  input: S;
  readOnly: boolean;
  /** Maps to MCP destructiveHint. */
  destructive: boolean;
  /** Maps to MCP idempotentHint. */
  idempotent: boolean;
  /** Maps to MCP openWorldHint - true when the tool touches the outside world. */
  openWorld: boolean;
  /** Required for write tools: computes the confirmation card without writing. */
  preview?: (
    input: z.infer<z.ZodObject<S>>,
    ctx: AgentToolContext,
  ) => Promise<E.Either<string, ToolProposal>>;
  execute: (
    input: z.infer<z.ZodObject<S>>,
    ctx: AgentToolContext,
  ) => Promise<E.Either<string, unknown>>;
};

/** Outcome of running a tool through the executor. */
export type ToolRunResult =
  | { kind: 'result'; content: string; isError: boolean }
  | { kind: 'proposal'; proposal: ToolProposal };

/** Helper so tool modules can declare tools without losing shape inference. */
export const defineTool = <S extends z.ZodRawShape>(
  tool: AgentTool<S>,
): AgentTool<S> => tool;
