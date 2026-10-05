import type {PromptContext, GitStatus, ToolchainId} from '../shell/ShellContext.js';
import {truncateText} from '../util/text.js';

export type FactTrust = 'session' | 'workspace' | 'user-metadata' | 'local-inventory';
export type FactSensitivity = 'public' | 'private' | 'secret';
export type FactPersistence = 'snapshot-safe' | 'display-only' | 'never-store';
export interface ContextFact<T> {
  readonly value: T;
  readonly source: {capability: string; evidence: string};
  readonly collectedAt: number;
  readonly freshness: 'fresh' | 'stale' | 'unknown';
  readonly trust: FactTrust;
  readonly sensitivity: FactSensitivity;
  readonly persistence: FactPersistence;
  readonly resolution: 'cheap' | 'bounded-async';
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
export type FactId = keyof FactValues;
export type ContextFacts = {readonly [K in FactId]?: ContextFact<FactValues[K]>};

/** Named core operations, not commands supplied by modules or packs. */
export const FACT_CAPABILITIES = {
  cwd: 'session.cwd', project: 'workspace.identity', root: 'workspace.git.root',
  pathAbbreviations: 'workspace.path.abbreviations', branch: 'workspace.git.branch', git: 'workspace.git.status',
  exitStatus: 'session.exit-status', toolchains: 'workspace.toolchain.markers', discovery: 'inventory.local',
  kubeContext: 'context.kubernetes.current', dockerContext: 'context.docker.current', shell: 'session.shell',
} as const satisfies Record<FactId, string>;
export type ContextCapabilityId = typeof FACT_CAPABILITIES[FactId];

/** Literal contextual data only. Bound work before cell measurement; neutralize bidi overrides/isolates too. */
export function safeContextText(value: string, maxCells = 512): string {
  return truncateText(value.slice(0, 1024).replace(/[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028-\u202e\u2066-\u2069]/gu, '�'), maxCells);
}

/** Adapt an already resolved legacy snapshot; this never collects or refreshes facts. */
export function promptFacts(context: PromptContext, collectedAt = 0): ContextFacts {
  const facts: ContextFacts = {};
  for (const id of Object.keys(FACT_CAPABILITIES) as FactId[]) {
    const value = id === 'exitStatus' ? context.exitStatus ?? 0 : context[id];
    if (value === undefined) continue;
    const session = id === 'cwd' || id === 'exitStatus' || id === 'shell';
    const metadata = id === 'kubeContext' || id === 'dockerContext';
    const at = id === 'discovery' ? context.discovery!.discoveredAt : collectedAt;
    Object.assign(facts, {[id]: {value, source: {capability: FACT_CAPABILITIES[id], evidence: 'legacy resolved PromptContext'},
      collectedAt: at, freshness: at ? 'fresh' : 'unknown', trust: session ? 'session' : metadata ? 'user-metadata' : id === 'discovery' ? 'local-inventory' : 'workspace',
      sensitivity: 'public', persistence: 'snapshot-safe', resolution: session ? 'cheap' : 'bounded-async'}});
  }
  return {...facts, ...context.facts};
}

export function factAllowed(fact: ContextFact<unknown>, purpose: 'display' | 'snapshot'): boolean {
  return fact.sensitivity !== 'secret' && fact.persistence !== 'never-store'
    && (purpose !== 'snapshot' || fact.persistence === 'snapshot-safe');
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
