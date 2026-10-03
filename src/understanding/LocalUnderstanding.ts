import type {LocalUnderstandingSettings} from '../prompt/configuration.js';
import {discoverLocal, systemDiscoveryAdapters, type DiscoveryAdapters, type FoundModel, type FoundRuntime} from './discovery.js';
import {ModelClient, type ModelStatus} from './ModelClient.js';
import {validateFoldHint, validateInterpretation, type FoldHint, type FoldRequest, type IntentInterpretation, type IntentRequest} from './tasks.js';

export type UnderstandingScope = 'ask' | 'folding';
export const SCOPE_LABELS: Record<UnderstandingScope, string> = {ask: 'Ask', folding: 'Smart Folding'};

/**
 * The one entry point NMSh features use for optional local understanding.
 * Off creates nothing: no client, no service, no model. A feature may use the
 * model only when the mode is on, its own scope is enabled and a model is
 * chosen. Every failure is "no answer", so callers keep their deterministic
 * behavior; model failure is never reported as the user's misunderstanding.
 */
export class LocalUnderstanding {
  private client?: ModelClient;
  status?: ModelStatus;
  discovery?: {runtimes: FoundRuntime[]; models: FoundModel[]};
  /** Diagnostics: how many inference requests this window sent. */
  requests = 0;

  constructor(private readonly settings: () => LocalUnderstandingSettings,
    private readonly makeClient: () => ModelClient = () => new ModelClient(),
    private readonly adapters: () => DiscoveryAdapters = systemDiscoveryAdapters) {}

  eligible(scope: UnderstandingScope): boolean {
    const settings = this.settings();
    return settings.mode !== 'off' && settings[scope] && Boolean(settings.model);
  }

  /** Always prefers the model for an eligible scope; Auto asks only when built-in understanding is unsure. */
  get prefersModel(): boolean { return this.settings().mode === 'always'; }

  private connection(): ModelClient {
    this.client ??= this.makeClient();
    return this.client;
  }

  async interpretAsk(request: IntentRequest, capabilityIds: ReadonlySet<string>): Promise<IntentInterpretation | undefined> {
    if (!this.eligible('ask')) return undefined;
    const settings = this.settings();
    this.requests += 1;
    const output = await this.connection().infer('intent', request, {priority: 'interactive', mode: settings.mode, model: settings.model!, timeoutMs: 10_000});
    return validateInterpretation(output, capabilityIds);
  }

  async foldHint(request: FoldRequest): Promise<FoldHint | undefined> {
    if (!this.eligible('folding')) return undefined;
    const settings = this.settings();
    this.requests += 1;
    const output = await this.connection().infer('fold', request, {priority: 'background', mode: settings.mode, model: settings.model!, timeoutMs: 4_000});
    return validateFoldHint(output);
  }

  /** Status of an already-running shared service; never starts one. */
  async refreshStatus(): Promise<ModelStatus | undefined> {
    if (this.settings().mode === 'off') { this.status = undefined; return undefined; }
    this.status = await this.connection().status();
    return this.status;
  }

  /** Local, bounded discovery; cached until asked again. Never loads a model or touches the network. */
  async discover(again = false): Promise<{runtimes: FoundRuntime[]; models: FoundModel[]}> {
    if (!this.discovery || again) this.discovery = await discoverLocal(this.adapters());
    return this.discovery;
  }

  /** Off unloads the shared model (once other windows' work finishes) and drops this window's connection. */
  modeChanged(): void {
    if (this.settings().mode !== 'off') return;
    this.client?.configure('off');
    this.client?.close();
    this.client = undefined;
    this.status = undefined;
  }

  dispose(): void { this.client?.close(); this.client = undefined; }
}

const scopes = (settings: LocalUnderstandingSettings) => (['ask', 'folding'] as const).filter(scope => settings[scope]).map(scope => SCOPE_LABELS[scope]);

/**
 * One concise welcome row. It names a model only when the shared service
 * reports one loaded; configured-but-idle is said as such. Snapshotted with
 * the presentation, so later load/unload never rewrites an archived welcome.
 */
export function understandingWelcomeText(settings: LocalUnderstandingSettings, status?: ModelStatus): string {
  if (settings.mode === 'off') return 'Off';
  const used = scopes(settings);
  const mode = settings.mode === 'auto' ? 'Auto' : 'Always';
  if (!used.length) return `${mode} · no features enabled`;
  if (!settings.model) return `${mode} · not set up · ${used.join(', ')}`;
  if (status && (status.state === 'ready' || status.state === 'busy') && status.model) return `${status.model} · ${used.join(', ')}`;
  return `${mode} · model idle · ${used.join(', ')}`;
}

/** /status and /providers rows: factual, shared-service wide, never another window's content. */
export function understandingStatusRows(settings: LocalUnderstandingSettings, status?: ModelStatus): Array<{label: string; value: string}> {
  const rows = [{label: 'Mode', value: settings.mode === 'off' ? 'Off' : settings.mode === 'auto' ? 'Auto' : 'Always'}];
  if (settings.mode === 'off') return rows;
  rows.push({label: 'Model', value: settings.model ? `${settings.model.label}${settings.model.owned ? ' (downloaded by NMSh)' : ' (found on this machine)'}` : 'not set up'});
  if (settings.model) rows.push({label: 'Runtime', value: settings.model.runtime});
  rows.push({label: 'State', value: status ? `${status.state[0]!.toUpperCase()}${status.state.slice(1)}${status.error ? ` · ${status.error}` : ''}` : 'not running (starts on first use)'});
  rows.push({label: 'Scope', value: scopes(settings).join(', ') || 'none enabled'});
  if (status) rows.push({label: 'Clients', value: `Shared by ${status.clients} NMSh session${status.clients === 1 ? '' : 's'}`});
  return rows;
}
