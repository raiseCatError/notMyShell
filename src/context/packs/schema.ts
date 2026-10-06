import {createHash} from 'node:crypto';
import type {CapabilityDefinition} from '../capability.js';

/**
 * Context Pack format, version 1: installable DATA describing native modules.
 *
 * A pack names trusted core capabilities and describes how their declared
 * fields are presented: literal labels, a fixed set of formatters, core icon
 * ids, semantic roles, surfaces, show-on-command words and priority. It cannot
 * contain or reference code, shell text, commands, argv, executable or file
 * paths, URLs evaluated at runtime, templates, includes or hooks, and it gains
 * no authority by being installed. Parsing is bounded (size, depth, counts,
 * string lengths) and strict: an unknown key is an error, never ignored, so a
 * future executable field can never be silently accepted by an older NMSh.
 * A pack that needs capabilities this NMSh does not implement is reported as
 * unsupported, not partially activated.
 */

export const PACK_SCHEMA = 'nmsh.context-pack/v1';
export const CONTEXT_API_VERSION = 1;
export const MAX_PACK_BYTES = 64 * 1024;

export const MODULE_CATEGORIES = ['identity', 'vcs', 'session', 'tooling', 'context', 'project', 'runtime', 'environment', 'infrastructure', 'cloud', 'system', 'agent'] as const;
export type ModuleCategory = typeof MODULE_CATEGORIES[number];

/** Semantic role names a pack may use; core maps them onto theme roles (see modules.ts). */
export const PACK_ROLES = ['identity', 'location', 'vcs', 'javascript', 'python', 'go', 'runtime', 'container', 'context', 'system', 'agent', 'success', 'failure',
  'project', 'cwd', 'gitBranch', 'node', 'docker', 'kubernetes'] as const;
export type PackRole = typeof PACK_ROLES[number];

export const PACK_FORMATS = ['text', 'version', 'percent', 'count', 'tokens', 'duration', 'since', 'ago', 'until', 'clock', 'basename', 'toolchain', 'upper', 'lower', 'title'] as const;
export type PackFormat = typeof PACK_FORMATS[number];

export const PACK_CONDITIONS = ['always', 'onCommand', 'inRepository'] as const;
export type PackCondition = typeof PACK_CONDITIONS[number];
export const PACK_SURFACES = ['mainPrompt', 'rightContext', 'contextRail', 'statusStrip'] as const;
export type PackSurface = typeof PACK_SURFACES[number];

export interface PackPart {
  /** Literal text (bounded, printable). */
  text?: string;
  fact?: string;
  field?: string;
  format?: PackFormat;
  prefix?: string;
  suffix?: string;
  /** Like prefix, but only when an earlier part of the segment rendered (a " · " separator). */
  join?: string;
  /** A missing fact field skips this part instead of the whole segment. */
  optional?: boolean;
  /**
   * Show only when a field (this part's own, or another field of the same or
   * another declared fact) is present/absent, equals or differs from a literal.
   */
  when?: PackWhen;
  /** Time values: show only when at least this old (stale disclosure) / still in the future (reset windows). */
  minAgeMs?: number;
  /** Hide this part once the named epoch-milliseconds field of the same fact has passed (a rate-limit window that reset). */
  until?: string;
  maxCells?: number;
}

export interface PackSegment {
  parts: PackPart[];
  role?: PackRole;
  /** Core icon id; `false` suppresses the module icon for this segment. */
  icon?: string | false;
  /** Shown instead of an icon in Safe glyph mode or with icons off, so text stays self-describing. */
  label?: string;
  /** Switch to the failure role at a threshold: a nearly full context window, a low battery, expired credentials. */
  emphasis?: {fact: string; field: string; atLeast?: number; atMost?: number; past?: boolean};
}

export interface PackWhen {
  fact?: string;
  field?: string;
  equals?: string | number | boolean;
  notEquals?: string | number | boolean;
  present?: boolean;
}

export interface PackModule {
  id: string;
  label: string;
  description: string;
  category: ModuleCategory;
  priority: number;
  role: PackRole;
  icon?: string;
  condition: PackCondition;
  triggers?: string[];
  surfaces?: {preferred: PackSurface; supported?: PackSurface[]};
  /** How a stale fact presents: shown as last known (default), or hidden. */
  stale?: 'show' | 'hide';
  segments: PackSegment[];
}

export type PackEvidence =
  | {kind: 'workspaceFile'; names: string[]}
  | {kind: 'workspaceExtension'; extensions: string[]}
  | {kind: 'executable'; names: string[]}
  | {kind: 'fact'; fact: string};

export interface PackRecommendation {module: string; evidence: PackEvidence[]}

export interface ContextPack {
  schema: typeof PACK_SCHEMA;
  id: string;
  version: string;
  name: string;
  description: string;
  license: string;
  provenance: {author: string; source?: string; notes?: string};
  compatibility: {contextApi: number; nmsh?: string};
  requires: string[];
  modules: PackModule[];
  recommend?: PackRecommendation[];
}

export interface ParsedPack {
  pack: ContextPack;
  /** sha256 of the exact manifest bytes. */
  sha256: string;
  bytes: number;
}

export type PackProblem = {kind: 'invalid'; message: string} | {kind: 'unsupported'; message: string; missing?: string[]};

const PACK_ID = /^[a-z][a-z0-9-]{0,31}(?:\.[a-z][a-z0-9-]{0,31}){1,3}$/u;
const MODULE_ID = /^[a-z][a-z0-9-]{0,31}$/u;
const SEMVER = /^(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})(?:-[0-9A-Za-z.-]{1,32})?$/u;
const WORD = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,31}$/u;
const FILE_NAME = /^(?!\.{1,2}$)[A-Za-z0-9._@+-]{1,64}$/u;
const SPDX = /^[A-Za-z0-9.+-]{1,64}(?: (?:AND|OR|WITH) [A-Za-z0-9.+-]{1,64}){0,7}$/u;
const UNPRINTABLE = /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028-\u202e\u2066-\u2069\ufff9-\ufffb]/u;
const ICON_ID = /^[a-z][a-zA-Z0-9]{0,31}$/u;
const NMSH_RANGE = /^(?:(?:>=|<=|>|<|=)?\d{1,4}\.\d{1,4}\.\d{1,4})(?: (?:>=|<=|>|<|=)?\d{1,4}\.\d{1,4}\.\d{1,4}){0,1}$/u;

class Invalid extends Error {}

function fail(path: string, message: string): never { throw new Invalid(`${path}: ${message}`); }

function obj(value: unknown, path: string, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) fail(path, 'must be an object');
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) if (!required.includes(key) && !optional.includes(key)) fail(`${path}.${key}`, 'is not part of the pack format');
  for (const key of required) if (!(key in record)) fail(`${path}.${key}`, 'is required');
  return record;
}

function str(value: unknown, path: string, max: number, pattern?: RegExp): string {
  if (typeof value !== 'string' || !value.length || value.length > max) fail(path, `must be a string of 1-${max} characters`);
  if (UNPRINTABLE.test(value)) fail(path, 'contains control or bidirectional formatting characters');
  if (pattern && !pattern.test(value)) fail(path, 'has an invalid format');
  return value;
}

function list<T>(value: unknown, path: string, max: number, item: (entry: unknown, path: string) => T, min = 0): T[] {
  if (!Array.isArray(value) || value.length < min || value.length > max) fail(path, `must be a list of ${min}-${max} entries`);
  return value.map((entry, index) => item(entry, `${path}[${index}]`));
}

function oneOf<T extends string>(value: unknown, path: string, options: readonly T[]): T {
  if (typeof value !== 'string' || !options.includes(value as T)) fail(path, `must be one of ${options.join(', ')}`);
  return value as T;
}

function bounded(value: unknown, path: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) fail(path, `must be an integer ${min}-${max}`);
  return value;
}

function literal(value: unknown, path: string): string | number | boolean {
  if (typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) return value;
  return str(value, path, 64);
}

function part(value: unknown, path: string): PackPart {
  const record = obj(value, path, [], ['text', 'fact', 'field', 'format', 'prefix', 'suffix', 'join', 'optional', 'when', 'minAgeMs', 'until', 'maxCells']);
  const result: PackPart = {};
  if (record.text !== undefined) result.text = str(record.text, `${path}.text`, 32);
  if (record.fact !== undefined || record.field !== undefined) {
    result.fact = str(record.fact, `${path}.fact`, 64, /^[a-z][a-zA-Z0-9]*(?:\.[a-z][a-zA-Z0-9]*){1,3}$/u);
    result.field = str(record.field, `${path}.field`, 48, /^[A-Za-z][A-Za-z0-9]{0,47}$/u);
  }
  if ((result.text === undefined) === (result.fact === undefined)) fail(path, 'needs exactly one of text or fact/field');
  if (record.format !== undefined) result.format = oneOf(record.format, `${path}.format`, PACK_FORMATS);
  if (record.prefix !== undefined) result.prefix = str(record.prefix, `${path}.prefix`, 16);
  if (record.suffix !== undefined) result.suffix = str(record.suffix, `${path}.suffix`, 16);
  if (record.join !== undefined) result.join = str(record.join, `${path}.join`, 8);
  if (record.optional !== undefined) { if (typeof record.optional !== 'boolean') fail(`${path}.optional`, 'must be true or false'); result.optional = record.optional; }
  if (record.when !== undefined) {
    const when = obj(record.when, `${path}.when`, [], ['fact', 'field', 'equals', 'notEquals', 'present']);
    const condition: PackWhen = {};
    if (when.fact !== undefined) condition.fact = str(when.fact, `${path}.when.fact`, 64, /^[a-z][a-zA-Z0-9]*(?:\.[a-z][a-zA-Z0-9]*){1,3}$/u);
    if (when.field !== undefined) condition.field = str(when.field, `${path}.when.field`, 48, /^[A-Za-z][A-Za-z0-9]{0,47}$/u);
    if (when.equals !== undefined) condition.equals = literal(when.equals, `${path}.when.equals`);
    if (when.notEquals !== undefined) condition.notEquals = literal(when.notEquals, `${path}.when.notEquals`);
    if (when.present !== undefined) { if (typeof when.present !== 'boolean') fail(`${path}.when.present`, 'must be true or false'); condition.present = when.present; }
    if (!result.fact && !(condition.fact && condition.field)) fail(`${path}.when`, 'a literal part must name the fact and field it depends on');
    if (Object.keys(condition).filter(key => key !== 'fact' && key !== 'field').length !== 1) fail(`${path}.when`, 'needs exactly one of equals, notEquals or present');
    result.when = condition;
  }
  if (record.minAgeMs !== undefined) result.minAgeMs = bounded(record.minAgeMs, `${path}.minAgeMs`, 0, 30 * 86_400_000);
  if (record.until !== undefined) result.until = str(record.until, `${path}.until`, 48, /^[A-Za-z][A-Za-z0-9]{0,47}$/u);
  if (record.maxCells !== undefined) result.maxCells = bounded(record.maxCells, `${path}.maxCells`, 1, 48);
  return result;
}

function segment(value: unknown, path: string): PackSegment {
  const record = obj(value, path, ['parts'], ['role', 'icon', 'label', 'emphasis']);
  const result: PackSegment = {parts: list(record.parts, `${path}.parts`, 8, part, 1)};
  if (record.role !== undefined) result.role = oneOf(record.role, `${path}.role`, PACK_ROLES);
  if (record.icon !== undefined) result.icon = record.icon === false ? false : str(record.icon, `${path}.icon`, 32, ICON_ID);
  if (record.label !== undefined) result.label = str(record.label, `${path}.label`, 12);
  if (record.emphasis !== undefined) {
    const emphasis = obj(record.emphasis, `${path}.emphasis`, ['fact', 'field'], ['atLeast', 'atMost', 'past']);
    const thresholds = ['atLeast', 'atMost', 'past'].filter(key => emphasis[key] !== undefined);
    if (thresholds.length !== 1) fail(`${path}.emphasis`, 'needs exactly one of atLeast, atMost or past');
    if (thresholds[0] === 'past' ? emphasis.past !== true : typeof emphasis[thresholds[0]!] !== 'number' || !Number.isFinite(emphasis[thresholds[0]!] as number)) {
      fail(`${path}.emphasis.${thresholds[0]}`, thresholds[0] === 'past' ? 'must be true' : 'must be a number');
    }
    result.emphasis = {fact: str(emphasis.fact, `${path}.emphasis.fact`, 64), field: str(emphasis.field, `${path}.emphasis.field`, 48),
      ...(thresholds[0] === 'past' ? {past: true} : {[thresholds[0]!]: emphasis[thresholds[0]!] as number})};
  }
  return result;
}

function module(value: unknown, path: string): PackModule {
  const record = obj(value, path, ['id', 'label', 'description', 'category', 'priority', 'role', 'condition', 'segments'], ['icon', 'triggers', 'surfaces', 'stale']);
  const result: PackModule = {
    id: str(record.id, `${path}.id`, 32, MODULE_ID), label: str(record.label, `${path}.label`, 24), description: str(record.description, `${path}.description`, 160),
    category: oneOf(record.category, `${path}.category`, MODULE_CATEGORIES), priority: bounded(record.priority, `${path}.priority`, 0, 99),
    role: oneOf(record.role, `${path}.role`, PACK_ROLES), condition: oneOf(record.condition, `${path}.condition`, PACK_CONDITIONS),
    segments: list(record.segments, `${path}.segments`, 4, segment, 1),
  };
  if (record.icon !== undefined) result.icon = str(record.icon, `${path}.icon`, 32, ICON_ID);
  if (record.triggers !== undefined) result.triggers = list(record.triggers, `${path}.triggers`, 24, (entry, at) => str(entry, at, 32, WORD), 1);
  if (result.condition === 'onCommand' && !result.triggers) fail(`${path}.triggers`, 'is required for show-on-command modules');
  if (record.surfaces !== undefined) {
    const surfaces = obj(record.surfaces, `${path}.surfaces`, ['preferred'], ['supported']);
    const preferred = oneOf(surfaces.preferred, `${path}.surfaces.preferred`, PACK_SURFACES);
    const supported = surfaces.supported === undefined ? undefined : list(surfaces.supported, `${path}.surfaces.supported`, 4, (entry, at) => oneOf(entry, at, PACK_SURFACES), 1);
    if (supported && !supported.includes(preferred)) fail(`${path}.surfaces`, 'preferred surface must be supported');
    result.surfaces = {preferred, ...(supported ? {supported} : {})};
  }
  if (record.stale !== undefined) result.stale = oneOf(record.stale, `${path}.stale`, ['show', 'hide'] as const);
  return result;
}

function evidence(value: unknown, path: string): PackEvidence {
  const record = obj(value, path, ['kind'], ['names', 'extensions', 'fact']);
  const kind = oneOf(record.kind, `${path}.kind`, ['workspaceFile', 'workspaceExtension', 'executable', 'fact'] as const);
  if (kind === 'workspaceFile') return {kind, names: list(record.names, `${path}.names`, 16, (entry, at) => str(entry, at, 64, FILE_NAME), 1)};
  if (kind === 'workspaceExtension') return {kind, extensions: list(record.extensions, `${path}.extensions`, 8, (entry, at) => str(entry, at, 16, /^\.[A-Za-z0-9]{1,15}$/u), 1)};
  if (kind === 'executable') return {kind, names: list(record.names, `${path}.names`, 8, (entry, at) => str(entry, at, 32, WORD), 1)};
  return {kind, fact: str(record.fact, `${path}.fact`, 64)};
}

/**
 * Parse and validate one manifest. `capabilities` is the core registry the
 * pack is checked against: unknown capability ids or fields make the pack
 * unsupported (it may need a newer NMSh), structural problems make it invalid.
 */
export function parsePack(bytes: string | Uint8Array, capabilities: ReadonlyMap<string, Pick<CapabilityDefinition<unknown>, 'id' | 'fields'>>):
  {ok: true; parsed: ParsedPack} | {ok: false; problem: PackProblem; sha256?: string; id?: string; version?: string} {
  const buffer = typeof bytes === 'string' ? Buffer.from(bytes, 'utf8') : Buffer.from(bytes);
  if (buffer.length > MAX_PACK_BYTES) return {ok: false, problem: {kind: 'invalid', message: `manifest is larger than ${MAX_PACK_BYTES / 1024} KiB`}};
  const sha256 = createHash('sha256').update(buffer).digest('hex');
  let raw: unknown;
  try { raw = JSON.parse(buffer.toString('utf8')) as unknown; } catch { return {ok: false, sha256, problem: {kind: 'invalid', message: 'manifest is not valid JSON'}}; }
  let pack: ContextPack;
  try {
    if (depth(raw) > 8) fail('pack', 'is nested too deeply');
    const record = obj(raw, 'pack', ['schema', 'id', 'version', 'name', 'description', 'license', 'provenance', 'compatibility', 'requires', 'modules'], ['recommend']);
    if (record.schema !== PACK_SCHEMA) {
      const known = typeof record.schema === 'string' && /^nmsh\.context-pack\/v\d+$/u.test(record.schema);
      return {ok: false, sha256, problem: {kind: known ? 'unsupported' : 'invalid', message: known ? `pack format ${record.schema} needs a newer NMSh` : 'pack.schema must be nmsh.context-pack/v1'}};
    }
    const provenance = obj(record.provenance, 'pack.provenance', ['author'], ['source', 'notes']);
    const compatibility = obj(record.compatibility, 'pack.compatibility', ['contextApi'], ['nmsh']);
    pack = {
      schema: PACK_SCHEMA, id: str(record.id, 'pack.id', 64, PACK_ID), version: str(record.version, 'pack.version', 48, SEMVER),
      name: str(record.name, 'pack.name', 48), description: str(record.description, 'pack.description', 240), license: str(record.license, 'pack.license', 160, SPDX),
      provenance: {author: str(provenance.author, 'pack.provenance.author', 96),
        ...(provenance.source !== undefined ? {source: str(provenance.source, 'pack.provenance.source', 200, /^https:\/\/[A-Za-z0-9.-]{1,100}(?:\/[A-Za-z0-9._~%!$&'()*+,;=:@/-]{0,96})?$/u)} : {}),
        ...(provenance.notes !== undefined ? {notes: str(provenance.notes, 'pack.provenance.notes', 240)} : {})},
      compatibility: {contextApi: bounded(compatibility.contextApi, 'pack.compatibility.contextApi', 1, 99),
        ...(compatibility.nmsh !== undefined ? {nmsh: str(compatibility.nmsh, 'pack.compatibility.nmsh', 32, NMSH_RANGE)} : {})},
      requires: list(record.requires, 'pack.requires', 16, (entry, at) => str(entry, at, 64, /^[a-z][a-zA-Z0-9]*(?:\.[a-z][a-zA-Z0-9]*){1,3}$/u)),
      modules: list(record.modules, 'pack.modules', 24, module, 1),
      ...(record.recommend !== undefined ? {recommend: list(record.recommend, 'pack.recommend', 24, (entry, at) => {
        const rule = obj(entry, at, ['module', 'evidence']);
        return {module: str(rule.module, `${at}.module`, 32, MODULE_ID), evidence: list(rule.evidence, `${at}.evidence`, 8, evidence, 1)};
      })} : {}),
    };
    const ids = new Set<string>();
    for (const item of pack.modules) { if (ids.has(item.id)) fail(`pack.modules.${item.id}`, 'is defined twice'); ids.add(item.id); }
    for (const rule of pack.recommend ?? []) if (!ids.has(rule.module)) fail(`pack.recommend.${rule.module}`, 'names no module in this pack');
    // Every fact a module or recommendation names must be declared in `requires`.
    const requires = new Set(pack.requires);
    const named = [...pack.modules.flatMap(item => item.segments.flatMap(entry => [...entry.parts.flatMap(item => [...(item.fact ? [item.fact] : []),
      ...(item.when?.fact ? [item.when.fact] : [])]), ...(entry.emphasis ? [entry.emphasis.fact] : [])])),
      ...(pack.recommend ?? []).flatMap(rule => rule.evidence.flatMap(item => item.kind === 'fact' ? [item.fact] : []))];
    for (const fact of named) if (!requires.has(fact)) fail('pack.requires', `must declare ${fact}`);
  } catch (error) {
    if (error instanceof Invalid) return {ok: false, sha256, problem: {kind: 'invalid', message: error.message}};
    throw error;
  }
  if (pack.compatibility.contextApi > CONTEXT_API_VERSION) {
    return {ok: false, sha256, id: pack.id, version: pack.version, problem: {kind: 'unsupported', message: `needs Context API ${pack.compatibility.contextApi}; this NMSh provides ${CONTEXT_API_VERSION}`}};
  }
  const missing = pack.requires.filter(id => !capabilities.has(id));
  const references = pack.modules.flatMap(item => item.segments.flatMap(entry => [...entry.parts.flatMap(item => [
    ...(item.fact && item.field ? [{fact: item.fact, field: item.field}] : []), ...(item.fact && item.until ? [{fact: item.fact, field: item.until}] : []),
    ...(item.when?.field && (item.when.fact ?? item.fact) ? [{fact: (item.when.fact ?? item.fact)!, field: item.when.field}] : [])]), ...(entry.emphasis ? [entry.emphasis] : [])]));
  const fieldProblems = references.filter(item => capabilities.has(item.fact) && !capabilities.get(item.fact)!.fields.includes(item.field))
    .map(item => `${item.fact}.${item.field}`);
  if (missing.length || fieldProblems.length) {
    return {ok: false, sha256, id: pack.id, version: pack.version, problem: {kind: 'unsupported',
      message: `needs ${[...missing, ...fieldProblems].join(', ')}, which this NMSh does not provide`, missing: [...missing, ...fieldProblems]}};
  }
  return {ok: true, parsed: {pack, sha256, bytes: buffer.length}};
}

function depth(value: unknown, level = 0): number {
  if (level > 16 || typeof value !== 'object' || value === null) return level;
  return Math.max(level, ...Object.values(value as Record<string, unknown>).map(item => depth(item, level + 1)));
}

/** Compare `version` against an `nmsh` range like ">=0.18.0" or ">=0.18.0 <1.0.0". */
export function satisfiesRange(version: string, range: string | undefined): boolean {
  if (!range) return true;
  const parse = (value: string) => value.split(/[.-]/u).slice(0, 3).map(item => Number.parseInt(item, 10) || 0);
  const compare = (a: number[], b: number[]) => { for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i]! - b[i]!; return 0; };
  const current = parse(version);
  return range.split(' ').every(clause => {
    const match = /^(>=|<=|>|<|=)?(.+)$/u.exec(clause);
    if (!match) return false;
    const difference = compare(current, parse(match[2]!));
    switch (match[1] ?? '=') {
      case '>=': return difference >= 0;
      case '<=': return difference <= 0;
      case '>': return difference > 0;
      case '<': return difference < 0;
      default: return difference === 0;
    }
  });
}

/** Stable canonical serialization (for built-in packs and fixtures). */
export function serializePack(pack: ContextPack): string {
  return `${JSON.stringify(pack, null, 2)}\n`;
}
