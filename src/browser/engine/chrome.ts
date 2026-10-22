import {execFile} from 'node:child_process';
import {constants as fsConstants} from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import type {BrowserAvailability} from '../types.js';

/**
 * Finds an installed Chromium-family browser. Nothing is ever downloaded: if none is found the reason says what to install or set.
 * `NMSH_BROWSER` (an absolute path) wins and is not second-guessed: if it is wrong the person is told so rather than silently
 * falling back to another browser.
 */
export const MIN_CHROME_MAJOR = 110;
const VERSION_TIMEOUT_MS = 5000;

const MAC_APPS = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'
];
const LINUX_NAMES = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge'];

export interface LocatorHost {
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  /** A regular file the current user may execute. */
  isExecutable(file: string): Promise<boolean>;
  /** The first line `--version` prints. Rejects when it cannot run. */
  version(file: string): Promise<string>;
}

export const realLocatorHost: LocatorHost = {
  platform: process.platform,
  env: process.env,
  async isExecutable(file) {
    try {
      if (!(await fs.stat(file)).isFile()) return false;
      await fs.access(file, fsConstants.X_OK);
      return true;
    } catch {
      return false;
    }
  },
  version(file) {
    return new Promise((resolve, reject) => {
      execFile(file, ['--version'], {timeout: VERSION_TIMEOUT_MS, encoding: 'utf8', env: {PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? ''}, maxBuffer: 64 * 1024, windowsHide: true},
        (error, stdout) => error ? reject(error) : resolve(String(stdout).split('\n')[0]?.trim() ?? ''));
    });
  }
};

const INSTALL_HINT = 'Install Google Chrome, Chromium or Microsoft Edge, or set NMSH_BROWSER to the full path of its executable.';

export async function candidatePaths(host: Pick<LocatorHost, 'platform' | 'env' | 'isExecutable'>): Promise<string[]> {
  if (host.platform === 'darwin') return MAC_APPS;
  const found: string[] = [];
  for (const dir of (host.env.PATH ?? '').split(path.delimiter)) {
    if (!path.isAbsolute(dir)) continue;
    for (const name of LINUX_NAMES) found.push(path.join(dir, name));
  }
  // Keep the preference order of LINUX_NAMES across directories.
  return found.sort((a, b) => LINUX_NAMES.indexOf(path.basename(a)) - LINUX_NAMES.indexOf(path.basename(b)));
}

export function parseChromeMajor(version: string): number | undefined {
  const match = /(\d+)\.\d+\.\d+/u.exec(version);
  return match ? Number(match[1]) : undefined;
}

async function check(host: LocatorHost, executable: string): Promise<BrowserAvailability> {
  let version: string;
  try {
    version = await host.version(executable);
  } catch {
    return {ok: false, reason: `${executable} did not answer --version, so NMSh cannot use it as a browser. ${INSTALL_HINT}`};
  }
  const major = parseChromeMajor(version);
  if (major === undefined) return {ok: false, reason: `${executable} does not look like Chrome or Chromium (it printed "${version.slice(0, 60).replace(/[^\x20-\x7e]/gu, '')}"). ${INSTALL_HINT}`};
  if (major < MIN_CHROME_MAJOR) return {ok: false, reason: `${executable} is version ${major}; NMSh needs version ${MIN_CHROME_MAJOR} or newer. Update it or set NMSH_BROWSER to a newer one.`};
  return {ok: true, executable, version};
}

/**
 * The executable `locateBrowser` would try first, found by looking at the filesystem only (`--version` is not run), for `/doctor`.
 * Whether it really is a usable Chrome is decided when a browser surface first opens.
 */
export async function findBrowserExecutable(host: Pick<LocatorHost, 'platform' | 'env' | 'isExecutable'> = realLocatorHost, override?: string): Promise<{ok: true; executable: string} | {ok: false; reason: string}> {
  const configured = override ?? host.env.NMSH_BROWSER;
  if (configured) {
    if (!path.isAbsolute(configured)) return {ok: false, reason: 'NMSH_BROWSER must be the absolute path of a browser executable.'};
    return (await host.isExecutable(configured)) ? {ok: true, executable: configured} : {ok: false, reason: `NMSH_BROWSER points to ${configured}, which is not an executable file.`};
  }
  for (const candidate of await candidatePaths(host)) if (await host.isExecutable(candidate)) return {ok: true, executable: candidate};
  return {ok: false, reason: `No Chrome, Chromium or Edge was found. ${INSTALL_HINT}`};
}

export async function locateBrowser(host: LocatorHost = realLocatorHost, override?: string): Promise<BrowserAvailability> {
  const configured = override ?? host.env.NMSH_BROWSER;
  if (configured) {
    if (!path.isAbsolute(configured)) return {ok: false, reason: 'NMSH_BROWSER must be the absolute path of a browser executable.'};
    if (!(await host.isExecutable(configured))) return {ok: false, reason: `NMSH_BROWSER points to ${configured}, which is not an executable file.`};
    return check(host, configured);
  }
  let rejected: BrowserAvailability | undefined;
  for (const candidate of await candidatePaths(host)) {
    if (!(await host.isExecutable(candidate))) continue;
    const result = await check(host, candidate);
    if (result.ok) return result;
    rejected ??= result;
  }
  return rejected ?? {ok: false, reason: `No Chrome, Chromium or Edge was found. ${INSTALL_HINT}`};
}
