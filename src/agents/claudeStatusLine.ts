import {mkdirSync, readFileSync, renameSync, rmSync, writeFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {dirname, isAbsolute, join} from 'node:path';
import {applyPlan, inspectFile, planCreate, planJsonSet, planReplace, sha256, type FileEditPlan} from '../ask/fileEdit.js';
import {nmshConfigDirectory} from '../configuration/paths.js';
import {posixQuote} from '../shell/adapters/ShellAdapter.js';

/**
 * Explicit, reviewed activation of NMSh's Claude Code status-line bridge.
 *
 * Claude Code runs a `statusLine` command from its settings and passes its
 * session state as JSON on stdin. Setting that command to `nmsh agent-status
 * claude` is the only change NMSh makes, and only after the person sees the
 * exact diff: the edit adds one key with a minimal span edit (the rest of the
 * file is untouched), refuses if the file changed since it was shown, and is
 * recorded so removal deletes exactly what NMSh added. A status line the
 * person already configured is never replaced: it is reported as a conflict.
 */

export interface StatusLineValue {type: 'command'; command: string; padding: number}

export type ClaudeBridgeState =
  | {state: 'configured'; settingsPath: string}
  | {state: 'not-configured'; settingsPath: string; missingFile: boolean}
  | {state: 'conflict'; settingsPath: string; command: string}
  | {state: 'unreadable'; settingsPath: string; reason: string};

interface OwnershipRecord {settingsPath: string; command: string; inserted: string; created: boolean; resultSha256: string; appliedAt: string}

export function claudeConfigDirectory(env: NodeJS.ProcessEnv = process.env): string {
  return env.CLAUDE_CONFIG_DIR && isAbsolute(env.CLAUDE_CONFIG_DIR) ? env.CLAUDE_CONFIG_DIR : join(env.HOME && isAbsolute(env.HOME) ? env.HOME : homedir(), '.claude');
}

export function claudeSettingsPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(claudeConfigDirectory(env), 'settings.json');
}

/** The command Claude Code runs; the launcher path is quoted data, never interpolated shell text. */
export function bridgeCommand(launcher: string): string {
  return `${posixQuote(launcher)} agent-status claude`;
}

export function statusLineValue(launcher: string): StatusLineValue {
  return {type: 'command', command: bridgeCommand(launcher), padding: 0};
}

function ownershipPath(env: NodeJS.ProcessEnv): string {
  return join(nmshConfigDirectory(env), 'agent-context', 'claude-status-line.json');
}

function readOwnership(env: NodeJS.ProcessEnv): OwnershipRecord | undefined {
  try {
    const value = JSON.parse(readFileSync(ownershipPath(env), 'utf8')) as Partial<OwnershipRecord>;
    return typeof value.settingsPath === 'string' && typeof value.command === 'string' && typeof value.inserted === 'string' && typeof value.created === 'boolean'
      && typeof value.resultSha256 === 'string' ? value as OwnershipRecord : undefined;
  } catch { return undefined; }
}

function writeOwnership(env: NodeJS.ProcessEnv, record: OwnershipRecord | undefined): void {
  const path = ownershipPath(env);
  if (!record) { rmSync(path, {force: true}); return; }
  mkdirSync(dirname(path), {recursive: true, mode: 0o700});
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(record, null, 2)}\n`, {mode: 0o600});
  renameSync(temporary, path);
}

const allowedRoots = (env: NodeJS.ProcessEnv) => [env.HOME && isAbsolute(env.HOME) ? env.HOME : homedir(), claudeConfigDirectory(env)];

function currentStatusLine(text: string): {ok: true; value: unknown} | {ok: false; reason: string} {
  try {
    const data = JSON.parse(text) as unknown;
    if (typeof data !== 'object' || data === null || Array.isArray(data)) return {ok: false, reason: 'its top level is not a JSON object'};
    return {ok: true, value: (data as Record<string, unknown>).statusLine};
  } catch { return {ok: false, reason: 'it is not valid JSON'}; }
}

/** Whether a statusLine value is NMSh's bridge (any NMSh launcher path). */
export function isBridgeValue(value: unknown): boolean {
  const record = value as Partial<StatusLineValue> | undefined;
  return record?.type === 'command' && typeof record.command === 'string' && / agent-status claude$/u.test(record.command) && /nmsh/u.test(record.command);
}

export function inspectClaudeBridge(env: NodeJS.ProcessEnv = process.env): ClaudeBridgeState {
  const settingsPath = claudeSettingsPath(env);
  let text: string;
  try { text = readFileSync(settingsPath, 'utf8'); } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT' ? {state: 'not-configured', settingsPath, missingFile: true}
      : {state: 'unreadable', settingsPath, reason: 'it cannot be read'};
  }
  const current = currentStatusLine(text);
  if (!current.ok) return {state: 'unreadable', settingsPath, reason: current.reason};
  if (current.value === undefined) return {state: 'not-configured', settingsPath, missingFile: false};
  if (isBridgeValue(current.value)) return {state: 'configured', settingsPath};
  const command = (current.value as {command?: unknown}).command;
  return {state: 'conflict', settingsPath, command: typeof command === 'string' ? command.slice(0, 200) : '(not a command status line)'};
}

export type BridgePlan = {plan: FileEditPlan} | {noop: string} | {refuse: string};

/** The exact edit that activates the bridge, for review. Nothing is written here. */
export function planClaudeBridge(launcher: string, env: NodeJS.ProcessEnv = process.env): BridgePlan {
  const state = inspectClaudeBridge(env);
  if (state.state === 'configured') return {noop: `Claude Code already uses the NMSh status bridge (${state.settingsPath}).`};
  if (state.state === 'conflict') return {refuse: `Claude Code already has its own status line (${state.command}) in ${state.settingsPath}. NMSh will not replace it; remove it there first if you want the NMSh bridge.`};
  if (state.state === 'unreadable') return {refuse: `${state.settingsPath} is not changed because ${state.reason}.`};
  const value = statusLineValue(launcher);
  if (state.missingFile) {
    const planned = planCreate(state.settingsPath, `${JSON.stringify({statusLine: value}, null, 2)}\n`, allowedRoots(env));
    return planned.kind === 'plan' ? {plan: {...planned.plan, reason: 'creates Claude Code user settings with the NMSh status line'}} : {refuse: planned.reason};
  }
  const planned = planJsonSet(inspectFile(state.settingsPath, allowedRoots(env)), 'json', [{path: ['statusLine'], value}]);
  if (planned.kind === 'plan') return {plan: planned.plan};
  return planned.kind === 'noop' ? {noop: planned.reason} : {refuse: planned.reason};
}

export function applyClaudeBridge(plan: FileEditPlan, launcher: string, env: NodeJS.ProcessEnv = process.env, now = new Date()): {ok: true} | {ok: false; reason: string} {
  const applied = applyPlan(plan);
  if (!applied.ok) return applied;
  const created = plan.operation === 'create';
  writeOwnership(env, {settingsPath: plan.resolvedPath, command: bridgeCommand(launcher), inserted: plan.edits[0]!.text,
    created, resultSha256: plan.resultSha256, appliedAt: now.toISOString()});
  return {ok: true};
}

/** Removal deletes exactly the text NMSh inserted, only while the status line is still NMSh's. */
export function planClaudeBridgeRemoval(env: NodeJS.ProcessEnv = process.env): BridgePlan {
  const record = readOwnership(env);
  const state = inspectClaudeBridge(env);
  if (state.state !== 'configured') return state.state === 'conflict' ? {refuse: `${state.settingsPath} now has a different status line; NMSh leaves it alone.`}
    : {noop: 'Claude Code does not use the NMSh status bridge; nothing to remove.'};
  if (!record || record.settingsPath !== inspectFile(state.settingsPath, allowedRoots(env)).resolvedPath) {
    return {refuse: `NMSh has no record of adding the status line in ${state.settingsPath}; remove the "statusLine" entry there yourself.`};
  }
  const facts = inspectFile(state.settingsPath, allowedRoots(env));
  if (record.created && facts.content !== undefined && sha256(facts.content) === record.resultSha256) {
    const planned = planReplace(facts, facts.content, '{}\n');
    return planned.kind === 'plan' ? {plan: {...planned.plan, reason: 'removes the status line NMSh added (the file NMSh created keeps an empty object)'}} : {refuse: planned.reason};
  }
  const planned = planReplace(facts, record.inserted, '');
  if (planned.kind === 'plan') return {plan: {...planned.plan, reason: 'removes exactly the status line NMSh added'}};
  return {refuse: `The status line in ${state.settingsPath} was edited since NMSh added it; remove the "statusLine" entry there yourself.`};
}

export function applyClaudeBridgeRemoval(plan: FileEditPlan, env: NodeJS.ProcessEnv = process.env): {ok: true} | {ok: false; reason: string} {
  const applied = applyPlan(plan);
  if (applied.ok) writeOwnership(env, undefined);
  return applied;
}
