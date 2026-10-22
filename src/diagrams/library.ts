import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';

/**
 * Finding the Mermaid library the person installed. NMSh does not bundle or download Mermaid (its single-file bundle also carries
 * third-party code under other licences, such as ELK's EPL-2.0): like the browser, it uses one that is already on the machine.
 *
 *  1. `NMSH_MERMAID`: an absolute path to a mermaid package folder or to its `dist/mermaid.min.js`. When it is set, it is the only
 *     candidate: a wrong value is reported, never replaced by another install.
 *  2. A global npm install (`npm install -g mermaid`): next to the running Node (`<prefix>/lib/node_modules`), then the usual prefixes.
 *  3. The copy inside a global @mermaid-js/mermaid-cli install.
 *
 * The bundle is read once into memory (so the file cannot change between the check and its use): a regular file, at most
 * MAX_LIBRARY_BYTES, not writable by everyone, from a package named `mermaid`, version 10 or newer when the package says so.
 */
export const MAX_LIBRARY_BYTES = 16 * 1024 * 1024;
const BUNDLE = path.join('dist', 'mermaid.min.js');

export type LocatedLibrary = {ok: true; path: string; version: string; source: string} | {ok: false; reason: string};
/** What `/doctor` reports: the install the locator would use, found by the same rules, without reading the bundle. */
export type MermaidProbe = {ok: true; path: string; version: string} | {ok: false; reason: string};
/** The release NMSh's tests draw with (CI fetches exactly this one). Other versions are used, not promised. */
export const TESTED_MERMAID = '12.2.0';

export interface LocateOptions {
  env: NodeJS.ProcessEnv;
  home: string;
  /** The running Node, whose prefix holds global npm packages. */
  execPath: string;
  /** Test seam: the package folders to try instead of the usual ones. */
  candidates?: readonly string[];
}

export const INSTALL_HINT = 'Install it with `npm install -g mermaid`, or set NMSH_MERMAID to a mermaid package folder or its dist/mermaid.min.js. NMSh does not download it.';

/** The package folders tried, in order (without NMSH_MERMAID). */
export function libraryCandidates(options: Omit<LocateOptions, 'candidates'>): string[] {
  const prefixes = [path.dirname(path.dirname(options.execPath)), '/opt/homebrew', '/usr/local', '/usr', path.join(options.home, '.npm-global'), path.join(options.home, '.local')];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const prefix of prefixes) {
    for (const candidate of [path.join(prefix, 'lib', 'node_modules', 'mermaid'), path.join(prefix, 'lib', 'node_modules', '@mermaid-js', 'mermaid-cli', 'node_modules', 'mermaid')]) {
      if (!seen.has(candidate)) { seen.add(candidate); out.push(candidate); }
    }
  }
  return out;
}

async function readBundle(file: string, packageDir: string | undefined, read = true): Promise<LocatedLibrary> {
  let version = 'unknown';
  if (packageDir) {
    let manifest: {name?: unknown; version?: unknown};
    try { manifest = JSON.parse(await readManifest(path.join(packageDir, 'package.json'))) as typeof manifest; }
    catch { return {ok: false, reason: `${packageDir} has no readable package.json.`}; }
    if (manifest.name !== 'mermaid') return {ok: false, reason: `${packageDir} is not the mermaid package.`};
    version = typeof manifest.version === 'string' ? manifest.version.slice(0, 40) : 'unknown';
    const major = Number(/^(\d+)\./u.exec(version)?.[1]);
    if (!(major >= 10)) return {ok: false, reason: `Mermaid ${version} at ${packageDir} is too old: NMSh needs version 10 or newer.`};
  }
  let handle: fs.FileHandle;
  try { handle = await fs.open(file, constants.O_RDONLY | constants.O_NONBLOCK | (constants.O_NOFOLLOW ?? 0)); }
  catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'EISDIR') return {ok: false, reason: `${file} is not a regular file.`};
    return {ok: false, reason: code === 'ENOENT' ? `${file} does not exist.` : `${file} cannot be read (${code ?? 'error'}).`};
  }
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) return {ok: false, reason: `${file} is not a regular file.`};
    if (stat.size > MAX_LIBRARY_BYTES) return {ok: false, reason: `${file} is too large (${Math.round(stat.size / 1048576)} MB) to be the Mermaid bundle.`};
    if ((stat.mode & 0o002) !== 0) return {ok: false, reason: `${file} can be changed by anyone on this machine, so NMSh does not run it.`};
    if (!read) return {ok: true, path: file, version, source: ''};
    const source = await handle.readFile({encoding: 'utf8'});
    if (source.length === 0) return {ok: false, reason: `${file} is empty.`};
    return {ok: true, path: file, version, source};
  } finally {
    await handle.close();
  }
}

/** package.json without blocking on a FIFO or reading a huge file: a regular file of at most 1 MB. */
async function readManifest(file: string): Promise<string> {
  const handle = await fs.open(file, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > 1024 * 1024) throw new Error('not a package.json');
    return await handle.readFile({encoding: 'utf8'});
  } finally { await handle.close(); }
}

/** The bundle path and package folder for a candidate: a package folder, or a file inside one's dist/. */
async function resolveCandidate(candidate: string): Promise<{file: string; packageDir?: string}> {
  let real = candidate;
  try { real = await fs.realpath(candidate); } catch { /* reported when opened */ }
  const stat = await fs.stat(real).catch(() => undefined);
  if (stat?.isDirectory() && !real.endsWith(`${path.sep}mermaid.min.js`)) return {file: path.join(real, BUNDLE), packageDir: real};
  const dist = path.dirname(real);
  const packageDir = path.basename(dist) === 'dist' ? path.dirname(dist) : undefined;
  const manifest = packageDir ? await fs.stat(path.join(packageDir, 'package.json')).catch(() => undefined) : undefined;
  return {file: real, ...(manifest?.isFile() ? {packageDir} : {})};
}

export async function locateMermaid(options: LocateOptions): Promise<LocatedLibrary> {
  return find(options, true);
}

/** The same search and checks as `locateMermaid`, but the bundle is only opened and `fstat`ed, never read. */
export async function probeMermaid(options: LocateOptions): Promise<MermaidProbe> {
  const found = await find(options, false);
  return found.ok ? {ok: true, path: found.path, version: found.version} : found;
}

async function find(options: LocateOptions, read: boolean): Promise<LocatedLibrary> {
  const explicit = options.env.NMSH_MERMAID?.trim();
  if (explicit) {
    if (!path.isAbsolute(explicit)) return {ok: false, reason: `NMSH_MERMAID must be an absolute path (it is ${JSON.stringify(explicit.slice(0, 200))}).`};
    const {file, packageDir} = await resolveCandidate(explicit);
    const found = await readBundle(file, packageDir, read);
    return found.ok ? found : {ok: false, reason: `NMSH_MERMAID: ${found.reason}`};
  }
  for (const candidate of options.candidates ?? libraryCandidates(options)) {
    const stat = await fs.stat(path.join(candidate, BUNDLE)).catch(() => undefined);
    if (!stat) continue;
    const {file, packageDir} = await resolveCandidate(candidate);
    return readBundle(file, packageDir, read);
  }
  return {ok: false, reason: `Mermaid is not installed. ${INSTALL_HINT}`};
}
