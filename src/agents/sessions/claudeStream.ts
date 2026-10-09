import type {AgentEvent, PermissionSuggestion, ToolResult} from './model.js';
import type {Catalog, ContextSnapshot, PatchHunk, RuntimeInfo, TelemetryUpdate, TodoItem} from '../telemetry.js';

/**
 * Claude Code's stream-json messages (the documented Agent SDK wire format) normalized into NMSh's provider-neutral
 * shapes: telemetry updates with provenance, structured tool results and presentation-only streaming text. Every
 * field is validated individually and bounded; an unknown or malformed field is dropped, never guessed. Strings stay
 * raw here and are scrubbed for display where they are painted.
 */

const MAX_TEXT = 64 * 1024;
const MAX_PATCH_LINES = 2000;
const MAX_LINE = 2000;

export const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const str = (value: unknown, limit = 256): string | undefined => typeof value === 'string' && value.length > 0 ? value.slice(0, limit) : undefined;
const num = (value: unknown, max = Number.MAX_SAFE_INTEGER): number | undefined => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= max ? value : undefined;
const strings = (value: unknown, count = 256, limit = 128): string[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string').slice(0, count).map(item => item.slice(0, limit)) : [];

/** Keep the beginning and the end of long output (where errors and summaries live), marking the cut. */
export function boundText(text: string, limit = MAX_TEXT): {text: string; truncated: boolean} {
  if (text.length <= limit) return {text, truncated: false};
  const head = Math.floor(limit / 4);
  return {text: `${text.slice(0, head)}\n… ${text.length - limit} characters not kept …\n${text.slice(text.length - (limit - head))}`, truncated: true};
}

// ---- Initialization ------------------------------------------------------------------------------------------------

export function parseCatalog(response: unknown, at: number): Catalog | undefined {
  if (!isRecord(response)) return undefined;
  const models = Array.isArray(response.models) ? response.models.flatMap(item => {
    if (!isRecord(item) || !str(item.value, 96) || !str(item.displayName, 96)) return [];
    const levels = strings(item.supportedEffortLevels, 8, 16);
    return [{value: str(item.value, 96)!, name: str(item.displayName, 96)!, ...(str(item.resolvedModel, 96) ? {resolved: str(item.resolvedModel, 96)!} : {}),
      ...(str(item.description, 300) ? {description: str(item.description, 300)!} : {}), ...(item.supportsEffort === true && levels.length ? {effortLevels: levels} : {}),
      ...(item.supportsFastMode === true ? {fastMode: true} : {})}];
  }).slice(0, 64) : [];
  const commands = Array.isArray(response.commands) ? response.commands.flatMap(item => {
    if (!isRecord(item) || !str(item.name, 64) || !/^[\w:.\-]+$/u.test(item.name as string)) return [];
    return [{name: str(item.name, 64)!, description: str(item.description, 300) ?? '', ...(str(item.argumentHint, 160) ? {argumentHint: str(item.argumentHint, 160)!} : {}),
      ...(strings(item.aliases, 8, 64).length ? {aliases: strings(item.aliases, 8, 64)} : {}), builtin: item.builtin === true}];
  }).slice(0, 400) : [];
  const account = isRecord(response.account) ? response.account : undefined;
  return {
    models, commands,
    agents: Array.isArray(response.agents) ? response.agents.flatMap(item => isRecord(item) && str(item.name, 64) ? [str(item.name, 64)!] : []).slice(0, 64) : [],
    outputStyles: strings(response.available_output_styles, 32, 64),
    ...(str(response.output_style, 64) ? {outputStyle: str(response.output_style, 64)!} : {}),
    ...(account ? {account: {...(str(account.apiProvider, 32) ? {provider: str(account.apiProvider, 32)!} : {}), ...(str(account.subscriptionType, 64) ? {plan: str(account.subscriptionType, 64)!} : {}),
      ...(str(account.email, 254) ? {email: str(account.email, 254)!} : {}), ...(str(account.organization, 128) ? {organization: str(account.organization, 128)!} : {})}} : {}),
    at,
  };
}

function parseRuntime(message: Record<string, unknown>, at: number): RuntimeInfo {
  const effort = message.effort === null ? null : str(message.effort, 16);
  return {
    ...(str(message.model, 96) ? {model: str(message.model, 96)!} : {}),
    ...(str(message.permissionMode, 32) ? {permissionMode: str(message.permissionMode, 32)!} : {}),
    tools: strings(message.tools, 256, 128),
    mcpServers: Array.isArray(message.mcp_servers) ? message.mcp_servers.flatMap(item => isRecord(item) && str(item.name, 128) ? [{name: str(item.name, 128)!, status: str(item.status, 32) ?? 'unknown', ...(str(item.source, 32) ? {source: str(item.source, 32)!} : {})}] : []).slice(0, 64) : [],
    slashCommands: strings(message.slash_commands, 400, 64),
    skills: strings(message.skills, 400, 64),
    plugins: Array.isArray(message.plugins) ? message.plugins.flatMap(item => isRecord(item) && str(item.name, 128) ? [{name: str(item.name, 128)!, ...(str(item.version, 32) ? {version: str(item.version, 32)!} : {})}] : []).slice(0, 128) : [],
    ...(str(message.output_style, 64) ? {outputStyle: str(message.output_style, 64)!} : {}),
    ...(str(message.claude_code_version, 32) ? {version: str(message.claude_code_version, 32)!} : {}),
    ...(effort !== undefined ? {effort} : {}),
    capabilities: strings(message.capabilities, 64, 64),
    at,
  };
}

export function parseContextUsage(response: unknown, detail: 'summary' | 'full'): ContextSnapshot | undefined {
  if (!isRecord(response) || num(response.totalTokens) === undefined || num(response.maxTokens) === undefined) return undefined;
  const kinds = new Set(['used', 'free', 'buffer', 'deferred']);
  const breakdown = isRecord(response.messageBreakdown) ? response.messageBreakdown : undefined;
  const apiUsage = isRecord(response.apiUsage) ? response.apiUsage : undefined;
  const skills = isRecord(response.skills) ? response.skills : undefined;
  return {
    ...(str(response.model, 96) ? {model: str(response.model, 96)!} : {}),
    totalTokens: num(response.totalTokens)!, maxTokens: num(response.maxTokens)!, percentage: num(response.percentage, 100) ?? 0,
    categories: Array.isArray(response.categories) ? response.categories.flatMap(item => isRecord(item) && str(item.name, 64) && num(item.tokens) !== undefined && kinds.has(item.kind as string)
      ? [{name: str(item.name, 64)!, tokens: num(item.tokens)!, kind: item.kind as ContextSnapshot['categories'][number]['kind']}] : []).slice(0, 32) : [],
    ...(num(response.autoCompactThreshold) !== undefined ? {autoCompactThreshold: num(response.autoCompactThreshold)!} : {}),
    autoCompact: response.isAutoCompactEnabled === true,
    memoryFiles: Array.isArray(response.memoryFiles) ? response.memoryFiles.flatMap(item => isRecord(item) && str(item.path, 1024) ? [{path: str(item.path, 1024)!, type: str(item.type, 32) ?? '', tokens: num(item.tokens) ?? 0}] : []).slice(0, 64) : [],
    mcpTools: Array.isArray(response.mcpTools) ? response.mcpTools.flatMap(item => isRecord(item) && str(item.name, 128) ? [{name: str(item.name, 128)!, server: str(item.serverName, 128) ?? '', tokens: num(item.tokens) ?? 0}] : []).slice(0, 256) : [],
    agents: Array.isArray(response.agents) ? response.agents.flatMap(item => isRecord(item) && str(item.agentType, 64) ? [{type: str(item.agentType, 64)!, source: str(item.source, 32) ?? '', tokens: num(item.tokens) ?? 0}] : []).slice(0, 64) : [],
    ...(skills && num(skills.totalSkills) !== undefined ? {skills: {total: num(skills.totalSkills)!, included: num(skills.includedSkills) ?? 0, tokens: num(skills.tokens) ?? 0}} : {}),
    ...(breakdown ? {messages: {toolCalls: num(breakdown.toolCallTokens) ?? 0, toolResults: num(breakdown.toolResultTokens) ?? 0, attachments: num(breakdown.attachmentTokens) ?? 0,
      assistant: num(breakdown.assistantMessageTokens) ?? 0, user: num(breakdown.userMessageTokens) ?? 0,
      byTool: Array.isArray(breakdown.toolCallsByType) ? breakdown.toolCallsByType.flatMap(item => isRecord(item) && str(item.name, 128) ? [{name: str(item.name, 128)!, call: num(item.callTokens) ?? 0, result: num(item.resultTokens) ?? 0}] : []).slice(0, 64) : []}} : {}),
    ...(apiUsage ? {apiUsage: {input: num(apiUsage.input_tokens) ?? 0, output: num(apiUsage.output_tokens) ?? 0, cacheRead: num(apiUsage.cache_read_input_tokens) ?? 0, cacheWrite: num(apiUsage.cache_creation_input_tokens) ?? 0}} : {}),
    detail,
  };
}

// ---- Tool results --------------------------------------------------------------------------------------------------

function parsePatch(value: unknown): {hunks: PatchHunk[]; added: number; removed: number; truncated: boolean} | undefined {
  if (!Array.isArray(value)) return undefined;
  const hunks: PatchHunk[] = [];
  let added = 0, removed = 0, lines = 0, truncated = false;
  for (const item of value.slice(0, 200)) {
    if (!isRecord(item) || !Array.isArray(item.lines)) continue;
    const kept: string[] = [];
    for (const line of item.lines) {
      if (typeof line !== 'string') continue;
      if (line.startsWith('+')) added++; else if (line.startsWith('-')) removed++;
      if (lines >= MAX_PATCH_LINES) { truncated = true; continue; }
      kept.push(line.length > MAX_LINE ? `${line.slice(0, MAX_LINE)}…` : line);
      lines++;
    }
    hunks.push({oldStart: num(item.oldStart) ?? 0, oldLines: num(item.oldLines) ?? 0, newStart: num(item.newStart) ?? 0, newLines: num(item.newLines) ?? 0, lines: kept});
  }
  if (value.length > 200) truncated = true;
  return {hunks, added, removed, truncated};
}

/** A tool's structured output by its shape (the documented *Output types). Contents of whole files are never kept. */
export function parseToolResult(value: unknown): ToolResult | undefined {
  if (!isRecord(value)) return undefined;
  if (typeof value.filePath === 'string' && Array.isArray(value.structuredPatch)) {
    const patch = parsePatch(value.structuredPatch)!;
    const created = value.type === 'create';
    // A created file's patch may be empty; its size is the written content's line count.
    const added = created && !patch.added && typeof value.content === 'string' ? value.content.split('\n').length : patch.added;
    return {kind: 'patch', path: value.filePath.slice(0, 4096), hunks: patch.hunks, added, removed: patch.removed, created, truncated: patch.truncated};
  }
  if (isRecord(value.file) && typeof value.file.filePath === 'string') {
    const file = value.file;
    return {kind: 'read', path: String(file.filePath).slice(0, 4096), ...(num(file.numLines) !== undefined ? {lines: num(file.numLines)!} : {}),
      ...(num(file.startLine) !== undefined ? {start: num(file.startLine)!} : {}), ...(num(file.totalLines) !== undefined ? {total: num(file.totalLines)!} : {}),
      ...(value.type === 'image' ? {image: true} : {})};
  }
  if (typeof value.stdout === 'string' || typeof value.stderr === 'string') {
    const out = boundText(typeof value.stdout === 'string' ? value.stdout : '');
    const err = boundText(typeof value.stderr === 'string' ? value.stderr : '', 16 * 1024);
    return {kind: 'bash', stdout: out.text, stderr: err.text, interrupted: value.interrupted === true, truncated: out.truncated || err.truncated,
      ...(str(value.backgroundTaskId, 64) ? {background: str(value.backgroundTaskId, 64)!} : {})};
  }
  if (num(value.numFiles) !== undefined && Array.isArray(value.filenames)) {
    return {kind: 'search', files: num(value.numFiles)!, ...(num(value.numMatches) !== undefined ? {matches: num(value.numMatches)!} : {}),
      ...(value.truncated === true ? {truncated: true} : {}), names: strings(value.filenames, 100, 1024)};
  }
  if (Array.isArray(value.newTodos)) {
    const todos = parseTodos(value.newTodos);
    return todos ? {kind: 'todos', todos} : undefined;
  }
  if (typeof value.agentId === 'string' && Array.isArray(value.content)) {
    const text = value.content.map(part => isRecord(part) && part.type === 'text' && typeof part.text === 'string' ? part.text : '').join('\n');
    return {kind: 'agent', text: boundText(text).text, ...(num(value.totalTokens) !== undefined ? {tokens: num(value.totalTokens)!} : {}),
      ...(num(value.totalToolUseCount) !== undefined ? {toolUses: num(value.totalToolUseCount)!} : {}), ...(num(value.totalDurationMs) !== undefined ? {durationMs: num(value.totalDurationMs)!} : {}),
      ...(str(value.agentType, 64) ? {agentType: str(value.agentType, 64)!} : {})};
  }
  return undefined;
}

export function parseTodos(value: unknown): TodoItem[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const statuses = new Set(['pending', 'in_progress', 'completed']);
  const todos = value.flatMap(item => isRecord(item) && typeof item.content === 'string' && statuses.has(item.status as string)
    ? [{content: item.content.slice(0, 500), status: item.status as TodoItem['status'], ...(str(item.activeForm, 500) ? {activeForm: str(item.activeForm, 500)!} : {})}] : []).slice(0, 100);
  return todos;
}

/** Permission rule offers in plain words. Only typed fields are read; anything unrecognized is not offered. */
export function parseSuggestions(value: unknown): PermissionSuggestion[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 8).flatMap(item => {
    if (!isRecord(item) || typeof item.type !== 'string' || typeof item.destination !== 'string') return [];
    const where = item.destination === 'session' ? 'for this session' : item.destination === 'localSettings' ? 'in this project (local settings)'
      : item.destination === 'projectSettings' ? 'in this project (shared settings)' : item.destination === 'userSettings' ? 'for every project (user settings)' : undefined;
    if (!where) return [];
    let label: string | undefined;
    if (item.type === 'addRules' && Array.isArray(item.rules) && item.behavior === 'allow') {
      const rules = item.rules.flatMap(rule => isRecord(rule) && typeof rule.toolName === 'string' ? [`${rule.toolName}${typeof rule.ruleContent === 'string' && rule.ruleContent ? `(${rule.ruleContent})` : ''}`] : []);
      if (rules.length) label = `Allow ${rules.join(', ').slice(0, 200)} ${where}`;
    } else if (item.type === 'setMode' && typeof item.mode === 'string') label = `Switch to ${item.mode} mode ${where}`;
    else if (item.type === 'addDirectories' && Array.isArray(item.directories)) label = `Allow access to ${strings(item.directories, 4, 512).join(', ')} ${where}`;
    return label ? [{update: item, label, destination: item.destination}] : [];
  });
}

// ---- Stream parser -------------------------------------------------------------------------------------------------

export interface PartialUpdate {
  /** The text of the content block streaming now, or undefined to clear it. */
  text?: string;
  thinking?: boolean;
}

export interface ClaudeParse {
  events: AgentEvent[];
  telemetry: TelemetryUpdate[];
  partial?: PartialUpdate;
  /** A response to one of NMSh's own control requests. */
  response?: {requestId: string; ok: boolean; body?: unknown; error?: string};
}

/** Tool names a tool result needs (file activity, todos) are remembered per tool_use id, bounded. */
export class ClaudeStream {
  private readonly tools = new Map<string, {name: string; input?: Record<string, unknown>}>();
  private partial = '';
  private streamingParent: string | null = null;

  constructor(private readonly now: () => number = Date.now) {}

  parse(message: Record<string, unknown>): ClaudeParse {
    const at = this.now();
    const out: ClaudeParse = {events: [], telemetry: []};
    const type = message.type;
    if (type === 'control_response' && isRecord(message.response) && typeof message.response.request_id === 'string') {
      const response = message.response;
      out.response = {requestId: response.request_id as string, ok: response.subtype === 'success',
        ...(response.subtype === 'success' ? {body: response.response} : {error: str(response.error, 300) ?? 'The provider refused the request'})};
      return out;
    }
    if (type === 'system') {
      switch (message.subtype) {
        case 'init': out.telemetry.push({kind: 'runtime', runtime: parseRuntime(message, at)}); break;
        case 'status':
          out.telemetry.push({kind: 'status', status: str(message.status, 32) ?? null, ...(str(message.permissionMode, 32) ? {permissionMode: str(message.permissionMode, 32)!} : {}), at});
          break;
        case 'compact_boundary': {
          const meta = isRecord(message.compact_metadata) ? message.compact_metadata : {};
          const pre = num(meta.pre_tokens);
          if (pre !== undefined) {
            const post = num(meta.post_tokens);
            const trigger = str(meta.trigger, 16) ?? 'auto';
            out.telemetry.push({kind: 'compaction', compaction: {at, trigger, preTokens: pre, ...(post !== undefined ? {postTokens: post} : {})}});
            out.events.push({kind: 'compacted', trigger, preTokens: pre, ...(post !== undefined ? {postTokens: post} : {})});
          }
          break;
        }
        case 'api_retry': {
          const attempt = num(message.attempt, 1000), max = num(message.max_retries, 1000);
          if (attempt !== undefined && max !== undefined) out.telemetry.push({kind: 'retry', attempt, max, delayMs: num(message.retry_delay_ms) ?? 0, ...(num(message.error_status, 999) ? {status: num(message.error_status, 999)!} : {}), at});
          break;
        }
        case 'task_started': case 'task_progress': case 'task_updated': case 'task_notification': {
          const id = str(message.task_id, 128);
          if (!id || message.ambient === true || message.skip_transcript === true) break;
          const usage = isRecord(message.usage) ? message.usage : undefined;
          const patch = isRecord(message.patch) ? message.patch : undefined;
          const status = message.subtype === 'task_started' ? 'running' : message.subtype === 'task_notification' ? str(message.status, 16) : str(patch?.status, 16);
          out.telemetry.push({kind: 'task', at, task: {id, ...(str(message.description ?? patch?.description, 300) ? {description: str(message.description ?? patch?.description, 300)!} : {}),
            ...(str(message.task_type, 32) ? {type: str(message.task_type, 32)!} : {}), ...(str(message.subagent_type, 64) ? {subagent: str(message.subagent_type, 64)!} : {}),
            ...(status ? {status} : {}), ...(str(message.tool_use_id, 128) ? {toolUseId: str(message.tool_use_id, 128)!} : {}),
            ...(str(message.parent_task_id, 128) ? {parent: str(message.parent_task_id, 128)!} : {}), ...(str(message.summary, 500) ? {summary: str(message.summary, 500)!} : {}),
            ...(str(message.last_tool_name, 64) ? {lastTool: str(message.last_tool_name, 64)!} : {}),
            ...(usage ? {...(num(usage.total_tokens) !== undefined ? {tokens: num(usage.total_tokens)!} : {}), ...(num(usage.tool_uses) !== undefined ? {toolUses: num(usage.tool_uses)!} : {}),
              ...(num(usage.duration_ms) !== undefined ? {durationMs: num(usage.duration_ms)!} : {})} : {}),
            ...(typeof message.is_backgrounded === 'boolean' ? {background: message.is_backgrounded} : patch && typeof patch.is_backgrounded === 'boolean' ? {background: patch.is_backgrounded} : {})}});
          break;
        }
      }
      return out;
    }
    if (type === 'rate_limit_event' && isRecord(message.rate_limit_info)) {
      const info = message.rate_limit_info;
      const kind = str(info.rateLimitType, 48) ?? 'unknown';
      const status = str(info.status, 32);
      if (status) out.telemetry.push({kind: 'rateLimit', type: kind, at, limit: {status, ...(num(info.utilization, 10) !== undefined ? {utilization: num(info.utilization, 10)!} : {}),
        ...(num(info.resetsAt) !== undefined ? {resetsAt: num(info.resetsAt)! * (num(info.resetsAt)! < 1e12 ? 1000 : 1)} : {})}});
      return out;
    }
    if (type === 'result') {
      const usage = isRecord(message.usage) ? message.usage : {};
      const perModel: Record<string, {input: number; output: number; cacheRead: number; cacheWrite: number; costUsd?: number; contextWindow?: number; maxOutput?: number}> = {};
      if (isRecord(message.modelUsage)) for (const [model, value] of Object.entries(message.modelUsage).slice(0, 16)) {
        if (!isRecord(value) || !/^[\w.:@/\-[\]]{1,96}$/u.test(model)) continue;
        perModel[model] = {input: num(value.inputTokens) ?? 0, output: num(value.outputTokens) ?? 0, cacheRead: num(value.cacheReadInputTokens) ?? 0, cacheWrite: num(value.cacheCreationInputTokens) ?? 0,
          ...(num(value.costUSD) !== undefined ? {costUsd: num(value.costUSD)!} : {}), ...(num(value.contextWindow) ? {contextWindow: num(value.contextWindow)!} : {}),
          ...(num(value.maxOutputTokens) ? {maxOutput: num(value.maxOutputTokens)!} : {})};
      }
      out.telemetry.push({kind: 'usage', at, usage: {perModel, ...(num(message.total_cost_usd) !== undefined ? {costUsd: num(message.total_cost_usd)!} : {}),
        lastTurn: {input: num(usage.input_tokens) ?? 0, output: num(usage.output_tokens) ?? 0, cacheRead: num(usage.cache_read_input_tokens) ?? 0, cacheWrite: num(usage.cache_creation_input_tokens) ?? 0},
        turns: num(message.num_turns) ?? 0, durationMs: num(message.duration_ms) ?? 0, apiMs: num(message.duration_api_ms) ?? 0}});
      out.telemetry.push({kind: 'settled', at});
      this.partial = '';
      out.partial = {};
      return out;
    }
    if (type === 'stream_event' && isRecord(message.event)) {
      // Streaming is presentation: the completed assistant message that follows is the only source.
      const parent = typeof message.parent_tool_use_id === 'string' ? message.parent_tool_use_id : null;
      const event = message.event;
      if (event.type === 'message_start') { this.partial = ''; this.streamingParent = parent; return out; }
      if (parent !== this.streamingParent || parent) return out;
      if (event.type === 'content_block_start' && isRecord(event.content_block)) {
        if (event.content_block.type === 'thinking' || event.content_block.type === 'redacted_thinking') out.partial = {thinking: true};
        else if (event.content_block.type === 'text') { this.partial = ''; out.partial = {text: ''}; }
      } else if (event.type === 'content_block_delta' && isRecord(event.delta) && event.delta.type === 'text_delta' && typeof event.delta.text === 'string') {
        if (this.partial.length < 512 * 1024) this.partial += event.delta.text;
        out.partial = {text: this.partial};
      }
      return out;
    }
    if (type === 'assistant' || type === 'user') {
      const parent = typeof message.parent_tool_use_id === 'string' ? message.parent_tool_use_id.slice(0, 128) : undefined;
      const content = isRecord(message.message) && Array.isArray(message.message.content) ? message.message.content : [];
      if (type === 'assistant') {
        for (const part of content) {
          if (!isRecord(part) || part.type !== 'tool_use' || typeof part.id !== 'string' || typeof part.name !== 'string') continue;
          const input = isRecord(part.input) ? part.input : undefined;
          if (this.tools.size > 4096) this.tools.delete(this.tools.keys().next().value!);
          this.tools.set(part.id, {name: part.name, ...(input ? {input} : {})});
          out.telemetry.push(...this.toolStarted(part.name, input, at));
        }
        if (content.some(part => isRecord(part) && part.type === 'text') && !parent) { this.partial = ''; out.partial = {}; }
      } else {
        const result = parseToolResult(message.tool_use_result);
        for (const part of content) {
          if (!isRecord(part) || part.type !== 'tool_result' || typeof part.tool_use_id !== 'string') continue;
          const tool = this.tools.get(part.tool_use_id);
          if (result?.kind === 'patch' && part.is_error !== true) {
            out.telemetry.push({kind: 'file', path: result.path, action: tool?.name === 'Write' || result.created ? 'write' : 'edit', added: result.added, removed: result.removed, patch: result.hunks, at});
          }
        }
      }
      return out;
    }
    return out;
  }

  /** The structured result for a tool_result block in a user message, when the message carries one. */
  resultFor(message: Record<string, unknown>): ToolResult | undefined {
    return parseToolResult(message.tool_use_result);
  }

  private toolStarted(name: string, input: Record<string, unknown> | undefined, at: number): TelemetryUpdate[] {
    const updates: TelemetryUpdate[] = [];
    const path = typeof input?.file_path === 'string' ? input.file_path : typeof input?.notebook_path === 'string' ? input.notebook_path : undefined;
    // Reads are counted when requested; edits and writes when their result reports the patch (a denied edit changes nothing).
    if (path && name === 'Read') updates.push({kind: 'file', path: path.slice(0, 4096), action: 'read', at});
    if (name === 'TodoWrite') {
      const todos = parseTodos(input?.todos);
      if (todos) updates.push({kind: 'todos', todos, at});
    }
    return updates;
  }
}
