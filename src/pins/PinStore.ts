import {closeSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, writeFileSync, writeSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {dirname, join} from 'node:path';
import {nmshConfigDirectory} from '../configuration/paths.js';
import {scanSensitive} from '../clipboard/report.js';

/**
 * Pins and recipes: commands the person chose to keep, in one file they can read (`pins.json`, next to config.json).
 *
 * - Written only by an explicit save, rename, scope change or delete. Nothing is pinned by itself, and command
 *   output, clipboard text and history are never stored here.
 * - A command that looks like it contains a secret is refused, not stored: use a {{placeholder}} for the secret part.
 * - Every change re-reads the file under a lock and replaces it with one atomic rename, so two NMSh windows cannot
 *   overwrite each other's saves, and a crash leaves the old file or the new one, never half of one.
 * - A file this version cannot read is reported and left alone, never replaced.
 */
export type PinScope = 'global' | 'directory';

export interface Pin {
  id: string;
  command: string;
  /** Optional human name; empty when the person gave none. */
  name: string;
  scope: PinScope;
  /** The directory the command was pinned from; `directory` pins show first there. */
  cwd?: string;
  createdAt: number;
}

export interface Recipe {
  id: string;
  name: string;
  description: string;
  /** Commands in order; each runs as one queue entry. `{{name}}` marks a value asked for when the recipe is used. */
  steps: string[];
  scope: PinScope;
  cwd?: string;
  createdAt: number;
}

export interface PinData {
  version: 1;
  pins: Pin[];
  recipes: Recipe[];
}

export const MAX_PINS = 500;
export const MAX_RECIPES = 200;
export const MAX_STEPS = 100;
export const MAX_COMMAND_LENGTH = 64 * 1024;
export const MAX_NAME_LENGTH = 80;

export const pinsPath = (env: NodeJS.ProcessEnv = process.env): string => join(nmshConfigDirectory(env), 'pins.json');

export type PinResult<T> = {ok: true; value: T} | {ok: false; reason: string};
const failure = (reason: string): {ok: false; reason: string} => ({ok: false, reason});

/** One line of plain text for a name: controls, format and bidi characters removed, spaces collapsed, bounded. */
export function cleanName(text: string): string {
  return text.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, ' ').replace(/\s+/gu, ' ').trim().slice(0, MAX_NAME_LENGTH);
}

/** Why a command cannot be kept (a secret in it, or a size), or undefined when it can. */
export function keepProblem(command: string): string | undefined {
  if (!command.trim()) return 'There is nothing to keep.';
  if (command.length > MAX_COMMAND_LENGTH) return 'That command is too long to keep.';
  const secrets = scanSensitive(command).filter(item => item.kind === 'token' || item.kind === 'credential' || item.kind === 'private key');
  if (secrets.length) return 'That command looks like it contains a secret, so it was not saved. Use a {{placeholder}} for the secret part.';
  return undefined;
}

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const scopeOf = (value: unknown): PinScope => value === 'directory' ? 'directory' : 'global';
const absolute = (value: unknown): string | undefined => typeof value === 'string' && value.startsWith('/') && value.length < 4096 && !/[\p{Cc}]/u.test(value) ? value : undefined;

function parsePin(raw: unknown): Pin | undefined {
  if (!isRecord(raw) || typeof raw.id !== 'string' || !/^[\w-]{1,40}$/u.test(raw.id) || typeof raw.command !== 'string' || keepProblem(raw.command) === 'There is nothing to keep.' || raw.command.length > MAX_COMMAND_LENGTH) return undefined;
  const cwd = absolute(raw.cwd);
  const scope = scopeOf(raw.scope);
  return {id: raw.id, command: raw.command, name: typeof raw.name === 'string' ? cleanName(raw.name) : '', scope: scope === 'directory' && !cwd ? 'global' : scope, ...(cwd ? {cwd} : {}),
    createdAt: Number.isSafeInteger(raw.createdAt) ? raw.createdAt as number : 0};
}

function parseRecipe(raw: unknown): Recipe | undefined {
  if (!isRecord(raw) || typeof raw.id !== 'string' || !/^[\w-]{1,40}$/u.test(raw.id) || !Array.isArray(raw.steps) || !raw.steps.length || raw.steps.length > MAX_STEPS) return undefined;
  const steps = raw.steps.filter((step): step is string => typeof step === 'string' && step.trim() !== '' && step.length <= MAX_COMMAND_LENGTH);
  const name = typeof raw.name === 'string' ? cleanName(raw.name) : '';
  if (steps.length !== raw.steps.length || !name) return undefined;
  const cwd = absolute(raw.cwd);
  const scope = scopeOf(raw.scope);
  return {id: raw.id, name, description: typeof raw.description === 'string' ? cleanName(raw.description) : '', steps, scope: scope === 'directory' && !cwd ? 'global' : scope, ...(cwd ? {cwd} : {}),
    createdAt: Number.isSafeInteger(raw.createdAt) ? raw.createdAt as number : 0};
}

/** The stored data, or why it cannot be used. A missing file is simply empty. */
export function loadPins(path = pinsPath()): PinResult<PinData> {
  let text: string;
  try { text = readFileSync(path, 'utf8'); }
  catch (error) { return (error as NodeJS.ErrnoException).code === 'ENOENT' ? {ok: true, value: {version: 1, pins: [], recipes: []}} : failure(`Could not read ${path}.`); }
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return failure(`${path} is not valid JSON, so it was left alone.`); }
  if (!isRecord(raw) || raw.version !== 1) return failure(`${path} is from a different version, so it was left alone.`);
  const pins = (Array.isArray(raw.pins) ? raw.pins : []).map(parsePin).filter((pin): pin is Pin => Boolean(pin)).slice(0, MAX_PINS);
  const recipes = (Array.isArray(raw.recipes) ? raw.recipes : []).map(parseRecipe).filter((recipe): recipe is Recipe => Boolean(recipe)).slice(0, MAX_RECIPES);
  return {ok: true, value: {version: 1, pins, recipes}};
}

const LOCK_STALE_MS = 10_000;

function withLock<T>(path: string, work: () => T): T {
  const lock = `${path}.lock`;
  const deadline = Date.now() + 3000;
  for (;;) {
    try { const handle = openSync(lock, 'wx', 0o600); writeSync(handle, String(process.pid)); closeSync(handle); break; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      try { if (Date.now() - statSync(lock).mtimeMs > LOCK_STALE_MS) rmSync(lock, {force: true}); } catch { /* released meanwhile */ }
      if (Date.now() > deadline) throw new Error('pins.json is being changed by another NMSh window; try again.');
      const until = Date.now() + 20;
      while (Date.now() < until) { /* brief wait; the lock is held for a few milliseconds */ }
    }
  }
  try { return work(); } finally { rmSync(lock, {force: true}); }
}

/**
 * Apply a change to the stored data and save it atomically. `change` receives the freshly re-read data and returns
 * the new data, or a reason to refuse (nothing is written then).
 */
export function updatePins<T>(change: (data: PinData) => PinResult<{data: PinData; value: T}>, path = pinsPath()): PinResult<T> {
  try {
    mkdirSync(dirname(path), {recursive: true, mode: 0o700});
    return withLock(path, () => {
      const loaded = loadPins(path);
      if (!loaded.ok) return loaded;
      const changed = change(structuredClone(loaded.value));
      if (!changed.ok) return changed;
      const temporary = `${path}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
      try {
        writeFileSync(temporary, `${JSON.stringify(changed.value.data, null, 2)}\n`, {mode: 0o600});
        renameSync(temporary, path);
      } catch (error) { rmSync(temporary, {force: true}); throw error; }
      return {ok: true, value: changed.value.value};
    });
  } catch (error) { return failure(error instanceof Error ? error.message : String(error)); }
}

const newId = (prefix: string) => `${prefix}${Date.now().toString(36)}${randomBytes(3).toString('hex')}`;

export function addPin(input: {command: string; name?: string; scope?: PinScope; cwd?: string}, path = pinsPath(), now = Date.now()): PinResult<Pin> {
  const problem = keepProblem(input.command);
  if (problem) return failure(problem);
  return updatePins<Pin>(data => {
    if (data.pins.length >= MAX_PINS) return failure(`NMSh keeps at most ${MAX_PINS} pins; remove one first.`);
    const existing = data.pins.find(pin => pin.command === input.command && pin.scope === (input.scope ?? 'global') && (pin.scope === 'global' || pin.cwd === input.cwd));
    if (existing) return failure('That command is already pinned.');
    const cwd = absolute(input.cwd);
    const scope = input.scope === 'directory' && cwd ? 'directory' : 'global';
    const pin: Pin = {id: newId('p'), command: input.command, name: cleanName(input.name ?? ''), scope, ...(cwd ? {cwd} : {}), createdAt: now};
    return {ok: true, value: {data: {...data, pins: [pin, ...data.pins]}, value: pin}};
  }, path);
}

export function addRecipe(input: {name: string; description?: string; steps: readonly string[]; scope?: PinScope; cwd?: string}, path = pinsPath(), now = Date.now()): PinResult<Recipe> {
  const name = cleanName(input.name);
  if (!name) return failure('A recipe needs a name.');
  if (!input.steps.length) return failure('A recipe needs at least one command.');
  if (input.steps.length > MAX_STEPS) return failure(`A recipe holds at most ${MAX_STEPS} commands.`);
  for (const step of input.steps) { const problem = keepProblem(step); if (problem) return failure(problem); }
  return updatePins<Recipe>(data => {
    if (data.recipes.length >= MAX_RECIPES) return failure(`NMSh keeps at most ${MAX_RECIPES} recipes; remove one first.`);
    if (data.recipes.some(recipe => recipe.name.toLowerCase() === name.toLowerCase())) return failure(`A recipe named "${name}" already exists.`);
    const cwd = absolute(input.cwd);
    const scope = input.scope === 'directory' && cwd ? 'directory' : 'global';
    const recipe: Recipe = {id: newId('r'), name, description: cleanName(input.description ?? ''), steps: [...input.steps], scope, ...(cwd ? {cwd} : {}), createdAt: now};
    return {ok: true, value: {data: {...data, recipes: [recipe, ...data.recipes]}, value: recipe}};
  }, path);
}

export type PinChange = {name: string} | {scope: PinScope} | {steps: readonly string[]};

/** Rename, change scope, or (recipes) replace the steps of the pin or recipe with this id. */
export function changeItem(id: string, change: PinChange, path = pinsPath()): PinResult<true> {
  return updatePins<true>(data => {
    const pin = data.pins.find(item => item.id === id);
    const recipe = data.recipes.find(item => item.id === id);
    const item = pin ?? recipe;
    if (!item) return failure('That item no longer exists.');
    if ('name' in change) {
      const name = cleanName(change.name);
      if (recipe && !name) return failure('A recipe needs a name.');
      if (recipe && data.recipes.some(other => other.id !== id && other.name.toLowerCase() === name.toLowerCase())) return failure(`A recipe named "${name}" already exists.`);
      item.name = name;
    } else if ('scope' in change) {
      if (change.scope === 'directory' && !item.cwd) return failure('It was not pinned from a directory, so it can only be global.');
      item.scope = change.scope;
    } else {
      if (!recipe) return failure('Only a recipe has steps.');
      if (!change.steps.length || change.steps.length > MAX_STEPS) return failure(`A recipe holds 1 to ${MAX_STEPS} commands.`);
      for (const step of change.steps) { const problem = keepProblem(step); if (problem) return failure(problem); }
      recipe.steps = [...change.steps];
    }
    return {ok: true, value: {data, value: true as const}};
  }, path);
}

export function removeItem(id: string, path = pinsPath()): PinResult<true> {
  return updatePins<true>(data => {
    const pins = data.pins.filter(item => item.id !== id);
    const recipes = data.recipes.filter(item => item.id !== id);
    if (pins.length === data.pins.length && recipes.length === data.recipes.length) return failure('That item no longer exists.');
    return {ok: true, value: {data: {...data, pins, recipes}, value: true as const}};
  }, path);
}

/** A directory item applies in its own directory and inside it; a global one applies everywhere. */
export const applies = (item: {scope: PinScope; cwd?: string}, cwd: string): boolean =>
  item.scope === 'global' || (item.cwd !== undefined && (cwd === item.cwd || cwd.startsWith(`${item.cwd.replace(/\/+$/u, '')}/`)));

/** What to show in a directory: the items that apply there (this directory's own first), newest first within each; `all` shows every item. */
export function inScope<T extends {scope: PinScope; cwd?: string; createdAt: number}>(items: readonly T[], cwd: string, all = false): T[] {
  const here = (item: T) => item.scope === 'directory' && item.cwd !== undefined && applies(item, cwd);
  return items.filter(item => all || applies(item, cwd)).sort((a, b) => Number(here(b)) - Number(here(a)) || b.createdAt - a.createdAt);
}
