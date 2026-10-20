import fs from 'node:fs';
import http from 'node:http';
import type {AddressInfo} from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {createBrowserEngine, createPreviewServer} from '../../src/browser/engine/index.js';
import type {BrowserEngine, BrowserPage, PageEvent, PreviewHandle, PreviewServer} from '../../src/browser/types.js';

/** Shared helpers for the tests that drive a real Chromium (or fake one). Scratch lives under the harness's TMPDIR. */

export function scratchDir(prefix = 'nmsh-browser-'): string {
  return fs.realpathSync(fs.mkdtempSync(path.join(process.env.TMPDIR ?? os.tmpdir(), prefix)));
}

export async function waitFor<T>(check: () => T | undefined | false | Promise<T | undefined | false>, what: string, timeoutMs = 20_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise(resolve => setTimeout(resolve, 25));
  }
}

export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

let probe: Promise<string | undefined> | undefined;

/** Undefined when a Chromium can be started here; otherwise the reason tests should skip. */
export function chromeSkipReason(): Promise<string | undefined> {
  probe ??= (async () => {
    const dir = scratchDir('nmsh-probe-');
    const engine = createBrowserEngine({profileDir: path.join(dir, 'profile')});
    try {
      const availability = await engine.available();
      if (!availability.ok) return `no browser: ${availability.reason}`;
      const page = await engine.open({kind: 'web', viewport: {width: 200, height: 100, scale: 1}, url: 'about:blank'});
      await page.close();
      return undefined;
    } catch (error) {
      return `the browser cannot start here: ${error instanceof Error ? error.message : String(error)}`;
    } finally {
      await engine.shutdown();
      fs.rmSync(dir, {recursive: true, force: true});
    }
  })();
  return probe;
}

export interface Lab {
  engine: BrowserEngine;
  previews: PreviewServer;
  dir: string;
  /** A document folder with the given files. */
  folder(files: Record<string, string>): string;
  /** Serve html from a folder as a trusted or untrusted preview. */
  preview(html: string, options?: {files?: Record<string, string>; trusted?: boolean}): Promise<PreviewHandle>;
  dispose(): Promise<void>;
}

export function createLab(options: {idleMs?: number} = {}): Lab {
  const dir = scratchDir();
  const engine = createBrowserEngine({profileDir: path.join(dir, 'profile'), idleMs: options.idleMs ?? 60_000});
  const previews = createPreviewServer();
  let folders = 0;
  const lab: Lab = {
    engine, previews, dir,
    folder(files) {
      const root = path.join(dir, `site${folders++}`);
      fs.mkdirSync(root, {recursive: true});
      for (const [name, content] of Object.entries(files)) {
        fs.mkdirSync(path.dirname(path.join(root, name)), {recursive: true});
        fs.writeFileSync(path.join(root, name), content);
      }
      return root;
    },
    preview(html, opts = {}) {
      return previews.serve({html, root: lab.folder(opts.files ?? {}), trusted: opts.trusted === true, name: 'test.html'});
    },
    async dispose() {
      await engine.shutdown();
      await previews.close();
      fs.rmSync(dir, {recursive: true, force: true});
    }
  };
  return lab;
}

/** Collects a page's events and lets a test wait for one. */
export class Events {
  readonly all: PageEvent[] = [];
  constructor(page: BrowserPage) {
    page.onEvent(event => this.all.push(event));
  }
  of<T extends PageEvent['type']>(type: T): Array<Extract<PageEvent, {type: T}>> {
    return this.all.filter((event): event is Extract<PageEvent, {type: T}> => event.type === type);
  }
  next<T extends PageEvent['type']>(type: T, match: (event: Extract<PageEvent, {type: T}>) => boolean = () => true, timeoutMs = 20_000): Promise<Extract<PageEvent, {type: T}>> {
    return waitFor(() => this.of(type).find(match), `a ${type} event`, timeoutMs);
  }
}

export interface LocalSite {
  origin: string;
  hits: string[];
  close(): Promise<void>;
}

/** A tiny loopback HTTP server: `routes` maps a path to a body (or full response); every request path is recorded in `hits`. */
export async function localSite(routes: Record<string, string | {type: string; body: string; headers?: Record<string, string>}> = {}): Promise<LocalSite> {
  const hits: string[] = [];
  const server = http.createServer((req, res) => {
    hits.push(req.url ?? '');
    const route = routes[(req.url ?? '').split('?')[0]!];
    if (route === undefined) {
      // Anything else is a 1x1 PNG so an <img> pointing here is a real, countable request.
      res.writeHead(200, {'Content-Type': 'image/png'});
      return void res.end(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64'));
    }
    const response = typeof route === 'string' ? {type: 'text/html; charset=utf-8', body: route} : route;
    res.writeHead(200, {'Content-Type': response.type, ...(response.headers ?? {})});
    res.end(response.body);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  return {
    origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    hits,
    close: () => new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); })
  };
}
