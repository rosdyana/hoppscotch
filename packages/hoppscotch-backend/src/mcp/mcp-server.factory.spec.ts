import express from 'express';
import { json } from 'express';
import request from 'supertest';
import * as E from 'fp-ts/Either';
import { z } from 'zod';
import { AgentToolExecutor } from 'src/agent-tools/agent-tool.executor';
import { AgentToolRegistry } from 'src/agent-tools/agent-tool.registry';
import { defineTool } from 'src/agent-tools/agent-tool.types';
import { WorkspaceResolverService } from 'src/agent-tools/workspace.resolver';
import { TeamService } from 'src/team/team.service';
import { AuthUser } from 'src/types/AuthUser';
import { McpServerFactory } from './mcp-server.factory';
import { mockDeep } from 'jest-mock-extended';

const user = { uid: 'user-1' } as AuthUser;
const deleteSideEffect = jest.fn();

const listTool = defineTool({
  name: 'hopp_list_collections',
  title: 'List collections',
  description: 'List collections',
  input: { workspaceId: z.string().optional() },
  readOnly: true,
  destructive: false,
  idempotent: true,
  openWorld: false,
  execute: async () => E.right([{ id: 'c1', title: 'Users' }]),
});

const deleteTool = defineTool({
  name: 'hopp_delete_collection',
  title: 'Delete collection',
  description: 'Delete a collection',
  input: { collectionId: z.string() },
  readOnly: false,
  destructive: true,
  idempotent: true,
  openWorld: false,
  preview: async () =>
    E.right({ summary: 'delete', before: {}, after: null, warnings: [] }),
  execute: async (input) => {
    deleteSideEffect(input);
    return E.right({ deleted: input.collectionId });
  },
});

/**
 * Drive the factory through a real Express server so the JSON-RPC framing and
 * the parsed-body handoff are actually exercised, not mocked.
 */
function buildApp(factory: McpServerFactory) {
  const app = express();
  // Mirrors main.ts: the body is consumed before routing, which is why the
  // controller must hand req.body to handleRequest explicitly.
  app.use(json({ limit: '100mb' }));
  app.post('/mcp', async (req, res) => {
    const { server, transport } = factory.create(user);
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });
  return app;
}

const rpc = (app: express.Express, body: unknown) =>
  request(app)
    .post('/mcp')
    .set('Accept', 'application/json, text/event-stream')
    .set('Content-Type', 'application/json')
    .send(body as object);

/** Streamable HTTP replies as SSE; pull the JSON payload back out. */
function parseRpc(res: request.Response) {
  if (res.body && Object.keys(res.body).length > 0) return res.body;
  const line = String(res.text)
    .split('\n')
    .find((l) => l.startsWith('data: '));
  return line ? JSON.parse(line.slice(6)) : undefined;
}

const INIT = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'test', version: '1.0.0' },
  },
};

describe('McpServerFactory', () => {
  // These drive a real HTTP server through supertest and complete an MCP
  // handshake, so they are slower than a unit test and can exceed Jest's 5s
  // default when the full suite runs in parallel.
  jest.setTimeout(30_000);

  let app: express.Express;

  beforeEach(() => {
    jest.clearAllMocks();
    const registry = new AgentToolRegistry();
    registry.registerAll([listTool, deleteTool]);
    const executor = new AgentToolExecutor(
      registry,
      new WorkspaceResolverService(mockDeep<TeamService>()),
    );
    app = buildApp(new McpServerFactory(registry, executor));
  });

  it('should complete an MCP initialize handshake', async () => {
    const res = await rpc(app, INIT);
    const body = parseRpc(res);

    expect(body.result.serverInfo.name).toBe('hoppscotch');
    expect(body.result.protocolVersion).toBeDefined();
  });

  it('should advertise every registered tool with its annotations', async () => {
    await rpc(app, INIT);
    const res = await rpc(app, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
      params: {},
    });

    const tools = parseRpc(res).result.tools;
    const names = tools.map((t: any) => t.name);
    expect(names).toEqual(
      expect.arrayContaining(['hopp_list_collections', 'hopp_delete_collection']),
    );

    const del = tools.find((t: any) => t.name === 'hopp_delete_collection');
    // This is what makes Claude Code prompt before a destructive call.
    expect(del.annotations.destructiveHint).toBe(true);
    expect(del.annotations.readOnlyHint).toBe(false);

    const list = tools.find((t: any) => t.name === 'hopp_list_collections');
    expect(list.annotations.readOnlyHint).toBe(true);
    expect(list.annotations.destructiveHint).toBe(false);
  });

  it('should expose the Zod shape as JSON Schema on the tool', async () => {
    await rpc(app, INIT);
    const res = await rpc(app, {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/list',
      params: {},
    });

    const del = parseRpc(res).result.tools.find(
      (t: any) => t.name === 'hopp_delete_collection',
    );

    expect(del.inputSchema.type).toBe('object');
    expect(del.inputSchema.properties.collectionId).toBeDefined();
    expect(del.inputSchema.required).toContain('collectionId');
  });

  it('should execute a read tool and return its content', async () => {
    await rpc(app, INIT);
    const res = await rpc(app, {
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: { name: 'hopp_list_collections', arguments: {} },
    });

    const result = parseRpc(res).result;
    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain('Users');
  });

  it('should execute writes directly under client-confirms rather than holding them', async () => {
    await rpc(app, INIT);
    const res = await rpc(app, {
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: {
        name: 'hopp_delete_collection',
        arguments: { collectionId: 'c9' },
      },
    });

    // MCP delegates confirmation to the client via destructiveHint, so the
    // call itself must go through.
    expect(deleteSideEffect).toHaveBeenCalledWith({ collectionId: 'c9' });
    expect(parseRpc(res).result.isError).toBeFalsy();
  });

  it('should surface a schema violation as a tool error, not a transport failure', async () => {
    await rpc(app, INIT);
    const res = await rpc(app, {
      jsonrpc: '2.0',
      id: 6,
      method: 'tools/call',
      params: { name: 'hopp_delete_collection', arguments: {} },
    });

    const body = parseRpc(res);
    const isError =
      body.result?.isError === true || body.error !== undefined;
    expect(isError).toBe(true);
    expect(deleteSideEffect).not.toHaveBeenCalled();
  });
});
