import { Response } from 'express';

/**
 * Minimal SSE framing.
 *
 * Nest's @Sse() wants an Observable on a GET; the chat needs a POST with a
 * JSON body, so the frames are written by hand.
 */
export class SseWriter {
  private closed = false;

  constructor(private readonly res: Response) {}

  open() {
    this.res.setHeader('Content-Type', 'text/event-stream');
    this.res.setHeader('Cache-Control', 'no-cache, no-transform');
    this.res.setHeader('Connection', 'keep-alive');
    // Stops nginx and other proxies buffering the stream into one blob.
    this.res.setHeader('X-Accel-Buffering', 'no');
    this.res.flushHeaders();
  }

  emit = (event: string, data: unknown) => {
    if (this.closed) return;
    this.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  close() {
    if (this.closed) return;
    this.closed = true;
    this.res.end();
  }
}
