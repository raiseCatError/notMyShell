import type {DiagramLibrary, DiagramRenderer, DiagramRenderRequest, DiagramRenderResult} from '../types.js';
import type {ChromePage} from './page.js';
import {pngSize} from './page.js';

/**
 * The diagram renderer: one browser page that turns diagram text into PNG pixels with a diagram library (Mermaid).
 *
 * The isolation, from the outside in (docs/design/diagrams.md):
 *  - a `preview` page: its own throwaway browser context, downloads denied, and every network request failed in the network layer
 *    (it has no origin of its own, so nothing is allowed; only `data:` images and fonts, which cannot leave the machine);
 *  - page scripts are disabled (`Emulation.setScriptExecutionDisabled`), and the document NMSh puts in it carries a CSP that allows
 *    no scripts, connections, frames or objects. Nothing in the page's main world ever runs: not a `<script>`, an event handler or
 *    a `javascript:` URL that a diagram might smuggle into the DOM;
 *  - the library runs in a DevTools isolated world (like a find query), which shares the DOM for layout and text measurement but
 *    no JavaScript with the page. Timers do not fire while page scripts are disabled, so that world's timer functions run their
 *    callbacks as microtasks; a callback that waits on real time cannot spin past the render timeout, which terminates it;
 *  - the diagram text is an argument of a protocol call, never part of HTML or code;
 *  - the library's SVG is treated as untrusted: it is parsed into an inert XML document, sized from its viewBox, and drawn only as
 *    an `<img>` (no scripts, no external loads, no interaction in that mode), and what leaves the browser is a PNG screenshot of
 *    it, decoded by NMSh's own bounded decoder.
 */

/** The largest drawing accepted, in CSS pixels; beyond this the diagram is refused rather than shrunk to illegibility. */
export const MAX_DRAWING_SIDE = 16_384;
export const MAX_DRAWING_AREA = 40_000_000;
/** The largest SVG text accepted from the library. */
export const MAX_SVG_CHARS = 4_000_000;
/** The PNG never exceeds these (the scale is reduced to fit). */
export const MAX_PIXEL_SIDE = 4096;
export const MAX_PIXEL_AREA = 8_388_608;
const CAPTURE_TIMEOUT_MS = 10_000;
const SETUP_TIMEOUT_MS = 20_000;

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"><title>diagram</title></head><body style="margin:0;background:transparent"><div id="nmsh-stage" style="position:absolute;left:0;top:0"></div></body></html>`;

/** Timers of the isolated world: callbacks run as microtasks, intervals never repeat (page scripts, and so real timers, are off). */
const TIMERS = `(() => {
  let next = 0;
  const live = new Set();
  const later = (fn, args) => { const id = ++next; live.add(id); Promise.resolve().then(() => { if (live.delete(id)) fn(...args); }); return id; };
  globalThis.setTimeout = (fn, ms, ...args) => typeof fn === 'function' ? later(fn, args) : 0;
  globalThis.clearTimeout = id => { live.delete(id); };
  globalThis.setInterval = () => 0;
  globalThis.clearInterval = () => {};
  globalThis.requestAnimationFrame = fn => later(fn, [performance.now()]);
  globalThis.cancelAnimationFrame = id => { live.delete(id); };
  globalThis.requestIdleCallback = fn => later(fn, [{didTimeout: false, timeRemaining: () => 50}]);
  globalThis.cancelIdleCallback = id => { live.delete(id); };
})(); 'timers'`;

const DRIVER = (limits: {side: number; area: number; svgChars: number}) => `(() => {
  const LIMITS = ${JSON.stringify(limits)};
  let url;
  const stage = () => document.getElementById('nmsh-stage');
  const clear = () => {
    const at = stage();
    if (at) at.replaceChildren();
    if (url) { URL.revokeObjectURL(url); url = undefined; }
    for (const node of [...document.body.children]) if (node.id !== 'nmsh-stage') node.remove();
  };
  const message = error => String((error && error.message) || error || 'unknown error').slice(0, 600);
  globalThis.__nmshDiagram = {
    clear,
    async render(text, config) {
      clear();
      const library = globalThis.mermaid;
      library.initialize(config);
      let type = '';
      try {
        const parsed = await library.parse(text);
        type = String((parsed && parsed.diagramType) || '');
      } catch (error) { return {error: 'syntax', message: message(error)}; }
      let svg;
      try { svg = (await library.render('nmsh-diagram', text)).svg; }
      catch (error) { clear(); return {error: 'failed', message: message(error)}; }
      for (const node of [...document.body.children]) if (node.id !== 'nmsh-stage') node.remove();
      if (typeof svg !== 'string' || !svg) return {error: 'failed', message: 'The library produced no drawing.'};
      if (svg.length > LIMITS.svgChars) return {error: 'too-large', message: 'The drawing is too large to show.'};
      // Parsed into an inert document (a DOMParser document runs no script and loads nothing); HTML parsing accepts the library's
      // serialisation, which is not always well-formed XML, and the XML serialiser below makes it a valid SVG image.
      const parsed = new DOMParser().parseFromString(svg, 'text/html');
      const root = parsed.body && parsed.body.firstElementChild;
      if (!root || root.localName !== 'svg') return {error: 'failed', message: 'The library produced no drawing.'};
      const box = String(root.getAttribute('viewBox') || '').trim().split(/[\\s,]+/).map(Number);
      const width = box.length === 4 ? box[2] : NaN, height = box.length === 4 ? box[3] : NaN;
      if (!(Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0)) return {error: 'failed', message: 'The drawing has no size.'};
      if (width > LIMITS.side || height > LIMITS.side || width * height > LIMITS.area) {
        return {error: 'too-large', message: 'The drawing would be ' + Math.ceil(width) + ' × ' + Math.ceil(height) + ' pixels, more than NMSh draws.'};
      }
      root.setAttribute('width', String(width));
      root.setAttribute('height', String(height));
      if (root.style) root.style.removeProperty('max-width');
      url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(root)], {type: 'image/svg+xml'}));
      const image = new Image();
      image.width = width;
      image.height = height;
      image.style.cssText = 'display:block';
      image.src = url;
      try { await image.decode(); } catch { clear(); return {error: 'failed', message: 'The drawing could not be drawn.'}; }
      stage().append(image);
      return {width, height, type};
    },
  };
  return 'driver';
})()`;

function asText(value: unknown, fallback: string): string {
  // eslint-disable-next-line no-control-regex
  return (typeof value === 'string' && value ? value : fallback).replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f‎‏‪-‮⁦-⁩]/gu, '').slice(0, 600);
}

/** The scale to capture at: as asked, but never beyond the pixel limits. */
export function captureScale(width: number, height: number, wanted: number): number {
  const scale = Math.min(wanted, MAX_PIXEL_SIDE / width, MAX_PIXEL_SIDE / height, Math.sqrt(MAX_PIXEL_AREA / (width * height)));
  return Math.max(0.01, Math.floor(scale * 1000) / 1000);
}

export class ChromeDiagramRenderer implements DiagramRenderer {
  private world = 0;
  private driver = '';
  private queue: Promise<unknown> = Promise.resolve();
  private gone = false;
  private readonly stopListening: () => void;
  private lost: (() => void) | undefined;

  private constructor(private readonly page: ChromePage) {
    this.stopListening = page.onEvent(event => {
      if (event.type === 'crashed' || event.type === 'closed') { this.gone = true; this.lost?.(); }
    });
  }

  static async create(page: ChromePage, library: DiagramLibrary): Promise<ChromeDiagramRenderer> {
    const renderer = new ChromeDiagramRenderer(page);
    try {
      await renderer.setup(library);
    } catch (error) {
      await renderer.close();
      throw error;
    }
    return renderer;
  }

  get closed(): boolean { return this.gone || this.page.isClosed; }

  private async evaluate(expression: string, timeoutMs = SETUP_TIMEOUT_MS): Promise<unknown> {
    const result = await this.page.protocol<{result: {value?: unknown}; exceptionDetails?: {text?: string; exception?: {description?: string}}}>('Runtime.evaluate', {expression, contextId: this.world, returnByValue: true}, timeoutMs);
    if (result.exceptionDetails) throw new Error(asText(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text, 'The diagram library failed to load.'));
    return result.result.value;
  }

  private async setup(library: DiagramLibrary): Promise<void> {
    await this.page.protocol('Emulation.setDefaultBackgroundColorOverride', {color: {r: 0, g: 0, b: 0, a: 0}});
    await this.page.protocol('Page.setDocumentContent', {frameId: this.page.frame, html: PAGE});
    this.world = (await this.page.protocol<{executionContextId: number}>('Page.createIsolatedWorld', {frameId: this.page.frame, worldName: 'nmsh-diagrams'})).executionContextId;
    await this.evaluate(TIMERS);
    await this.evaluate(`${library.source}\n;'library'`);
    const ready = await this.evaluate(`typeof globalThis.mermaid === 'object' && globalThis.mermaid !== null && ['initialize', 'parse', 'render'].every(name => typeof globalThis.mermaid[name] === 'function')`);
    if (ready !== true) throw new Error('The file is not a Mermaid library (no mermaid.initialize, parse and render).');
    await this.evaluate(DRIVER({side: MAX_DRAWING_SIDE, area: MAX_DRAWING_AREA, svgChars: MAX_SVG_CHARS}));
    const driver = await this.page.protocol<{result: {objectId?: string}}>('Runtime.evaluate', {expression: 'globalThis.__nmshDiagram', contextId: this.world});
    if (!driver.result.objectId) throw new Error('The diagram renderer could not start.');
    this.driver = driver.result.objectId;
  }

  render(request: DiagramRenderRequest): Promise<DiagramRenderResult> {
    const run = this.queue.then(() => this.renderNow(request));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async renderNow(request: DiagramRenderRequest): Promise<DiagramRenderResult> {
    if (this.closed) return {ok: false, code: 'crashed', reason: 'The diagram renderer stopped.'};
    const lost = new Promise<'lost'>(resolve => { this.lost = () => resolve('lost'); });
    const timeoutMs = Math.max(100, request.timeoutMs);
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<'timeout'>(resolve => { timer = setTimeout(() => resolve('timeout'), timeoutMs); timer.unref(); });
    try {
      const drawn = await Promise.race([this.draw(request, timeoutMs + 1000), lost, timeout]);
      if (drawn === 'timeout') {
        // The library is still busy (or waiting forever): stop its script and throw the page away; the next diagram gets a new one.
        await this.page.protocol('Runtime.terminateExecution', {}, 2000).catch(() => undefined);
        await this.close();
        return {ok: false, code: 'timeout', reason: `Drawing took longer than ${Math.round(timeoutMs / 100) / 10} s, so it was stopped.`};
      }
      if (drawn === 'lost') return {ok: false, code: 'crashed', reason: 'The browser page drawing diagrams stopped.'};
      return drawn;
    } catch (error) {
      if (this.closed) return {ok: false, code: 'crashed', reason: 'The browser page drawing diagrams stopped.'};
      return {ok: false, code: 'failed', reason: asText(error instanceof Error ? error.message : String(error), 'The diagram could not be drawn.')};
    } finally {
      clearTimeout(timer);
      this.lost = undefined;
    }
  }

  private async draw(request: DiagramRenderRequest, timeoutMs: number): Promise<DiagramRenderResult> {
    const call = await this.page.protocol<{result: {value?: any}; exceptionDetails?: {text?: string; exception?: {description?: string}}}>('Runtime.callFunctionOn', {
      objectId: this.driver,
      functionDeclaration: 'function (text, config) { return this.render(text, config); }',
      arguments: [{value: request.source}, {value: request.config}],
      awaitPromise: true, returnByValue: true,
    }, timeoutMs);
    if (call.exceptionDetails) return {ok: false, code: 'failed', reason: asText(call.exceptionDetails.exception?.description ?? call.exceptionDetails.text, 'The diagram could not be drawn.')};
    const value = call.result.value;
    if (!value || typeof value !== 'object') return {ok: false, code: 'failed', reason: 'The diagram could not be drawn.'};
    if (typeof value.error === 'string') {
      const code = value.error === 'syntax' || value.error === 'too-large' ? value.error : 'failed';
      return {ok: false, code, reason: asText(value.message, 'The diagram could not be drawn.')};
    }
    const width = Number(value.width), height = Number(value.height);
    if (!(width > 0 && height > 0 && width <= MAX_DRAWING_SIDE && height <= MAX_DRAWING_SIDE)) return {ok: false, code: 'failed', reason: 'The drawing has no usable size.'};
    try {
      const scale = captureScale(width, height, request.scale);
      const shot = await this.page.protocol<{data: string}>('Page.captureScreenshot', {format: 'png', fromSurface: true, captureBeyondViewport: true, clip: {x: 0, y: 0, width, height, scale}}, CAPTURE_TIMEOUT_MS);
      const png = new Uint8Array(Buffer.from(shot.data, 'base64'));
      const size = pngSize(png);
      if (!size.width || !size.height || size.width > MAX_PIXEL_SIDE + 2 || size.height > MAX_PIXEL_SIDE + 2) return {ok: false, code: 'failed', reason: 'The browser returned an unusable picture.'};
      return {ok: true, png, width: size.width, height: size.height, type: asText(value.type, 'diagram')};
    } finally {
      await this.page.protocol('Runtime.callFunctionOn', {objectId: this.driver, functionDeclaration: 'function () { this.clear(); }'}, 5000).catch(() => undefined);
    }
  }

  async close(): Promise<void> {
    this.gone = true;
    this.stopListening();
    await this.page.close().catch(() => undefined);
  }
}
