/** Bounded data-only readers. Dynamic/include generators are never executed or guessed. */
import {dirname, isAbsolute, resolve} from 'node:path';
import {snapshot, type FileSnapshot} from './hostFiles.js';
import {appearancePaths, type AppearanceContext, type AppearanceHost} from './hostPaths.js';

/** `raw` is the trimmed value exactly as written (before outer-quote removal), for values with their own quoting rules. */
export interface Definition {value: string; raw: string; path: string; line: number}
/** `definitions` lists every non-include definition in load order (later ones win), for disclosing shadowed lines. */
export interface ConfigurationRead {hostPath: string; values: Map<string, Definition>; definitions: Array<Definition & {key: string}>; files: FileSnapshot[]; problems: string[]}
/** Overrides simulate a reviewed integration; they never change files or the captured preconditions. */
export function readHostConfiguration(host: AppearanceHost, context: AppearanceContext, overrides?: ReadonlyMap<string, string>): ConfigurationRead {
  const paths = appearancePaths(host, context);
  const files = new Map<string, FileSnapshot>();
  const values = new Map<string, Definition>();
  const definitions: Array<Definition & {key: string}> = [];
  const problems: string[] = [];
  const queue: Array<{path: string; stack: readonly string[]; optional: boolean}> = [];
  let totalBytes = 0;
  const get = (path: string): FileSnapshot => {
    const existing = files.get(path);
    if (existing) return existing;
    if (files.size >= 32) throw new Error('More than 32 configuration files; cannot establish effective appearance safely.');
    const file = snapshot(path, paths.home);
    totalBytes += Buffer.byteLength(overrides?.get(path) ?? file.content ?? '');
    if (totalBytes > 2 * 1024 * 1024) throw new Error('Configuration includes exceed 2 MiB.');
    files.set(path, file); return file;
  };
  const unquote = (value: string) => value.startsWith('"') && value.endsWith('"') ? value.slice(1, -1) : value;
  const walk = (path: string, stack: readonly string[] = [], optional = false): void => {
    if (stack.includes(path) || stack.length >= 8) throw new Error('Recursive or deeply nested configuration include.');
    const file = get(path);
    const content = overrides?.get(path) ?? file.content;
    if (content === undefined) { if (!optional) throw new Error(`Required included file is missing: ${path}`); return; }
    const follow = (value: string) => {
      let name = unquote(value.trim());
      const optional = host === 'ghostty' && name.startsWith('?');
      if (optional) name = name.slice(1);
      if (!name || /[$*?{}\[\]`\u0000-\u001f]/u.test(name) || name.includes('"') || name.includes("'")) throw new Error('An include needs dynamic expansion or unsupported quoting; nothing will be executed.');
      const expanded = name.startsWith('~/') ? resolve(paths.home, name.slice(2)) : isAbsolute(name) ? name : resolve(dirname(path), name);
      if (host === 'ghostty') {
        if (queue.length >= 32) throw new Error('Too many recursive includes.');
        queue.push({path: expanded, stack: [...stack, path], optional});
      } else walk(expanded, [...stack, path]);
    };
    content.split(/\r?\n/u).forEach((line, index) => {
      const clean = line.trim();
      if (!clean || clean.startsWith('#')) return;
      const match = host === 'ghostty' ? /^([\w-]+)\s*=\s*(.*)$/u.exec(clean) : /^(\w+)\s+(.*)$/u.exec(clean);
      if (!match) throw new Error(`Unsupported configuration syntax at ${path}:${index + 1}.`);
      const [, key, raw] = match;
      if (/[\u0000-\u001f\u007f-\u009f]/u.test(raw!)) throw new Error('A configuration value contains terminal controls.');
      if (host === 'kitty' && ['geninclude', 'envinclude', 'globinclude'].includes(key!)) throw new Error('Dynamic Kitty includes cannot be evaluated safely.');
      if (key === (host === 'ghostty' ? 'config-file' : 'include')) { follow(raw!); return; }
      const definition = {value: unquote(raw!.trim()), raw: raw!.trim(), path, line: index + 1};
      values.set(key!, definition);
      if (definitions.length < 4096) definitions.push({...definition, key: key!});
    });
  };
  let hostPath = paths.fallback;
  try {
    // Ghostty loads ALL roots before traversing one appended recursive-include queue.
    // Kitty processes includes immediately in place.
    for (const path of paths.candidates) {
      const file = get(path);
      if ((overrides?.get(path) ?? file.content) !== undefined) {
        hostPath = path; walk(path);
        // Kitty uses only the first existing kitty.conf. Earlier absent candidates stay captured, so creating one invalidates a plan.
        if (host === 'kitty') break;
      }
    }
    const loaded = new Set<string>();
    for (let index = 0; index < queue.length; index++) {
      const entry = queue[index]!;
      if (loaded.has(entry.path)) throw new Error('A duplicate or recursive include cannot be resolved safely.');
      loaded.add(entry.path); walk(entry.path, entry.stack, entry.optional);
    }
  } catch (error) { problems.push(error instanceof Error ? error.message : String(error)); }
  return {hostPath, values, definitions, files: [...files.values()], problems};
}
