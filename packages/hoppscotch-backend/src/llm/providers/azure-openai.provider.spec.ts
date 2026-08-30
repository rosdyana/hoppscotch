import { AzureOpenAIProvider } from './azure-openai.provider';
import { NormalizedMessage } from '../llm.types';
import { AIProvider } from 'src/types/InfraConfig';

const OPTIONS = {
  endpoint: 'https://demo.openai.azure.com',
  apiKey: 'secret',
  deployment: 'gpt-4o',
  apiVersion: '2025-04-01-preview',
};

/** Feed the provider a canned stream of chunks. */
function stubStream(provider: AzureOpenAIProvider, chunks: unknown[]) {
  const client = (provider as any).client;
  client.chat.completions.create = jest.fn().mockResolvedValue({
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) yield chunk;
    },
  });
  return client;
}

describe('AzureOpenAIProvider', () => {
  const run = (chunks: unknown[]) => {
    const provider = new AzureOpenAIProvider(OPTIONS);
    stubStream(provider, chunks);
    const deltas: string[] = [];
    return provider
      .streamTurn({
        system: 'sys',
        messages: [{ role: 'user', text: 'hi' }],
        tools: [],
        maxTokens: 100,
        onTextDelta: (d) => deltas.push(d),
      })
      .then((turn) => ({ turn, deltas }));
  };

  it('should stream text deltas and finish with end_turn', async () => {
    const { turn, deltas } = await run([
      { choices: [{ delta: { content: 'Hel' } }] },
      { choices: [{ delta: { content: 'lo' } }] },
      { choices: [{ delta: {}, finish_reason: 'stop' }] },
      { choices: [], usage: { prompt_tokens: 5, completion_tokens: 2 } },
    ]);

    expect(deltas).toEqual(['Hel', 'lo']);
    expect(turn.text).toBe('Hello');
    expect(turn.stopReason).toBe('end_turn');
    expect(turn.usage).toEqual({ inputTokens: 5, outputTokens: 2 });
  });

  it('should reassemble a tool call whose arguments arrive across chunks', async () => {
    const { turn } = await run([
      {
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: 'call_1',
                  function: { name: 'hopp_get_collection', arguments: '{"col' },
                },
              ],
            },
          },
        ],
      },
      // Subsequent fragments carry neither id nor name - only the index.
      {
        choices: [
          {
            delta: {
              tool_calls: [{ index: 0, function: { arguments: 'lectionId"' } }],
            },
          },
        ],
      },
      {
        choices: [
          {
            delta: {
              tool_calls: [{ index: 0, function: { arguments: ':"abc"}' } }],
            },
          },
        ],
      },
      { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
    ]);

    expect(turn.stopReason).toBe('tool_use');
    expect(turn.toolCalls).toEqual([
      {
        id: 'call_1',
        name: 'hopp_get_collection',
        input: { collectionId: 'abc' },
      },
    ]);
  });

  it('should keep parallel tool calls separate and ordered by index', async () => {
    const { turn } = await run([
      {
        choices: [
          {
            delta: {
              tool_calls: [
                { index: 1, id: 'b', function: { name: 'second', arguments: '{}' } },
                { index: 0, id: 'a', function: { name: 'first', arguments: '{}' } },
              ],
            },
          },
        ],
      },
      { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
    ]);

    expect(turn.toolCalls.map((c) => c.name)).toEqual(['first', 'second']);
  });

  it('should yield empty input on malformed argument JSON rather than throwing', async () => {
    const { turn } = await run([
      {
        choices: [
          {
            delta: {
              tool_calls: [
                { index: 0, id: 'x', function: { name: 't', arguments: '{"a":' } },
              ],
            },
          },
        ],
      },
      { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
    ]);

    // The executor rejects this and hands the model a recoverable error.
    expect(turn.toolCalls[0].input).toEqual({});
  });

  it('should map content_filter to refusal and length to max_tokens', async () => {
    const refusal = await run([
      { choices: [{ delta: {}, finish_reason: 'content_filter' }] },
    ]);
    expect(refusal.turn.stopReason).toBe('refusal');

    const truncated = await run([
      { choices: [{ delta: { content: 'x' }, finish_reason: 'length' }] },
    ]);
    expect(truncated.turn.stopReason).toBe('max_tokens');
  });

  describe('message conversion', () => {
    const convert = (messages: NormalizedMessage[]) =>
      (new AzureOpenAIProvider(OPTIONS) as any).toOpenAIMessages(messages);

    it('should expand tool results into one message per result', () => {
      const out = convert([
        {
          role: 'tool_results',
          results: [
            { toolUseId: 'a', content: 'ra', isError: false },
            { toolUseId: 'b', content: 'rb', isError: true },
          ],
        },
      ]);

      // Unlike Anthropic, OpenAI wants N separate `tool` messages.
      expect(out).toEqual([
        { role: 'tool', tool_call_id: 'a', content: 'ra' },
        { role: 'tool', tool_call_id: 'b', content: 'rb' },
      ]);
    });

    it('should replay an assistant turn with its tool calls', () => {
      const out = convert([
        {
          role: 'assistant',
          provider: AIProvider.AZURE_OPENAI,
          raw: {
            text: 'thinking',
            toolCalls: [{ id: 'c1', name: 'tool', input: { k: 1 } }],
          },
        },
      ]);

      expect(out[0]).toEqual({
        role: 'assistant',
        content: 'thinking',
        tool_calls: [
          {
            id: 'c1',
            type: 'function',
            function: { name: 'tool', arguments: '{"k":1}' },
          },
        ],
      });
    });
  });
});
