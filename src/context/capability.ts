import type {FactCost, FactPersistence, FactSensitivity, FactTrust} from './facts.js';
import type {ShellEnvironment} from './shellEnvironment.js';

/**
 * The contract between the Context Engine and one trusted core capability.
 *
 * A capability is a named operation NMSh core knows how to perform safely,
 * such as reading the active AWS profile from local configuration. Modules and
 * Context Packs only name capabilities; they never supply paths, commands or
 * code. Every resolver lives in core, receives a restricted scope (never
 * `process.env`), honors cancellation and returns plain data that the engine
 * sanitizes before anything can render it.
 */

/** What a cached value is keyed by, besides the allowlisted environment it declares. */
export type CapabilityScope = 'session' | 'workspace' | 'user' | 'machine';
/** Concurrency family: probes (bounded subprocesses) get the tightest limit. */
export type CapabilityFamily = 'metadata' | 'probe' | 'system' | 'agent';
export type InvalidationEvent = 'command' | 'refresh';

export interface CapabilityScopeInput {
  cwd: string;
  home: string;
  /** Repository top level when known. */
  root?: string;
  /** Frontend session identity, for session-scoped capabilities. */
  session: string;
  /** Allowlisted values reported by the live shell (or the documented fallback). */
  env: ShellEnvironment;
  /** Facts the frontend already holds in memory (job count from the shell snapshot, session start). */
  live?: {jobs?: number; startedAt?: number};
}

export interface CapabilityContext extends CapabilityScopeInput {
  /** Value fields some visible module needs; resolvers may skip the expensive rest. */
  fields: ReadonlySet<string>;
  signal: AbortSignal;
  now: number;
}

export interface FieldPolicy {
  sensitivity: FactSensitivity;
  persistence: FactPersistence;
}

export interface CapabilityResult<V> {
  value: V;
  /** Short factual provenance such as "AWS_PROFILE, ~/.aws/config"; never a value. */
  evidence: string;
}

export interface CapabilityDefinition<V = unknown> {
  id: string;
  title: string;
  /** What is read, for disclosure in /prompt: file names and variable names, never values. */
  reads: readonly string[];
  scope: CapabilityScope;
  family: CapabilityFamily;
  cost: FactCost;
  trust: FactTrust;
  sensitivity: FactSensitivity;
  persistence: FactPersistence;
  /** Stricter policy for individual value fields (an account e-mail inside an otherwise public fact). */
  fieldPolicy?: Readonly<Record<string, FieldPolicy>>;
  /** Value fields a module may demand. */
  fields: readonly string[];
  /** Allowlisted shell environment names the value depends on; part of the cache key. */
  env: readonly string[];
  /** How long a resolved value counts as fresh. */
  ttlMs: number;
  /**
   * Time-based facts (clock, memory, battery, agent status) re-resolve on this
   * cadence while a visible module demands them; nothing ticks otherwise.
   */
  refreshMs?: number;
  timeoutMs: number;
  invalidateOn: readonly InvalidationEvent[];
  /** Deterministic synthetic value for previews and showcases; never collected. */
  preview: V;
  /** Absent (undefined) means "not applicable here", which is distinct from failure. */
  resolve(context: CapabilityContext): Promise<CapabilityResult<V> | undefined>;
}

export function defineCapability<V>(definition: CapabilityDefinition<V>): CapabilityDefinition<V> {
  return definition;
}
