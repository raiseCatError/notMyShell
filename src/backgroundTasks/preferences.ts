import {mkdirSync, readFileSync, renameSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {nmshConfigDirectory} from '../configuration/paths.js';
import type {Classification} from './detector.js';

/**
 * Background task preferences (#382). Remembered decisions are per command
 * family (`adb logcat`, `npm run dev`), never per program, so "always" for
 * `adb logcat` never covers `adb devices`. There is no global "always
 * background" mode: automatic background execution happens only for a family
 * the person explicitly set to Always, and an invocation can still be forced
 * to the foreground.
 */

export type FamilyDecision = 'always' | 'never';

export interface BackgroundPreferences {
  version: 1;
  /** Ask about recognized families, or never suggest (remembered Always decisions still apply). */
  suggestions: 'ask' | 'off';
  families: Record<string, FamilyDecision>;
  retention: {
    /** Output kept per task, in lines and bytes (whichever is reached first). */
    lines: number;
    bytes: number;
    /** Finished tasks kept in the list before the oldest are removed. */
    finishedKept: number;
  };
  /** A notice when a task ends: never, only when it fails, or always. */
  notify: 'never' | 'failure' | 'always';
  /** Show the task bar collapsed (one summary row) or expanded. */
  bar: 'collapsed' | 'expanded';
  /** Up from an idle composer focuses the task bar (like the agent shelf); off leaves Shift+Up and /background. */
  upArrow: 'idle' | 'off';
}

export const DEFAULT_PREFERENCES = (): BackgroundPreferences => ({
  version: 1, suggestions: 'ask', families: {}, retention: {lines: 5000, bytes: 2 * 1024 * 1024, finishedKept: 20}, notify: 'failure', bar: 'collapsed', upArrow: 'idle',
});

const LIMITS = {lines: [100, 100_000], bytes: [64 * 1024, 32 * 1024 * 1024], finishedKept: [0, 200]} as const;
const FAMILY = /^[a-z0-9][\w .:@/+-]{0,63}$/iu;

const clamp = (value: unknown, [low, high]: readonly [number, number], fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.max(low, Math.min(high, Math.round(value))) : fallback;

/** Any stored value to valid preferences: unknown fields dropped, numbers clamped, at most 256 family decisions. */
export function normalizePreferences(value: unknown): BackgroundPreferences {
  const defaults = DEFAULT_PREFERENCES();
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return defaults;
  const data = value as Record<string, unknown>;
  const families: Record<string, FamilyDecision> = {};
  if (typeof data.families === 'object' && data.families !== null && !Array.isArray(data.families)) {
    for (const [family, decision] of Object.entries(data.families).slice(0, 256)) {
      if (FAMILY.test(family) && (decision === 'always' || decision === 'never')) families[family] = decision;
    }
  }
  const retention = typeof data.retention === 'object' && data.retention !== null ? data.retention as Record<string, unknown> : {};
  return {
    version: 1,
    suggestions: data.suggestions === 'off' ? 'off' : 'ask',
    families,
    retention: {
      lines: clamp(retention.lines, LIMITS.lines, defaults.retention.lines),
      bytes: clamp(retention.bytes, LIMITS.bytes, defaults.retention.bytes),
      finishedKept: clamp(retention.finishedKept, LIMITS.finishedKept, defaults.retention.finishedKept),
    },
    notify: data.notify === 'never' || data.notify === 'always' ? data.notify : 'failure',
    bar: data.bar === 'expanded' ? 'expanded' : 'collapsed',
    upArrow: data.upArrow === 'off' ? 'off' : 'idle',
  };
}

export type Decision =
  | {action: 'foreground'; reason: string}
  | {action: 'suggest'; classification: Classification}
  | {action: 'background'; classification: Classification; reason: string};

/**
 * What happens when a command is submitted. Unrecognized commands, forced-foreground invocations and Never families
 * run normally; a recognized family is suggested when suggestions are on; only an explicit Always runs it in the
 * background without asking.
 */
export function decide(classification: Classification | undefined, preferences: BackgroundPreferences, override?: 'foreground'): Decision {
  if (override === 'foreground') return {action: 'foreground', reason: 'run in the foreground for this invocation'};
  if (!classification) return {action: 'foreground', reason: 'not recognized as long-running'};
  const remembered = preferences.families[classification.family];
  if (remembered === 'always') return {action: 'background', classification, reason: `you chose to always run ${classification.family} in the background`};
  if (remembered === 'never') return {action: 'foreground', reason: `you chose never to be asked about ${classification.family}`};
  return preferences.suggestions === 'ask' ? {action: 'suggest', classification} : {action: 'foreground', reason: 'suggestions are off'};
}

/** A remembered decision for one family, or undefined to forget it (back to Ask). */
export function rememberFamily(preferences: BackgroundPreferences, family: string, decision: FamilyDecision | undefined): BackgroundPreferences {
  if (!FAMILY.test(family)) return preferences;
  const families = {...preferences.families};
  if (decision) families[family] = decision; else delete families[family];
  return {...preferences, families};
}

export const preferencesPath = (env: NodeJS.ProcessEnv = process.env) => join(nmshConfigDirectory(env), 'background-tasks.json');

export function loadPreferences(env: NodeJS.ProcessEnv = process.env): BackgroundPreferences {
  try { return normalizePreferences(JSON.parse(readFileSync(preferencesPath(env), 'utf8'))); } catch { return DEFAULT_PREFERENCES(); }
}

/** Written atomically, private to the user. Command families are stored; commands, arguments and output are not. */
export function savePreferences(preferences: BackgroundPreferences, env: NodeJS.ProcessEnv = process.env): void {
  const path = preferencesPath(env);
  mkdirSync(dirname(path), {recursive: true, mode: 0o700});
  const staged = `${path}.${process.pid}.tmp`;
  writeFileSync(staged, `${JSON.stringify(normalizePreferences(preferences), null, 2)}\n`, {encoding: 'utf8', mode: 0o600});
  renameSync(staged, path);
}
