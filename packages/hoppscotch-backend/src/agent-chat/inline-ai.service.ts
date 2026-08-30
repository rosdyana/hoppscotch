import { Injectable } from '@nestjs/common';
import * as E from 'fp-ts/Either';
import { randomUUID } from 'crypto';
import { LlmConfigService } from 'src/llm/llm-config.service';
import { LlmService } from 'src/llm/llm.service';

/**
 * Backs the inline AI actions that already exist in the frontend
 * (ExperimentsPlatformDef): generate a request name, and rewrite a body,
 * pre-request script or test script.
 *
 * These are single-shot completions with no tools - deliberately separate from
 * the agent loop, which is conversational and stateful.
 */
@Injectable()
export class InlineAiService {
  constructor(
    private readonly llm: LlmService,
    private readonly llmConfig: LlmConfigService,
  ) {}

  private async complete(system: string, user: string) {
    const config = await this.llmConfig.getEnabled();
    if (E.isLeft(config)) return E.left(config.left);

    let text = '';
    const turn = await this.llm.streamTurn({
      system,
      messages: [{ role: 'user', text: user }],
      tools: [],
      maxTokens: config.right.maxOutputTokens,
      onTextDelta: (delta) => {
        text += delta;
      },
    });

    if (E.isLeft(turn)) return E.left(turn.left);
    return E.right({ text: (turn.right.text || text).trim() });
  }

  /** Models like to wrap code in fences even when told not to. */
  private stripCodeFence(text: string): string {
    const fenced = text.match(/^```[a-zA-Z]*\n([\s\S]*?)\n?```$/);
    return (fenced ? fenced[1] : text).trim();
  }

  async generateRequestName(requestInfo: string, namingStyle: string) {
    const result = await this.complete(
      `You name HTTP API requests. Reply with ONLY the name - no quotes, no explanation, no punctuation at the end.
Naming style: ${namingStyle || 'DESCRIPTIVE_WITH_SPACES'}.`,
      requestInfo,
    );
    if (E.isLeft(result)) return E.left(result.left);

    return E.right({
      request_name: result.right.text.split('\n')[0].slice(0, 120),
      trace_id: randomUUID(),
    });
  }

  async modifyRequestBody(requestBody: string, userPrompt: string) {
    const result = await this.complete(
      `You edit HTTP request bodies. Reply with ONLY the modified body. No markdown fences, no commentary.`,
      `Current body:\n${requestBody}\n\nRequested change:\n${userPrompt}`,
    );
    if (E.isLeft(result)) return E.left(result.left);

    return E.right({
      modified_body: this.stripCodeFence(result.right.text),
      trace_id: randomUUID(),
    });
  }

  async modifyPreRequestScript(requestInfo: string, userPrompt: string) {
    const result = await this.complete(
      `You write Hoppscotch pre-request scripts in JavaScript, using the pw.* API.
Reply with ONLY the script. No markdown fences, no commentary.`,
      `Request context:\n${requestInfo}\n\nRequested change:\n${userPrompt}`,
    );
    if (E.isLeft(result)) return E.left(result.left);

    return E.right({
      modified_script: this.stripCodeFence(result.right.text),
      trace_id: randomUUID(),
    });
  }

  async modifyTestScript(requestInfo: string, userPrompt: string) {
    const result = await this.complete(
      `You write Hoppscotch test scripts in JavaScript, using pw.test and pw.expect.
Reply with ONLY the script. No markdown fences, no commentary.`,
      `Request context:\n${requestInfo}\n\nRequested change:\n${userPrompt}`,
    );
    if (E.isLeft(result)) return E.left(result.left);

    return E.right({
      modified_script: this.stripCodeFence(result.right.text),
      trace_id: randomUUID(),
    });
  }
}
