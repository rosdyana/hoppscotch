import { Injectable } from '@nestjs/common';
import * as E from 'fp-ts/Either';
import { z } from 'zod';
import { AgentTool, defineTool } from '../agent-tool.types';

/**
 * Tools that put a question to the user rather than doing anything.
 *
 * The executor intercepts these before `execute` runs, so the handlers below
 * are unreachable in practice - they exist to satisfy the tool contract.
 */
@Injectable()
export class InteractionTools {
  build(): AgentTool<any>[] {
    return [
      defineTool({
        name: 'hopp_ask_user',
        title: 'Ask the user',
        description:
          'Ask the user a question and wait for their answer. Use this whenever the request does not identify a workspace, collection, folder or request unambiguously, or when more than one candidate matches - never guess. Supply `options` when the answer is a choice from a known set; the user gets one button per option.',
        input: {
          question: z
            .string()
            .min(1)
            .max(500)
            .describe('The question, phrased for a non-technical reader.'),
          options: z
            .array(z.string().min(1).max(120))
            .max(6)
            .optional()
            .describe(
              'Candidate answers, rendered as buttons. Prefer names the user recognises over ids.',
            ),
          allowFreeText: z
            .boolean()
            .optional()
            .default(true)
            .describe(
              'Whether the user may type an answer instead of picking an option.',
            ),
        },
        readOnly: true,
        destructive: false,
        idempotent: true,
        openWorld: false,
        interactive: true,
        execute: async () =>
          E.left('hopp_ask_user is answered by the user, not executed.'),
      }),
    ];
  }
}
