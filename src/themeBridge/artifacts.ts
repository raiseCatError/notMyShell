import {createHash} from 'node:crypto';
import {existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {dirname, join} from 'node:path';
import {nmshConfigDirectory} from '../configuration/paths.js';
import {applyPlan, inspectFile, planAppend, planCreate, planReplace, type FileEditPlan} from '../ask/fileEdit.js';
import type {BridgeMode, BridgeTargetId} from './model.js';

/**
 * Theme Bridge ownership: generated artifacts and exact config hooks NMSh
 * created, recorded in a small ledger. A file is replaced or removed only
 * when ownership is established (a ledger entry whose recorded content hash
 * matches the file on disk); a hook is removed only as the exact lines NMSh
 * inserted. When ownership is uncertain NMSh stops and says so; it never
 * deletes or overwrites.
 */

export const ADAPTER_VERSION = 1;
export type ManagedTarget = Extract<BridgeTargetId, 'tmux' | 'neovim' | 'vim'> | 'vivid';

export interface ConfigHook {
  /** The user's config file the hook lives in. */
  configPath: string;
  /** The exact lines NMSh inserted (removal removes exactly these). */
  lines: string[];
  insertedAt: string;
}

export interface LedgerEntry {
  target: ManagedTarget;
  artifactPath: string;
  mode: BridgeMode;
  themeRef: string;
  format: string;
  formatVersion: number;
  sha256: string;
  adapterVersion: number;
  generatedAt: string;
  hook?: ConfigHook;
}

export interface Ledger {version: 1; entries: Partial<Record<ManagedTarget, LedgerEntry>>}

export const bridgeDirectory = (env: NodeJS.ProcessEnv = process.env) => join(nmshConfigDirectory(env), 'theme-bridge');
export const ledgerPath = (env: NodeJS.ProcessEnv = process.env) => join(bridgeDirectory(env), 'ledger.json');
export const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

/** Where each managed artifact lives: always inside NMSh's own Theme Bridge directory. */
export function artifactPath(target: ManagedTarget, env: NodeJS.ProcessEnv = process.env): string {
  const root = bridgeDirectory(env);
  switch (target) {
    case 'tmux': return join(root, 'tmux', 'nmsh-bridge.tmux.conf');
    case 'neovim': return join(root, 'nvim', 'colors', 'nmsh-bridge.lua');
    case 'vim': return join(root, 'vim', 'colors', 'nmsh-bridge.vim');
    case 'vivid': return join(root, 'vivid', 'nmsh-bridge.yml');
  }
}

/** The runtimepath directory that holds `colors/` for an editor target. */
export const runtimeDirectory = (target: 'neovim' | 'vim', env: NodeJS.ProcessEnv = process.env) => dirname(dirname(artifactPath(target, env)));

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const TARGETS: readonly ManagedTarget[] = ['tmux', 'neovim', 'vim', 'vivid'];

/** A malformed or stale ledger yields no ownership (so nothing can be deleted on its say-so). */
export function loadLedger(env: NodeJS.ProcessEnv = process.env): Ledger {
  let parsed: unknown;
  try { parsed = JSON.parse(readFileSync(ledgerPath(env), 'utf8')); } catch { return {version: 1, entries: {}}; }
  const entries: Ledger['entries'] = {};
  const raw = isRecord(parsed) && isRecord(parsed.entries) ? parsed.entries : {};
  for (const target of TARGETS) {
    const entry = raw[target];
    if (!isRecord(entry) || entry.target !== target || typeof entry.sha256 !== 'string' || !/^[0-9a-f]{64}$/u.test(entry.sha256)) continue;
    // Only the path NMSh itself would use is ever trusted; a ledger cannot point NMSh at other files.
    if (entry.artifactPath !== artifactPath(target, env)) continue;
    const hook = isRecord(entry.hook) && typeof entry.hook.configPath === 'string' && Array.isArray(entry.hook.lines)
      && entry.hook.lines.every(line => typeof line === 'string' && line.length < 2048) && entry.hook.lines.length > 0 && entry.hook.lines.length <= 4
      ? {configPath: entry.hook.configPath, lines: entry.hook.lines as string[], insertedAt: String(entry.hook.insertedAt ?? '')} : undefined;
    entries[target] = {target, artifactPath: entry.artifactPath, mode: entry.mode === 'choose' ? 'choose' : 'follow', themeRef: String(entry.themeRef ?? ''),
      format: String(entry.format ?? ''), formatVersion: Number(entry.formatVersion) || 1, sha256: entry.sha256, adapterVersion: Number(entry.adapterVersion) || 1,
      generatedAt: String(entry.generatedAt ?? ''), ...(hook ? {hook} : {})};
  }
  return {version: 1, entries};
}

export function saveLedger(ledger: Ledger, env: NodeJS.ProcessEnv = process.env): void {
  const path = ledgerPath(env);
  mkdirSync(dirname(path), {recursive: true, mode: 0o700});
  const staged = `${path}.${process.pid}.tmp`;
  writeFileSync(staged, `${JSON.stringify(ledger, null, 2)}\n`, {encoding: 'utf8', mode: 0o600});
  renameSync(staged, path);
}

export type Ownership = 'absent' | 'owned' | 'modified' | 'unknown';

/** Owned: the ledger recorded this exact content. Modified/unknown files are never touched. */
export function ownership(target: ManagedTarget, ledger: Ledger, env: NodeJS.ProcessEnv = process.env): Ownership {
  const path = artifactPath(target, env);
  if (!existsSync(path)) return 'absent';
  const entry = ledger.entries[target];
  if (!entry) return 'unknown';
  let content: string;
  try { content = readFileSync(path, 'utf8'); } catch { return 'unknown'; }
  return sha256(content) === entry.sha256 ? 'owned' : 'modified';
}

export type GenerateResult = {ok: true; path: string; changed: boolean} | {ok: false; error: string};

/**
 * resolve → render → stage → validate → atomic replace. A file NMSh does not
 * provably own is never replaced; a failed validation leaves the previous
 * artifact (and every other adapter) untouched.
 */
export function writeArtifact(target: ManagedTarget, content: string, validate: (content: string) => boolean, record: Omit<LedgerEntry, 'target' | 'artifactPath' | 'sha256' | 'adapterVersion' | 'generatedAt' | 'hook'>,
  env: NodeJS.ProcessEnv = process.env, now = new Date()): GenerateResult {
  if (!validate(content)) return {ok: false, error: 'The generated file failed validation; the previous one was kept.'};
  const ledger = loadLedger(env);
  const state = ownership(target, ledger, env);
  const path = artifactPath(target, env);
  if (state === 'modified' || state === 'unknown') {
    return {ok: false, error: `${path} exists but NMSh cannot confirm it wrote it${state === 'modified' ? ' (it was edited)' : ''}. Move it away to let NMSh manage it.`};
  }
  const hash = sha256(content);
  const previous = ledger.entries[target];
  const changed = !previous || previous.sha256 !== hash || state === 'absent';
  if (changed) {
    mkdirSync(dirname(path), {recursive: true, mode: 0o700});
    const staged = `${path}.${process.pid}.tmp`;
    try {
      writeFileSync(staged, content, {encoding: 'utf8', mode: 0o644});
      if (readFileSync(staged, 'utf8') !== content || !validate(readFileSync(staged, 'utf8'))) throw new Error('staged file did not verify');
      renameSync(staged, path);
    } catch (error) {
      try { unlinkSync(staged); } catch { /* nothing staged */ }
      return {ok: false, error: `Writing ${path} failed: ${error instanceof Error ? error.message : String(error)}. The previous file was kept.`};
    }
  }
  ledger.entries[target] = {...record, target, artifactPath: path, sha256: hash, adapterVersion: ADAPTER_VERSION, generatedAt: now.toISOString(),
    ...(previous?.hook ? {hook: previous.hook} : {})};
  saveLedger(ledger, env);
  return {ok: true, path, changed};
}

/** Removes a managed artifact only when owned; an edited or unrecorded file is reported and kept. */
export function removeArtifact(target: ManagedTarget, env: NodeJS.ProcessEnv = process.env): {ok: true; removed: boolean} | {ok: false; error: string} {
  const ledger = loadLedger(env);
  const state = ownership(target, ledger, env);
  const path = artifactPath(target, env);
  if (state === 'modified' || state === 'unknown') return {ok: false, error: `${path} was not removed: NMSh cannot confirm it is unchanged since NMSh wrote it.`};
  if (state === 'owned') unlinkSync(path);
  // A recorded include stays recorded (it is harmless without the file: every include tolerates a missing file) until it is removed explicitly.
  const hook = ledger.entries[target]?.hook;
  if (hook) ledger.entries[target] = {...ledger.entries[target]!, sha256: sha256(''), hook};
  else delete ledger.entries[target];
  saveLedger(ledger, env);
  return {ok: true, removed: state === 'owned'};
}

// ---- Exact config hooks ---------------------------------------------------------

export interface HookSpec {
  configPath: string;
  lines: string[];
  /** Create the config file with only these lines when it does not exist. */
  createIfMissing: boolean;
}

const HOOK_COMMENT = {tmux: '# NMSh Theme Bridge: loads NMSh-managed colors (remove with /theme-bridge)',
  neovim: '-- NMSh Theme Bridge: loads NMSh-managed colors (remove with /theme-bridge)',
  vim: '" NMSh Theme Bridge: loads NMSh-managed colors (remove with /theme-bridge)'};

/** A path safe to embed in a single-quoted tmux/Vim/Lua string without escaping rules that differ by target. */
export function hookSafePath(path: string): boolean {
  return /^[^'"\\,\u0000-\u001f\u007f|]+$/u.test(path);
}

function firstExisting(paths: readonly string[]): string | undefined {
  return paths.find(path => existsSync(path));
}

/** The user config a hook belongs in, and the exact lines. Existing files are preferred; nothing else is assumed. */
export function hookSpec(target: Extract<ManagedTarget, 'tmux' | 'neovim' | 'vim'>, env: NodeJS.ProcessEnv = process.env, home = env.HOME || homedir()): HookSpec | {error: string} {
  const xdg = env.XDG_CONFIG_HOME && env.XDG_CONFIG_HOME.startsWith('/') ? env.XDG_CONFIG_HOME : join(home, '.config');
  if (target === 'tmux') {
    const fragment = artifactPath('tmux', env);
    if (!hookSafePath(fragment)) return {error: `The managed file path ${fragment} cannot be quoted safely for tmux.`};
    const existing = firstExisting([join(home, '.tmux.conf'), join(xdg, 'tmux', 'tmux.conf')]);
    return {configPath: existing ?? join(home, '.tmux.conf'), lines: [HOOK_COMMENT.tmux, `source-file -q '${fragment}'`], createIfMissing: !existing};
  }
  const runtime = runtimeDirectory(target, env);
  if (!hookSafePath(runtime)) return {error: `The managed directory ${runtime} cannot be quoted safely for ${target === 'neovim' ? 'Neovim' : 'Vim'}.`};
  if (target === 'neovim') {
    const lua = join(xdg, 'nvim', 'init.lua');
    const vimscript = join(xdg, 'nvim', 'init.vim');
    if (existsSync(vimscript) && !existsSync(lua)) {
      return {configPath: vimscript, lines: [HOOK_COMMENT.vim, `silent! execute 'set runtimepath+=' . fnameescape('${runtime}') | silent! colorscheme nmsh-bridge`], createIfMissing: false};
    }
    return {configPath: lua, lines: [HOOK_COMMENT.neovim, `pcall(function() vim.opt.runtimepath:append('${runtime}'); vim.cmd.colorscheme('nmsh-bridge') end)`], createIfMissing: !existsSync(lua)};
  }
  const existing = firstExisting([join(home, '.vimrc'), join(home, '.vim', 'vimrc')]);
  return {configPath: existing ?? join(home, '.vimrc'), lines: [HOOK_COMMENT.vim, `silent! execute 'set runtimepath+=' . fnameescape('${runtime}') | silent! colorscheme nmsh-bridge`], createIfMissing: !existing};
}

/** The verified plan (exact path, exact diff) for inserting a hook; nothing is written here. */
export function planHook(spec: HookSpec, home: string): {plan: FileEditPlan} | {noop: string} | {error: string} {
  const roots = [home];
  if (spec.createIfMissing && !existsSync(spec.configPath)) {
    const result = planCreate(spec.configPath, `${spec.lines.join('\n')}\n`, roots);
    return result.kind === 'plan' ? {plan: result.plan} : {error: 'reason' in result ? result.reason : 'Cannot create that file.'};
  }
  const result = planAppend(inspectFile(spec.configPath, roots), 'text', spec.lines.join('\n'));
  if (result.kind === 'plan') return {plan: result.plan};
  if (result.kind === 'noop') return {noop: result.reason};
  return {error: 'reason' in result ? result.reason : 'Cannot edit that file.'};
}

/** Applies a confirmed hook plan and records the exact lines in the ledger. */
export function applyHook(target: Extract<ManagedTarget, 'tmux' | 'neovim' | 'vim'>, plan: FileEditPlan, spec: HookSpec, env: NodeJS.ProcessEnv = process.env, now = new Date()): {ok: true} | {ok: false; error: string} {
  const ledger = loadLedger(env);
  const entry = ledger.entries[target];
  if (!entry) return {ok: false, error: 'Generate the managed file first.'};
  const result = applyPlan(plan);
  if (!result.ok) return {ok: false, error: result.reason};
  ledger.entries[target] = {...entry, hook: {configPath: spec.configPath, lines: [...spec.lines], insertedAt: now.toISOString()}};
  saveLedger(ledger, env);
  return {ok: true};
}

/** The plan to remove exactly the recorded hook lines; anything else in the file is untouched. */
export function planHookRemoval(target: Extract<ManagedTarget, 'tmux' | 'neovim' | 'vim'>, home: string, env: NodeJS.ProcessEnv = process.env): {plan: FileEditPlan} | {gone: true} | {error: string} {
  const hook = loadLedger(env).entries[target]?.hook;
  if (!hook) return {error: 'NMSh has no recorded include for this target.'};
  const facts = inspectFile(hook.configPath, [home]);
  if (facts.content === undefined) return {error: `${hook.configPath} ${facts.refusal ?? 'cannot be read'}; nothing was changed.`};
  const block = `${hook.lines.join('\n')}\n`;
  const occurrences = facts.content.split(block).length - 1;
  if (occurrences === 0) return {gone: true};
  if (occurrences > 1) return {error: `${hook.configPath} contains the NMSh include more than once; remove the extra copies yourself so NMSh does not guess.`};
  const result = planReplace(facts, block, '');
  return result.kind === 'plan' ? {plan: result.plan} : {error: 'reason' in result ? result.reason : 'Cannot plan the removal.'};
}

export function applyHookRemoval(target: Extract<ManagedTarget, 'tmux' | 'neovim' | 'vim'>, plan: FileEditPlan | undefined, env: NodeJS.ProcessEnv = process.env): {ok: true} | {ok: false; error: string} {
  if (plan) {
    const result = applyPlan(plan);
    if (!result.ok) return {ok: false, error: result.reason};
  }
  const ledger = loadLedger(env);
  const entry = ledger.entries[target];
  if (entry) { delete entry.hook; saveLedger(ledger, env); }
  return {ok: true};
}
