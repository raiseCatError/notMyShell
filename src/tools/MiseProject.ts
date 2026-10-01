import {spawn} from 'node:child_process';
import {statSync, realpathSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {resolveCommand} from '../providers/providers.js';

export interface MiseProject {cwd: string; identity: string; binary?: string; marker?: string}
export interface MiseMetadata {tools: {name: string; version: string}[]; tasks: string[]}
export type MiseResult = {state: 'available'; metadata: MiseMetadata} | {state: 'failed'};
const MARKERS = ['mise.toml', '.mise.toml', '.mise/config.toml', '.config/mise/config.toml', '.tool-versions'];

/** Filesystem facts only: never read/evaluate config or invoke mise. */
export function detectMiseProject(cwd: string, binary = resolveCommand('mise')): MiseProject {
  let canonical = cwd;
  try { canonical = realpathSync(cwd); } catch { /* inspection will fail factually */ }
  const facts: string[] = [canonical, binary ?? 'missing'];
  let marker: string | undefined;
  for (let directory = canonical;; directory = dirname(directory)) {
    for (const name of [...MARKERS, '.git']) {
      const path = join(directory, name);
      try {
        const stat = statSync(path);
        facts.push(`${path}:${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`);
        if (name !== '.git' && stat.isFile()) marker ??= path;
      } catch { /* absent/inaccessible markers do not assert configured tools */ }
    }
    if (dirname(directory) === directory) break;
  }
  return {cwd: canonical, identity: JSON.stringify(facts), binary, marker};
}

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const label = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 256 && !/[\u0000-\u001f\u007f-\u009f]/u.test(value);

/** Only names/versions survive parsing; env, run, paths and unknown fields are discarded. */
export function parseMiseMetadata(toolsJSON: string, tasksJSON: string): MiseMetadata {
  const tools: unknown = JSON.parse(toolsJSON), tasks: unknown = JSON.parse(tasksJSON);
  if (!record(tools) || !Array.isArray(tasks) || tasks.length > 500 || Object.keys(tools).length > 200) throw new Error('Invalid metadata');
  const versions: MiseMetadata['tools'] = [];
  for (const [name, entries] of Object.entries(tools)) {
    if (!label(name) || !Array.isArray(entries) || entries.length > 50) throw new Error('Invalid metadata');
    for (const entry of entries) {
      if (!record(entry) || !label(entry.version)) throw new Error('Invalid metadata');
      versions.push({name, version: entry.version});
    }
  }
  const names = tasks.map(task => {
    if (!record(task) || !label(task.name) || task.name.startsWith('-') || task.name === ':::') throw new Error('Invalid metadata');
    return task.name;
  });
  return {tools: versions, tasks: [...new Set(names)]};
}

/** argv-only, detached, bounded combined output; errors never expose captured data. */
function capture(binary: string, args: string[], cwd: string, signal: AbortSignal, timeoutMs: number, maxBytes: number): Promise<string | undefined> {
  return new Promise(resolve => {
    if (signal.aborted) { resolve(undefined); return; }
    let child: ReturnType<typeof spawn>;
    try { child = spawn(binary, args, {cwd, detached: true, stdio: ['ignore', 'pipe', 'pipe']}); }
    catch { resolve(undefined); return; }
    let done = false, bytes = 0;
    const chunks: Buffer[] = [];
    const finish = (value?: string) => {
      if (done) return;
      done = true; clearTimeout(timer); signal.removeEventListener('abort', abort);
      // Also reap descendants after the metadata process exits.
      if (child.pid) { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* exited */ } }
      resolve(value);
    };
    const abort = () => finish();
    const timer = setTimeout(abort, timeoutMs);
    signal.addEventListener('abort', abort, {once: true});
    for (const [stream, stdout] of [[child.stdout!, true], [child.stderr!, false]] as const) stream.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > maxBytes) finish();
      else if (stdout) chunks.push(chunk);
    });
    child.once('error', abort);
    child.once('close', code => finish(code === 0 ? Buffer.concat(chunks).toString('utf8') : undefined));
    if (signal.aborted) abort();
  });
}

export class MiseProjectService {
  private cache = new Map<string, MiseResult>();
  private controller?: AbortController;
  cached(project: MiseProject): MiseResult | undefined { return this.cache.get(project.identity); }
  cancel(): void { this.controller?.abort(); }
  async inspect(project: MiseProject, consent: boolean, refresh = false, options: {timeoutMs?: number; maxBytes?: number} = {}): Promise<MiseResult | undefined> {
    if (!consent || !project.binary) return undefined;
    if (!refresh && this.cache.has(project.identity)) return this.cached(project);
    this.cancel();
    const controller = this.controller = new AbortController();
    let result: MiseResult = {state: 'failed'};
    try {
      const captureArgs = [project.cwd, controller.signal, options.timeoutMs ?? 3000, options.maxBytes ?? 128 * 1024] as const;
      const tools = await capture(project.binary, ['ls', '--current', '--json'], ...captureArgs);
      const tasks = tools === undefined ? undefined : await capture(project.binary, ['tasks', 'ls', '--json'], ...captureArgs);
      if (tools !== undefined && tasks !== undefined) result = {state: 'available', metadata: parseMiseMetadata(tools, tasks)};
    } catch { /* generic failure, no raw output */ }
    if (controller.signal.aborted || detectMiseProject(project.cwd, project.binary).identity !== project.identity) return undefined;
    if (this.cache.size >= 32) this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(project.identity, result);
    return result;
  }
}

export function miseTaskCommand(task: string): string {
  if (!label(task) || task.startsWith('-') || task === ':::') throw new Error('Invalid task');
  return `mise run '${task.replace(/'/gu, "'\\''")}'`;
}
