import { mockDeep } from 'jest-mock-extended';
import { PrismaService } from 'src/prisma/prisma.service';
import { AIProvider } from 'src/types/InfraConfig';
import { AgentConversationService } from './agent-conversation.service';

const service = new AgentConversationService(mockDeep<PrismaService>());

/** An Anthropic-shaped assistant turn holding a tool_use block. */
const assistantWithToolUse = (id: string, name = 'hopp_rename_collection') => ({
  role: 'assistant',
  content: [
    { type: 'text', text: 'Renaming that for you.' },
    { type: 'tool_use', id, name, input: { collectionId: 'c1' } },
  ],
});

describe('AgentConversationService', () => {
  describe('findPendingApprovals', () => {
    it('should find nothing in an empty conversation', () => {
      expect(service.findPendingApprovals([])).toEqual([]);
    });

    it('should find nothing when the assistant only spoke', () => {
      expect(
        service.findPendingApprovals([
          { role: 'user', content: 'hi' },
          { role: 'assistant', content: [{ type: 'text', text: 'hello' }] },
        ]),
      ).toEqual([]);
    });

    it('should surface an unanswered tool call', () => {
      const pending = service.findPendingApprovals([
        { role: 'user', content: 'rename it' },
        assistantWithToolUse('call_1'),
      ]);

      expect(pending).toEqual([
        {
          toolUseId: 'call_1',
          name: 'hopp_rename_collection',
          input: { collectionId: 'c1' },
        },
      ]);
    });

    it('should treat an answered tool call as resolved', () => {
      const pending = service.findPendingApprovals([
        { role: 'user', content: 'rename it' },
        assistantWithToolUse('call_1'),
        {
          role: 'tool_results',
          content: [{ toolUseId: 'call_1', content: 'ok', isError: false }],
        },
      ]);

      expect(pending).toEqual([]);
    });

    it('should only consider the latest assistant turn', () => {
      // An earlier turn was resolved; the newest one is what needs a decision.
      const pending = service.findPendingApprovals([
        assistantWithToolUse('old_call'),
        {
          role: 'tool_results',
          content: [{ toolUseId: 'old_call', content: 'ok', isError: false }],
        },
        assistantWithToolUse('new_call'),
      ]);

      expect(pending.map((p) => p.toolUseId)).toEqual(['new_call']);
    });

    it('should surface every unanswered call in a parallel turn', () => {
      const pending = service.findPendingApprovals([
        {
          role: 'assistant',
          content: [
            { type: 'tool_use', id: 'a', name: 'one', input: {} },
            { type: 'tool_use', id: 'b', name: 'two', input: {} },
          ],
        },
      ]);

      expect(pending.map((p) => p.toolUseId)).toEqual(['a', 'b']);
    });

    it('should handle the Azure OpenAI raw shape too', () => {
      const pending = service.findPendingApprovals([
        {
          role: 'assistant',
          content: {
            text: 'ok',
            toolCalls: [{ id: 'call_x', name: 'hopp_delete_request', input: {} }],
          },
        },
      ]);

      expect(pending.map((p) => p.toolUseId)).toEqual(['call_x']);
    });
  });

  describe('toNormalizedMessages', () => {
    it('should round-trip user, assistant and tool_results rows', () => {
      const out = service.toNormalizedMessages([
        { role: 'user', provider: null, content: 'hello' },
        {
          role: 'assistant',
          provider: AIProvider.AZURE_FOUNDRY_ANTHROPIC,
          content: [{ type: 'text', text: 'hi' }],
        },
        {
          role: 'tool_results',
          provider: null,
          content: [{ toolUseId: 'a', content: 'r', isError: false }],
        },
      ]);

      expect(out[0]).toEqual({ role: 'user', text: 'hello' });
      expect(out[1]).toEqual({
        role: 'assistant',
        provider: AIProvider.AZURE_FOUNDRY_ANTHROPIC,
        raw: [{ type: 'text', text: 'hi' }],
      });
      expect(out[2]).toEqual({
        role: 'tool_results',
        results: [{ toolUseId: 'a', content: 'r', isError: false }],
      });
    });
  });
});
