import type {BrowserAvailability, BrowserEngine, PreviewServer} from './types.js';

/**
 * NMSh's connection to the real browser, created once and used by every browser surface (the `/browser` panel and the document
 * workspace's rendered preview). Nothing browser-related is imported, started or allocated until a surface asks:
 *
 *  - the engine module (and `marked`, which turns Markdown into the preview's HTML) is loaded with a dynamic import;
 *  - `availability()` only looks for an installed Chrome or Chromium and checks its version;
 *  - the Chromium process starts on the first `open` and stops by itself when idle; the preview server listens on a loopback
 *    port only from the first preview and stops with `shutdown()`.
 * With no browser installed, or the setting off, none of this ever runs and the rest of NMSh is unaffected.
 */
export interface BrowserHostOptions {
  /** A private directory for the browser's throwaway profile (created on demand). */
  profileDir: string;
  /** Milliseconds the browser stays running after its last page closed. */
  idleMs: number;
  env?: NodeJS.ProcessEnv;
}

type EngineModule = typeof import('./engine/index.js');

export class BrowserHost {
  private module: Promise<EngineModule> | undefined;
  private loaded: EngineModule | undefined;
  private browser: BrowserEngine | undefined;
  private server: PreviewServer | undefined;
  private available: Promise<BrowserAvailability> | undefined;

  constructor(private readonly options: BrowserHostOptions, private readonly load: () => Promise<EngineModule> = () => import('./engine/index.js')) {}

  private async engineModule(): Promise<EngineModule> {
    this.module ??= this.load().then(loaded => { this.loaded = loaded; return loaded; });
    return this.module;
  }

  /** Is a usable Chrome or Chromium installed? Remembered for the life of the host. */
  async availability(): Promise<BrowserAvailability> {
    this.available ??= this.engineModule().then(module => module.locateBrowser(undefined, this.options.env?.NMSH_BROWSER));
    return this.available;
  }

  async engine(): Promise<BrowserEngine> {
    const module = await this.engineModule();
    this.browser ??= module.createBrowserEngine({profileDir: this.options.profileDir, idleMs: this.options.idleMs, ...(this.options.env ? {env: this.options.env} : {})});
    return this.browser;
  }

  async previews(): Promise<PreviewServer> {
    const module = await this.engineModule();
    this.server ??= module.createPreviewServer();
    return this.server;
  }

  /** The complete HTML for a document's text. Only valid after `engine()` or `previews()` resolved. */
  html(text: string, kind: 'html' | 'markdown', options: {title: string; colorScheme: 'light' | 'dark'; diagram?: (source: string) => {src: string; alt: string} | {note: string}}): string {
    if (!this.loaded) throw new Error('The browser module is not loaded.');
    return this.loaded.htmlDocumentFor(text, kind, options);
  }

  get running(): boolean { return Boolean(this.browser?.stats().running); }

  /** Stop the browser and the preview server now (NMSh is exiting, or the person turned the browser off). */
  async shutdown(): Promise<void> {
    const browser = this.browser;
    const server = this.server;
    this.browser = undefined;
    this.server = undefined;
    await Promise.allSettled([browser?.shutdown(), server?.close()]);
  }
}
