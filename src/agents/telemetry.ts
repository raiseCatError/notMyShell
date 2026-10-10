import {displayText} from './transcript/projection.js';

/**
 * What NMSh knows about one managed target's runtime: its model and effort, permission mode, context window, usage,
 * rate limits, compaction, the files its tools touched, its tasks and its plan. Every value says where it came from
 * and when, so the interface can tell a provider's own report from something NMSh observed, requested or estimated.
 * Telemetry is target-scoped (account-scoped rate limits are copied between targets of the same launch profile only,
 * labelled as such) and display-only: it is never written to shell history, journals or exported settings.
 */

/** Where a fact came from. */
export type Provenance =
  /** The provider reported it in a structured event or control response. */
  | 'provider'
  /** NMSh asked for it and the provider acknowledged the request; the effect is not separately reported. */
  | 'requested'
  /** NMSh saw it happen (a tool event naming a file, a turn's timing). */
  | 'observed'
  /** NMSh derived it from other reported numbers; shown as an estimate. */
  | 'estimate';

export interface Sourced<T> {
  value: T;
  source: Provenance;
  at: number;
  /** Short words for detail views: "system/init", "set_model acknowledged", "rate_limit_event". */
  evidence: string;
}

export interface ModelOption {
  /** What the provider accepts (an alias such as "sonnet" or a full id). */
  value: string;
  /** The model the alias resolves to now, when the provider says. */
  resolved?: string;
  name: string;
  description?: string;
  effortLevels?: readonly string[];
  fastMode?: boolean;
}

export interface ProviderCommand {
  name: string;
  description: string;
  argumentHint?: string;
  aliases?: readonly string[];
  /** The provider's own built-in, as opposed to a user, project, plugin or MCP-defined command. */
  builtin: boolean;
}

export interface Catalog {
  models: ModelOption[];
  commands: ProviderCommand[];
  agents: string[];
  outputStyles: string[];
  outputStyle?: string;
  /** Account facts the provider published at initialization; the e-mail is kept in memory only and shown on request. */
  account?: {provider?: string; plan?: string; email?: string; organization?: string};
  at: number;
}

export interface RuntimeInfo {
  model?: string;
  permissionMode?: string;
  tools: string[];
  mcpServers: Array<{name: string; status: string; source?: string}>;
  slashCommands: string[];
  skills: string[];
  plugins: Array<{name: string; version?: string}>;
  outputStyle?: string;
  version?: string;
  /** Only when the provider reports it; headless Claude Code does not. */
  effort?: string | null;
  capabilities: string[];
  at: number;
}

export interface ModelUsageTotals {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  costUsd?: number;
  contextWindow?: number;
  maxOutput?: number;
}

export interface UsageTotals {
  /** Cumulative across the target's turns (the provider reports running totals). */
  perModel: Record<string, ModelUsageTotals>;
  costUsd?: number;
  /** The newest turn's main-loop request: what the context held at that call. */
  lastTurn?: {input: number; output: number; cacheRead: number; cacheWrite: number; model?: string};
  turns: number;
  durationMs: number;
  apiMs: number;
  at: number;
}

export interface ContextCategory {
  name: string;
  tokens: number;
  kind: 'used' | 'free' | 'buffer' | 'deferred';
}

export interface ContextSnapshot {
  model?: string;
  totalTokens: number;
  maxTokens: number;
  percentage: number;
  categories: ContextCategory[];
  autoCompactThreshold?: number;
  autoCompact: boolean;
  memoryFiles: Array<{path: string; type: string; tokens: number}>;
  mcpTools: Array<{name: string; server: string; tokens: number}>;
  agents: Array<{type: string; source: string; tokens: number}>;
  skills?: {total: number; included: number; tokens: number};
  messages?: {toolCalls: number; toolResults: number; attachments: number; assistant: number; user: number; byTool: Array<{name: string; call: number; result: number}>};
  apiUsage?: {input: number; output: number; cacheRead: number; cacheWrite: number};
  detail: 'summary' | 'full';
}

export interface RateLimit {
  status: string;
  utilization?: number;
  resetsAt?: number;
  /** Which target reported it, when copied from another target of the same launch profile. */
  from?: string;
}

export interface Compaction {
  at: number;
  trigger: string;
  preTokens: number;
  postTokens?: number;
}

export interface FileActivity {
  path: string;
  reads: number;
  edits: number;
  writes: number;
  added: number;
  removed: number;
  last: number;
  /** The newest edit's provider-reported patch (bounded), for the right panel and diff detail. */
  patch?: PatchHunk[];
}

export interface PatchHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: string[];
}

export interface TaskInfo {
  id: string;
  description: string;
  type?: string;
  subagent?: string;
  status: string;
  toolUseId?: string;
  parent?: string;
  summary?: string;
  lastTool?: string;
  tokens?: number;
  toolUses?: number;
  durationMs?: number;
  background?: boolean;
  started: number;
  updated: number;
}

export interface TodoItem {
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
  activeForm?: string;
}

export interface AgentTelemetry {
  catalog?: Catalog;
  runtime?: RuntimeInfo;
  /** Requests NMSh made through supported controls, with the provider's acknowledgement. */
  requested: {model?: Sourced<string>; effort?: Sourced<string | null>; permissionMode?: Sourced<string>};
  modelHistory: Array<{at: number; model: string; source: Provenance}>;
  usage?: UsageTotals;
  context?: Sourced<ContextSnapshot>;
  rateLimits: Record<string, Sourced<RateLimit>>;
  compactions: Compaction[];
  files: Map<string, FileActivity>;
  tasks: Map<string, TaskInfo>;
  todos?: Sourced<TodoItem[]>;
  /** The provider is retrying an API call (attempt, of, delay); cleared when a turn settles. */
  retry?: {attempt: number; max: number; delayMs: number; status?: number; at: number};
  /** "compacting" while the provider compacts, from system/status. */
  status?: Sourced<string>;
}

export function emptyTelemetry(): AgentTelemetry {
  return {requested: {}, modelHistory: [], rateLimits: {}, compactions: [], files: new Map(), tasks: new Map()};
}

/** Normalized updates an adapter emits; the reducer below is the only writer of telemetry. */
export type TelemetryUpdate =
  | {kind: 'catalog'; catalog: Catalog}
  | {kind: 'runtime'; runtime: RuntimeInfo}
  | {kind: 'usage'; usage: Omit<UsageTotals, 'at'>; at: number}
  | {kind: 'context'; snapshot: ContextSnapshot; at: number}
  | {kind: 'rateLimit'; type: string; limit: RateLimit; at: number}
  | {kind: 'compaction'; compaction: Compaction}
  | {kind: 'status'; status: string | null; permissionMode?: string; at: number}
  | {kind: 'retry'; attempt: number; max: number; delayMs: number; status?: number; at: number}
  | {kind: 'task'; task: Partial<TaskInfo> & {id: string}; at: number}
  | {kind: 'todos'; todos: TodoItem[]; at: number}
  | {kind: 'file'; path: string; action: 'read' | 'edit' | 'write'; added?: number; removed?: number; patch?: PatchHunk[]; at: number}
  | {kind: 'requested'; field: 'model' | 'effort' | 'permissionMode'; value: string | null; at: number; evidence?: string}
  | {kind: 'settled'; at: number};

const MAX_FILES = 500;
const MAX_TASKS = 200;
const MAX_HISTORY = 50;

export function applyTelemetry(telemetry: AgentTelemetry, update: TelemetryUpdate): void {
  switch (update.kind) {
    case 'catalog': telemetry.catalog = update.catalog; break;
    case 'runtime': {
      const previous = telemetry.runtime?.model;
      telemetry.runtime = update.runtime;
      if (update.runtime.model && update.runtime.model !== previous) pushHistory(telemetry, update.runtime.model, 'provider', update.runtime.at);
      if (update.runtime.permissionMode && telemetry.requested.permissionMode?.value === update.runtime.permissionMode) {
        // The provider now reports the mode NMSh asked for: the report is authoritative from here on.
        telemetry.requested.permissionMode = undefined;
      }
      break;
    }
    case 'usage': telemetry.usage = {...update.usage, at: update.at}; break;
    case 'context': telemetry.context = {value: update.snapshot, source: 'provider', at: update.at, evidence: `get_context_usage (${update.snapshot.detail})`}; break;
    case 'rateLimit': telemetry.rateLimits[update.type] = {value: update.limit, source: 'provider', at: update.at, evidence: update.limit.from ? `rate_limit_event from ${update.limit.from}` : 'rate_limit_event'}; break;
    case 'compaction':
      telemetry.compactions.push(update.compaction);
      if (telemetry.compactions.length > MAX_HISTORY) telemetry.compactions.shift();
      // The window was rebuilt: an older breakdown no longer describes it.
      telemetry.context = undefined;
      break;
    case 'status':
      telemetry.status = update.status ? {value: update.status, source: 'provider', at: update.at, evidence: 'system/status'} : undefined;
      if (update.permissionMode && telemetry.runtime) telemetry.runtime = {...telemetry.runtime, permissionMode: update.permissionMode, at: update.at};
      break;
    case 'retry': telemetry.retry = {attempt: update.attempt, max: update.max, delayMs: update.delayMs, ...(update.status ? {status: update.status} : {}), at: update.at}; break;
    case 'task': {
      const existing = telemetry.tasks.get(update.task.id);
      const next: TaskInfo = {description: '', status: 'running', started: update.at, ...existing, ...update.task, updated: update.at};
      telemetry.tasks.set(update.task.id, next);
      if (telemetry.tasks.size > MAX_TASKS) telemetry.tasks.delete(telemetry.tasks.keys().next().value!);
      break;
    }
    case 'todos': telemetry.todos = {value: update.todos, source: 'provider', at: update.at, evidence: 'TodoWrite'}; break;
    case 'file': {
      const key = update.path;
      const file = telemetry.files.get(key) ?? {path: key, reads: 0, edits: 0, writes: 0, added: 0, removed: 0, last: update.at};
      if (update.action === 'read') file.reads++;
      else if (update.action === 'edit') file.edits++;
      else file.writes++;
      file.added += update.added ?? 0;
      file.removed += update.removed ?? 0;
      file.last = update.at;
      if (update.patch) file.patch = update.patch;
      telemetry.files.delete(key);
      telemetry.files.set(key, file);
      if (telemetry.files.size > MAX_FILES) telemetry.files.delete(telemetry.files.keys().next().value!);
      break;
    }
    case 'requested': {
      const evidence = update.evidence ?? (update.field === 'model' ? 'set_model acknowledged' : update.field === 'effort' ? 'apply_flag_settings acknowledged' : 'set_permission_mode acknowledged');
      if (update.field === 'model' && update.value) pushHistory(telemetry, update.value, 'requested', update.at);
      (telemetry.requested as Record<string, Sourced<string | null>>)[update.field] = {value: update.value, source: 'requested', at: update.at, evidence};
      break;
    }
    case 'settled': telemetry.retry = undefined; break;
  }
}

function pushHistory(telemetry: AgentTelemetry, model: string, source: Provenance, at: number): void {
  const last = telemetry.modelHistory.at(-1);
  if (last?.model === model) return;
  telemetry.modelHistory.push({at, model, source});
  if (telemetry.modelHistory.length > MAX_HISTORY) telemetry.modelHistory.shift();
}

// ---- Derived views ------------------------------------------------------------------------------------------------

export interface ContextMeter {
  used: number;
  max: number;
  percent: number;
  source: Provenance;
  at: number;
  evidence: string;
}

/**
 * How full the context window is now. The provider's own breakdown wins; otherwise the newest turn's main-loop request
 * (input plus cache reads and writes) is the context the model last saw, an estimate against the reported window.
 * Lifetime totals are never used here: they measure spend, not what the model holds.
 */
export function contextMeter(telemetry: AgentTelemetry): ContextMeter | undefined {
  const usage = telemetry.usage;
  const context = telemetry.context;
  const turnAfterSnapshot = usage && context && usage.at > context.at;
  if (context && !turnAfterSnapshot && context.value.maxTokens > 0) {
    return {used: context.value.totalTokens, max: context.value.maxTokens, percent: Math.min(100, (context.value.totalTokens / context.value.maxTokens) * 100),
      source: 'provider', at: context.at, evidence: context.evidence};
  }
  const last = usage?.lastTurn;
  const model = last?.model ?? telemetry.runtime?.model;
  const window = (model ? usage?.perModel[model]?.contextWindow : undefined) ?? Object.values(usage?.perModel ?? {}).find(item => item.contextWindow)?.contextWindow ?? context?.value.maxTokens;
  if (!last || !window) return undefined;
  const used = last.input + last.cacheRead + last.cacheWrite + last.output;
  return {used, max: window, percent: Math.min(100, (used / window) * 100), source: 'estimate', at: usage!.at, evidence: 'newest turn usage against the reported window'};
}

/** The model the provider runs now, else the one NMSh requested (pending the next report), else none. */
export function currentModel(telemetry: AgentTelemetry, reported?: string): Sourced<string> | undefined {
  const requested = telemetry.requested.model;
  const runtime = telemetry.runtime;
  if (requested && (!runtime?.model || requested.at > runtime.at) && !sameModel(requested.value, runtime?.model, telemetry)) return requested;
  const model = runtime?.model ?? reported;
  return model ? {value: model, source: 'provider', at: runtime?.at ?? 0, evidence: 'system/init'} : undefined;
}

/** Whether an alias such as "sonnet" names the runtime model id the provider reports. */
export function sameModel(requested: string | undefined, runtime: string | undefined, telemetry: AgentTelemetry): boolean {
  if (!requested || !runtime) return false;
  if (requested === runtime) return true;
  const option = telemetry.catalog?.models.find(model => model.value === requested);
  return option?.resolved === runtime;
}

/** A display name for a model id: the catalog's name ("Sonnet 5.5"), else a tidy form of the id. */
export function modelName(model: string, telemetry: AgentTelemetry | undefined): string {
  const option = telemetry?.catalog?.models.find(item => item.resolved === model && item.value !== 'default') ?? telemetry?.catalog?.models.find(item => item.value === model);
  if (option) return displayText(option.name).replace(/\s*\(recommended\)$/iu, '');
  const match = /^claude-([a-z]+)-(\d+)(?:-(\d+))?/u.exec(model);
  if (match) return `${match[1]![0]!.toUpperCase()}${match[1]!.slice(1)} ${match[2]}${match[3] && match[3].length <= 2 ? `.${match[3]}` : ''}`;
  return displayText(model).slice(0, 40);
}

/** Cache reads as a share of all input the provider counted for this target (how much of the prompt was reused). */
export function cacheShare(usage: UsageTotals | undefined): number | undefined {
  if (!usage) return undefined;
  let read = 0, total = 0;
  for (const item of Object.values(usage.perModel)) { read += item.cacheRead; total += item.input + item.cacheRead + item.cacheWrite; }
  return total > 0 ? read / total : undefined;
}

export function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1).replace(/\.0$/u, '')}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(value >= 100_000 ? 0 : 1).replace(/\.0$/u, '')}k`;
  return String(Math.round(value));
}

/** The catalog entry for the model a target runs (or was asked to run): its name, aliases and effort levels. */
export function modelOption(telemetry: AgentTelemetry | undefined, model: string | undefined): ModelOption | undefined {
  if (!telemetry?.catalog || !model) return undefined;
  const models = telemetry.catalog.models;
  return models.find(item => item.value === model && item.value !== 'default') ?? models.find(item => item.resolved === model && item.value !== 'default')
    ?? models.find(item => item.value === model) ?? models.find(item => item.resolved === model);
}

export type EffortState = 'acknowledged' | 'launch' | 'settings' | 'default' | 'unavailable' | 'unknown';

/**
 * What is known about a target's effort, honestly: headless Claude Code never reports the level in effect, so the
 * best evidence is NMSh's own acknowledged request, then the launch flag, then the account's settings file. A model
 * without effort levels has none to set; with nothing configured, the model's default applies (its level unreported).
 */
export function effortStatus(telemetry: AgentTelemetry | undefined, settingsEffort?: string): {value?: string; state: EffortState; words: string} {
  if (!telemetry) return {state: 'unknown', words: 'unknown'};
  const option = modelOption(telemetry, currentModel(telemetry)?.value);
  if (option && !option.effortLevels?.length) return {state: 'unavailable', words: 'this model has no effort levels'};
  const requested = telemetry.requested.effort;
  if (requested) {
    if (requested.evidence === 'launch flag') return {value: requested.value ?? undefined, state: 'launch', words: `${requested.value} · set at launch`};
    return requested.value === null ? {state: 'default', words: 'model default · set in NMSh'} : {value: requested.value, state: 'acknowledged', words: `${requested.value} · acknowledged by Claude`};
  }
  if (settingsEffort) return {value: settingsEffort, state: 'settings', words: `${settingsEffort} · from Claude settings`};
  return option ? {state: 'default', words: 'model default (level not reported)'} : {state: 'unknown', words: 'unknown until Claude publishes its models'};
}
