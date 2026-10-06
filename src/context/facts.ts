import type {PromptContext, GitStatus, ToolchainId} from '../shell/ShellContext.js';
import {truncateText} from '../util/text.js';

export type FactTrust = 'session' | 'workspace' | 'user-metadata' | 'local-inventory';
export type FactSensitivity = 'public' | 'private' | 'secret';
export type FactPersistence = 'snapshot-safe' | 'display-only' | 'never-store';
/** `cheap`: projected from memory. `bounded-async`: bounded local reads. `probe`: a bounded trusted subprocess. */
export type FactCost = 'cheap' | 'bounded-async' | 'probe';
export interface ContextFact<T> {
  readonly value: T;
  readonly source: {capability: string; evidence: string};
  readonly collectedAt: number;
  readonly freshness: 'fresh' | 'stale' | 'unknown';
  readonly trust: FactTrust;
  readonly sensitivity: FactSensitivity;
  readonly persistence: FactPersistence;
  readonly resolution: FactCost;
  /** Stricter policy for individual value fields; absent fields follow the fact's own policy. */
  readonly fieldPolicy?: Readonly<Record<string, {sensitivity: FactSensitivity; persistence: FactPersistence}>>;
}

export interface FactValues {
  cwd: string;
  project: string;
  root: string;
  pathAbbreviations: Record<string, string>;
  branch: string;
  git: GitStatus;
  exitStatus: number;
  toolchains: ToolchainId[];
  discovery: NonNullable<PromptContext['discovery']>;
  kubeContext: string;
  dockerContext: string;
  shell: NonNullable<PromptContext['shell']>;
}
/** Legacy prompt facts adapted from PromptContext. */
export type FactId = keyof FactValues;
/** Capability-backed facts are namespaced (`cloud.aws`, `runtime.node`) and hold plain sanitized objects. */
export type CapabilityFactId = `${string}.${string}`;
export type ContextFacts = {readonly [K in FactId]?: ContextFact<FactValues[K]>}
  & {readonly [K in CapabilityFactId]?: ContextFact<unknown>};

/** Named core operations, not commands supplied by modules or packs. */
export const FACT_CAPABILITIES = {
  cwd: 'session.cwd', project: 'workspace.identity', root: 'workspace.git.root',
  pathAbbreviations: 'workspace.path.abbreviations', branch: 'workspace.git.branch', git: 'workspace.git.status',
  exitStatus: 'session.exit-status', toolchains: 'workspace.toolchain.markers', discovery: 'inventory.local',
  kubeContext: 'context.kubernetes.current', dockerContext: 'context.docker.current', shell: 'session.shell',
} as const satisfies Record<FactId, string>;
export type ContextCapabilityId = typeof FACT_CAPABILITIES[FactId];

const DISPLAY_CONTROLS = /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028-\u202e\u2066-\u2069]/gu;

/** Literal contextual data only. Bound work before cell measurement; neutralize bidi overrides/isolates too. */
export function safeContextText(value: string, maxCells = 512): string {
  return truncateText(value.slice(0, 1024).replace(DISPLAY_CONTROLS, '�'), maxCells);
}

const MAX_FACT_STRING = 512;
const MAX_FACT_ITEMS = 32;
const MAX_FACT_DEPTH = 4;

/**
 * The single sanitization boundary every capability value passes before it is
 * cached: strings lose terminal controls and bidi formatting and are bounded,
 * collections and nesting are bounded, and anything that is not plain data
 * (functions, symbols, class instances, non-finite numbers) is dropped. Display
 * painting still applies `safeContextText`; this keeps hostile bytes out of
 * every consumer, including /prompt disclosure and tests.
 */
export function sanitizeFactValue(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') return value.slice(0, MAX_FACT_STRING).replace(DISPLAY_CONTROLS, '�');
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'boolean') return value;
  if (depth >= MAX_FACT_DEPTH || value === null || typeof value !== 'object') return undefined;
  if (Array.isArray(value)) {
    return value.slice(0, MAX_FACT_ITEMS).map(item => sanitizeFactValue(item, depth + 1)).filter(item => item !== undefined);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return undefined;
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(value).slice(0, MAX_FACT_ITEMS)) {
    if (!/^[A-Za-z][A-Za-z0-9_]{0,47}$/u.test(key)) continue;
    const item = sanitizeFactValue((value as Record<string, unknown>)[key], depth + 1);
    if (item !== undefined) result[key] = item;
  }
  return result;
}

/** Adapt an already resolved legacy snapshot; this never collects or refreshes facts. */
export function promptFacts(context: PromptContext, collectedAt = 0): ContextFacts {
  const facts: Record<string, ContextFact<unknown>> = {};
  for (const id of Object.keys(FACT_CAPABILITIES) as FactId[]) {
    const value = id === 'exitStatus' ? context.exitStatus ?? 0 : context[id];
    if (value === undefined) continue;
    const session = id === 'cwd' || id === 'exitStatus' || id === 'shell';
    const metadata = id === 'kubeContext' || id === 'dockerContext';
    const at = id === 'discovery' ? context.discovery!.discoveredAt : collectedAt;
    facts[id] = {value, source: {capability: FACT_CAPABILITIES[id], evidence: 'legacy resolved PromptContext'},
      collectedAt: at, freshness: at ? 'fresh' : 'unknown', trust: session ? 'session' : metadata ? 'user-metadata' : id === 'discovery' ? 'local-inventory' : 'workspace',
      sensitivity: 'public', persistence: 'snapshot-safe', resolution: session ? 'cheap' : 'bounded-async'};
  }
  return {...facts, ...context.facts} as ContextFacts;
}

export function factAllowed(fact: ContextFact<unknown>, purpose: 'display' | 'snapshot'): boolean {
  return fact.sensitivity !== 'secret' && fact.persistence !== 'never-store'
    && (purpose !== 'snapshot' || fact.persistence === 'snapshot-safe');
}

function fieldAllowed(policy: {sensitivity: FactSensitivity; persistence: FactPersistence}, purpose: 'display' | 'snapshot'): boolean {
  return policy.sensitivity !== 'secret' && policy.persistence !== 'never-store'
    && (purpose !== 'snapshot' || policy.persistence === 'snapshot-safe');
}

/**
 * The value a module may see for one purpose: undefined when the fact is not
 * allowed at all, otherwise the value without fields whose own policy forbids
 * that purpose (an account e-mail never reaches a snapshot, for example).
 */
export function projectFactValue(fact: ContextFact<unknown> | undefined, purpose: 'display' | 'snapshot'): unknown {
  if (!fact || !factAllowed(fact, purpose)) return undefined;
  const policy = fact.fieldPolicy;
  if (!policy || typeof fact.value !== 'object' || fact.value === null || Array.isArray(fact.value)) return fact.value;
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(fact.value as Record<string, unknown>)) {
    const own = policy[key];
    if (!own || fieldAllowed(own, purpose)) result[key] = item;
  }
  return result;
}

/** A module receives only declared facts, plus the existing visibility inputs. No I/O handles. */
export function moduleFactContext(context: PromptContext, facts: ContextFacts, fields: readonly FactId[], purpose: 'display' | 'snapshot'): PromptContext {
  const result: PromptContext = {cwd: '', project: '', commandWords: context.commandWords, home: context.home};
  for (const id of new Set<FactId>([...fields, 'branch', 'exitStatus', 'shell'])) {
    const fact = facts[id];
    if (fact && factAllowed(fact, purpose)) Object.assign(result, {[id]: fact.value});
  }
  return result;
}

/** Refresh a value without weakening a previously established privacy policy. */
export function updateFact<T>(next: ContextFact<T> | undefined, previous: ContextFact<T> | undefined): ContextFact<T> | undefined {
  if (!next || !previous) return next ?? previous;
  return {...next, sensitivity: previous.sensitivity, persistence: previous.persistence};
}
