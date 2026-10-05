import {copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {dirname} from 'node:path';
import {parse as parseToml} from 'smol-toml';
import {sha256} from '../ask/fileEdit.js';
import {
  applyTmuxChange, describeTmuxChange, loadTmuxModel, optionProvenance, parseTmuxConfig, readUserTmuxConfig, saveTmuxModel, TMUX_ACTIONS, TMUX_OPTIONS,
  type TmuxChange,
} from '../tools/config/tmux.js';
import {writeTmuxManaged} from '../tools/config/tmuxManaged.js';
import {destinationFor, readFound, type FoundFile, type ScanResult} from './scan.js';

/**
 * Turning a scan into reviewed choices. Structured or command-style config
 * goes through its adapter at field level (current vs dotfiles, never
 * silently the repository's value on a conflict). A file is copied exactly
 * only when its registry entry declares an exactCopy validator and the
 * content passes it (fail-closed: being parseable is not being safe);
 * everything else, including all executable config, is inspect only. The
 * repository itself is never modified.
 */

export type ItemKind = 'fields' | 'copy' | 'inspect' | 'templated' | 'unreadable';
export type ItemMode = 'import' | 'copy' | 'skip';

export interface FieldChoice {change: TmuxChange; label: string; repo: string; current: string; source: string; use: boolean; conflict: boolean}

export interface DotfilesItem {
  file: FoundFile;
  kind: ItemKind;
  mode: ItemMode;
  modes: readonly ItemMode[];
  note: string;
  fields?: FieldChoice[];
  destination?: string;
  /** sha256 of the destination when reviewed ('absent' when missing): copying refuses if it changed since. */
  destinationSha?: string;
  content?: string;
  diff?: string[];
}

function shortDiff(before: string | undefined, after: string): string[] {
  if (before === undefined) return [`+ new file (${after.split('\n').length} lines)`];
  const a = before.split('\n');
  const b = after.split('\n');
  const out: string[] = [];
  for (let index = 0; index < Math.max(a.length, b.length) && out.length < 12; index++) {
    if (a[index] === b[index]) continue;
    if (a[index] !== undefined) out.push(`- ${a[index]}`);
    if (b[index] !== undefined) out.push(`+ ${b[index]}`);
  }
  return out.length ? out : ['  identical to the current file'];
}

function tmuxFields(text: string, env: NodeJS.ProcessEnv): FieldChoice[] {
  const repo = parseTmuxConfig(text);
  const model = loadTmuxModel(env);
  const mine = readUserTmuxConfig(env);
  const user = mine ? parseTmuxConfig(mine.text) : undefined;
  const fields: FieldChoice[] = [];
  for (const [id, value] of Object.entries(repo.options)) {
    const option = TMUX_OPTIONS.find(item => item.id === id)!;
    const current = optionProvenance(option, model, user);
    if (current.effective === value) continue;
    const conflict = current.source !== 'tmux default';
    fields.push({change: {kind: 'option', id, value}, label: option.label, repo: value, current: current.effective, source: current.source, use: !conflict, conflict});
  }
  if (repo.prefix) {
    const current = model.prefix ?? user?.prefix ?? 'C-b';
    if (current !== repo.prefix) {
      const conflict = Boolean(model.prefix ?? user?.prefix);
      fields.push({change: {kind: 'prefix', key: repo.prefix}, label: 'Prefix', repo: repo.prefix, current, source: model.prefix ? 'NMSh managed file' : user?.prefix ? 'your tmux config' : 'tmux default', use: !conflict, conflict});
    }
  }
  for (const binding of repo.bindings) {
    if (binding.action === 'send-prefix') continue;
    const existing = [...model.bindings, ...(user?.bindings ?? [])].find(item => item.key === binding.key && item.table === binding.table);
    if (existing?.action === binding.action) continue;
    fields.push({change: {kind: 'binding', binding}, label: `Key ${binding.key}`, repo: TMUX_ACTIONS[binding.action].label, current: existing ? TMUX_ACTIONS[existing.action].label : '—',
      source: existing ? 'existing binding' : 'unbound', use: !existing, conflict: Boolean(existing)});
  }
  return fields;
}

export function buildPlan(scan: ScanResult, env: NodeJS.ProcessEnv = process.env): DotfilesItem[] {
  const items: DotfilesItem[] = [];
  const seen = new Set<string>();
  for (const file of scan.found) {
    const base = {file};
    if (file.templated) { items.push({...base, kind: 'templated', mode: 'skip', modes: ['skip'], note: 'chezmoi template: not literal config; review it with chezmoi (NMSh does not render templates)'}); continue; }
    if (file.tool.configClass === 'executable') { items.push({...base, kind: 'inspect', mode: 'skip', modes: ['skip'], note: 'Executable config: inspect only; never sourced, copied or rewritten'}); continue; }
    if (seen.has(file.tool.id)) { items.push({...base, kind: 'inspect', mode: 'skip', modes: ['skip'], note: `Another ${file.tool.label} file was already selected from this repository`}); continue; }
    const content = readFound(scan, file);
    if (typeof content !== 'string') { items.push({...base, kind: 'unreadable', mode: 'skip', modes: ['skip'], note: content.error}); continue; }
    seen.add(file.tool.id);
    if (file.tool.id === 'tmux') {
      const fields = tmuxFields(content, env);
      const parsed = parseTmuxConfig(content);
      items.push({...base, kind: 'fields', mode: fields.length ? 'import' : 'skip', modes: fields.length ? ['import', 'skip'] : ['skip'], fields, content,
        note: `${fields.length} supported value${fields.length === 1 ? '' : 's'} differ · ${parsed.unsupported.length} other lines stay out · ${parsed.ignored.length} dynamic lines never run`});
      continue;
    }
    if (file.target.endsWith('.toml')) { try { parseToml(content); } catch { items.push({...base, kind: 'unreadable', mode: 'skip', modes: ['skip'], note: 'Not valid TOML; skipped'}); continue; } }
    const exact = file.tool.exactCopy?.(content);
    if (exact && !exact.ok) { items.push({...base, kind: 'inspect', mode: 'skip', modes: ['skip'], note: `Inspect only: ${exact.reason}`}); continue; }
    if (exact?.ok) {
      const destination = destinationFor(file.tool, env);
      let before: string | undefined;
      try { before = readFileSync(destination, 'utf8'); } catch { before = undefined; }
      items.push({...base, kind: 'copy', mode: 'skip', modes: ['skip', 'copy'], content, destination, destinationSha: before === undefined ? 'absent' : sha256(before), diff: shortDiff(before, content),
        note: `Copy exact file to ${destination}${before === undefined ? '' : ' (the current file is backed up first)'}`});
      continue;
    }
    items.push({...base, kind: 'inspect', mode: 'skip', modes: ['skip'], note: file.tool.dotfilesNote ?? 'Inspect only: no reviewed import for this tool; never copied'});
  }
  return items;
}

/** The combined review text: everything that would change, and what is skipped. */
export function reviewLines(items: readonly DotfilesItem[], include: readonly string[]): string[] {
  const lines: string[] = [];
  let fragments = 0;
  let copies = 0;
  for (const item of items) {
    lines.push(`${item.file.tool.label}  ${item.file.repoPath}`);
    if (item.mode === 'import' && item.fields) {
      const used = item.fields.filter(field => field.use);
      if (used.length) fragments = 1;
      for (const field of used) lines.push(`  + ${describeTmuxChange(field.change)}`);
      if (!used.length) lines.push('  (no values selected)');
    } else if (item.mode === 'copy' && item.kind === 'copy') { copies++; lines.push(`  ~ copy to ${item.destination}`, ...item.diff!.slice(0, 6).map(line => `    ${line}`)); }
    else lines.push(`  · ${item.kind === 'inspect' || item.kind === 'templated' ? item.note : 'skipped'}`);
  }
  if (include.length) lines.push('', 'tmux.conf gains one include of the NMSh-managed tmux file:', ...include.map(line => `  ${line}`));
  lines.push('', `Files: ${fragments} managed fragment${fragments === 1 ? '' : 's'} updated · ${include.length ? 1 : 0} reviewed include · ${copies} file${copies === 1 ? '' : 's'} copied (backed up first) · 0 scripts run · the repository is not changed`);
  return lines;
}

/** Backup then atomic replace, refusing if the destination changed since review or is a symlink. */
function copyExact(item: DotfilesItem, now: Date): string {
  const destination = item.destination!;
  const verdict = item.file.tool.exactCopy?.(item.content!);
  if (!verdict?.ok) return 'no exact-copy authority for this tool; nothing was written.';
  if (existsSync(destination)) {
    if (lstatSync(destination).isSymbolicLink()) return `${destination} is a symlink (to ${realpathSync(destination)}); not replaced.`;
    if (sha256(readFileSync(destination, 'utf8')) !== item.destinationSha) return `${destination} changed since review; nothing was written.`;
    copyFileSync(destination, `${destination}.nmsh-backup-${now.toISOString().replace(/[:.]/gu, '-')}`);
  } else if (item.destinationSha !== 'absent') return `${destination} disappeared since review; nothing was written.`;
  mkdirSync(dirname(destination), {recursive: true});
  const staged = `${destination}.nmsh-${process.pid}.tmp`;
  writeFileSync(staged, item.content!, {encoding: 'utf8', mode: 0o644});
  renameSync(staged, destination);
  return `copied to ${destination}`;
}

/** Applies the reviewed choices through the tool adapters. Per-item results; one failure does not stop the others. */
export function applyPlan(items: readonly DotfilesItem[], env: NodeJS.ProcessEnv = process.env, now = new Date()): string[] {
  const results: string[] = [];
  for (const item of items) {
    try {
      if (item.mode === 'import' && item.fields) {
        let model = loadTmuxModel(env);
        for (const field of item.fields.filter(choice => choice.use)) {
          const next = applyTmuxChange(model, field.change);
          if ('error' in next) results.push(`${item.file.tool.label}: ${next.error}`); else model = next;
        }
        saveTmuxModel(model, env);
        const written = writeTmuxManaged(model, env);
        results.push(`${item.file.tool.label}: ${written.ok ? 'supported values saved to the NMSh-managed tmux file' : written.error}`);
      } else if (item.mode === 'copy') results.push(`${item.file.tool.label}: ${copyExact(item, now)}`);
    } catch (error) {
      results.push(`${item.file.tool.label}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return results;
}

export const homeOf = (env: NodeJS.ProcessEnv = process.env) => env.HOME || homedir();
