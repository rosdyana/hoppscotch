import { AIProvider } from 'src/types/InfraConfig';
import { NormalizedTurn, StreamTurnParams } from '../llm.types';

/**
 * One streamed assistant turn.
 *
 * Implementations must not throw provider exceptions across this boundary -
 * they map them through llm.errors and throw the mapped constant instead.
 */
export interface LlmProvider {
  readonly id: AIProvider;
  streamTurn(params: StreamTurnParams): Promise<NormalizedTurn>;
}
