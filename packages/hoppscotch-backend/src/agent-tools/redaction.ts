/**
 * Central redaction for everything the agent layer serializes into an LLM
 * prompt or a tool result.
 *
 * A leak here is silent and permanent - it lands in the provider's logs - so
 * every path that can carry a credential funnels through this one module and
 * is covered by tests.
 */

/** Header names whose VALUES must never reach the model. */
const SENSITIVE_HEADER_NAMES = new Set([
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'api-key',
  'x-auth-token',
  'x-access-token',
  'x-csrf-token',
]);

/** Header names that look credential-bearing even if not explicitly listed. */
const SENSITIVE_HEADER_PATTERN = /token|secret|passwd|password|credential|api[-_]?key/i;

export const REDACTED = '<redacted>';
export const SECRET_PLACEHOLDER = '<secret>';

export function isSensitiveHeaderName(name: string): boolean {
  const lower = name.trim().toLowerCase();
  return (
    SENSITIVE_HEADER_NAMES.has(lower) || SENSITIVE_HEADER_PATTERN.test(lower)
  );
}

type KeyValue = { key?: string; value?: unknown; [k: string]: unknown };

/**
 * Mask the values of credential-bearing headers, keeping the names so the
 * model can still reason about which auth scheme a request uses.
 */
export function redactHeaders<T extends KeyValue>(headers: T[]): T[] {
  if (!Array.isArray(headers)) return headers;

  return headers.map((header) =>
    header && isSensitiveHeaderName(String(header.key ?? ''))
      ? { ...header, value: REDACTED }
      : header,
  );
}

/**
 * Replace the value of every `secret: true` environment variable.
 *
 * Without this, "what environments do I have?" would ship every production
 * credential in the workspace to the provider on the first turn.
 */
export function redactEnvironmentVariables<T extends Record<string, unknown>>(
  variables: T[],
): T[] {
  if (!Array.isArray(variables)) return variables;

  return variables.map((variable) =>
    variable && variable.secret === true
      ? { ...variable, value: SECRET_PLACEHOLDER }
      : variable,
  );
}

/**
 * Redact a stored HoppRESTRequest in place of serializing it raw.
 *
 * Covers headers, and the auth block - which holds bearer tokens, API keys and
 * OAuth secrets under a variety of shapes, so every string field on it that
 * is not structural is masked.
 */
const AUTH_STRUCTURAL_FIELDS = new Set([
  'authType',
  'authActive',
  'addTo',
  'grantTypeInfo',
]);

export function redactRequest<T extends Record<string, any>>(request: T): T {
  if (!request || typeof request !== 'object') return request;

  const redacted: Record<string, any> = { ...request };

  if (Array.isArray(redacted.headers)) {
    redacted.headers = redactHeaders(redacted.headers);
  }

  if (redacted.auth && typeof redacted.auth === 'object') {
    const auth: Record<string, any> = { ...redacted.auth };
    for (const [key, value] of Object.entries(auth)) {
      if (AUTH_STRUCTURAL_FIELDS.has(key)) continue;
      if (typeof value === 'string' && value !== '') auth[key] = REDACTED;
    }
    redacted.auth = auth;
  }

  return redacted as T;
}

/** Parse a stored request JSON string, redact it, and hand back an object. */
export function redactRequestJson(json: unknown): unknown {
  if (typeof json !== 'string') {
    return redactRequest(json as Record<string, any>);
  }

  try {
    return redactRequest(JSON.parse(json));
  } catch {
    // Unparseable stored request - withhold it rather than risk leaking a raw
    // credential-bearing blob.
    return REDACTED;
  }
}
