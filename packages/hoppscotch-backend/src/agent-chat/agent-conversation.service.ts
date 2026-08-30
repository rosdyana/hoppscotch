import { Injectable } from '@nestjs/common';
import * as E from 'fp-ts/Either';
import { AI_CONVERSATION_NOT_FOUND } from 'src/errors';
import { NormalizedMessage, ToolResult } from 'src/llm/llm.types';
import { PrismaService } from 'src/prisma/prisma.service';
import { AIProvider } from 'src/types/InfraConfig';

export type PendingApproval = {
  toolUseId: string;
  name: string;
  input: Record<string, unknown>;
};

@Injectable()
export class AgentConversationService {
  constructor(private readonly prisma: PrismaService) {}

  async create(params: {
    userUid: string;
    title: string;
    provider: AIProvider;
    model: string;
    teamID?: string | null;
  }) {
    return this.prisma.agentConversation.create({
      data: {
        userUid: params.userUid,
        title: params.title,
        provider: params.provider,
        model: params.model,
        workspaceType: params.teamID ? 'TEAM' : 'USER',
        teamID: params.teamID ?? null,
      },
    });
  }

  async list(userUid: string, take = 25) {
    return this.prisma.agentConversation.findMany({
      where: { userUid },
      orderBy: { updatedOn: 'desc' },
      take,
      select: {
        id: true,
        title: true,
        model: true,
        provider: true,
        updatedOn: true,
      },
    });
  }

  /** Fetch a conversation, scoped to its owner. */
  async get(conversationID: string, userUid: string) {
    const conversation = await this.prisma.agentConversation.findFirst({
      where: { id: conversationID, userUid },
      include: { messages: { orderBy: { seq: 'asc' } } },
    });

    return conversation
      ? E.right(conversation)
      : E.left(AI_CONVERSATION_NOT_FOUND);
  }

  async delete(conversationID: string, userUid: string) {
    const result = await this.prisma.agentConversation.deleteMany({
      where: { id: conversationID, userUid },
    });
    return result.count > 0
      ? E.right(true)
      : E.left(AI_CONVERSATION_NOT_FOUND);
  }

  /** Rebuild provider-neutral history from stored rows. */
  toNormalizedMessages(
    messages: { role: string; provider: string | null; content: unknown }[],
  ): NormalizedMessage[] {
    return messages.map((message) => {
      switch (message.role) {
        case 'user':
          return { role: 'user', text: String(message.content) };
        case 'tool_results':
          return {
            role: 'tool_results',
            results: message.content as ToolResult[],
          };
        default:
          return {
            role: 'assistant',
            provider: message.provider as AIProvider,
            raw: message.content,
          };
      }
    });
  }

  private async nextSeq(conversationID: string) {
    const last = await this.prisma.agentMessage.findFirst({
      where: { conversationID },
      orderBy: { seq: 'desc' },
      select: { seq: true },
    });
    return (last?.seq ?? 0) + 1;
  }

  async appendUser(conversationID: string, text: string) {
    return this.prisma.agentMessage.create({
      data: {
        conversationID,
        role: 'user',
        content: text,
        seq: await this.nextSeq(conversationID),
      },
    });
  }

  async appendAssistant(
    conversationID: string,
    provider: AIProvider,
    raw: unknown,
  ) {
    return this.prisma.agentMessage.create({
      data: {
        conversationID,
        role: 'assistant',
        provider,
        content: raw as any,
        seq: await this.nextSeq(conversationID),
      },
    });
  }

  async appendToolResults(conversationID: string, results: ToolResult[]) {
    return this.prisma.agentMessage.create({
      data: {
        conversationID,
        role: 'tool_results',
        content: results as any,
        seq: await this.nextSeq(conversationID),
      },
    });
  }

  async touch(conversationID: string) {
    await this.prisma.agentConversation.update({
      where: { id: conversationID },
      data: { updatedOn: new Date() },
    });
  }

  /**
   * Derive which tool calls are still awaiting approval.
   *
   * There is no approvals table on purpose: a pending approval IS "the latest
   * assistant turn proposed a tool call that no later tool_results message
   * answers". One state machine, nothing to drift out of sync.
   */
  findPendingApprovals(
    messages: { role: string; content: unknown }[],
  ): PendingApproval[] {
    const answered = new Set<string>();
    for (const message of messages) {
      if (message.role !== 'tool_results') continue;
      for (const result of (message.content as ToolResult[]) ?? []) {
        answered.add(result.toolUseId);
      }
    }

    const lastAssistant = [...messages]
      .reverse()
      .find((message) => message.role === 'assistant');
    if (!lastAssistant) return [];

    const blocks = Array.isArray(lastAssistant.content)
      ? (lastAssistant.content as any[])
      : ((lastAssistant.content as any)?.toolCalls ?? []);

    return blocks
      .filter(
        (block: any) =>
          (block?.type === 'tool_use' || block?.name) && block?.id,
      )
      .filter((block: any) => !answered.has(block.id))
      .map((block: any) => ({
        toolUseId: block.id,
        name: block.name,
        input: (block.input ?? {}) as Record<string, unknown>,
      }));
  }
}
