import { Injectable } from '@nestjs/common';
import * as E from 'fp-ts/Either';
import { z } from 'zod';
import { AgentAttachmentService } from 'src/agent-chat/agent-attachment.service';
import { AgentTool, defineTool } from '../agent-tool.types';

/** Cap on one read so a large file cannot be pulled in wholesale by accident. */
const MAX_READ_CHARS = 40_000;

@Injectable()
export class AttachmentTools {
  constructor(private readonly attachments: AgentAttachmentService) {}

  build(): AgentTool<any>[] {
    return [
      defineTool({
        name: 'hopp_read_attachment',
        title: 'Read an attached file',
        description:
          'Read part of a file the user attached to this conversation. Only files larger than the inline threshold need this - smaller ones already appear in full in the attachments block. To import an attachment into a workspace, pass its id to an import tool instead of reading it here.',
        input: {
          attachmentId: z
            .string()
            .min(1)
            .describe('The id from the attachments block.'),
          offset: z
            .number()
            .int()
            .min(0)
            .optional()
            .describe('Character offset to start from. Defaults to 0.'),
          limit: z
            .number()
            .int()
            .min(1)
            .max(MAX_READ_CHARS)
            .optional()
            .describe(
              `How many characters to return. Defaults to ${MAX_READ_CHARS}.`,
            ),
        },
        readOnly: true,
        destructive: false,
        idempotent: true,
        openWorld: false,
        execute: async (input, ctx) => {
          const found = await this.attachments.get(
            input.attachmentId,
            ctx.user.uid,
          );
          if (E.isLeft(found)) return found;

          const attachment = found.right;
          const offset = input.offset ?? 0;
          const limit = input.limit ?? MAX_READ_CHARS;
          const chunk = attachment.content.slice(offset, offset + limit);

          return E.right({
            filename: attachment.filename,
            format: attachment.format,
            byteSize: attachment.byteSize,
            offset,
            returned: chunk.length,
            hasMore: offset + chunk.length < attachment.content.length,
            content: chunk,
          });
        },
      }),
    ];
  }
}
