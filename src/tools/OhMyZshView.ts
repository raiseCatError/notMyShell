import {constants, copyFileSync, lstatSync, readFileSync, renameSync, writeFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {dirname, join} from 'node:path';
import type {Key} from '../terminal/keys.js';
import {createConfirm, handleConfirmKey, renderConfirm, type ConfirmState} from '../ui/formControls.js';
import {fingerprint} from '../prompt/Powerlevel10kConfigurator.js';
import {shortDiff} from '../dotfiles/plan.js';
import {fileFacts, OH_MY_ZSH_INSTALL, previousZshrc, type FileFacts} from './frameworks.js';

/**
 * Oh My Zsh's two special views in /tools.
 *
 * Guided install: NMSh never downloads or runs the installer (it never runs
 * install scripts). It fingerprints and backs up .zshrc, shows the official
 * source and the exact documented settings that keep .zshrc and the login
 * shell untouched, and afterwards verifies what changed. An unexpected
 * .zshrc change is reported prominently; nothing is restored silently.
 *
 * Previous zshrc: compares .zshrc with the installer's .zshrc.pre-oh-my-zsh.
 * Restoring is a separate confirmation (default No) that first backs up the
 * current file and then replaces it atomically. Shell code is never merged,
 * sourced or parsed.
 */

export interface ZshrcSnapshot {path: string; sha256?: string; backup?: string; error?: string}

export type OhMyZshView =
  | {kind: 'guided'; env: NodeJS.ProcessEnv; snapshot?: ZshrcSnapshot; verified?: string[]; unexpected?: boolean}
  | {kind: 'previous'; env: NodeJS.ProcessEnv; current: FileFacts; previous: FileFacts; diff: string[]; confirm?: ConfirmState; result?: string};

const stamp = (now: Date) => now.toISOString().replace(/[:.]/gu, '-');
const hash = (content: Buffer) => fingerprint(content);

export function openGuidedInstall(env: NodeJS.ProcessEnv = process.env): OhMyZshView {
  return {kind: 'guided', env};
}

/** Fingerprint and back up .zshrc (absent is recorded as absent). Never renames or edits the original. */
export function snapshotZshrc(env: NodeJS.ProcessEnv = process.env, now = new Date()): ZshrcSnapshot {
  const path = OH_MY_ZSH_INSTALL.snapshotTargets(env)[0]!;
  try {
    const info = lstatSync(path);
    if (!info.isFile()) return {path, error: `${path} is ${info.isSymbolicLink() ? 'a symlink' : 'not a regular file'}; NMSh records nothing and makes no backup. Back it up yourself before installing.`};
    const content = readFileSync(path);
    const backup = `${path}.nmsh-backup-${stamp(now)}-${randomUUID()}`;
    copyFileSync(path, backup, constants.COPYFILE_EXCL);
    return {path, sha256: hash(content), backup};
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {path};
    return {path, error: error instanceof Error ? error.message : String(error)};
  }
}

/** What changed since the snapshot: installation present, .zshrc fingerprint, installer side files. */
export function verifyInstall(view: Extract<OhMyZshView, {kind: 'guided'}>): void {
  const found = OH_MY_ZSH_INSTALL.verify(view.env);
  const snapshot = view.snapshot;
  const now = snapshot ? fileFacts(snapshot.path, hash) : undefined;
  const lines = [found ? `Oh My Zsh found at ${found.path}.` : 'Oh My Zsh was not found yet (no oh-my-zsh.sh with lib/ and themes/ at $ZSH or ~/.oh-my-zsh).'];
  view.unexpected = false;
  if (snapshot && !snapshot.error) {
    const changed = (now?.sha256 ?? undefined) !== snapshot.sha256;
    view.unexpected = changed;
    lines.push(changed
      ? `UNEXPECTED: ${snapshot.path} changed although KEEP_ZSHRC=yes was requested. Your backup is ${snapshot.backup ?? '(there was no file before)'}. NMSh did not restore anything.`
      : `${snapshot.path} is unchanged.`);
  } else lines.push('No .zshrc snapshot was taken, so NMSh cannot say whether it changed.');
  for (const side of OH_MY_ZSH_INSTALL.filesAtRisk(view.env).slice(1)) {
    const facts = fileFacts(side, hash);
    if (facts.exists) lines.push(`${side} exists (${facts.bytes} bytes, ${facts.modified?.toISOString().slice(0, 16).replace('T', ' ')}).`);
  }
  view.verified = lines;
}

export function openPrevious(env: NodeJS.ProcessEnv = process.env): OhMyZshView | undefined {
  const pair = previousZshrc(env);
  if (!pair) return undefined;
  const current = fileFacts(pair.current, hash);
  const previous = fileFacts(pair.previous, hash);
  let diff: string[] = [];
  try {
    diff = shortDiff(current.exists ? readFileSync(pair.current, 'utf8') : undefined, readFileSync(pair.previous, 'utf8'));
  } catch { diff = ['(not readable as text)']; }
  return {kind: 'previous', env, current, previous, diff};
}

/** Back up the current .zshrc, then atomically replace it with the previous file. Refuses if either changed since review. */
export function restorePrevious(view: Extract<OhMyZshView, {kind: 'previous'}>, now = new Date()): string {
  const current = fileFacts(view.current.path, hash);
  const previous = fileFacts(view.previous.path, hash);
  if (current.sha256 !== view.current.sha256 || previous.sha256 !== view.previous.sha256) return 'A file changed since review; nothing was written. Reopen to review again.';
  if (current.symlink) return `${view.current.path} is a symlink; NMSh does not replace it. Nothing was written.`;
  if (!previous.exists) return `${view.previous.path} is gone; nothing was written.`;
  let backup = '';
  if (current.exists) {
    backup = `${view.current.path}.nmsh-backup-${stamp(now)}-${randomUUID()}`;
    copyFileSync(view.current.path, backup, constants.COPYFILE_EXCL);
  }
  const staged = join(dirname(view.current.path), `.zshrc.nmsh-${process.pid}.tmp`);
  writeFileSync(staged, readFileSync(view.previous.path), {mode: 0o644, flag: 'wx'});
  renameSync(staged, view.current.path);
  return `Restored ${view.previous.path} to ${view.current.path}.${backup ? ` The replaced file is backed up at ${backup}.` : ''} ${view.previous.path} was left in place. New Zsh sessions use it; NMSh did not merge anything.`;
}

/** Returns 'back' when the view should close; 'open' with the two paths for the app to open. */
export function ohMyZshKey(view: OhMyZshView, key: Key): 'back' | {open: string[]} | undefined {
  if (view.kind === 'previous' && view.confirm) {
    const decision = handleConfirmKey(key, view.confirm);
    if (decision === 'confirm') { view.confirm = undefined; view.result = restorePrevious(view); }
    else if (decision === 'cancel') { view.confirm = undefined; view.result = 'Cancelled. Nothing was changed.'; }
    return undefined;
  }
  if (key.kind === 'escape' || key.kind === 'interrupt') return 'back';
  if (key.kind !== 'text') return undefined;
  const lower = key.value.toLowerCase();
  if (view.kind === 'guided') {
    if (lower === 'b') view.snapshot = snapshotZshrc(view.env);
    else if (lower === 'v') verifyInstall(view);
    return undefined;
  }
  if (lower === 'k') return 'back';
  if (lower === 'e') return {open: [view.current.path, view.previous.path]};
  if (lower === 'r') { view.result = undefined; view.confirm = createConfirm(); }
  return undefined;
}

const facts = (label: string, file: FileFacts) => file.exists
  ? [`${label}  ${file.path}`, `           ${file.bytes} bytes · modified ${file.modified?.toISOString().slice(0, 16).replace('T', ' ')} · sha256 ${file.sha256?.slice(0, 16)}…${file.symlink ? ' · symlink' : ''}`]
  : [`${label}  ${file.path}  (missing)`];

/** Plain rows (the panel adds color and framing). */
export function renderOhMyZshView(view: OhMyZshView): {rows: string[]; footer: Array<[string, string]>} {
  if (view.kind === 'guided') {
    const adapter = OH_MY_ZSH_INSTALL;
    const rows = ['Oh My Zsh needs its official installer. NMSh will not run it for you.', '',
      'With the settings below the installer:', '  ✓ keeps your current .zshrc (KEEP_ZSHRC=yes, --keep-zshrc)', '  ✓ does not change your login shell (CHSH=no)',
      '  ✓ does not start another Zsh (RUNZSH=no, --unattended)', '  ✓ clones only the official repository (REPO/REMOTE/BRANCH pinned)', '',
      `Source  ${adapter.source}`, `Needs   ${adapter.prerequisites.join(', ')}`, '',
      'Steps (run them yourself in a terminal; inspect the file before running it):', ...adapter.steps(view.env).map((step, index) => `  ${index + 1}. ${step}`), '',
      ...adapter.recoveryHints.map(hint => `• ${hint}`), ''];
    const snapshot = view.snapshot;
    if (!snapshot) rows.push('B first: NMSh fingerprints and backs up .zshrc so it can verify afterwards.');
    else if (snapshot.error) rows.push(`Snapshot: ${snapshot.error}`);
    else rows.push(snapshot.sha256 ? `Snapshot: ${snapshot.path} sha256 ${snapshot.sha256.slice(0, 16)}… · backup ${snapshot.backup}` : `Snapshot: ${snapshot.path} does not exist yet (recorded as absent).`);
    if (view.verified) rows.push('', ...(view.unexpected ? ['! ' + view.verified[1]!] : []), ...view.verified.filter((_, index) => !(view.unexpected && index === 1)));
    return {rows, footer: [['B', 'back up .zshrc'], ['V', 'verify after installing'], ['Esc', 'back']]};
  }
  const rows = ['Previous zshrc found. This does not mean anything is wrong: the Oh My Zsh installer saves the old file there.', '',
    ...facts('Current ', view.current), ...facts('Previous', view.previous), '', 'Changes (current → previous, first lines):', ...view.diff.map(line => `  ${line}`), '',
    'Shell code is not merged or sourced by NMSh. Edit by hand if you want parts of both.'];
  if (view.confirm) {
    rows.push('', `Restore previous: ${view.current.path} is backed up, then replaced by ${view.previous.path}. ${view.previous.path} stays.`, renderConfirm(view.confirm, {focused: true}));
    return {rows, footer: [['←→', 'choose'], ['Enter', 'confirm'], ['Esc', 'cancel']]};
  }
  if (view.result) rows.push('', view.result);
  return {rows, footer: [['E', 'open both'], ['K', 'keep current'], ['R', 'restore previous…'], ['Esc', 'back']]};
}
