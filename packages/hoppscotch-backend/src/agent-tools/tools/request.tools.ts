import { Injectable } from '@nestjs/common';
import * as E from 'fp-ts/Either';
import * as O from 'fp-ts/Option';
import { z } from 'zod';
import { TEAM_COLL_NOT_FOUND, TEAM_REQ_NOT_FOUND } from 'src/errors';
import { TeamCollectionService } from 'src/team-collection/team-collection.service';
import { TeamRequestService } from 'src/team-request/team-request.service';
import { ReqType } from 'src/types/RequestTypes';
import { UserCollectionService } from 'src/user-collection/user-collection.service';
import { UserRequestService } from 'src/user-request/user-request.service';
import { AgentTool, AgentToolContext, defineTool } from '../agent-tool.types';
import { redactRequestJson } from '../redaction';

const workspaceId = z
  .string()
  .optional()
  .describe(
    'Workspace to act in. Omit for your personal workspace; use a team id from hopp_list_workspaces for a team.',
  );

const reqType = z
  .enum(['REST', 'GQL'])
  .optional()
  .describe('Request type. Defaults to REST.');

@Injectable()
export class RequestTools {
  constructor(
    private readonly userCollectionService: UserCollectionService,
    private readonly userRequestService: UserRequestService,
    private readonly teamCollectionService: TeamCollectionService,
    private readonly teamRequestService: TeamRequestService,
  ) {}

  build(): AgentTool<any>[] {
    return [
      this.createCollection(),
      this.renameCollection(),
      this.deleteCollection(),
      this.moveCollection(),
      this.createRequest(),
      this.updateRequest(),
      this.deleteRequest(),
      this.setRequestScripts(),
    ];
  }

  private toReqType(value: 'REST' | 'GQL' | undefined): ReqType {
    return value === 'GQL' ? ReqType.GQL : ReqType.REST;
  }

  /** Read a collection's current title, for before/after in a preview. */
  private async collectionTitle(
    ctx: AgentToolContext,
    collectionId: string,
  ): Promise<E.Either<string, string>> {
    if (ctx.workspace.type === 'team') {
      const collection =
        await this.teamCollectionService.getCollection(collectionId);
      if (E.isLeft(collection)) return E.left(collection.left);

      // getCollection is not team-scoped, so confirm it belongs to the team
      // the caller was actually authorized for.
      if (collection.right.teamID !== ctx.workspace.teamID) {
        return E.left(TEAM_COLL_NOT_FOUND);
      }
      return E.right(collection.right.title);
    }

    const collection = await this.userCollectionService.getUserCollection(
      collectionId,
      ctx.user.uid,
    );
    if (E.isLeft(collection)) return E.left(collection.left);
    return E.right(collection.right.title);
  }

  private async requestRecord(ctx: AgentToolContext, requestId: string) {
    if (ctx.workspace.type === 'team') {
      const found = await this.teamRequestService.getRequest(requestId);
      if (O.isNone(found)) return E.left(TEAM_REQ_NOT_FOUND);
      if (found.value.teamID !== ctx.workspace.teamID) {
        return E.left(TEAM_REQ_NOT_FOUND);
      }
      return E.right({
        title: found.value.title,
        request: found.value.request,
        collectionID: found.value.collectionID,
      });
    }

    const found = await this.userRequestService.fetchUserRequest(
      requestId,
      ctx.user,
    );
    if (E.isLeft(found)) return E.left(found.left);
    return E.right({
      title: found.right.title,
      request: found.right.request,
      collectionID: found.right.collectionID,
    });
  }

  private createCollection() {
    return defineTool({
      name: 'hopp_create_collection',
      title: 'Create a collection or folder',
      description:
        'Create a collection, or a folder inside one by passing parentId. Returns the new id.',
      input: {
        workspaceId,
        title: z.string().min(1).describe('Name for the new collection.'),
        parentId: z
          .string()
          .optional()
          .describe('Create inside this collection, making it a folder.'),
        type: reqType,
      },
      readOnly: false,
      destructive: false,
      idempotent: false,
      openWorld: false,
      preview: async (input, ctx) => {
        const location = input.parentId
          ? await this.collectionTitle(ctx, input.parentId)
          : E.right(null);
        if (E.isLeft(location)) return E.left(location.left);

        return E.right({
          summary: location.right
            ? `Create folder "${input.title}" inside "${location.right}"`
            : `Create collection "${input.title}"`,
          before: null,
          after: { title: input.title, parentId: input.parentId ?? null },
          warnings: [],
        });
      },
      execute: async (input, ctx) => {
        if (ctx.workspace.type === 'team') {
          const result = await this.teamCollectionService.createCollection(
            ctx.workspace.teamID,
            input.title,
            null,
            input.parentId ?? null,
          );
          if (E.isLeft(result)) return E.left(result.left);
          return E.right({ id: result.right.id, title: result.right.title });
        }

        const result = await this.userCollectionService.createUserCollection(
          ctx.user,
          input.title,
          null,
          input.parentId ?? null,
          this.toReqType(input.type),
        );
        if (E.isLeft(result)) return E.left(result.left);
        return E.right({ id: result.right.id, title: result.right.title });
      },
    });
  }

  private renameCollection() {
    return defineTool({
      name: 'hopp_rename_collection',
      title: 'Rename a collection',
      description: 'Change the title of a collection or folder.',
      input: {
        workspaceId,
        collectionId: z.string(),
        title: z.string().min(1).describe('New title.'),
      },
      readOnly: false,
      destructive: false,
      idempotent: true,
      openWorld: false,
      preview: async (input, ctx) => {
        const current = await this.collectionTitle(ctx, input.collectionId);
        if (E.isLeft(current)) return E.left(current.left);

        return E.right({
          summary: `Rename "${current.right}" to "${input.title}"`,
          before: { title: current.right },
          after: { title: input.title },
          warnings: [],
        });
      },
      execute: async (input, ctx) => {
        if (ctx.workspace.type === 'team') {
          const result = await this.teamCollectionService.renameCollection(
            input.collectionId,
            input.title,
          );
          if (E.isLeft(result)) return E.left(result.left);
          return E.right({ id: input.collectionId, title: input.title });
        }

        const result = await this.userCollectionService.renameUserCollection(
          input.title,
          input.collectionId,
          ctx.user.uid,
        );
        if (E.isLeft(result)) return E.left(result.left);
        return E.right({ id: input.collectionId, title: input.title });
      },
    });
  }

  private deleteCollection() {
    return defineTool({
      name: 'hopp_delete_collection',
      title: 'Delete a collection',
      description:
        'Delete a collection or folder AND everything inside it. This cannot be undone.',
      input: { workspaceId, collectionId: z.string() },
      readOnly: false,
      destructive: true,
      idempotent: true,
      openWorld: false,
      preview: async (input, ctx) => {
        const current = await this.collectionTitle(ctx, input.collectionId);
        if (E.isLeft(current)) return E.left(current.left);

        // Show the caller exactly what disappears, not just the top node.
        const contents = await this.describeSubtree(ctx, input.collectionId);

        return E.right({
          summary: `Delete "${current.right}" and everything inside it`,
          before: contents,
          after: null,
          warnings: [
            'This permanently deletes the collection and all folders and requests inside it.',
          ],
        });
      },
      execute: async (input, ctx) => {
        if (ctx.workspace.type === 'team') {
          const result = await this.teamCollectionService.deleteCollection(
            input.collectionId,
          );
          if (E.isLeft(result)) return E.left(result.left);
          return E.right({ deleted: input.collectionId });
        }

        const result = await this.userCollectionService.deleteUserCollection(
          input.collectionId,
          ctx.user.uid,
        );
        if (E.isLeft(result)) return E.left(result.left);
        return E.right({ deleted: input.collectionId });
      },
    });
  }

  private moveCollection() {
    return defineTool({
      name: 'hopp_move_collection',
      title: 'Move a collection',
      description:
        'Move a collection or folder under a different parent, or to the root by omitting destinationId.',
      input: {
        workspaceId,
        collectionId: z.string(),
        destinationId: z
          .string()
          .optional()
          .describe('New parent collection id. Omit to move to the root.'),
      },
      readOnly: false,
      destructive: false,
      idempotent: true,
      openWorld: false,
      preview: async (input, ctx) => {
        const current = await this.collectionTitle(ctx, input.collectionId);
        if (E.isLeft(current)) return E.left(current.left);

        const destination = input.destinationId
          ? await this.collectionTitle(ctx, input.destinationId)
          : E.right(null);
        if (E.isLeft(destination)) return E.left(destination.left);

        return E.right({
          summary: `Move "${current.right}" to ${
            destination.right ? `"${destination.right}"` : 'the workspace root'
          }`,
          before: { collectionId: input.collectionId },
          after: { parentId: input.destinationId ?? null },
          warnings: [],
        });
      },
      execute: async (input, ctx) => {
        if (ctx.workspace.type === 'team') {
          const result = await this.teamCollectionService.moveCollection(
            input.collectionId,
            input.destinationId ?? null,
          );
          if (E.isLeft(result)) return E.left(result.left);
          return E.right({ moved: input.collectionId });
        }

        const result = await this.userCollectionService.moveUserCollection(
          input.collectionId,
          input.destinationId ?? null,
          ctx.user.uid,
        );
        if (E.isLeft(result)) return E.left(result.left);
        return E.right({ moved: input.collectionId });
      },
    });
  }

  private createRequest() {
    return defineTool({
      name: 'hopp_create_request',
      title: 'Create a request',
      description:
        'Add a request to a collection. `request` is a HoppRESTRequest JSON object - include method, endpoint, ' +
        'headers, params and body as needed.',
      input: {
        workspaceId,
        collectionId: z.string(),
        title: z.string().min(1),
        request: z
          .record(z.any())
          .describe('HoppRESTRequest JSON object (v17 shape).'),
        type: reqType,
      },
      readOnly: false,
      destructive: false,
      idempotent: false,
      openWorld: false,
      preview: async (input, ctx) => {
        const parent = await this.collectionTitle(ctx, input.collectionId);
        if (E.isLeft(parent)) return E.left(parent.left);

        const method = (input.request as any)?.method ?? 'GET';
        const endpoint = (input.request as any)?.endpoint ?? '';

        return E.right({
          summary: `Add ${method} "${input.title}" to "${parent.right}"`,
          before: null,
          after: { title: input.title, method, endpoint },
          warnings: [],
        });
      },
      execute: async (input, ctx) => {
        const body = JSON.stringify(input.request);

        if (ctx.workspace.type === 'team') {
          const result = await this.teamRequestService.createTeamRequest(
            input.collectionId,
            ctx.workspace.teamID,
            input.title,
            body,
          );
          if (E.isLeft(result)) return E.left(result.left);
          return E.right({ id: result.right.id, title: result.right.title });
        }

        const result = await this.userRequestService.createRequest(
          input.collectionId,
          input.title,
          body,
          this.toReqType(input.type),
          ctx.user,
        );
        if (E.isLeft(result)) return E.left(result.left);
        return E.right({ id: result.right.id, title: result.right.title });
      },
    });
  }

  private updateRequest() {
    return defineTool({
      name: 'hopp_update_request',
      title: 'Update a request',
      description:
        'Replace a saved request. Read it with hopp_get_request first and send the whole modified object back.',
      input: {
        workspaceId,
        requestId: z.string(),
        title: z.string().optional().describe('New title. Omit to keep it.'),
        request: z.record(z.any()).describe('Full HoppRESTRequest JSON object.'),
        type: reqType,
      },
      readOnly: false,
      destructive: false,
      idempotent: true,
      openWorld: false,
      preview: async (input, ctx) => {
        const existing = await this.requestRecord(ctx, input.requestId);
        if (E.isLeft(existing)) return E.left(existing.left);

        return E.right({
          summary: `Update request "${input.title ?? existing.right.title}"`,
          before: redactRequestJson(existing.right.request),
          after: redactRequestJson(input.request),
          warnings: [],
        });
      },
      execute: async (input, ctx) => {
        const existing = await this.requestRecord(ctx, input.requestId);
        if (E.isLeft(existing)) return E.left(existing.left);

        const title = input.title ?? existing.right.title;
        const body = JSON.stringify(input.request);

        if (ctx.workspace.type === 'team') {
          const result = await this.teamRequestService.updateTeamRequest(
            input.requestId,
            title,
            body,
          );
          if (E.isLeft(result)) return E.left(result.left);
          return E.right({ id: input.requestId, title });
        }

        const result = await this.userRequestService.updateRequest(
          input.requestId,
          title,
          this.toReqType(input.type),
          body,
          ctx.user,
        );
        if (E.isLeft(result)) return E.left(result.left);
        return E.right({ id: input.requestId, title });
      },
    });
  }

  private deleteRequest() {
    return defineTool({
      name: 'hopp_delete_request',
      title: 'Delete a request',
      description: 'Delete a saved request. This cannot be undone.',
      input: { workspaceId, requestId: z.string() },
      readOnly: false,
      destructive: true,
      idempotent: true,
      openWorld: false,
      preview: async (input, ctx) => {
        const existing = await this.requestRecord(ctx, input.requestId);
        if (E.isLeft(existing)) return E.left(existing.left);

        return E.right({
          summary: `Delete request "${existing.right.title}"`,
          before: redactRequestJson(existing.right.request),
          after: null,
          warnings: ['This permanently deletes the request.'],
        });
      },
      execute: async (input, ctx) => {
        if (ctx.workspace.type === 'team') {
          const result = await this.teamRequestService.deleteTeamRequest(
            input.requestId,
          );
          if (E.isLeft(result)) return E.left(result.left);
          return E.right({ deleted: input.requestId });
        }

        const result = await this.userRequestService.deleteRequest(
          input.requestId,
          ctx.user,
        );
        if (E.isLeft(result)) return E.left(result.left);
        return E.right({ deleted: input.requestId });
      },
    });
  }

  /**
   * Persist generated scripts. The model writes the script itself - this only
   * merges it into the stored request, so script generation needs no tool of
   * its own.
   */
  private setRequestScripts() {
    return defineTool({
      name: 'hopp_set_request_scripts',
      title: 'Set request scripts',
      description:
        'Set the pre-request and/or test script on a saved request, leaving the rest of it untouched.',
      input: {
        workspaceId,
        requestId: z.string(),
        preRequestScript: z.string().optional(),
        testScript: z.string().optional(),
        type: reqType,
      },
      readOnly: false,
      destructive: false,
      idempotent: true,
      openWorld: false,
      preview: async (input, ctx) => {
        const merged = await this.mergeScripts(ctx, input);
        if (E.isLeft(merged)) return E.left(merged.left);

        const { existing, before, after } = merged.right;
        const changed = [
          input.preRequestScript !== undefined ? 'pre-request script' : null,
          input.testScript !== undefined ? 'test script' : null,
        ].filter(Boolean);

        return E.right({
          summary: `Set ${changed.join(' and ')} on "${existing.title}"`,
          before,
          after,
          warnings: [],
        });
      },
      execute: async (input, ctx) => {
        const merged = await this.mergeScripts(ctx, input);
        if (E.isLeft(merged)) return E.left(merged.left);

        const { existing, request } = merged.right;
        const body = JSON.stringify(request);

        if (ctx.workspace.type === 'team') {
          const result = await this.teamRequestService.updateTeamRequest(
            input.requestId,
            existing.title,
            body,
          );
          if (E.isLeft(result)) return E.left(result.left);
          return E.right({ id: input.requestId, updated: true });
        }

        const result = await this.userRequestService.updateRequest(
          input.requestId,
          existing.title,
          this.toReqType(input.type),
          body,
          ctx.user,
        );
        if (E.isLeft(result)) return E.left(result.left);
        return E.right({ id: input.requestId, updated: true });
      },
    });
  }

  /** Read-modify-write helper shared by setRequestScripts' preview and execute. */
  private async mergeScripts(
    ctx: AgentToolContext,
    input: {
      requestId?: string;
      preRequestScript?: string;
      testScript?: string;
    },
  ) {
    const existing = await this.requestRecord(ctx, input.requestId as string);
    if (E.isLeft(existing)) return E.left(existing.left);

    let parsed: Record<string, any>;
    try {
      parsed =
        typeof existing.right.request === 'string'
          ? JSON.parse(existing.right.request)
          : (existing.right.request as Record<string, any>);
    } catch {
      return E.left('user_request/invalid_json');
    }

    const request = { ...parsed };
    if (input.preRequestScript !== undefined) {
      request.preRequestScript = input.preRequestScript;
    }
    if (input.testScript !== undefined) {
      request.testScript = input.testScript;
    }

    return E.right({
      existing: existing.right,
      request,
      before: {
        preRequestScript: parsed.preRequestScript ?? '',
        testScript: parsed.testScript ?? '',
      },
      after: {
        preRequestScript: request.preRequestScript ?? '',
        testScript: request.testScript ?? '',
      },
    });
  }

  /** Summarize what a delete would remove, for the confirmation card. */
  private async describeSubtree(
    ctx: AgentToolContext,
    collectionId: string,
  ): Promise<unknown> {
    try {
      if (ctx.workspace.type === 'team') {
        const exported = await this.teamCollectionService.getCollectionForCLI(
          collectionId,
          ctx.user.uid,
        );
        return E.isRight(exported) ? this.countTree(exported.right) : null;
      }

      const exported =
        await this.userCollectionService.exportUserCollectionToJSONObject(
          ctx.user.uid,
          collectionId,
        );
      return E.isRight(exported) ? this.countTree(exported.right) : null;
    } catch {
      return null;
    }
  }

  private countTree(node: any): {
    name: string;
    folders: number;
    requests: number;
  } {
    let folders = 0;
    let requests = 0;

    const walk = (current: any) => {
      if (!current || typeof current !== 'object') return;
      requests += Array.isArray(current.requests) ? current.requests.length : 0;
      for (const folder of current.folders ?? []) {
        folders += 1;
        walk(folder);
      }
    };
    walk(node);

    return { name: node?.name ?? node?.title ?? '', folders, requests };
  }
}
