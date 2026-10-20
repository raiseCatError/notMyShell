import type {BrowserEngine, PreviewServer} from '../types.js';
import {ChromeEngine} from './engine.js';
import {createPreviewServer as createServer} from './preview.js';

export {htmlDocumentFor, markdownToHtml} from './markdownHtml.js';
export {locateBrowser} from './chrome.js';

export function createBrowserEngine(options: {profileDir: string; idleMs?: number; executable?: string; env?: NodeJS.ProcessEnv}): BrowserEngine {
  return new ChromeEngine(options);
}

export function createPreviewServer(): PreviewServer {
  return createServer();
}
