import { Injectable } from '@nestjs/common';
import {
  harImporter,
  hoppInsomniaImporter,
  hoppOpenAPIImporter,
  hoppPostmanImporter,
  hoppRESTImporter,
} from '@hoppscotch/importers';
import * as E from 'fp-ts/Either';
import { z } from 'zod';
import { AgentAttachmentService } from 'src/agent-chat/agent-attachment.service';
import { TeamCollectionService } from 'src/team-collection/team-collection.service';
import { TeamRequestService } from 'src/team-request/team-request.service';
import { ReqType } from 'src/types/RequestTypes';
import { UserCollectionService } from 'src/user-collection/user-collection.service';
import { UserRequestService } from 'src/user-request/user-request.service';
import { AgentTool, AgentToolContext, defineTool } from '../agent-tool.types';

const workspaceId = z
  .string()
  .optional()
  .describe(
    'Workspace to import into. Omit for your personal workspace; use a team id from hopp_list_workspaces for a team.',
  );

type ImporterResult = { name?: string; folders?: unknown[]; requests?: unknown[] };

@Injectable()
export class ImportTools {
  constructor(
    private readonly userCollectionService: UserCollectionService,
    private readonly teamCollectionService: TeamCollectionService,
    private readonly userRequestService: UserRequestService,
    private readonly teamRequestService: TeamRequestService,
    private readonly attachments: AgentAttachmentService,
  ) {}

  build(): AgentTool<any>[] {
    return [
      this.importPostman(),
      this.importOpenApi(),
      this.importInsomnia(),
      this.importHar(),
      this.importHoppscotch(),
      this.importCurl(),
    ];
  }

  /**
   * Both importers return fp-ts structures - some Either, some TaskEither -
   * so normalize to a plain promise of collections here.
   */
  private async runImporter(
    importer: (content: string[]) => unknown,
    content: string,
  ): Promise<E.Either<string, ImporterResult[]>> {
    try {
      const outcome: any = await Promise.resolve(importer([content]));

      // TaskEither resolves to an Either; Either is already one.
      const result =
        typeof outcome === 'function' ? await outcome() : outcome;

      if (result && result._tag === 'Left') {
        return E.left(`import/failed: ${String(result.left)}`);
      }
      if (result && result._tag === 'Right') {
        return E.right(result.right as ImporterResult[]);
      }

      return Array.isArray(result)
        ? E.right(result as ImporterResult[])
        : E.left('import/failed');
    } catch (e) {
      return E.left(
        `import/failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  private countTree(nodes: ImporterResult[]) {
    let folders = 0;
    let requests = 0;

    const walk = (node: any) => {
      requests += node?.requests?.length ?? 0;
      for (const child of node?.folders ?? []) {
        folders += 1;
        walk(child);
      }
    };
    nodes.forEach(walk);

    return { collections: nodes.length, folders, requests };
  }

  private async persist(
    ctx: AgentToolContext,
    collections: ImporterResult[],
    destinationCollectionId?: string,
  ) {
    const json = JSON.stringify(collections);

    if (ctx.workspace.type === 'team') {
      const result = await this.teamCollectionService.importCollectionsFromJSON(
        json,
        ctx.workspace.teamID,
        destinationCollectionId ?? null,
      );
      if (E.isLeft(result)) return E.left(result.left);
      return E.right(this.countTree(collections));
    }

    const result = await this.userCollectionService.importCollectionsFromJSON(
      json,
      ctx.user.uid,
      destinationCollectionId ?? null,
      ReqType.REST,
    );
    if (E.isLeft(result)) return E.left(result.left);
    return E.right(this.countTree(collections));
  }

  /**
   * Either the inlined content or the stored attachment - never both.
   *
   * Enforced here rather than as a Zod refinement because the executor parses
   * `z.object(tool.input)` from the raw shape, which leaves no place to hang an
   * object-level check.
   */
  private async resolveContent(
    input: { content?: string; attachmentId?: string },
    ctx: AgentToolContext,
  ): Promise<E.Either<string, string>> {
    if (input.content && input.attachmentId) {
      return E.left(
        'Provide either content or attachmentId, not both.',
      );
    }

    if (input.attachmentId) {
      const found = await this.attachments.get(
        input.attachmentId,
        ctx.user.uid,
      );
      if (E.isLeft(found)) return E.left(found.left);
      return E.right(found.right.content);
    }

    if (!input.content) {
      return E.left('Provide either content or attachmentId.');
    }

    return E.right(input.content);
  }

  /** Shared shape for every file-based importer. */
  private fileImporter(config: {
    name: string;
    title: string;
    description: string;
    contentLabel: string;
    importer: (content: string[]) => unknown;
  }) {
    return defineTool({
      name: config.name,
      title: config.title,
      description: config.description,
      input: {
        workspaceId,
        content: z.string().min(1).optional().describe(config.contentLabel),
        attachmentId: z
          .string()
          .optional()
          .describe(
            'Import a file the user attached to this conversation, by its id from the attachments block. Use this instead of content for anything large - the file is read server-side. Chat only; not available over MCP.',
          ),
        destinationCollectionId: z
          .string()
          .optional()
          .describe('Import inside this existing collection.'),
      },
      readOnly: false,
      destructive: false,
      idempotent: false,
      openWorld: false,
      preview: async (input, ctx) => {
        const content = await this.resolveContent(input, ctx);
        if (E.isLeft(content)) return E.left(content.left);

        const parsed = await this.runImporter(config.importer, content.right);
        if (E.isLeft(parsed)) return E.left(parsed.left);

        const counts = this.countTree(parsed.right);
        return E.right({
          summary: `Import ${counts.collections} collection(s), ${counts.folders} folder(s) and ${counts.requests} request(s)`,
          before: null,
          after: {
            ...counts,
            names: parsed.right.map((collection) => collection.name),
          },
          warnings: [],
        });
      },
      execute: async (input, ctx) => {
        const content = await this.resolveContent(input, ctx);
        if (E.isLeft(content)) return E.left(content.left);

        const parsed = await this.runImporter(config.importer, content.right);
        if (E.isLeft(parsed)) return E.left(parsed.left);

        return this.persist(ctx, parsed.right, input.destinationCollectionId);
      },
    });
  }

  private importPostman() {
    return this.fileImporter({
      name: 'hopp_import_postman',
      title: 'Import a Postman collection',
      description:
        'Import a Postman collection export (v2 or v2.1) into a workspace.',
      contentLabel: 'The Postman collection JSON, as text.',
      importer: hoppPostmanImporter,
    });
  }

  private importOpenApi() {
    return this.fileImporter({
      name: 'hopp_import_openapi',
      title: 'Import an OpenAPI spec',
      description:
        'Import an OpenAPI or Swagger document (JSON or YAML) as a collection.',
      contentLabel: 'The OpenAPI/Swagger document, as text.',
      importer: hoppOpenAPIImporter,
    });
  }

  private importInsomnia() {
    return this.fileImporter({
      name: 'hopp_import_insomnia',
      title: 'Import an Insomnia export',
      description: 'Import an Insomnia collection export into a workspace.',
      contentLabel: 'The Insomnia export, as text.',
      importer: hoppInsomniaImporter,
    });
  }

  private importHar() {
    return this.fileImporter({
      name: 'hopp_import_har',
      title: 'Import a HAR file',
      description:
        'Import an HTTP Archive (HAR) file, turning each captured entry into a request.',
      contentLabel: 'The HAR file contents, as text.',
      importer: harImporter,
    });
  }

  private importHoppscotch() {
    return this.fileImporter({
      name: 'hopp_import_hoppscotch',
      title: 'Import a Hoppscotch collection',
      description: 'Import a Hoppscotch collection export.',
      contentLabel: 'The Hoppscotch collection JSON, as text.',
      importer: hoppRESTImporter,
    });
  }

  private importCurl() {
    return defineTool({
      name: 'hopp_import_curl',
      title: 'Import a cURL command',
      description:
        'Turn a cURL command into a saved request inside a collection.',
      input: {
        workspaceId,
        curl: z.string().min(1).describe('The cURL command.'),
        collectionId: z.string().describe('Collection to add the request to.'),
        title: z.string().optional().describe('Name for the new request.'),
      },
      readOnly: false,
      destructive: false,
      idempotent: false,
      openWorld: false,
      preview: async (input) => {
        const parsed = parseCurl(input.curl);
        if (E.isLeft(parsed)) return E.left(parsed.left);

        return E.right({
          summary: `Create ${parsed.right.method} "${
            input.title ?? parsed.right.endpoint
          }"`,
          before: null,
          after: parsed.right,
          warnings: [],
        });
      },
      execute: async (input, ctx) => {
        const parsed = parseCurl(input.curl);
        if (E.isLeft(parsed)) return E.left(parsed.left);

        const title =
          input.title ?? String(parsed.right.endpoint ?? 'Imported request');
        const body = JSON.stringify({ ...parsed.right, name: title });

        // Goes through the same services as every other write, so orderIndex
        // locking and the pubsub events that update open browser tabs are
        // identical.
        if (ctx.workspace.type === 'team') {
          const result = await this.teamRequestService.createTeamRequest(
            input.collectionId,
            ctx.workspace.teamID,
            title,
            body,
          );
          if (E.isLeft(result)) return E.left(result.left);
          return E.right({ id: result.right.id, title });
        }

        const result = await this.userRequestService.createRequest(
          input.collectionId,
          title,
          body,
          ReqType.REST,
          ctx.user,
        );
        if (E.isLeft(result)) return E.left(result.left);
        return E.right({ id: result.right.id, title });
      },
    });
  }
}

/**
 * Minimal cURL parser covering the flags that actually appear in copied
 * commands. The full parser in hoppscotch-common has nine sub-helpers; this
 * handles method, headers, data, basic auth and form fields.
 */
export function parseCurl(
  command: string,
): E.Either<string, Record<string, unknown>> {
  const tokens = tokenizeCurl(command);
  if (tokens.length === 0 || !tokens[0].startsWith('curl')) {
    return E.left('import/not_a_curl_command');
  }

  let method: string | null = null;
  let url = '';
  const headers: { key: string; value: string; active: boolean }[] = [];
  let body: string | null = null;
  let contentType: string | null = null;

  for (let i = 1; i < tokens.length; i++) {
    const token = tokens[i];

    switch (token) {
      case '-X':
      case '--request':
        method = tokens[++i]?.toUpperCase() ?? null;
        break;

      case '-H':
      case '--header': {
        const raw = tokens[++i] ?? '';
        const separator = raw.indexOf(':');
        if (separator === -1) break;
        const key = raw.slice(0, separator).trim();
        const value = raw.slice(separator + 1).trim();
        if (key.toLowerCase() === 'content-type') contentType = value;
        headers.push({ key, value, active: true });
        break;
      }

      case '-d':
      case '--data':
      case '--data-raw':
      case '--data-binary':
        body = tokens[++i] ?? '';
        break;

      case '-u':
      case '--user': {
        const credentials = tokens[++i] ?? '';
        headers.push({
          key: 'Authorization',
          value: `Basic ${Buffer.from(credentials).toString('base64')}`,
          active: true,
        });
        break;
      }

      case '--url':
        url = tokens[++i] ?? '';
        break;

      default:
        if (!token.startsWith('-') && url === '') url = token;
        break;
    }
  }

  if (url === '') return E.left('import/curl_missing_url');

  return E.right({
    v: '17',
    name: url,
    method: method ?? (body !== null ? 'POST' : 'GET'),
    endpoint: url,
    headers,
    params: [],
    auth: { authType: 'inherit', authActive: true },
    preRequestScript: '',
    testScript: '',
    body:
      body === null
        ? { contentType: null, body: null }
        : { contentType: contentType ?? 'application/json', body },
    requestVariables: [],
    responses: {},
    description: null,
  });
}

/** Split a shell-ish command respecting quotes and line continuations. */
function tokenizeCurl(command: string): string[] {
  const normalized = command.replace(/\\\r?\n/g, ' ').trim();
  const tokens: string[] = [];

  let current = '';
  let quote: '"' | "'" | null = null;

  for (let i = 0; i < normalized.length; i++) {
    const char = normalized[i];

    if (quote) {
      if (char === quote) quote = null;
      else current += char;
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    if (/\s/.test(char)) {
      if (current !== '') tokens.push(current);
      current = '';
      continue;
    }

    current += char;
  }

  if (current !== '') tokens.push(current);
  return tokens;
}
