import { Injectable } from '@nestjs/common';
import * as http from 'http';
import * as https from 'https';
import * as E from 'fp-ts/Either';
import {
  AGENT_REQUEST_EXECUTION_DISABLED,
  AGENT_REQUEST_TIMEOUT,
  AGENT_RESPONSE_TOO_LARGE,
} from 'src/errors';
import { LlmConfigService } from 'src/llm/llm-config.service';
import { redactHeaders } from 'src/agent-tools/redaction';
import { EnvVariable, interpolate } from './env-interpolation';
import { SsrfGuardService } from './ssrf-guard.service';

export type RunRequestInput = {
  method: string;
  url: string;
  headers?: { key: string; value: string; active?: boolean }[];
  params?: { key: string; value: string; active?: boolean }[];
  body?: string | null;
  contentType?: string | null;
  variables?: EnvVariable[];
};

export type RunRequestResult = {
  status: number;
  statusText: string;
  durationMs: number;
  headers: Record<string, string>;
  body: string;
  bodyTruncated: boolean;
  sizeBytes: number;
};

const MAX_REDIRECTS = 5;
/** Ceiling on what we hand back to the model, independent of the byte cap. */
const MAX_BODY_CHARS_FOR_MODEL = 32_000;

@Injectable()
export class RequestRunnerService {
  constructor(
    private readonly ssrfGuard: SsrfGuardService,
    private readonly llmConfig: LlmConfigService,
  ) {}

  async run(
    input: RunRequestInput,
  ): Promise<E.Either<string, RunRequestResult>> {
    const config = await this.llmConfig.get();
    if (!config.requestExecution.enabled) {
      return E.left(AGENT_REQUEST_EXECUTION_DISABLED);
    }

    const variables = input.variables ?? [];
    const policy = { allowedHosts: config.requestExecution.allowedHosts };

    let url = this.buildUrl(input, variables);
    const method = (input.method || 'GET').toUpperCase();

    let headers = this.buildHeaders(input, variables);
    const body = input.body ? interpolate(input.body, variables) : null;

    const startedAt = Date.now();
    let redirects = 0;
    let origin: string | null = null;

    while (true) {
      const target = await this.ssrfGuard.check(url, policy);
      if (E.isLeft(target)) return E.left(target.left);

      // Dropping credentials on a cross-origin hop stops an open redirect from
      // forwarding the caller's auth to a third party.
      const nextOrigin = target.right.url.origin;
      if (origin !== null && nextOrigin !== origin) {
        headers = Object.fromEntries(
          Object.entries(headers).filter(
            ([key]) =>
              !['authorization', 'cookie', 'proxy-authorization'].includes(
                key.toLowerCase(),
              ),
          ),
        );
      }
      origin = nextOrigin;

      const response = await this.send(
        target.right,
        method,
        headers,
        // Only the first hop carries the body; redirects are followed as GET-ish.
        redirects === 0 ? body : null,
        config.requestExecution.timeoutMs,
        config.requestExecution.maxResponseBytes,
      );
      if (E.isLeft(response)) return E.left(response.left);

      const { status, statusText, responseHeaders, chunks, truncated } =
        response.right;

      const location = responseHeaders['location'];
      if (status >= 300 && status < 400 && location) {
        redirects += 1;
        if (redirects > MAX_REDIRECTS) {
          return E.left(
            `${AGENT_REQUEST_TIMEOUT}: exceeded ${MAX_REDIRECTS} redirects`,
          );
        }
        // Re-run the FULL policy on the new URL - a redirect to 169.254.169.254
        // is the classic bypass.
        url = new URL(location, target.right.url).toString();
        continue;
      }

      const raw = Buffer.concat(chunks);
      const text = raw.toString('utf8');
      const clipped = text.length > MAX_BODY_CHARS_FOR_MODEL;

      return E.right({
        status,
        statusText,
        durationMs: Date.now() - startedAt,
        // The response can echo back credentials we sent.
        headers: this.redactResponseHeaders(responseHeaders),
        body: clipped ? text.slice(0, MAX_BODY_CHARS_FOR_MODEL) : text,
        bodyTruncated: clipped || truncated,
        sizeBytes: raw.byteLength,
      });
    }
  }

  private buildUrl(input: RunRequestInput, variables: EnvVariable[]): string {
    const base = interpolate(input.url ?? '', variables);
    const active = (input.params ?? []).filter(
      (param) => param.active !== false && param.key,
    );
    if (active.length === 0) return base;

    const separator = base.includes('?') ? '&' : '?';
    const query = active
      .map(
        (param) =>
          `${encodeURIComponent(interpolate(param.key, variables))}=${encodeURIComponent(
            interpolate(param.value ?? '', variables),
          )}`,
      )
      .join('&');

    return `${base}${separator}${query}`;
  }

  private buildHeaders(
    input: RunRequestInput,
    variables: EnvVariable[],
  ): Record<string, string> {
    const headers: Record<string, string> = {};

    for (const header of input.headers ?? []) {
      if (header.active === false || !header.key) continue;
      headers[interpolate(header.key, variables)] = interpolate(
        header.value ?? '',
        variables,
      );
    }

    if (input.contentType && !this.hasHeader(headers, 'content-type')) {
      headers['content-type'] = input.contentType;
    }

    return headers;
  }

  private hasHeader(headers: Record<string, string>, name: string): boolean {
    return Object.keys(headers).some(
      (key) => key.toLowerCase() === name.toLowerCase(),
    );
  }

  private redactResponseHeaders(
    headers: Record<string, string>,
  ): Record<string, string> {
    const asPairs = Object.entries(headers).map(([key, value]) => ({
      key,
      value,
    }));
    return Object.fromEntries(
      redactHeaders(asPairs).map((header) => [header.key, header.value]),
    );
  }

  /** Issue one hop, connecting to the pinned IP rather than re-resolving. */
  private send(
    target: { url: URL; address: string; family: number },
    method: string,
    headers: Record<string, string>,
    body: string | null,
    timeoutMs: number,
    maxBytes: number,
  ): Promise<
    E.Either<
      string,
      {
        status: number;
        statusText: string;
        responseHeaders: Record<string, string>;
        chunks: Buffer[];
        truncated: boolean;
      }
    >
  > {
    return new Promise((resolve) => {
      const isHttps = target.url.protocol === 'https:';
      const transport = isHttps ? https : http;

      const request = transport.request(
        {
          method,
          // Connect to the address we already validated. `host` preserves the
          // original Host header (and TLS SNI) so virtual hosting still works.
          host: target.address,
          servername: isHttps ? target.url.hostname : undefined,
          port:
            target.url.port !== ''
              ? Number(target.url.port)
              : isHttps
                ? 443
                : 80,
          path: `${target.url.pathname}${target.url.search}`,
          headers: { ...headers, host: target.url.host },
          timeout: timeoutMs,
          // We follow redirects ourselves so each hop is re-validated.
        },
        (response) => {
          const chunks: Buffer[] = [];
          let received = 0;
          let truncated = false;

          response.on('data', (chunk: Buffer) => {
            received += chunk.byteLength;
            if (received > maxBytes) {
              truncated = true;
              response.destroy();
              return;
            }
            chunks.push(chunk);
          });

          response.on('end', () =>
            resolve(
              E.right({
                status: response.statusCode ?? 0,
                statusText: response.statusMessage ?? '',
                responseHeaders: this.flattenHeaders(response.headers),
                chunks,
                truncated,
              }),
            ),
          );

          response.on('close', () => {
            if (!truncated) return;
            resolve(
              E.right({
                status: response.statusCode ?? 0,
                statusText: response.statusMessage ?? '',
                responseHeaders: this.flattenHeaders(response.headers),
                chunks,
                truncated: true,
              }),
            );
          });

          response.on('error', () =>
            resolve(E.left(AGENT_RESPONSE_TOO_LARGE)),
          );
        },
      );

      request.on('timeout', () => {
        request.destroy();
        resolve(E.left(AGENT_REQUEST_TIMEOUT));
      });

      request.on('error', (error) =>
        resolve(E.left(`agent/request_failed: ${error.message}`)),
      );

      if (body) request.write(body);
      request.end();
    });
  }

  private flattenHeaders(
    headers: http.IncomingHttpHeaders,
  ): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(headers)) {
      if (value === undefined) continue;
      out[key] = Array.isArray(value) ? value.join(', ') : String(value);
    }
    return out;
  }
}
