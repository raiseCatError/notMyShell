import type {Readable, Writable} from 'node:stream';

/**
 * A DevTools Protocol client over Chrome's `--remote-debugging-pipe`: UTF-8 JSON messages, each followed by one NUL byte, written to
 * the child's fd 3 and read from its fd 4. No network port exists. Everything is bounded: one message may not exceed
 * `maxMessageBytes` (the connection is torn down instead of buffering without limit), every request has a timeout, and when the pipe
 * closes every pending request rejects.
 */
export const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
export const MAX_MESSAGE_BYTES = 32 * 1024 * 1024;

export class CdpError extends Error {
  constructor(message: string, readonly code?: number) {
    super(message);
    this.name = 'CdpError';
  }
}

export interface CdpEvent {
  method: string;
  params: any;
  /** Present for events of an attached (flat) session. */
  sessionId?: string;
}

interface Pending {
  method: string;
  resolve(value: any): void;
  reject(error: Error): void;
  timer: NodeJS.Timeout;
}

export interface CdpOptions {
  requestTimeoutMs?: number;
  maxMessageBytes?: number;
}

export class CdpClient {
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private readonly eventListeners = new Set<(event: CdpEvent) => void>();
  private readonly closeListeners = new Set<(reason: string) => void>();
  private chunks: Buffer[] = [];
  private buffered = 0;
  private closedReason: string | undefined;
  private readonly requestTimeoutMs: number;
  private readonly maxMessageBytes: number;

  constructor(private readonly output: Writable, private readonly input: Readable, options: CdpOptions = {}) {
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.maxMessageBytes = options.maxMessageBytes ?? MAX_MESSAGE_BYTES;
    input.on('data', (chunk: Buffer | string) => this.receive(typeof chunk === 'string' ? Buffer.from(chunk) : chunk));
    input.on('end', () => this.close('The browser closed its connection.'));
    input.on('close', () => this.close('The browser closed its connection.'));
    input.on('error', error => this.close(`The browser connection failed: ${error.message}`));
    output.on('error', error => this.close(`The browser connection failed: ${error.message}`));
    output.on('close', () => this.close('The browser closed its connection.'));
  }

  get closed(): boolean { return this.closedReason !== undefined; }

  send<T = any>(method: string, params: object = {}, options: {sessionId?: string; timeoutMs?: number} = {}): Promise<T> {
    if (this.closedReason !== undefined) return Promise.reject(new CdpError(this.closedReason));
    const id = this.nextId++;
    const message: Record<string, unknown> = {id, method, params};
    if (options.sessionId) message.sessionId = options.sessionId;
    return new Promise<T>((resolve, reject) => {
      const timeoutMs = options.timeoutMs ?? this.requestTimeoutMs;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new CdpError(`The browser did not answer ${method} within ${Math.round(timeoutMs / 1000)} seconds.`));
      }, timeoutMs);
      timer.unref();
      this.pending.set(id, {method, resolve, reject, timer});
      try {
        this.output.write(`${JSON.stringify(message)}\0`);
      } catch (error) {
        this.pending.delete(id);
        clearTimeout(timer);
        reject(new CdpError(error instanceof Error ? error.message : String(error)));
      }
    });
  }

  onEvent(listener: (event: CdpEvent) => void): () => void {
    this.eventListeners.add(listener);
    return () => { this.eventListeners.delete(listener); };
  }

  onClose(listener: (reason: string) => void): () => void {
    this.closeListeners.add(listener);
    return () => { this.closeListeners.delete(listener); };
  }

  /** Tear the connection down; every pending request rejects with `reason`. Safe to call repeatedly. */
  close(reason = 'The browser connection was closed.'): void {
    if (this.closedReason !== undefined) return;
    this.closedReason = reason;
    this.chunks = [];
    this.buffered = 0;
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      this.pending.delete(id);
      pending.reject(new CdpError(reason));
    }
    this.input.destroy();
    this.output.destroy();
    for (const listener of [...this.closeListeners]) listener(reason);
    this.closeListeners.clear();
    this.eventListeners.clear();
  }

  private receive(chunk: Buffer): void {
    let start = 0;
    while (start <= chunk.length && this.closedReason === undefined) {
      const nul = chunk.indexOf(0, start);
      const end = nul === -1 ? chunk.length : nul;
      if (this.buffered + (end - start) > this.maxMessageBytes) {
        this.close(`The browser sent a message larger than ${Math.round(this.maxMessageBytes / 1024 / 1024)} MB.`);
        return;
      }
      if (end > start) {
        this.chunks.push(chunk.subarray(start, end));
        this.buffered += end - start;
      }
      if (nul === -1) return;
      const raw = this.chunks.length === 1 ? this.chunks[0]! : Buffer.concat(this.chunks, this.buffered);
      this.chunks = [];
      this.buffered = 0;
      if (raw.length > 0) this.dispatch(raw.toString('utf8'));
      start = nul + 1;
    }
  }

  private dispatch(text: string): void {
    let message: any;
    try {
      message = JSON.parse(text);
    } catch {
      return; // not ours to interpret; a well-formed peer never sends this
    }
    if (typeof message !== 'object' || message === null) return;
    if (typeof message.id === 'number') {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) pending.reject(new CdpError(`${pending.method}: ${String(message.error.message ?? 'failed')}`, typeof message.error.code === 'number' ? message.error.code : undefined));
      else pending.resolve(message.result ?? {});
      return;
    }
    if (typeof message.method === 'string') {
      const event: CdpEvent = {method: message.method, params: message.params ?? {}, ...(typeof message.sessionId === 'string' ? {sessionId: message.sessionId} : {})};
      for (const listener of [...this.eventListeners]) {
        try { listener(event); } catch { /* a listener's bug must not break the stream */ }
      }
    }
  }
}
