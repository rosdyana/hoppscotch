import { AIProvider } from 'src/types/InfraConfig';

/**
 * A tool as the model sees it. `inputSchema` is JSON Schema derived from the
 * tool's Zod shape, so the same declaration drives both this and MCP.
 */
export type AgentToolSpec = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

export type NormalizedToolCall = {
  id: string;
  name: string;
  input: Record<string, unknown>;
};

export type ToolResult = {
  toolUseId: string;
  content: string;
  isError: boolean;
};

/**
 * Conversation history in a provider-neutral form.
 *
 * Assistant turns keep the provider's own content blocks in `raw` rather than
 * being flattened to text: Anthropic thinking blocks, cache_control markers and
 * partial tool JSON are all lossy to normalize, and we need to replay them
 * verbatim on the next turn. `provider` records which format `raw` is in.
 *
 * `tool_results` carries an array rather than pre-built provider blocks because
 * this is exactly where the two wire formats diverge - Anthropic expands it to
 * one user message holding N tool_result blocks, Azure OpenAI expands it to N
 * separate `tool` messages.
 */
export type NormalizedMessage =
  | { role: 'user'; text: string }
  | { role: 'assistant'; provider: AIProvider; raw: unknown }
  | { role: 'tool_results'; results: ToolResult[] };

export type NormalizedStopReason =
  | 'end_turn'
  | 'tool_use'
  | 'max_tokens'
  | 'pause_turn'
  | 'stop_sequence'
  | 'refusal';

export type NormalizedTurn = {
  text: string;
  toolCalls: NormalizedToolCall[];
  stopReason: NormalizedStopReason;
  usage: { inputTokens: number; outputTokens: number };
  /** Provider-native assistant content, replayed verbatim on the next turn. */
  raw: unknown;
};

export type StreamTurnParams = {
  system: string;
  messages: NormalizedMessage[];
  tools: AgentToolSpec[];
  maxTokens: number;
  signal?: AbortSignal;
  onTextDelta: (delta: string) => void;
};

/** Resolved AI configuration, decrypted. Never leaves the backend. */
export type AiConfig = {
  enabled: boolean;
  provider: AIProvider;
  model: string;
  maxOutputTokens: number;
  maxToolIterations: number;
  enableThinking: boolean;
  mcpEnabled: boolean;
  foundry: { resource: string; apiKey: string };
  azureOpenAI: {
    endpoint: string;
    apiKey: string;
    deployment: string;
    apiVersion: string;
  };
  requestExecution: {
    enabled: boolean;
    allowedHosts: string[];
    timeoutMs: number;
    maxResponseBytes: number;
  };
};
