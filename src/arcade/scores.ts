import {chmodSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';

/**
 * Local arcade data: high scores, statistics and puzzles in progress, in one small JSON file next to NMSh's own
 * configuration (`<config dir>/arcade.json`). It is versioned, bounded, validated on every read, written atomically
 * (a temp file, then a rename) and owner-only. A damaged file is set aside and the arcade starts fresh; a file written
 * by a newer NMSh is left untouched and read-only. Nothing here touches the network, and a QA launcher with its own
 * `XDG_CONFIG_HOME` therefore has its own file: personal scores never mix with test sessions.
 */
export const ARCADE_FILE = 'arcade.json';
export const ARCADE_VERSION = 1;
export const MAX_FILE_BYTES = 256 * 1024;
export const MAX_GAMES = 16;
const MAX_KEYS = 64;
const MAX_DEPTH = 5;
const MAX_STRING = 8192;
const MAX_ARRAY = 4096;
const GAME_ID = /^[a-z][a-z0-9-]{0,31}$/u;
const KEY = /^[A-Za-z0-9_.-]{1,40}$/u;
const FORBIDDEN = new Set(['__proto__', 'constructor', 'prototype']);

export type RecordValue = number | string | boolean | null | RecordValue[] | {[key: string]: RecordValue};
export type GameRecord = {[key: string]: RecordValue};

/** A cleaned copy of untrusted JSON, or undefined when it is not a record of bounded plain values. */
function cleanValue(value: unknown, depth: number): RecordValue | undefined {
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'string') return value.length <= MAX_STRING ? value : undefined;
  if (depth >= MAX_DEPTH) return undefined;
  if (Array.isArray(value)) {
    if (value.length > MAX_ARRAY) return undefined;
    const items: RecordValue[] = [];
    for (const item of value) { const clean = cleanValue(item, depth + 1); if (clean === undefined) return undefined; items.push(clean); }
    return items;
  }
  if (typeof value === 'object') {
    const keys = Object.keys(value as object);
    if (keys.length > MAX_KEYS) return undefined;
    const out: {[key: string]: RecordValue} = {};
    for (const key of keys) {
      if (!KEY.test(key) || FORBIDDEN.has(key)) return undefined;
      const clean = cleanValue((value as Record<string, unknown>)[key], depth + 1);
      if (clean === undefined) return undefined;
      out[key] = clean;
    }
    return out;
  }
  return undefined;
}

export function cleanRecord(value: unknown): GameRecord | undefined {
  const clean = cleanValue(value, 0);
  return clean !== null && typeof clean === 'object' && !Array.isArray(clean) ? clean : undefined;
}

/** What a game sees of its own record: read a copy, write back a whole record or a patch. */
export interface GameRecordHandle {
  get(): GameRecord;
  /** Replace the record (invalid values are refused and the old record stays). */
  set(record: GameRecord): boolean;
  /** Change a copy with `change` and save it if it is still valid. */
  update(change: (record: GameRecord) => void): boolean;
}

export interface ArcadeStoreOptions {
  /** NMSh's configuration directory. */
  directory: string;
  now?: () => number;
}

export class ArcadeStore {
  private games = new Map<string, GameRecord>();
  private dirty = false;
  private loaded = false;
  private notice: string | undefined;
  private readOnly = false;
  private readonly path: string;
  private readonly now: () => number;

  constructor(private readonly options: ArcadeStoreOptions) {
    this.path = join(options.directory, ARCADE_FILE);
    this.now = options.now ?? Date.now;
  }

  /** Why the last load started fresh or read-only, for one quiet note in the hub. */
  get recovered(): string | undefined { return this.notice; }
  get writable(): boolean { return !this.readOnly; }

  load(): void {
    this.loaded = true;
    this.games = new Map();
    if (!existsSync(this.path)) return;
    let text: string;
    try {
      const size = statSync(this.path).size;
      if (size > MAX_FILE_BYTES) return this.setAside('it was larger than the arcade allows');
      text = readFileSync(this.path, 'utf8');
    } catch { return this.setAside('it could not be read'); }
    let parsed: unknown;
    try { parsed = JSON.parse(text); } catch { return this.setAside('it was not valid JSON'); }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return this.setAside('it was not an arcade file');
    const version = (parsed as {version?: unknown}).version;
    if (typeof version === 'number' && version > ARCADE_VERSION) {
      this.readOnly = true;
      this.notice = 'Arcade data was saved by a newer NMSh; scores are shown but not changed.';
      return;
    }
    if (version !== ARCADE_VERSION) return this.setAside('its version is unknown');
    const games = (parsed as {games?: unknown}).games;
    if (typeof games !== 'object' || games === null || Array.isArray(games)) return this.setAside('it had no games');
    for (const [id, value] of Object.entries(games as Record<string, unknown>).slice(0, MAX_GAMES)) {
      if (!GAME_ID.test(id) || FORBIDDEN.has(id)) continue;
      const clean = cleanRecord(value);
      if (clean) this.games.set(id, clean);
    }
  }

  private setAside(why: string): void {
    this.notice = `Arcade data was unreadable (${why}) and was set aside; scores start fresh.`;
    try { renameSync(this.path, `${this.path}.corrupt-${this.now()}`); } catch { /* leave it; the next save replaces it */ }
  }

  /** The record handle for a game; loads the file on first use. */
  record(gameId: string): GameRecordHandle {
    if (!GAME_ID.test(gameId) || FORBIDDEN.has(gameId)) throw new RangeError('invalid game id');
    if (!this.loaded) this.load();
    return {
      get: () => structuredClone(this.games.get(gameId) ?? {}),
      set: record => this.write(gameId, record),
      update: change => {
        const copy = structuredClone(this.games.get(gameId) ?? {});
        change(copy);
        return this.write(gameId, copy);
      },
    };
  }

  private write(gameId: string, record: GameRecord): boolean {
    if (this.readOnly) return false;
    const clean = cleanRecord(record);
    if (!clean) return false;
    if (!this.games.has(gameId) && this.games.size >= MAX_GAMES) return false;
    const next = new Map(this.games).set(gameId, clean);
    if (Buffer.byteLength(JSON.stringify(this.serialize(next))) > MAX_FILE_BYTES) return false;
    this.games = next;
    this.dirty = true;
    return true;
  }

  private serialize(games: Map<string, GameRecord>): {version: number; games: Record<string, GameRecord>} {
    return {version: ARCADE_VERSION, games: Object.fromEntries(games)};
  }

  /** Write pending changes: temp file, then rename, owner-only. Failure leaves the old file and keeps the data in memory. */
  flush(): boolean {
    if (!this.dirty || this.readOnly) return true;
    try {
      mkdirSync(this.options.directory, {recursive: true, mode: 0o700});
      const temp = `${this.path}.${process.pid}.tmp`;
      writeFileSync(temp, JSON.stringify(this.serialize(this.games)), {mode: 0o600});
      renameSync(temp, this.path);
      try { chmodSync(this.path, 0o600); } catch { /* best effort */ }
      this.dirty = false;
      return true;
    } catch { return false; }
  }
}
