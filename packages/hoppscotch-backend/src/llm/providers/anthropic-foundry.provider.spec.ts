import { AIProvider } from 'src/types/InfraConfig';
import { AnthropicFoundryProvider } from './anthropic-foundry.provider';
import { AgentToolSpec, NormalizedMessage } from '../llm.types';

const provider = new AnthropicFoundryProvider({
  resource: 'demo.azure.anthropic.com',
  apiKey: 'secret',
  model: 'claude-opus-5',
  enableThinking: false,
});

const convertMessages = (messages: NormalizedMessage[]) =>
  (provider as any).toAnthropicMessages(messages);
const convertTools = (tools: AgentToolSpec[]) =>
  (provider as any).toAnthropicTools(tools);

describe('AnthropicFoundryProvider', () => {
  describe('message conversion', () => {
    it('should put every tool result in a SINGLE user message', () => {
      const out = convertMessages([
        {
          role: 'tool_results',
          results: [
            { toolUseId: 'a', content: 'ra', isError: false },
            { toolUseId: 'b', content: 'rb', isError: true },
          ],
        },
      ]);

      // Splitting these across messages teaches the model to stop calling
      // tools in parallel, so the single-message shape matters.
      expect(out).toHaveLength(1);
      expect(out[0].role).toBe('user');
      expect(out[0].content).toEqual([
        { type: 'tool_result', tool_use_id: 'a', content: 'ra' },
        { type: 'tool_result', tool_use_id: 'b', content: 'rb', is_error: true },
      ]);
    });

    it('should replay assistant content blocks verbatim', () => {
      const raw = [
        { type: 'thinking', thinking: 'hmm', signature: 'sig' },
        { type: 'text', text: 'answer' },
      ];

      const out = convertMessages([
        { role: 'assistant', provider: AIProvider.AZURE_FOUNDRY_ANTHROPIC, raw },
      ]);

      // Thinking blocks must survive the round trip untouched.
      expect(out[0]).toEqual({ role: 'assistant', content: raw });
    });
  });

  describe('tool conversion', () => {
    const tools: AgentToolSpec[] = [
      { name: 'a', description: 'first', inputSchema: { type: 'object' } },
      { name: 'b', description: 'second', inputSchema: { type: 'object' } },
    ];

    it('should mark only the last tool with cache_control', () => {
      const out = convertTools(tools);

      expect(out[0].cache_control).toBeUndefined();
      expect(out[1].cache_control).toEqual({ type: 'ephemeral' });
    });

    it('should carry name, description and schema through', () => {
      const out = convertTools(tools);

      expect(out[0]).toMatchObject({
        name: 'a',
        description: 'first',
        input_schema: { type: 'object' },
      });
    });
  });

  describe('turn normalization', () => {
    it('should split text and tool_use blocks and expose usage', () => {
      const turn = (provider as any).toNormalizedTurn({
        content: [
          { type: 'text', text: 'Let me look. ' },
          { type: 'tool_use', id: 't1', name: 'hopp_search', input: { q: 'x' } },
        ],
        stop_reason: 'tool_use',
        usage: { input_tokens: 11, output_tokens: 3 },
      });

      expect(turn.text).toBe('Let me look. ');
      expect(turn.toolCalls).toEqual([
        { id: 't1', name: 'hopp_search', input: { q: 'x' } },
      ]);
      expect(turn.stopReason).toBe('tool_use');
      expect(turn.usage).toEqual({ inputTokens: 11, outputTokens: 3 });
    });

    it('should default a missing stop_reason to end_turn', () => {
      const turn = (provider as any).toNormalizedTurn({
        content: [{ type: 'text', text: 'hi' }],
        stop_reason: null,
        usage: {},
      });

      expect(turn.stopReason).toBe('end_turn');
    });
  });
});
