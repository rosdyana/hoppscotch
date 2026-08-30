import { AnthropicFoundry } from '@anthropic-ai/foundry-sdk';
import type Anthropic from '@anthropic-ai/sdk';
import { AIProvider } from 'src/types/InfraConfig';
import { mapAnthropicError } from '../llm.errors';
import {
  AgentToolSpec,
  NormalizedMessage,
  NormalizedStopReason,
  NormalizedToolCall,
  NormalizedTurn,
  StreamTurnParams,
} from '../llm.types';
import { LlmProvider } from './llm-provider.interface';

export type AnthropicFoundryProviderOptions = {
  /** Bare host, e.g. `my-resource.azure.anthropic.com` - not a URL. */
  resource: string;
  apiKey: string;
  model: string;
  enableThinking: boolean;
};

export class AnthropicFoundryProvider implements LlmProvider {
  readonly id = AIProvider.AZURE_FOUNDRY_ANTHROPIC;

  private readonly client: AnthropicFoundry;

  constructor(private readonly options: AnthropicFoundryProviderOptions) {
    this.client = new AnthropicFoundry({
      apiKey: options.apiKey,
      resource: options.resource,
    });
  }

  async streamTurn(params: StreamTurnParams): Promise<NormalizedTurn> {
    const { system, messages, tools, maxTokens, signal, onTextDelta } = params;

    try {
      const stream = this.client.messages.stream(
        {
          model: this.options.model,
          max_tokens: maxTokens,
          // The system prompt and tool list are constant for a conversation,
          // so caching this prefix is close to free with a large tool set.
          system: [
            {
              type: 'text',
              text: system,
              cache_control: { type: 'ephemeral' },
            },
          ],
          messages: this.toAnthropicMessages(messages),
          tools: this.toAnthropicTools(tools),
          // Adaptive thinking is beta on Foundry, hence the opt-in. Note
          // budget_tokens is rejected outright on Opus 5 / Sonnet 5 - depth is
          // controlled through output_config.effort instead.
          ...(this.options.enableThinking
            ? {
                thinking: { type: 'adaptive' as const },
                output_config: { effort: 'high' as const },
              }
            : {}),
        } as Anthropic.MessageStreamParams,
        { signal },
      );

      for await (const event of stream) {
        if (
          event.type === 'content_block_delta' &&
          event.delta.type === 'text_delta'
        ) {
          onTextDelta(event.delta.text);
        }
      }

      const final = await stream.finalMessage();
      return this.toNormalizedTurn(final);
    } catch (e) {
      throw new Error(mapAnthropicError(e));
    }
  }

  private toNormalizedTurn(message: Anthropic.Message): NormalizedTurn {
    const text = message.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');

    const toolCalls: NormalizedToolCall[] = message.content
      .filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
      .map((b) => ({
        id: b.id,
        name: b.name,
        input: (b.input ?? {}) as Record<string, unknown>,
      }));

    return {
      text,
      toolCalls,
      stopReason: (message.stop_reason ?? 'end_turn') as NormalizedStopReason,
      usage: {
        inputTokens: message.usage?.input_tokens ?? 0,
        outputTokens: message.usage?.output_tokens ?? 0,
      },
      // Replayed verbatim next turn, preserving thinking blocks and tool_use
      // blocks exactly as the model emitted them.
      raw: message.content,
    };
  }

  private toAnthropicMessages(
    messages: NormalizedMessage[],
  ): Anthropic.MessageParam[] {
    return messages.map((message) => {
      switch (message.role) {
        case 'user':
          return { role: 'user', content: message.text };

        case 'assistant':
          return {
            role: 'assistant',
            content: message.raw as Anthropic.ContentBlockParam[],
          };

        case 'tool_results':
          // All results for a turn go in ONE user message. Splitting them
          // across messages trains the model to stop calling tools in parallel.
          return {
            role: 'user',
            content: message.results.map(
              (result) =>
                ({
                  type: 'tool_result',
                  tool_use_id: result.toolUseId,
                  content: result.content,
                  ...(result.isError ? { is_error: true } : {}),
                }) satisfies Anthropic.ToolResultBlockParam,
            ),
          };
      }
    });
  }

  private toAnthropicTools(tools: AgentToolSpec[]): Anthropic.Tool[] {
    return tools.map((tool, index) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.inputSchema as Anthropic.Tool.InputSchema,
      // Cache the whole tool block by marking the last entry.
      ...(index === tools.length - 1
        ? { cache_control: { type: 'ephemeral' as const } }
        : {}),
    }));
  }
}
