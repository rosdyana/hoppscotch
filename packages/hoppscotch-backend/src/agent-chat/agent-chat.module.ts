import { Module } from '@nestjs/common';
import { AgentAttachmentModule } from 'src/agent-chat/agent-attachment.module';
import { AgentToolsModule } from 'src/agent-tools/agent-tools.module';
import { LlmModule } from 'src/llm/llm.module';
import { PrismaModule } from 'src/prisma/prisma.module';
import { UserModule } from 'src/user/user.module';
import { AgentChatController } from './agent-chat.controller';
import { AgentChatService } from './agent-chat.service';
import { AgentConversationService } from './agent-conversation.service';
import { InlineAiService } from './inline-ai.service';

@Module({
  imports: [
    PrismaModule,
    LlmModule,
    AgentToolsModule,
    AgentAttachmentModule,
    UserModule,
  ],
  providers: [AgentChatService, AgentConversationService, InlineAiService],
  controllers: [AgentChatController],
  exports: [AgentConversationService],
})
export class AgentChatModule {}
