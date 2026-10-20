import {randomBytes} from 'node:crypto';
import fs from 'node:fs/promises';
import {constants as fsConstants} from 'node:fs';
import http from 'node:http';
import type {AddressInfo} from 'node:net';
import path from 'node:path';
import type {PreviewDocument, PreviewHandle, PreviewServer} from '../types.js';

/**
 * The loopback server behind a document preview. It serves the editor's HTML from memory at `http://127.0.0.1:<port>/<token>/` and
 * the files beside the document under a strict rule: the path is decoded once and must stay inside the document's folder after
 * `realpath`, the file must be a regular file of at most 25 MiB (checked on the descriptor that is then read), and the extension must be
 * on an allow-list. Scripts, JSON and modules are served only when the document is trusted. Every response forbids sniffing, caching and
 * cross-origin use; HTML gets a CSP that allows nothing remote. Nothing here lists directories or reads outside `root`.
 */
export const MAX_ASSET_BYTES = 25 * 1024 * 1024;
export const MAX_PROBLEMS = 50;
export const MAX_CONNECTIONS = 32;

const TOKEN_BYTES = 16;
const IMAGE_SRC = "img-src 'self' data:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; media-src 'none'";
const TAIL = "frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
export const HTML_CSP = `default-src 'none'; ${IMAGE_SRC}; script-src 'none'; connect-src 'none'; ${TAIL}`;
export const TRUSTED_HTML_CSP = `default-src 'none'; ${IMAGE_SRC}; script-src 'self' 'unsafe-inline'; connect-src 'self'; ${TAIL}`;

type Kind = 'plain' | 'html' | 'svg' | 'script';
const TYPES: Readonly<Record<string, readonly [string, Kind]>> = {
  css: ['text/css; charset=utf-8', 'plain'],
  png: ['image/png', 'plain'],
  jpg: ['image/jpeg', 'plain'],
  jpeg: ['image/jpeg', 'plain'],
  gif: ['image/gif', 'plain'],
  webp: ['image/webp', 'plain'],
  avif: ['image/avif', 'plain'],
  ico: ['image/x-icon', 'plain'],
  svg: ['image/svg+xml', 'svg'],
  woff: ['font/woff', 'plain'],
  woff2: ['font/woff2', 'plain'],
  ttf: ['font/ttf', 'plain'],
  otf: ['font/otf', 'plain'],
  html: ['text/html; charset=utf-8', 'html'],
  htm: ['text/html; charset=utf-8', 'html'],
  js: ['text/javascript; charset=utf-8', 'script'],
  mjs: ['text/javascript; charset=utf-8', 'script'],
  json: ['application/json; charset=utf-8', 'script']
};

/** Strip C0, DEL, C1 and bidi controls so a hostile path cannot repaint the person's screen, and bound the length. */
export function cleanForDisplay(text: string, max = 200): string {
  return text.replace(/[\u0000-\u001f\u007f-\u009f؜‎‏‪-‮⁦-⁩]/gu, '').slice(0, max);
}

interface Entry {
  document: PreviewDocument;
  html: string;
  problems: Array<{path: string; reason: string}>;
}

class Refusal extends Error {
  constructor(readonly status: number, message: string, readonly record = true) {
    super(message);
  }
}

function extensionOf(file: string): string {
  const base = path.basename(file);
  const dot = base.lastIndexOf('.');
  return dot <= 0 ? '' : base.slice(dot + 1).toLowerCase();
}

function inside(root: string, file: string): boolean {
  return file === root || file.startsWith(root.endsWith(path.sep) ? root : root + path.sep);
}

export function createPreviewServer(): PreviewServer {
  const entries = new Map<string, Entry>();
  let server: http.Server | undefined;
  let starting: Promise<number> | undefined;
  let port = 0;

  const record = (entry: Entry, asset: string, reason: string): void => {
    entry.problems.push({path: cleanForDisplay(asset), reason: cleanForDisplay(reason, 120)});
    if (entry.problems.length > MAX_PROBLEMS) entry.problems.splice(0, entry.problems.length - MAX_PROBLEMS);
  };

  const baseHeaders = (): http.OutgoingHttpHeaders => ({
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Cache-Control': 'no-store',
    'Cross-Origin-Resource-Policy': 'same-origin'
  });

  const fail = (res: http.ServerResponse, status: number, message: string, extra: http.OutgoingHttpHeaders = {}): void => {
    const body = `${message}\n`;
    res.writeHead(status, {...baseHeaders(), 'Content-Type': 'text/plain; charset=utf-8', 'Content-Length': Buffer.byteLength(body), ...extra});
    res.end(body);
  };

  /** Resolve a decoded asset path to an open descriptor on a vetted regular file. */
  const openAsset = async (entry: Entry, segments: string[]): Promise<{handle: fs.FileHandle; size: number; type: readonly [string, Kind]}> => {
    const requested = segments.join('/');
    const type = TYPES[extensionOf(requested)];
    if (!type) throw new Refusal(403, 'this kind of file is not served');
    if (type[1] === 'script' && !entry.document.trusted) throw new Refusal(403, 'scripts are off');
    let realRoot: string;
    let real: string;
    try {
      realRoot = await fs.realpath(entry.document.root);
      real = await fs.realpath(path.join(realRoot, ...segments));
    } catch {
      throw new Refusal(404, 'not found');
    }
    if (!inside(realRoot, real) || real === realRoot) throw new Refusal(403, 'outside the document folder');
    const relative = path.relative(realRoot, real).split(path.sep);
    if (relative.some(part => part.startsWith('.'))) throw new Refusal(403, 'hidden files are not served');
    const realType = TYPES[extensionOf(real)];
    if (!realType || (realType[1] === 'script' && !entry.document.trusted)) throw new Refusal(403, realType ? 'scripts are off' : 'this kind of file is not served');
    let handle: fs.FileHandle | undefined;
    try {
      handle = await fs.open(real, fsConstants.O_RDONLY | fsConstants.O_NONBLOCK | (fsConstants.O_NOFOLLOW ?? 0));
      const stat = await handle.stat();
      if (!stat.isFile()) throw new Refusal(403, 'not a regular file');
      if (stat.size > MAX_ASSET_BYTES) throw new Refusal(403, 'file is too large');
      return {handle, size: stat.size, type: realType};
    } catch (error) {
      await handle?.close().catch(() => undefined);
      if (error instanceof Refusal) throw error;
      throw new Refusal(404, 'not found');
    }
  };

  const handle = async (req: http.IncomingMessage, res: http.ServerResponse): Promise<void> => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return fail(res, 405, 'method not allowed', {Allow: 'GET, HEAD'});
    const host = (req.headers.host ?? '').toLowerCase();
    if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) return fail(res, 421, 'misdirected request');
    if (req.headers['sec-fetch-site'] === 'cross-site') return fail(res, 403, 'cross-site requests are not served');
    const rawPath = (req.url ?? '').split(/[?#]/u, 1)[0] ?? '';
    if (!rawPath.startsWith('/')) return fail(res, 400, 'bad request');
    const rest = rawPath.slice(1);
    const slash = rest.indexOf('/');
    const token = slash === -1 ? rest : rest.slice(0, slash);
    const entry = entries.get(token);
    if (!entry) return fail(res, 404, 'not found');
    if (slash === -1) {
      res.writeHead(308, {...baseHeaders(), Location: `/${token}/`});
      return void res.end();
    }
    const tail = rest.slice(slash + 1);
    const head = req.method === 'HEAD';

    if (tail === '') {
      const body = Buffer.from(entry.html, 'utf8');
      res.writeHead(200, {...baseHeaders(), 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': body.length,
        'Content-Security-Policy': entry.document.trusted ? TRUSTED_HTML_CSP : HTML_CSP});
      return void res.end(head ? undefined : body);
    }

    let shown = tail;
    try {
      let decoded: string;
      try {
        decoded = decodeURIComponent(tail); // exactly once
      } catch {
        throw new Refusal(400, 'bad path');
      }
      shown = decoded;
      if (decoded.includes('\0') || decoded.includes('\\')) throw new Refusal(400, 'bad path');
      const segments = decoded.split('/');
      if (segments.some(part => part === '' || part === '.' || part === '..')) throw new Refusal(403, 'path is not allowed');
      if (segments.some(part => part.startsWith('.'))) throw new Refusal(403, 'hidden files are not served');
      const {handle: file, size, type} = await openAsset(entry, segments);
      const [contentType, kind] = type;
      const headers: http.OutgoingHttpHeaders = {...baseHeaders(), 'Content-Type': contentType, 'Content-Length': size};
      if (kind === 'html') headers['Content-Security-Policy'] = entry.document.trusted ? TRUSTED_HTML_CSP : HTML_CSP;
      if (kind === 'svg') {
        headers['Content-Security-Policy'] = 'sandbox';
        headers['Content-Disposition'] = 'inline';
      }
      res.writeHead(200, headers);
      if (head || size === 0) {
        await file.close();
        return void res.end();
      }
      const stream = file.createReadStream({start: 0, end: size - 1});
      stream.on('error', () => res.destroy());
      res.on('close', () => stream.destroy());
      stream.pipe(res);
    } catch (error) {
      const refusal = error instanceof Refusal ? error : new Refusal(500, 'error');
      record(entry, shown, refusal.message);
      fail(res, refusal.status, refusal.message);
    }
  };

  const start = (): Promise<number> => {
    starting ??= new Promise<number>((resolve, reject) => {
      const created = http.createServer((req, res) => {
        handle(req, res).catch(() => {
          if (!res.headersSent) fail(res, 500, 'error');
          else res.destroy();
        });
      });
      created.maxConnections = MAX_CONNECTIONS;
      created.headersTimeout = 10_000;
      created.requestTimeout = 15_000;
      created.keepAliveTimeout = 2_000;
      created.on('clientError', (_error, socket) => socket.destroy());
      created.once('error', error => { starting = undefined; reject(error); });
      created.listen(0, '127.0.0.1', () => {
        server = created;
        port = (created.address() as AddressInfo).port;
        created.unref();
        resolve(port);
      });
    });
    return starting;
  };

  return {
    async serve(document) {
      const listening = await start();
      const token = randomBytes(TOKEN_BYTES).toString('hex');
      const entry: Entry = {document: {...document}, html: document.html, problems: []};
      entries.set(token, entry);
      return {
        url: `http://127.0.0.1:${listening}/${token}/`,
        update(html: string) { entry.html = html; },
        problems: () => entry.problems.map(problem => ({...problem})),
        dispose() { entries.delete(token); }
      } satisfies PreviewHandle;
    },
    async close() {
      entries.clear();
      const closing = server;
      server = undefined;
      starting = undefined;
      if (!closing) return;
      await new Promise<void>(resolve => {
        closing.close(() => resolve());
        closing.closeAllConnections();
      });
    }
  };
}
