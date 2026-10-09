import {assignSignature} from '../../session/signatures.js';
import {basename, isAbsolute} from 'node:path';
import {resolveCommand} from '../../providers/providers.js';
import {harness, HARNESSES, type HarnessDescriptor} from '../harnesses.js';
import {ClaudeSession, EFFORT_LEVELS, type ControlResult} from './claudeAdapter.js';
import {applyTelemetry, emptyTelemetry, type ContextSnapshot, type TelemetryUpdate} from '../telemetry.js';
import type {TargetAdapter} from '../targets/adapter.js';
import {capabilityFacts, updateCapabilities} from '../targets/capabilities.js';
import {AgentTranscript} from '../transcript/model.js';
import {scanAgents, type DiscoveredAgent} from './discovery.js';
import {pushEvent, titleFromPrompt, type AgentEvent, type AgentSession} from './model.js';

/**
 * Launch profiles: provider-specific, non-secret launch settings. Only fields
 * an adapter supports are kept; credentials, tokens and arbitrary shell text
 * are never stored (authentication stays with the harness).
 */
export interface AgentProfile {
  name: string;
  harness: string;
  label?: string;
  /** Claude: --model value. */
  model?: string;
  /** Claude: --permission-mode, one of the modes the CLI documents (never bypassPermissions). */
  permissionMode?: 'acceptEdits' | 'auto' | 'manual' | 'dontAsk' | 'plan';
  /** Claude: --effort at launch (session-only in Claude; NMSh never writes Claude's settings). */
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  /** Claude: CLAUDE_CONFIG_DIR, the harness's own config/account directory selector. */
  configDir?: string;
}

const PERMISSION_MODES = new Set(['acceptEdits', 'auto', 'manual', 'dontAsk', 'plan']);

export function normalizeProfiles(value: unknown): AgentProfile[] {
  if (!Array.isArray(value)) return [];
  const profiles: AgentProfile[] = [];
  for (const raw of value.slice(0, 32)) {
    const item = raw as Record<string, unknown>;
    if (typeof item?.name !== 'string' || !/^[\w.-]{1,40}$/u.test(item.name) || typeof item.harness !== 'string' || !harness(item.harness)) continue;
    if (profiles.some(profile => profile.name === item.name)) continue;
    const profile: AgentProfile = {name: item.name, harness: item.harness};
    if (typeof item.label === 'string') profile.label = item.label.slice(0, 40);
    if (item.harness === 'claude') {
      if (typeof item.model === 'string' && /^[\w.:@-]{1,64}$/u.test(item.model)) profile.model = item.model;
      if (typeof item.permissionMode === 'string' && PERMISSION_MODES.has(item.permissionMode)) profile.permissionMode = item.permissionMode as AgentProfile['permissionMode'];
      if (typeof item.configDir === 'string' && isAbsolute(item.configDir) && !/[\n\u0000]/u.test(item.configDir)) profile.configDir = item.configDir;
      if (typeof item.effort === 'string' && (EFFORT_LEVELS as readonly string[]).includes(item.effort)) profile.effort = item.effort as AgentProfile['effort'];
    }
    profiles.push(profile);
  }
  return profiles;
}

export type LaunchResult = {ok: true; session: AgentSession} | {ok: false; reason: string};

export interface AgentEnvironment {
  resolve(executable: string): string | undefined;
  scan(exclude: ReadonlySet<number>): Promise<DiscoveredAgent[]>;
  now(): number;
  /** Claude's --help text (tests), else the installed CLI is asked. */
  claudeHelp?: string;
}

export const systemAgentEnvironment: AgentEnvironment = {resolve: name => resolveCommand(name), scan: exclude => scanAgents(exclude), now: () => Date.now()};

let ordinal = 0;

export class AgentSessions {
  readonly sessions: AgentSession[] = [];
  private readonly controls = new Map<string, TargetAdapter>();
  private readonly profiles = new Map<string, AgentProfile>();
  private listeners = new Set<(session?: AgentSession, event?: AgentEvent) => void>();
  scanning = false;

  constructor(private readonly env: AgentEnvironment = systemAgentEnvironment) {}

  onChange(listener: (session?: AgentSession, event?: AgentEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  private emit(session?: AgentSession, event?: AgentEvent): void { for (const listener of this.listeners) listener(session, event); }

  get(id: string): AgentSession | undefined { return this.sessions.find(session => session.id === id); }

  /** Installed and controllable state of every registered harness, for /ai. */
  harnesses(): Array<{harness: HarnessDescriptor; executable?: string; controllable: boolean}> {
    return HARNESSES.map(item => {
      const executable = item.executables.map(name => this.env.resolve(name)).find(Boolean);
      return {harness: item, ...(executable ? {executable} : {}), controllable: Boolean(executable && item.control)};
    });
  }

  /** Start a managed session in the background; the shell stays where it is. */
  launch(harnessId: string, cwd: string, options: {prompt?: string; profile?: AgentProfile} = {}): LaunchResult {
    const descriptor = harness(harnessId);
    if (!descriptor) return {ok: false, reason: `NMSh doesn't know a harness called ${harnessId}.`};
    const executable = descriptor.executables.map(name => this.env.resolve(name)).find(Boolean);
    if (!executable) return {ok: false, reason: `${descriptor.name} is not installed (${descriptor.executables.join(', ')} not found). NMSh has no verified install recipe for it; install it from its official instructions.`};
    if (descriptor.control !== 'claude-stream-json') return {ok: false, reason: descriptor.controlNote ?? `NMSh has no supported control channel for ${descriptor.name}.`};
    ordinal += 1;
    const now = this.env.now();
    const id = `agent-${now.toString(36)}-${ordinal}`;
    const session: AgentSession = {id, harness: descriptor.id, level: 'managed', cwd, signature: assignSignature(id, this.sessions.flatMap(item => item.signature ? [item.signature] : [])),
      title: options.profile?.label ?? `${basename(cwd) || descriptor.short} · ${descriptor.short} ${ordinal}`, startedAt: now, state: 'starting', events: [], attention: false, updatedAt: now};
    const profile = options.profile?.harness === descriptor.id ? options.profile : undefined;
    if (profile) session.profileId = profile.name;
    session.capabilities = capabilityFacts(id, 'managed', descriptor.id);
    session.telemetry = emptyTelemetry();
    try {session.transcript = new AgentTranscript();} catch {return {ok: false, reason: 'Cannot create private agent source storage.'};}
    if (profile) this.profiles.set(id, profile);
    const started = this.startControl(session, profile);
    if (!started.ok) {session.transcript.dispose(); return started;}
    this.sessions.push(session);
    if (options.prompt) this.send(session.id, options.prompt);
    this.emit(session);
    return {ok: true, session};
  }

  private startControl(session: AgentSession, profile?: AgentProfile, resume?: string): {ok: true} | {ok: false; reason: string} {
    const executable = this.env.resolve('claude');
    if (!executable || !session.cwd) return {ok: false, reason: 'Claude executable or workspace unavailable'};
    const args = [...(profile?.model ? ['--model', profile.model] : []), ...(profile?.permissionMode ? ['--permission-mode', profile.permissionMode] : [])];
    session.telemetry ??= emptyTelemetry();
    const control = new ClaudeSession({executable, cwd: session.cwd, args, ...(resume ? {resume} : {}), ...(profile?.configDir ? {env: {...process.env, CLAUDE_CONFIG_DIR: profile.configDir}} : {}),
      ...(profile?.effort ? {effort: profile.effort} : {}),
      onEvent: event => { if (event.kind === 'incomplete') session.transcript?.source.markIncomplete(event.reason); pushEvent(session, event, this.env.now()); updateCapabilities(session.capabilities!, event, this.env.now()); if (event.kind === 'started') session.reconnectable = Boolean(event.harnessSessionId && control.capabilities.resume); if (event.kind === 'exited') this.controls.delete(session.id); this.emit(session, event); },
      onTelemetry: update => this.telemetry(session, update),
      onPartial: partial => {
        // Presentation only: the streaming text is replaced by the provider's completed message, never stored.
        const now = this.env.now();
        session.partial = partial.thinking ? {text: '', at: now, thinking: true} : partial.text === undefined ? undefined : {text: partial.text, at: now};
        this.emitPartial(session);
      }}, this.env.claudeHelp);
    if (profile?.effort) applyTelemetry(session.telemetry, {kind: 'requested', field: 'effort', value: profile.effort, at: this.env.now()});
    const started = control.start();
    if (!started.ok) return started;
    session.pid = control.pid;
    this.controls.set(session.id, control);
    return {ok: true};
  }

  resume(id: string): {ok: true} | {ok: false; reason: string} {
    const session = this.get(id);
    if (this.controls.has(id)) return {ok: true};
    if (!session?.reconnectable || !session.harnessSessionId || session.level !== 'managed') return {ok: false, reason: 'No supported reconnectable target'};
    session.capabilities = capabilityFacts(id, session.level, session.harness);
    session.state = 'starting';
    return this.startControl(session, this.profiles.get(id), session.harnessSessionId);
  }

  /** Apply one telemetry update; account-wide rate limits also reach live targets of the same launch profile, labelled. */
  private telemetry(session: AgentSession, update: TelemetryUpdate): void {
    session.telemetry ??= emptyTelemetry();
    applyTelemetry(session.telemetry, update);
    if (update.kind === 'rateLimit') {
      const key = session.profileId ?? '';
      for (const other of this.sessions) {
        if (other === session || other.harness !== session.harness || (other.profileId ?? '') !== key || !other.telemetry) continue;
        applyTelemetry(other.telemetry, {...update, limit: {...update.limit, from: session.title}});
      }
    }
    this.emit(session);
  }

  private partialListeners = new Set<(session: AgentSession) => void>();
  /** Streaming text changes often; hosts subscribe separately so they can coalesce frames. */
  onPartial(listener: (session: AgentSession) => void): () => void {
    this.partialListeners.add(listener);
    return () => this.partialListeners.delete(listener);
  }
  private emitPartial(session: AgentSession): void { for (const listener of this.partialListeners) listener(session); }

  /** The live control channel of a managed target, when its provider accepted one. */
  private control(id: string): ClaudeSession | undefined {
    const control = this.controls.get(id);
    return control instanceof ClaudeSession ? control : undefined;
  }

  /** Whether a target can take runtime controls (model, effort, permission mode, context, MCP) right now. */
  controllable(id: string): boolean { return Boolean(this.control(id)?.controllable); }

  async setModel(id: string, model: string | undefined): Promise<ControlResult> {
    return this.control(id)?.setModel(model) ?? {ok: false, reason: 'This target has no live control channel'};
  }

  async setEffort(id: string, level: string | null): Promise<ControlResult> {
    return this.control(id)?.setEffort(level) ?? {ok: false, reason: 'This target has no live control channel'};
  }

  async setPermissionMode(id: string, mode: string): Promise<ControlResult> {
    return this.control(id)?.setPermissionMode(mode) ?? {ok: false, reason: 'This target has no live control channel'};
  }

  async contextUsage(id: string, detail: 'summary' | 'full' = 'summary'): Promise<ControlResult<ContextSnapshot>> {
    return this.control(id)?.contextUsage(detail) ?? {ok: false, reason: 'This target has no live control channel'};
  }

  async mcpStatus(id: string): Promise<ControlResult<unknown[]>> {
    return this.control(id)?.mcpStatus() ?? {ok: false, reason: 'This target has no live control channel'};
  }

  async mcpToggle(id: string, name: string, enabled: boolean): Promise<ControlResult> {
    return this.control(id)?.mcpToggle(name, enabled) ?? {ok: false, reason: 'This target has no live control channel'};
  }

  async mcpReconnect(id: string, name: string): Promise<ControlResult> {
    return this.control(id)?.mcpReconnect(name) ?? {ok: false, reason: 'This target has no live control channel'};
  }

  async stopTask(id: string, taskId: string): Promise<ControlResult> {
    return this.control(id)?.stopTask(taskId) ?? {ok: false, reason: 'This target has no live control channel'};
  }

  /** Text for a managed session; observed sessions never accept input. */
  send(id: string, text: string): boolean {
    const session = this.get(id);
    const control = this.controls.get(id);
    if (!session || session.level === 'observed' || !control || !text.trim()) return false;
    if (!session.events.some(event => event.kind === 'user') && session.title.includes(' · ')) session.title = titleFromPrompt(text, session.title);
    return control.send(text);
  }

  /**
   * The person's explicit answer to a pending approval; NMSh never answers on its own. `remember` selects one of the
   * rule changes the provider offered with this very request (by index), never one NMSh composed.
   */
  answer(id: string, allow: boolean, remember?: number): boolean {
    const session = this.get(id);
    const pending = session?.pendingApproval;
    const control = this.controls.get(id);
    const suggestion = remember === undefined ? undefined : pending?.suggestions?.[remember];
    if (remember !== undefined && !suggestion) return false;
    return Boolean(session && pending && control && control.answer(pending.requestId, allow, suggestion));
  }

  choose(id: string, requestId: string, answers: Record<string, string>): boolean {
    return this.get(id)?.pendingChoice?.requestId === requestId && Boolean(this.controls.get(id)?.choose?.(requestId, answers));
  }

  cancel(id: string): boolean { const control = this.controls.get(id); control?.cancel(); return Boolean(control); }

  rename(id: string, title: string): boolean {
    const session = this.get(id);
    const clean = title.replace(/[\u0000-\u001f\u007f]/gu, '').trim().slice(0, 60);
    if (!session || !clean) return false;
    pushEvent(session, {kind: 'renamed', title: clean}, this.env.now());
    this.emit(session);
    return true;
  }

  /** The user saw it: normal auto-hide resumes. */
  acknowledge(id: string): void {
    const session = this.get(id);
    if (session?.attention) { session.attention = false; this.emit(session); }
  }

  close(id: string): void {
    this.controls.get(id)?.close();
    const index = this.sessions.findIndex(session => session.id === id);
    if (index >= 0 && this.sessions[index]!.level !== 'managed') this.sessions.splice(index, 1);
  }

  /** Merge a discovery scan: new observed agents appear, vanished ones go; managed processes are never duplicated. */
  async discover(): Promise<void> {
    if (this.scanning) return;
    this.scanning = true;
    try {
      const managed = new Set(this.sessions.flatMap(session => session.level === 'managed' && session.pid ? [session.pid] : []));
      const found = await this.env.scan(managed);
      const live = new Set(found.map(agent => agent.pid));
      let changed = false;
      for (let index = this.sessions.length - 1; index >= 0; index -= 1) {
        const session = this.sessions[index]!;
        if (session.level === 'observed' && !live.has(session.pid!)) { this.sessions.splice(index, 1); changed = true; }
      }
      for (const agent of found) {
        if (this.sessions.some(session => session.pid === agent.pid)) continue;
        const descriptor = harness(agent.harness)!;
        this.sessions.push({id: `observed-${agent.pid}`, harness: agent.harness, level: 'observed', title: descriptor.short,
          signature: assignSignature(`observed-${agent.pid}`, this.sessions.flatMap(item => item.signature ? [item.signature] : [])), ...(agent.cwd ? {cwd: agent.cwd} : {}),
          startedAt: agent.startedAt, state: 'running', pid: agent.pid, ...(agent.tty ? {tty: agent.tty} : {}), events: [], attention: false, updatedAt: this.env.now(), capabilities: capabilityFacts(`observed-${agent.pid}`, 'observed', agent.harness)});
        changed = true;
      }
      if (changed) this.emit();
    } finally { this.scanning = false; }
  }

  dispose(): void {
    for (const control of this.controls.values()) control.close();
    this.controls.clear();
    for (const session of this.sessions) session.transcript?.dispose();
    this.profiles.clear();
    this.listeners.clear();
    this.partialListeners.clear();
  }
}
