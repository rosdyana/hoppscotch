import { Injectable } from '@nestjs/common';
import * as E from 'fp-ts/Either';
import * as O from 'fp-ts/Option';
import { z } from 'zod';
import { TEAM_REQ_NOT_FOUND } from 'src/errors';
import { TeamCollectionService } from 'src/team-collection/team-collection.service';
import { TeamRequestService } from 'src/team-request/team-request.service';
import { ReqType } from 'src/types/RequestTypes';
import { UserCollectionService } from 'src/user-collection/user-collection.service';
import { UserRequestService } from 'src/user-request/user-request.service';
import { AgentTool, AgentToolContext, defineTool } from '../agent-tool.types';
import { redactRequestJson } from '../redaction';

/** Shared optional workspace selector. Omitted means the personal workspace. */
const workspaceId = z
  .string()
  .optional()
  .describe(
    'Workspace to act in. Omit for your personal workspace; use a team id from hopp_list_workspaces for a team.',
  );

const reqType = z
  .enum(['REST', 'GQL'])
  .optional()
  .describe('Request type of the collections to list. Defaults to REST.');

@Injectable()
export class CollectionTools {
  constructor(
    private readonly userCollectionService: UserCollectionService,
    private readonly userRequestService: UserRequestService,
    private readonly teamCollectionService: TeamCollectionService,
    private readonly teamRequestService: TeamRequestService,
  ) {}

  build(): AgentTool<any>[] {
    return [
      this.listCollections(),
      this.getCollection(),
      this.getRequest(),
      this.listRequests(),
      this.search(),
    ];
  }

  private toReqType(value: 'REST' | 'GQL' | undefined): ReqType {
    return value === 'GQL' ? ReqType.GQL : ReqType.REST;
  }

  private listCollections() {
    return defineTool({
      name: 'hopp_list_collections',
      title: 'List collections',
      description:
        'List collections in a workspace. Returns ids, titles and parent ids - not their contents. ' +
        'Pass parentId to list the folders inside a collection. Use hopp_get_collection to read a collection in full.',
      input: {
        workspaceId,
        parentId: z
          .string()
          .optional()
          .describe('List children of this collection instead of the roots.'),
        type: reqType,
        take: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe('Maximum number to return (default 25).'),
      },
      readOnly: true,
      destructive: false,
      idempotent: true,
      openWorld: false,
      execute: async (input, ctx) => {
        const take = input.take ?? 25;

        if (ctx.workspace.type === 'team') {
          const collections = input.parentId
            ? await this.teamCollectionService.getChildrenOfCollection(
                input.parentId,
                null,
                take,
              )
            : await this.teamCollectionService.getTeamRootCollections(
                ctx.workspace.teamID,
                null,
                take,
              );

          return E.right(
            collections.map((collection) => ({
              id: collection.id,
              title: collection.title,
              parentId: collection.parentID ?? null,
            })),
          );
        }

        const collections = input.parentId
          ? await this.userCollectionService.getUserChildCollections(
              ctx.user,
              input.parentId,
              null,
              take,
              this.toReqType(input.type),
            )
          : await this.userCollectionService.getUserRootCollections(
              ctx.user,
              null,
              take,
              this.toReqType(input.type),
            );

        return E.right(
          collections.map((collection) => ({
            id: collection.id,
            title: collection.title,
            parentId: collection.parentID ?? null,
          })),
        );
      },
    });
  }

  /**
   * The question-answering primitive: one call returns a whole subtree,
   * including each request's method, URL, headers and scripts.
   */
  private getCollection() {
    return defineTool({
      name: 'hopp_get_collection',
      title: 'Get a collection',
      description:
        'Read a collection and everything inside it - nested folders and every request, with method, URL, ' +
        'headers, params, body and scripts. Use this to answer questions about what a collection contains or does. ' +
        'Credential values are redacted.',
      input: {
        workspaceId,
        collectionId: z.string().describe('Collection id to read.'),
      },
      readOnly: true,
      destructive: false,
      idempotent: true,
      openWorld: false,
      execute: async (input, ctx) => {
        if (ctx.workspace.type === 'team') {
          // getCollectionForCLI runs its own team-membership check.
          const result = await this.teamCollectionService.getCollectionForCLI(
            input.collectionId,
            ctx.user.uid,
          );
          if (E.isLeft(result)) return E.left(result.left);
          return E.right(this.redactTree(result.right));
        }

        const result =
          await this.userCollectionService.exportUserCollectionToJSONObject(
            ctx.user.uid,
            input.collectionId,
          );
        if (E.isLeft(result)) return E.left(result.left);
        return E.right(this.redactTree(result.right));
      },
    });
  }

  private getRequest() {
    return defineTool({
      name: 'hopp_get_request',
      title: 'Get a request',
      description:
        'Read a single saved request in full, including its pre-request and test scripts. ' +
        'Credential values are redacted.',
      input: {
        workspaceId,
        requestId: z.string().describe('Request id to read.'),
      },
      readOnly: true,
      destructive: false,
      idempotent: true,
      openWorld: false,
      execute: async (input, ctx) => {
        if (ctx.workspace.type === 'team') {
          const found = await this.teamRequestService.getRequest(
            input.requestId,
          );
          if (O.isNone(found)) return E.left(TEAM_REQ_NOT_FOUND);

          const request = found.value;

          // getRequest is not workspace-scoped, so confirm it belongs to the
          // team the caller was actually authorized for.
          if (request.teamID !== ctx.workspace.teamID) {
            return E.left(TEAM_REQ_NOT_FOUND);
          }

          return E.right({
            id: request.id,
            title: request.title,
            collectionId: request.collectionID,
            request: redactRequestJson(request.request),
          });
        }

        const result = await this.userRequestService.fetchUserRequest(
          input.requestId,
          ctx.user,
        );
        if (E.isLeft(result)) return E.left(result.left);

        return E.right({
          id: result.right.id,
          title: result.right.title,
          collectionId: result.right.collectionID,
          request: redactRequestJson(result.right.request),
        });
      },
    });
  }

  private listRequests() {
    return defineTool({
      name: 'hopp_list_requests',
      title: 'List requests in a collection',
      description:
        'List the requests directly inside one collection or folder, without their bodies. ' +
        'Use hopp_get_request for the full detail of one.',
      input: {
        workspaceId,
        collectionId: z.string().describe('Collection id to list requests in.'),
        type: reqType,
        take: z.number().int().min(1).max(100).optional(),
      },
      readOnly: true,
      destructive: false,
      idempotent: true,
      openWorld: false,
      execute: async (input, ctx) => {
        const take = input.take ?? 50;

        if (ctx.workspace.type === 'team') {
          const requests = await this.teamRequestService.getRequestsInCollection(
            input.collectionId,
            null,
            take,
          );
          return E.right(
            requests.map((request) => ({
              id: request.id,
              title: request.title,
            })),
          );
        }

        const requests = await this.userRequestService.fetchUserRequests(
          input.collectionId,
          this.toReqType(input.type),
          null,
          take,
          ctx.user,
        );
        if (E.isLeft(requests)) return E.left(requests.left);

        return E.right(
          requests.right.map((request) => ({
            id: request.id,
            title: request.title,
          })),
        );
      },
    });
  }

  private search() {
    return defineTool({
      name: 'hopp_search',
      title: 'Search collections and requests',
      description:
        'Find collections and requests whose title matches a query. Use this to locate something by name ' +
        'before reading it with hopp_get_collection or hopp_get_request.',
      input: {
        workspaceId,
        query: z.string().min(1).describe('Text to match against titles.'),
        take: z.number().int().min(1).max(50).optional(),
      },
      readOnly: true,
      destructive: false,
      idempotent: true,
      openWorld: false,
      execute: async (input, ctx) => {
        const take = input.take ?? 10;

        if (ctx.workspace.type === 'team') {
          const results = await this.teamCollectionService.searchByTitle(
            input.query,
            ctx.workspace.teamID,
            take,
            0,
          );
          return E.right(results);
        }

        const results = await this.userCollectionService.searchByTitle(
          input.query,
          ctx.user.uid,
          take,
        );
        return E.right(results);
      },
    });
  }

  /**
   * Load a stored request UNREDACTED.
   *
   * Only for the request runner, which needs real credentials to actually send
   * the request. Never serialize the result into a prompt or tool output - use
   * the redacting hopp_get_request tool for that.
   */
  async loadRawRequest(
    ctx: AgentToolContext,
    requestId: string,
  ): Promise<E.Either<string, unknown>> {
    const parse = (raw: unknown) => {
      if (typeof raw !== 'string') return E.right(raw);
      try {
        return E.right(JSON.parse(raw));
      } catch {
        return E.left('user_request/invalid_json');
      }
    };

    if (ctx.workspace.type === 'team') {
      const found = await this.teamRequestService.getRequest(requestId);
      if (O.isNone(found)) return E.left(TEAM_REQ_NOT_FOUND);
      if (found.value.teamID !== ctx.workspace.teamID) {
        return E.left(TEAM_REQ_NOT_FOUND);
      }
      return parse(found.value.request);
    }

    const found = await this.userRequestService.fetchUserRequest(
      requestId,
      ctx.user,
    );
    if (E.isLeft(found)) return E.left(found.left);
    return parse(found.right.request);
  }

  /** Walk an exported collection tree, redacting every request in it. */
  private redactTree(node: any): any {
    if (!node || typeof node !== 'object') return node;

    return {
      ...node,
      requests: Array.isArray(node.requests)
        ? node.requests.map((request: unknown) => redactRequestJson(request))
        : node.requests,
      folders: Array.isArray(node.folders)
        ? node.folders.map((folder: unknown) => this.redactTree(folder))
        : node.folders,
    };
  }
}
