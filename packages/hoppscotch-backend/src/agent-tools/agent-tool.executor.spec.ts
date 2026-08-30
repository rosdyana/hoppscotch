import { mockDeep } from 'jest-mock-extended';
import * as E from 'fp-ts/Either';
import { z } from 'zod';
import {
  AI_TOOL_INPUT_INVALID,
  AI_TOOL_NOT_FOUND,
  AI_WORKSPACE_FORBIDDEN,
  AI_WORKSPACE_NOT_FOUND,
} from 'src/errors';
import { TeamAccessRole } from 'src/team/team.model';
import { TeamService } from 'src/team/team.service';
import { AuthUser } from 'src/types/AuthUser';
import { AgentToolExecutor } from './agent-tool.executor';
import { AgentToolRegistry } from './agent-tool.registry';
import { defineTool } from './agent-tool.types';
import { WorkspaceResolverService } from './workspace.resolver';

const mockTeamService = mockDeep<TeamService>();
const user = { uid: 'user-1' } as AuthUser;

/** Spy standing in for the underlying collection service a write would call. */
const writeSideEffect = jest.fn();

const readTool = defineTool({
  name: 'read_tool',
  title: 'Read',
  description: 'read',
  input: { id: z.string() },
  readOnly: true,
  destructive: false,
  idempotent: true,
  openWorld: false,
  execute: async (input) => E.right({ got: input.id }),
});

const writeTool = defineTool({
  name: 'write_tool',
  title: 'Write',
  description: 'write',
  input: { title: z.string() },
  readOnly: false,
  destructive: false,
  idempotent: false,
  openWorld: false,
  preview: async (input) =>
    E.right({
      summary: `Rename to ${input.title}`,
      before: { title: 'old' },
      after: { title: input.title },
      warnings: [],
    }),
  execute: async (input) => {
    writeSideEffect(input);
    return E.right({ renamed: input.title });
  },
});

const unpreviewableWriteTool = defineTool({
  name: 'unpreviewable_write',
  title: 'Write',
  description: 'write without preview',
  input: {},
  readOnly: false,
  destructive: true,
  idempotent: false,
  openWorld: false,
  execute: async () => {
    writeSideEffect({});
    return E.right(true);
  },
});

const destructiveWriteTool = defineTool({
  name: 'destructive_write',
  title: 'Delete',
  description: 'delete',
  input: { id: z.string() },
  readOnly: false,
  destructive: true,
  idempotent: true,
  openWorld: false,
  preview: async (input) =>
    E.right({
      summary: `Delete ${input.id}`,
      before: { id: input.id },
      after: null,
      warnings: ['This removes 3 requests.'],
    }),
  execute: async (input) => {
    writeSideEffect(input);
    return E.right({ deleted: input.id });
  },
});

const askTool = defineTool({
  name: 'ask_tool',
  title: 'Ask',
  description: 'ask',
  input: {
    question: z.string(),
    options: z.array(z.string()).optional(),
    allowFreeText: z.boolean().optional().default(true),
  },
  readOnly: true,
  destructive: false,
  idempotent: true,
  openWorld: false,
  interactive: true,
  execute: async () => {
    writeSideEffect({});
    return E.right(true);
  },
});

let executor: AgentToolExecutor;

beforeEach(() => {
  jest.clearAllMocks();
  const registry = new AgentToolRegistry();
  registry.registerAll([
    readTool,
    writeTool,
    unpreviewableWriteTool,
    destructiveWriteTool,
    askTool,
  ]);
  executor = new AgentToolExecutor(
    registry,
    new WorkspaceResolverService(mockTeamService),
  );
});

const run = (over: Partial<Parameters<AgentToolExecutor['run']>[0]> = {}) =>
  executor.run({
    name: 'read_tool',
    input: { id: 'x' },
    user,
    source: 'chat',
    policy: 'require-approval',
    ...over,
  });

describe('AgentToolExecutor', () => {
  it('should run a read tool freely and return its result', async () => {
    const result = await run();

    expect(result).toEqual({
      kind: 'result',
      content: JSON.stringify({ got: 'x' }),
      isError: false,
    });
  });

  it('should report an unknown tool as a recoverable error, not a throw', async () => {
    const result = await run({ name: 'nope' });

    expect(result).toEqual({
      kind: 'result',
      content: AI_TOOL_NOT_FOUND,
      isError: true,
    });
  });

  it('should return schema violations so the model can self-correct', async () => {
    const result = await run({ input: { id: 42 } });

    expect(result.kind).toBe('result');
    if (result.kind === 'result') {
      expect(result.isError).toBe(true);
      expect(result.content).toContain(AI_TOOL_INPUT_INVALID);
      // The specific field must be named, otherwise the model just retries.
      expect(result.content).toContain('id');
    }
  });

  describe('workspace authorization', () => {
    it('should not leak whether an unknown team exists', async () => {
      mockTeamService.getTeamMember.mockResolvedValue(null);

      const result = await run({ workspaceId: 'team-does-not-exist' });

      expect(result).toEqual({
        kind: 'result',
        content: AI_WORKSPACE_NOT_FOUND,
        isError: true,
      });
    });

    it('should refuse a write when the caller is only a VIEWER', async () => {
      mockTeamService.getTeamMember.mockResolvedValue({
        role: TeamAccessRole.VIEWER,
      } as any);

      const result = await run({
        name: 'write_tool',
        input: { title: 'new' },
        workspaceId: 'team-1',
        policy: 'client-confirms',
      });

      expect(result).toEqual({
        kind: 'result',
        content: AI_WORKSPACE_FORBIDDEN,
        isError: true,
      });
      expect(writeSideEffect).not.toHaveBeenCalled();
    });

    it('should allow a VIEWER to read', async () => {
      mockTeamService.getTeamMember.mockResolvedValue({
        role: TeamAccessRole.VIEWER,
      } as any);

      const result = await run({ workspaceId: 'team-1' });

      expect(result.kind).toBe('result');
      if (result.kind === 'result') expect(result.isError).toBe(false);
    });

    it('should allow an EDITOR to write', async () => {
      mockTeamService.getTeamMember.mockResolvedValue({
        role: TeamAccessRole.EDITOR,
      } as any);

      const result = await run({
        name: 'write_tool',
        input: { title: 'new' },
        workspaceId: 'team-1',
        policy: 'client-confirms',
      });

      expect(result.kind).toBe('result');
      expect(writeSideEffect).toHaveBeenCalledWith({ title: 'new' });
    });
  });

  describe('write policy gate', () => {
    it('should hold a write under require-approval and NOT execute it', async () => {
      const result = await run({ name: 'write_tool', input: { title: 'new' } });

      expect(result.kind).toBe('proposal');
      if (result.kind === 'proposal') {
        expect(result.proposal.summary).toBe('Rename to new');
        expect(result.proposal.before).toEqual({ title: 'old' });
        expect(result.proposal.after).toEqual({ title: 'new' });
      }
      // The whole point of the guardrail: nothing was written.
      expect(writeSideEffect).not.toHaveBeenCalled();
    });

    it('should execute the same write under client-confirms (MCP)', async () => {
      const result = await run({
        name: 'write_tool',
        input: { title: 'new' },
        source: 'mcp',
        policy: 'client-confirms',
      });

      expect(result.kind).toBe('result');
      expect(writeSideEffect).toHaveBeenCalledWith({ title: 'new' });
    });

    it('should refuse a write tool that cannot be previewed rather than run it', async () => {
      const result = await run({ name: 'unpreviewable_write', input: {} });

      expect(result.kind).toBe('result');
      if (result.kind === 'result') expect(result.isError).toBe(true);
      expect(writeSideEffect).not.toHaveBeenCalled();
    });
  });

  it('should turn a thrown tool error into an error result', async () => {
    const registry = new AgentToolRegistry();
    registry.register(
      defineTool({
        name: 'boom',
        title: 'Boom',
        description: 'throws',
        input: {},
        readOnly: true,
        destructive: false,
        idempotent: true,
        openWorld: false,
        execute: async () => {
          throw new Error('kaboom');
        },
      }),
    );
    const isolated = new AgentToolExecutor(
      registry,
      new WorkspaceResolverService(mockTeamService),
    );

    const result = await isolated.run({
      name: 'boom',
      input: {},
      user,
      source: 'chat',
      policy: 'require-approval',
    });

    expect(result).toEqual({
      kind: 'result',
      content: 'kaboom',
      isError: true,
    });
  });

  describe('auto-approve policy', () => {
    it('should run an ordinary write without asking', async () => {
      const result = await run({
        name: 'write_tool',
        input: { title: 'new' },
        policy: 'auto-approve',
      });

      expect(result).toEqual({
        kind: 'result',
        content: JSON.stringify({ renamed: 'new' }),
        isError: false,
      });
      expect(writeSideEffect).toHaveBeenCalledWith({ title: 'new' });
    });

    it('should still hold a destructive write for confirmation', async () => {
      const result = await run({
        name: 'destructive_write',
        input: { id: 'coll-1' },
        policy: 'auto-approve',
      });

      expect(result.kind).toBe('proposal');
      // The whole point: the underlying service is never reached.
      expect(writeSideEffect).not.toHaveBeenCalled();
    });

    it('should leave MCP unchanged - client-confirms still executes', async () => {
      const result = await run({
        name: 'destructive_write',
        input: { id: 'coll-1' },
        policy: 'client-confirms',
      });

      expect(result.kind).toBe('result');
      expect(writeSideEffect).toHaveBeenCalledWith({ id: 'coll-1' });
    });
  });

  describe('interactive tools', () => {
    it('should hand back a question instead of executing', async () => {
      const result = await run({
        name: 'ask_tool',
        input: { question: 'Which collection?', options: ['A', 'B'] },
      });

      expect(result).toEqual({
        kind: 'question',
        question: {
          question: 'Which collection?',
          options: ['A', 'B'],
          allowFreeText: true,
        },
      });
      expect(writeSideEffect).not.toHaveBeenCalled();
    });

    it('should ask even under auto-approve', async () => {
      const result = await run({
        name: 'ask_tool',
        input: { question: 'Which one?' },
        policy: 'auto-approve',
      });

      expect(result.kind).toBe('question');
    });
  });
});
