import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Request, Response } from 'express';
import * as E from 'fp-ts/Either';
import { GqlUser } from 'src/decorators/gql-user.decorator';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { ThrottlerBehindProxyGuard } from 'src/guards/throttler-behind-proxy.guard';
import { LlmConfigService } from 'src/llm/llm-config.service';
import { AuthUser } from 'src/types/AuthUser';
import { throwHTTPErr } from 'src/utils';
import { AgentChatService } from './agent-chat.service';
import { AgentConversationService } from './agent-conversation.service';
import {
  ApprovalDto,
  CreateConversationDto,
  FeedbackDto,
  InlineAiDto,
  SendMessageDto,
} from './dto/agent-chat.dto';
import { InlineAiService } from './inline-ai.service';
import { SseWriter } from './sse-writer';

@UseGuards(ThrottlerBehindProxyGuard, JwtAuthGuard)
@Controller({ path: 'ai', version: '1' })
export class AgentChatController {
  constructor(
    private readonly chat: AgentChatService,
    private readonly conversations: AgentConversationService,
    private readonly inlineAi: InlineAiService,
    private readonly llmConfig: LlmConfigService,
  ) {}

  @Get('config')
  async config() {
    const config = await this.llmConfig.get();
    return {
      enabled: config.enabled,
      model: config.model,
      requestExecutionEnabled: config.requestExecution.enabled,
    };
  }

  @Post('conversations')
  async createConversation(
    @GqlUser() user: AuthUser,
    @Body() dto: CreateConversationDto,
  ) {
    const config = await this.llmConfig.getEnabled();
    if (E.isLeft(config)) throwHTTPErr({ message: config.left, statusCode: 403 });

    return this.conversations.create({
      userUid: user.uid,
      title: dto.title?.trim() || 'New chat',
      provider: config.right.provider,
      model: config.right.model,
      teamID: dto.workspaceId ?? null,
    });
  }

  @Get('conversations')
  listConversations(@GqlUser() user: AuthUser) {
    return this.conversations.list(user.uid);
  }

  @Get('conversations/:id')
  async getConversation(@GqlUser() user: AuthUser, @Param('id') id: string) {
    const conversation = await this.conversations.get(id, user.uid);
    if (E.isLeft(conversation)) {
      throwHTTPErr({ message: conversation.left, statusCode: 404 });
    }
    return conversation.right;
  }

  @Delete('conversations/:id')
  async deleteConversation(@GqlUser() user: AuthUser, @Param('id') id: string) {
    const result = await this.conversations.delete(id, user.uid);
    if (E.isLeft(result)) {
      throwHTTPErr({ message: result.left, statusCode: 404 });
    }
    return { deleted: true };
  }

  /**
   * Stream one assistant turn.
   *
   * SSE rather than a GraphQL subscription: the PubSub is in-memory with no
   * Redis adapter, so a mutation-plus-subscription design would silently drop
   * tokens behind a load balancer. Here the POST *is* the stream, bound to the
   * process doing the work by construction.
   */
  @Post('conversations/:id/messages')
  async sendMessage(
    @GqlUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: SendMessageDto,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const writer = new SseWriter(res);
    writer.open();

    const controller = new AbortController();
    req.on('close', () => controller.abort());

    try {
      await this.chat.runTurn({
        user,
        conversationID: id,
        text: dto.text,
        workspaceId: dto.workspaceId,
        signal: controller.signal,
        emit: writer.emit,
      });
    } catch (e) {
      writer.emit('error', {
        code: e instanceof Error ? e.message : 'ai/unknown_error',
      });
    } finally {
      writer.close();
    }
  }

  @Post('conversations/:id/approvals')
  async resolveApproval(
    @GqlUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: ApprovalDto,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const writer = new SseWriter(res);
    writer.open();

    const controller = new AbortController();
    req.on('close', () => controller.abort());

    try {
      await this.chat.resolveApproval({
        user,
        conversationID: id,
        toolUseId: dto.toolUseId,
        decision: dto.decision,
        workspaceId: dto.workspaceId,
        signal: controller.signal,
        emit: writer.emit,
      });
    } catch (e) {
      writer.emit('error', {
        code: e instanceof Error ? e.message : 'ai/unknown_error',
      });
    } finally {
      writer.close();
    }
  }

  /* Inline AI actions backing ExperimentsPlatformDef in the frontend. */

  @Post('generate-request-name')
  async generateRequestName(@Body() dto: InlineAiDto) {
    return this.unwrap(
      await this.inlineAi.generateRequestName(
        dto.requestInfo ?? '',
        dto.namingStyle ?? '',
      ),
    );
  }

  @Post('modify-request-body')
  async modifyRequestBody(@Body() dto: InlineAiDto) {
    return this.unwrap(
      await this.inlineAi.modifyRequestBody(
        dto.requestBody ?? '',
        dto.userPrompt ?? '',
      ),
    );
  }

  @Post('modify-pre-request-script')
  async modifyPreRequestScript(@Body() dto: InlineAiDto) {
    return this.unwrap(
      await this.inlineAi.modifyPreRequestScript(
        dto.requestInfo ?? '',
        dto.userPrompt ?? '',
      ),
    );
  }

  @Post('modify-test-script')
  async modifyTestScript(@Body() dto: InlineAiDto) {
    return this.unwrap(
      await this.inlineAi.modifyTestScript(
        dto.requestInfo ?? '',
        dto.userPrompt ?? '',
      ),
    );
  }

  @Post('feedback')
  feedback(@Body() _dto: FeedbackDto) {
    // Accepted so the existing thumbs-up/down UI works; nothing is stored yet.
    return { ok: true };
  }

  private unwrap<T>(result: E.Either<string, T>): T {
    if (E.isLeft(result)) {
      throwHTTPErr({ message: result.left, statusCode: 403 });
    }
    return (result as E.Right<T>).right;
  }
}
