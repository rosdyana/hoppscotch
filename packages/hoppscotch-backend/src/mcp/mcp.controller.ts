import {
  Controller,
  Delete,
  Get,
  HttpStatus,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { AccessTokenService } from 'src/access-token/access-token.service';
import { PATAuthGuard } from 'src/guards/rest-pat-auth.guard';
import { ThrottlerBehindProxyGuard } from 'src/guards/throttler-behind-proxy.guard';
import { AuthUser } from 'src/types/AuthUser';
import { McpEnabledGuard } from './mcp-enabled.guard';
import { McpServerFactory } from './mcp-server.factory';

/**
 * Remote MCP endpoint, so an agent can drive this Hoppscotch instance.
 *
 *   claude mcp add --transport http hoppscotch \
 *     https://<host>/backend/mcp \
 *     --header "Authorization: Bearer <hoppscotch PAT>"
 *
 * Deliberately unversioned: this URL gets pasted by hand, and /backend/mcp
 * reads better than /backend/v1/mcp. MockServerController sets the precedent.
 */
@UseGuards(ThrottlerBehindProxyGuard)
@Controller({ path: 'mcp' })
export class McpController {
  constructor(
    private readonly factory: McpServerFactory,
    private readonly accessTokenService: AccessTokenService,
  ) {}

  @Post()
  @UseGuards(McpEnabledGuard, PATAuthGuard)
  async handleRequest(@Req() req: Request, @Res() res: Response) {
    const user = (req as Request & { user: AuthUser }).user;

    const { server, transport } = this.factory.create(
      user,
      typeof req.query.workspace === 'string' ? req.query.workspace : undefined,
    );

    res.on('close', () => {
      void transport.close();
      void server.close();
    });

    await server.connect(transport);

    // main.ts installs express.json() before routing, so the JSON-RPC body has
    // already been consumed. Hand the parsed body over explicitly or the
    // transport hangs waiting on a drained stream.
    await transport.handleRequest(req, res, req.body);

    void this.touchToken(req);
  }

  /**
   * Stateless transport: there is no server-initiated stream to open and no
   * session to terminate, so the other verbs are honest 405s.
   */
  @Get()
  handleGet(@Res() res: Response) {
    res
      .status(HttpStatus.METHOD_NOT_ALLOWED)
      .json({ error: 'This MCP server is stateless; use POST.' });
  }

  @Delete()
  handleDelete(@Res() res: Response) {
    res
      .status(HttpStatus.METHOD_NOT_ALLOWED)
      .json({ error: 'This MCP server is stateless; there is no session to end.' });
  }

  /** Keep the tokens page's "last used" column meaningful. */
  private async touchToken(req: Request) {
    const [type, token] = req.headers.authorization?.split(' ') ?? [];
    if (type !== 'Bearer' || !token) return;

    try {
      await this.accessTokenService.updateLastUsedForPAT(token);
    } catch {
      // Never fail an MCP call over bookkeeping.
    }
  }
}
