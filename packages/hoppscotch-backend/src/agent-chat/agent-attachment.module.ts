import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { AgentAttachmentService } from './agent-attachment.service';

/**
 * Stands alone rather than living in AgentChatModule: the import and read
 * tools need it too, and AgentChatModule already imports AgentToolsModule - so
 * putting it there would close a dependency cycle.
 */
@Module({
  imports: [PrismaModule],
  providers: [AgentAttachmentService],
  exports: [AgentAttachmentService],
})
export class AgentAttachmentModule {}
