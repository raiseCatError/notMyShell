import {createHash, randomBytes} from 'node:crypto';
import {constants} from 'node:fs';
import {chmod, lstat, mkdir, open, readdir, rename, rm} from 'node:fs/promises';
import {join} from 'node:path';
import {defaultRuntimeDir} from '../session/runtimeDir.js';
import {SESSION_ID_ENV} from '../session/SessionClient.js';

/**
 * Agent context through an agent's own structured status interface.
 *
 * Claude Code runs a configured status-line command on each update and passes
 * its session state as JSON on stdin (model, effort, context window, rate
 * limits, cost, repository, pull request). NMSh's bridge (`nmsh agent-status
 * claude`) keeps an allowlisted, bounded subset in a private file under the
 * NMSh runtime directory, tagged with the NMSh session the agent runs in, and
 * prints a compact status line back for Claude's own UI. Nothing is scraped
 * from terminal output, no transcript or prompt text is read, and the
 * transcript path, prompt id and raw session id are never stored.
 */

export const AGENT_STATUS_SCHEMA = 1;

const MAX_INPUT_BYTES = 256 * 1024;

export interface AgentStatusRecord {
  schema: 1;
  harness: 'claude';
  /** Epoch milliseconds when the agent last reported. */
  updatedAt: number;
  /** Short digest of the agent's own session id: correlation only. */
  session?: string;
  model?: string;
  modelId?: string;
  effort?: string;
  fast?: boolean;
  contextPercent?: number;
  contextWindow?: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  fiveHourPercent?: number;
  fiveHourResetsAt?: number;
  sevenDayPercent?: number;
  sevenDayResetsAt?: number;
  spendPercent?: number;
  spendResetsAt?: number;
  durationMs?: number;
  costUsd?: number;
  linesAdded?: number;
  linesRemoved?: number;
  repo?: string;
  worktree?: string;
  pr?: number;
  prReview?: string;
  sessionName?: string;
  agentName?: string;
  version?: string;
}

const object = (value: unknown): Record<string, unknown> | undefined => typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const label = (value: unknown, limit = 64): string | undefined =>
  typeof value === 'string' && value.trim() && value.length <= limit && !/[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028-\u202e\u2066-\u2069]/u.test(value) ? value.trim() : undefined;
const number = (value: unknown, min: number, max: number): number | undefined => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? value : undefined;
const seconds = (value: unknown): number | undefined => { const parsed = number(value, 1_000_000_000, 100_000_000_000); return parsed === undefined ? undefined : Math.round(parsed * 1000); };

/** Claude Code's documented status-line input → the allowlisted record. Unknown, malformed or oversized fields are dropped individually. */
export function parseClaudeStatus(input: unknown, now = Date.now()): AgentStatusRecord | undefined {
  const data = object(input);
  if (!data) return undefined;
  const model = object(data.model), context = object(data.context_window), usage = object(context?.current_usage);
  const limits = object(data.rate_limits), five = object(limits?.five_hour), seven = object(limits?.seven_day), spend = object(limits?.spend_limit);
  const cost = object(data.cost), workspace = object(data.workspace), repo = object(workspace?.repo), pr = object(data.pr);
  const sessionId = label(data.session_id, 128);
  const owner = label(repo?.owner, 128), name = label(repo?.name, 128);
  const record: AgentStatusRecord = {schema: AGENT_STATUS_SCHEMA, harness: 'claude', updatedAt: now};
  const set = <K extends keyof AgentStatusRecord>(key: K, value: AgentStatusRecord[K] | undefined) => { if (value !== undefined) record[key] = value; };
  set('session', sessionId ? createHash('sha256').update(sessionId).digest('hex').slice(0, 12) : undefined);
  set('model', label(model?.display_name, 48));
  set('modelId', label(model?.id, 96));
  set('effort', label(object(data.effort)?.level, 16));
  set('fast', typeof data.fast_mode === 'boolean' ? data.fast_mode : undefined);
  set('contextPercent', number(context?.used_percentage, 0, 100));
  set('contextWindow', number(context?.context_window_size, 1, 100_000_000));
  set('inputTokens', number(context?.total_input_tokens, 0, 100_000_000));
  set('outputTokens', number(context?.total_output_tokens, 0, 100_000_000));
  set('cacheReadTokens', number(usage?.cache_read_input_tokens, 0, 100_000_000));
  set('cacheWriteTokens', number(usage?.cache_creation_input_tokens, 0, 100_000_000));
  set('fiveHourPercent', number(five?.used_percentage, 0, 1000));
  set('fiveHourResetsAt', seconds(five?.resets_at));
  set('sevenDayPercent', number(seven?.used_percentage, 0, 1000));
  set('sevenDayResetsAt', seconds(seven?.resets_at));
  set('spendPercent', number(spend?.used_percentage, 0, 1000));
  set('spendResetsAt', seconds(spend?.resets_at));
  set('durationMs', number(cost?.total_duration_ms, 0, 10 * 365 * 86_400_000));
  set('costUsd', number(cost?.total_cost_usd, 0, 1_000_000));
  set('linesAdded', number(cost?.total_lines_added, 0, 100_000_000));
  set('linesRemoved', number(cost?.total_lines_removed, 0, 100_000_000));
  set('repo', owner && name ? `${owner}/${name}`.slice(0, 160) : undefined);
  set('worktree', label(workspace?.git_worktree, 96));
  set('pr', number(pr?.number, 1, 10_000_000));
  set('prReview', ['approved', 'pending', 'changes_requested', 'draft'].includes(pr?.review_state as string) ? pr!.review_state as string : undefined);
  set('sessionName', label(data.session_name, 96));
  set('agentName', label(object(data.agent)?.name, 64));
  set('version', label(data.version, 32));
  return record;
}

/** Re-validate a stored record (it is still a file another process could have written). */
export function validAgentStatus(value: unknown): AgentStatusRecord | undefined {
  const data = object(value);
  if (!data || data.schema !== AGENT_STATUS_SCHEMA || data.harness !== 'claude' || number(data.updatedAt, 0, 100_000_000_000_000) === undefined) return undefined;
  const record: AgentStatusRecord = {schema: AGENT_STATUS_SCHEMA, harness: 'claude', updatedAt: data.updatedAt as number};
  const strings: Array<[keyof AgentStatusRecord, number]> = [['session', 12], ['model', 48], ['modelId', 96], ['effort', 16], ['repo', 160], ['worktree', 96],
    ['prReview', 24], ['sessionName', 96], ['agentName', 64], ['version', 32]];
  for (const [key, limit] of strings) { const item = label(data[key], limit); if (item !== undefined) (record as unknown as Record<string, unknown>)[key] = item; }
  const numbers: Array<[keyof AgentStatusRecord, number, number]> = [['contextPercent', 0, 100], ['contextWindow', 1, 1e8], ['inputTokens', 0, 1e8], ['outputTokens', 0, 1e8],
    ['cacheReadTokens', 0, 1e8], ['cacheWriteTokens', 0, 1e8], ['fiveHourPercent', 0, 1000], ['fiveHourResetsAt', 0, 1e14], ['sevenDayPercent', 0, 1000],
    ['sevenDayResetsAt', 0, 1e14], ['spendPercent', 0, 1000], ['spendResetsAt', 0, 1e14], ['durationMs', 0, 1e12], ['costUsd', 0, 1e6], ['linesAdded', 0, 1e8],
    ['linesRemoved', 0, 1e8], ['pr', 1, 1e7]];
  for (const [key, min, max] of numbers) { const item = number(data[key], min, max); if (item !== undefined) (record as unknown as Record<string, unknown>)[key] = item; }
  if (typeof data.fast === 'boolean') record.fast = data.fast;
  return record;
}

/** The NMSh session an agent runs in, from the managed shell's environment; `external` outside NMSh. */
export function agentScope(env: NodeJS.ProcessEnv = process.env): string {
  const id = env[SESSION_ID_ENV];
  return id && /^[A-Za-z0-9-]{1,64}$/u.test(id) ? id : 'external';
}

export function agentStatusDirectory(env: NodeJS.ProcessEnv = process.env): string {
  return join(defaultRuntimeDir(env), 'agent-context');
}

export function agentStatusPath(directory: string, harness: 'claude', scope: string): string {
  return join(directory, `${harness}-${scope}.json`);
}

/** Atomic private write: a reader sees the previous or the next record, never half of one. */
export async function writeAgentStatus(directory: string, scope: string, record: AgentStatusRecord): Promise<void> {
  await mkdir(directory, {recursive: true, mode: 0o700});
  await chmod(directory, 0o700).catch(() => {});
  const target = agentStatusPath(directory, record.harness, scope);
  const temporary = `${target}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  const file = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { await file.writeFile(`${JSON.stringify(record)}\n`, 'utf8'); } finally { await file.close(); }
  await rename(temporary, target);
}

async function readRecord(path: string): Promise<AgentStatusRecord | undefined> {
  let file;
  try {
    file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const info = await file.stat();
    const uid = process.getuid?.();
    if (!info.isFile() || info.size > 64 * 1024 || (uid !== undefined && info.uid !== uid) || (info.mode & 0o022) !== 0) return undefined;
    return validAgentStatus(JSON.parse(await file.readFile('utf8')) as unknown);
  } catch { return undefined; }
  finally { await file?.close().catch(() => {}); }
}

/** This session's record, else the most recent one from any session (account-level limits stay meaningful). */
export async function readAgentStatus(directory: string, scope: string): Promise<{record: AgentStatusRecord; own: boolean} | undefined> {
  const own = await readRecord(agentStatusPath(directory, 'claude', scope));
  if (own) return {record: own, own: true};
  let names: string[] = [];
  try {
    const info = await lstat(directory);
    if (!info.isDirectory()) return undefined;
    names = (await readdir(directory)).filter(name => /^claude-[A-Za-z0-9-]{1,64}\.json$/u.test(name)).slice(0, 64);
  } catch { return undefined; }
  let latest: AgentStatusRecord | undefined;
  for (const name of names) {
    const item = await readRecord(join(directory, name));
    if (item && (!latest || item.updatedAt > latest.updatedAt)) latest = item;
  }
  return latest ? {record: latest, own: false} : undefined;
}

/** Remove records older than `maxAgeMs` (bounded; best effort). */
export async function pruneAgentStatus(directory: string, now = Date.now(), maxAgeMs = 7 * 86_400_000): Promise<void> {
  let names: string[] = [];
  try { names = (await readdir(directory)).filter(name => /^claude-[A-Za-z0-9-]{1,64}\.json$/u.test(name)).slice(0, 256); } catch { return; }
  for (const name of names) {
    const record = await readRecord(join(directory, name));
    if (!record || now - record.updatedAt > maxAgeMs) await rm(join(directory, name), {force: true}).catch(() => {});
  }
}

/** Bounded stdin read for the bridge; Claude cancels in-flight runs, so this must never hang. */
export function readBoundedStdin(stream: NodeJS.ReadableStream = process.stdin, timeoutMs = 2000): Promise<string | undefined> {
  return new Promise(resolve => {
    const chunks: Buffer[] = [];
    let size = 0, done = false;
    const finish = (value: string | undefined) => { if (!done) { done = true; clearTimeout(timer); resolve(value); } };
    const timer = setTimeout(() => finish(undefined), timeoutMs);
    timer.unref?.();
    stream.on('data', (chunk: Buffer | string) => {
      const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
      size += buffer.length;
      if (size > MAX_INPUT_BYTES) finish(undefined); else chunks.push(buffer);
    });
    stream.once('end', () => finish(Buffer.concat(chunks).toString('utf8')));
    stream.once('error', () => finish(undefined));
  });
}
