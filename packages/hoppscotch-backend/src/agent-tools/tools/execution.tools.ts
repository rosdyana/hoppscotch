import { Injectable } from '@nestjs/common';
import * as E from 'fp-ts/Either';
import { z } from 'zod';
import { RequestRunnerService } from 'src/request-runner/request-runner.service';
import { AgentTool, AgentToolContext, defineTool } from '../agent-tool.types';
import { CollectionTools } from './collection.tools';

const workspaceId = z
  .string()
  .optional()
  .describe(
    'Workspace to act in. Omit for your personal workspace; use a team id from hopp_list_workspaces for a team.',
  );

const keyValue = z.array(
  z.object({
    key: z.string(),
    value: z.string(),
    active: z.boolean().optional(),
  }),
);

@Injectable()
export class ExecutionTools {
  constructor(
    private readonly runner: RequestRunnerService,
    private readonly collectionTools: CollectionTools,
  ) {}

  build(): AgentTool<any>[] {
    return [this.runAdhocRequest(), this.runSavedRequest()];
  }

  /**
   * Running a request mutates a third-party system even though it writes
   * nothing in Hoppscotch, so these are NOT read-only. destructive + openWorld
   * make Claude Code prompt before firing one.
   */
  private runAdhocRequest() {
    return defineTool({
      name: 'hopp_run_adhoc_request',
      title: 'Run an ad-hoc HTTP request',
      description:
        'Send an HTTP request and return the status, headers and body. The response body is truncated ' +
        'for large payloads. Blocked from reaching private or internal addresses.',
      input: {
        method: z.string().describe('HTTP method, e.g. GET or POST.'),
        url: z.string().describe('Absolute URL to request.'),
        headers: keyValue.optional(),
        params: keyValue.optional(),
        body: z.string().optional().describe('Raw request body.'),
        contentType: z.string().optional(),
      },
      readOnly: false,
      destructive: true,
      idempotent: false,
      openWorld: true,
      preview: async (input) =>
        E.right({
          summary: `Send ${String(input.method).toUpperCase()} ${input.url}`,
          before: null,
          after: { method: input.method, url: input.url },
          warnings: ['This sends a real request to an external service.'],
        }),
      execute: async (input) => {
        const result = await this.runner.run({
          method: input.method,
          url: input.url,
          headers: input.headers as any,
          params: input.params as any,
          body: input.body ?? null,
          contentType: input.contentType ?? null,
        });
        if (E.isLeft(result)) return E.left(result.left);
        return E.right(result.right);
      },
    });
  }

  private runSavedRequest() {
    return defineTool({
      name: 'hopp_run_request',
      title: 'Run a saved request',
      description:
        'Send a saved request and return its response, so you can explain or debug the result.',
      input: {
        workspaceId,
        requestId: z.string().describe('Saved request id to send.'),
      },
      readOnly: false,
      destructive: true,
      idempotent: false,
      openWorld: true,
      preview: async (input, ctx) => {
        const request = await this.loadRequest(ctx, input.requestId as string);
        if (E.isLeft(request)) return E.left(request.left);

        return E.right({
          summary: `Send ${request.right.method} ${request.right.url}`,
          before: null,
          after: { method: request.right.method, url: request.right.url },
          warnings: ['This sends a real request to an external service.'],
        });
      },
      execute: async (input, ctx) => {
        const request = await this.loadRequest(ctx, input.requestId as string);
        if (E.isLeft(request)) return E.left(request.left);

        const result = await this.runner.run(request.right);
        if (E.isLeft(result)) return E.left(result.left);
        return E.right(result.right);
      },
    });
  }

  /**
   * Load the UNREDACTED stored request - the runner needs real credentials to
   * actually send it. Only the response comes back through redaction.
   */
  private async loadRequest(ctx: AgentToolContext, requestId: string) {
    const raw = await this.collectionTools.loadRawRequest(ctx, requestId);
    if (E.isLeft(raw)) return E.left(raw.left);

    const request = raw.right as Record<string, any>;
    return E.right({
      method: String(request.method ?? 'GET'),
      url: String(request.endpoint ?? ''),
      headers: Array.isArray(request.headers) ? request.headers : [],
      params: Array.isArray(request.params) ? request.params : [],
      body: request.body?.body ?? null,
      contentType: request.body?.contentType ?? null,
    });
  }
}
