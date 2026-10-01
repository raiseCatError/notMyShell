import {createHash, randomUUID} from 'node:crypto';
import {readFileSync, writeFileSync, mkdirSync, lstatSync, statSync, realpathSync, renameSync, unlinkSync, openSync, closeSync} from 'node:fs';
import {isAbsolute, join} from 'node:path';
import {nmshConfigDirectory} from '../configuration/paths.js';

export interface SessionPreset {name: string; cwd: string; commands: string[]; acknowledged?: string}
interface PresetFile {version: 1; presets: SessionPreset[]}
export class PresetError extends Error {}
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const safeText = (value: unknown, max: number): value is string => typeof value === 'string' && value.length <= max && !/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/u.test(value);
export function validatePreset(value: unknown): SessionPreset {
  if (!object(value) || typeof value.name !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9 _-]{0,63}$/u.test(value.name) || value.name.trim() !== value.name) throw new PresetError('Invalid preset name. Use 1–64 letters, numbers, spaces, _ or -.');
  if (!safeText(value.cwd,4096) || !isAbsolute(value.cwd) || /[\r\n\t]/u.test(value.cwd)) throw new PresetError('Preset cwd must be an absolute directory path.');
  if (!Array.isArray(value.commands) || value.commands.length > 16 || !value.commands.every(command => safeText(command,4096) && command.trim().length > 0 && !command.includes('\r')) || Buffer.byteLength(value.commands.join(''),'utf8') > 16384) throw new PresetError('Invalid startup commands (maximum 16 commands / 16 KiB).');
  if (value.acknowledged !== undefined && (typeof value.acknowledged !== 'string' || !/^[a-f0-9]{64}$/u.test(value.acknowledged))) throw new PresetError('Malformed preset acknowledgement.');
  return {name:value.name, cwd:value.cwd, commands:[...value.commands], ...(value.acknowledged ? {acknowledged:value.acknowledged as string} : {})};
}
export function presetDigest(preset: SessionPreset): string {
  return createHash('sha256').update(JSON.stringify([preset.cwd,preset.commands])).digest('hex');
}
export function presetNeedsAcknowledgement(preset: SessionPreset): boolean { return preset.acknowledged !== presetDigest(preset); }
export function validatePresetCwd(preset: SessionPreset): void {
  try { if (statSync(preset.cwd).isDirectory()) return; } catch { /* missing/inaccessible */ }
  throw new PresetError('Preset cwd is missing or is not an accessible directory.');
}
export function presetCommands(preset: SessionPreset): string[] {
  return [`cd -- '${preset.cwd.replace(/'/gu,"'\\''")}'`, ...preset.commands];
}

/** Additive versioned sidecar: never rewrites config.json or captures session/env/history. */
export class SessionPresetStore {
  readonly path: string;
  constructor(readonly directory = nmshConfigDirectory()) { this.path = join(directory,'presets.json'); }
  private read(): PresetFile {
    let source: string;
    try {
      const stat = lstatSync(this.path);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 256 * 1024) throw new PresetError('Preset storage is not a supported regular file.');
      source = readFileSync(this.path,'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {version:1,presets:[]};
      throw error instanceof PresetError ? error : new PresetError('Could not read preset storage.');
    }
    try {
      const parsed: unknown = JSON.parse(source);
      if (!object(parsed) || parsed.version !== 1 || !Array.isArray(parsed.presets) || parsed.presets.length > 100) throw new Error();
      const presets = parsed.presets.map(validatePreset);
      if (new Set(presets.map(preset=>preset.name)).size !== presets.length) throw new Error();
      return {version:1,presets};
    } catch { throw new PresetError('Malformed or unsupported preset storage; existing file was preserved.'); }
  }
  list(): SessionPreset[] { return this.read().presets; }
  get(name: string): SessionPreset {
    const preset = this.list().find(item=>item.name === name);
    if (!preset) throw new PresetError('Preset not found.');
    return preset;
  }
  private mutate(change: (file: PresetFile)=>void): void {
    mkdirSync(this.directory,{recursive:true,mode:0o700});
    const lock = `${this.path}.lock`, temporary = `${this.path}.${randomUUID()}.tmp`;
    let descriptor: number;
    try { descriptor = openSync(lock,'wx',0o600); }
    catch { throw new PresetError('Preset storage is busy or not writable.'); }
    try {
      const original = this.diskContents();
      const file = this.read();
      if (this.diskContents() !== original) throw new PresetError('Preset storage changed; retry after inspecting it.');
      change(file);
      if (file.presets.length > 100) throw new PresetError('Preset limit reached (100).');
      const contents = JSON.stringify(file,null,2)+'\n';
      if (Buffer.byteLength(contents,'utf8') > 256 * 1024) throw new PresetError('Preset storage limit reached (256 KiB); existing presets were preserved.');
      writeFileSync(temporary,contents,{flag:'wx',mode:0o600});
      this.read(); // Refuse symlinks or a malformed intervening replacement.
      if (this.diskContents() !== original) throw new PresetError('Preset storage changed; retry after inspecting it.');
      renameSync(temporary,this.path);
    } finally {
      closeSync(descriptor);
      try { unlinkSync(temporary); } catch { /* no staged file */ }
      unlinkSync(lock);
    }
  }
  private diskContents(): string | undefined {
    try { return readFileSync(this.path,'utf8'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw new PresetError('Could not read preset storage.'); }
  }
  create(value: Pick<SessionPreset,'name'|'cwd'|'commands'>): SessionPreset {
    const preset = validatePreset({name:value.name,cwd:value.cwd,commands:value.commands});
    validatePresetCwd(preset);
    this.mutate(file=>{
      if (file.presets.some(item=>item.name === preset.name)) throw new PresetError('Duplicate preset name.');
      file.presets.push(preset);
    });
    return preset;
  }
  delete(name: string): void {
    this.mutate(file=>{
      if (!file.presets.some(item=>item.name === name)) throw new PresetError('Preset not found.');
      file.presets = file.presets.filter(item=>item.name !== name);
    });
  }
  acknowledge(reviewed: SessionPreset): SessionPreset {
    let acknowledged: SessionPreset | undefined;
    this.mutate(file=>{
      const current = file.presets.find(item=>item.name === reviewed.name);
      if (!current || presetDigest(current) !== presetDigest(reviewed)) throw new PresetError('Preset changed; inspect and acknowledge it again.');
      validatePresetCwd(current);
      current.acknowledged = presetDigest(current);
      acknowledged = current;
    });
    return acknowledged!;
  }
}

/** One visible ordinary submission per real prompt. Nothing is replayed on attach. */
export class PresetStartup {
  private queue: string[];
  private submitted = 0;
  active = true;
  constructor(readonly preset: SessionPreset) {
    if (presetNeedsAcknowledgement(preset)) throw new PresetError('Startup acknowledgement required.');
    validatePresetCwd(preset);
    this.queue = presetCommands(preset);
  }
  cancel(): void { this.active = false; this.queue = []; }
  next(exitCode: number, cwd: string): {command: string} | {error: string} | undefined {
    if (!this.active) return;
    let enteredCwd = cwd === this.preset.cwd;
    if (this.submitted === 1 && !enteredCwd) {
      try { enteredCwd = realpathSync(cwd) === realpathSync(this.preset.cwd); } catch { /* missing */ }
    }
    if (this.submitted > 0 && (exitCode !== 0 || (this.submitted === 1 && !enteredCwd))) {
      this.cancel();
      return {error:'Preset startup stopped: command failed or requested cwd was not entered.'};
    }
    const command = this.queue.shift();
    if (command === undefined) { this.active = false; return; }
    this.submitted++;
    return {command};
  }
}
