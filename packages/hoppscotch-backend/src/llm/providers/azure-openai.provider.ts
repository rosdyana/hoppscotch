import { AzureOpenAI } from 'openai';
import type OpenAI from 'openai';
import { AIProvider } from 'src/types/InfraConfig';
import { mapOpenAIError } from '../llm.errors';
import {
  AgentToolSpec,
  NormalizedMessage,
  NormalizedStopReason,
  NormalizedToolCall,
  NormalizedTurn,
  StreamTurnParams,
} from '../llm.types';
import { LlmProvider } from './llm-provider.interface';

export type AzureOpenAIProviderOptions = {
  endpoint: string;
  apiKey: string;
  deployment: string;
  apiVersion: string;
};

/** Accumulator for a tool call arriving in fragments across stream chunks. */
type PartialToolCall = { id: string; name: string; args: string };

export class AzureOpenAIProvider implements LlmProvider {
  readonly id = AIProvider.AZURE_OPENAI;

  private readonly client: AzureOpenAI;

  constructor(private readonly options: AzureOpenAIProviderOptions) {
    this.client = new AzureOpenAI({
      endpoint: options.endpoint,
      apiKey: options.apiKey,
      apiVersion: options.apiVersion,
      deployment: options.deployment,
    });
  }

  async streamTurn(params: StreamTurnParams): Promise<NormalizedTurn> {
    const { system, messages, tools, maxTokens, signal, onTextDelta } = params;

    try {
      const stream = await this.client.chat.completions.create(
        {
          model: this.options.deployment,
          stream: true,
          stream_options: { include_usage: true },
          max_completion_tokens: maxTokens,
          messages: [
            { role: 'system', content: system },
            ...this.toOpenAIMessages(messages),
          ],
          ...(tools.length > 0
            ? { tools: this.toOpenAITools(tools), tool_choice: 'auto' as const }
            : {}),
        },
        { signal },
      );

      let text = '';
      let finishReason: string | null = null;
      let usage = { inputTokens: 0, outputTokens: 0 };

      // id and function.name only appear on a tool call's FIRST fragment;
      // arguments stream in as partial JSON afterwards. Correlate by index.
      const partials = new Map<number, PartialToolCall>();

      for await (const chunk of stream) {
        if (chunk.usage) {
          usage = {
            inputTokens: chunk.usage.prompt_tokens ?? 0,
            outputTokens: chunk.usage.completion_tokens ?? 0,
          };
        }

        const choice = chunk.choices?.[0];
        if (!choice) continue;
        if (choice.finish_reason) finishReason = choice.finish_reason;

        const delta = choice.delta;
        if (!delta) continue;

        if (delta.content) {
          text += delta.content;
          onTextDelta(delta.content);
        }

        for (const call of delta.tool_calls ?? []) {
          const existing = partials.get(call.index) ?? {
            id: '',
            name: '',
            args: '',
          };

          partials.set(call.index, {
            id: call.id ?? existing.id,
            name: call.function?.name ?? existing.name,
            args: existing.args + (call.function?.arguments ?? ''),
          });
        }
      }

      const toolCalls: NormalizedToolCall[] = [...partials.entries()]
        .sort(([a], [b]) => a - b)
        .map(([, partial]) => ({
          id: partial.id,
          name: partial.name,
          // Emit an empty input on malformed JSON rather than throwing: the
          // executor will reject it and hand the model a recoverable error.
          input: this.safeParseArgs(partial.args),
        }));

      return {
        text,
        toolCalls,
        stopReason: this.toStopReason(finishReason, toolCalls.length > 0),
        usage,
        raw: { text, toolCalls },
      };
    } catch (e) {
      throw new Error(mapOpenAIError(e));
    }
  }

  private safeParseArgs(args: string): Record<string, unknown> {
    if (!args.trim()) return {};
    try {
      const parsed = JSON.parse(args);
      return typeof parsed === 'object' && parsed !== null ? parsed : {};
    } catch {
      return {};
    }
  }

  private toStopReason(
    finishReason: string | null,
    hasToolCalls: boolean,
  ): NormalizedStopReason {
    switch (finishReason) {
      case 'tool_calls':
      case 'function_call':
        return 'tool_use';
      case 'length':
        return 'max_tokens';
      case 'content_filter':
        return 'refusal';
      case 'stop':
        // Some deployments report `stop` alongside tool calls.
        return hasToolCalls ? 'tool_use' : 'end_turn';
      default:
        return hasToolCalls ? 'tool_use' : 'end_turn';
    }
  }

  private toOpenAIMessages(
    messages: NormalizedMessage[],
  ): OpenAI.Chat.ChatCompletionMessageParam[] {
    const out: OpenAI.Chat.ChatCompletionMessageParam[] = [];

    for (const message of messages) {
      switch (message.role) {
        case 'user':
          out.push({ role: 'user', content: message.text });
          break;

        case 'assistant': {
          const raw = message.raw as {
            text?: string;
            toolCalls?: NormalizedToolCall[];
          };
          const toolCalls = raw?.toolCalls ?? [];

          out.push({
            role: 'assistant',
            content: raw?.text ?? '',
            ...(toolCalls.length > 0
              ? {
                  tool_calls: toolCalls.map((call) => ({
                    id: call.id,
                    type: 'function' as const,
                    function: {
                      name: call.name,
                      arguments: JSON.stringify(call.input ?? {}),
                    },
                  })),
                }
              : {}),
          });
          break;
        }

        case 'tool_results':
          // Unlike Anthropic, each result is its own message.
          for (const result of message.results) {
            out.push({
              role: 'tool',
              tool_call_id: result.toolUseId,
              content: result.content,
            });
          }
          break;
      }
    }

    return out;
  }

  private toOpenAITools(
    tools: AgentToolSpec[],
  ): OpenAI.Chat.ChatCompletionTool[] {
    return tools.map((tool) => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema as Record<string, unknown>,
      },
    }));
  }
}
