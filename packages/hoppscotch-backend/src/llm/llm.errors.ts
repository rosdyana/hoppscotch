import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import {
  AI_PROVIDER_AUTH_FAILED,
  AI_PROVIDER_RATE_LIMITED,
  AI_PROVIDER_REQUEST_FAILED,
  AI_PROVIDER_UNAVAILABLE,
} from 'src/errors';

/**
 * Map a provider exception onto one of our error constants.
 *
 * Checked most-specific-first using the SDKs' typed exception classes - never
 * by string-matching the message, which breaks silently on SDK upgrades.
 */
export function mapAnthropicError(e: unknown): string {
  if (e instanceof Anthropic.AuthenticationError) return AI_PROVIDER_AUTH_FAILED;
  if (e instanceof Anthropic.RateLimitError) return AI_PROVIDER_RATE_LIMITED;
  if (e instanceof Anthropic.APIError) return AI_PROVIDER_REQUEST_FAILED;
  return AI_PROVIDER_UNAVAILABLE;
}

export function mapOpenAIError(e: unknown): string {
  if (e instanceof OpenAI.AuthenticationError) return AI_PROVIDER_AUTH_FAILED;
  if (e instanceof OpenAI.RateLimitError) return AI_PROVIDER_RATE_LIMITED;
  if (e instanceof OpenAI.APIError) return AI_PROVIDER_REQUEST_FAILED;
  return AI_PROVIDER_UNAVAILABLE;
}
