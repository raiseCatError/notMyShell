import {drive, driveSync, runCommand, runCommandSync, sleepSync, type Runner, type SyncRunner} from './run.js';
import {refuse, type MaximizeResult, type OwnedWindow, type Probe, type Refused, type RestoreResult, type WindowHost} from './types.js';

export interface FirstRunWindowOptions {
  run?: Runner;
  runSync?: SyncRunner;
  sleep?: (ms: number) => Promise<void>;
  sleepSync?: (ms: number) => void;
}

type Maximized = Extract<MaximizeResult, {outcome: 'maximized'}>;

/**
 * The one-time window offer of a genuine first run, in process memory only:
 * nothing about it is saved, so later launches and `/startup` never see it.
 * One read-only probe; an offer only when the window is NMSh's own and in its
 * normal state; maximize only on consent; one restore, only of what NMSh
 * changed and only while it is still exactly as NMSh left it. Operations run
 * one at a time, so a restore asked for mid-maximize waits for it.
 */
export class FirstRunWindow {
  private probing?: Promise<boolean>;
  private window?: OwnedWindow;
  private phase: 'idle' | 'offered' | 'declined' | 'accepted' = 'idle';
  private maximized?: Maximized;
  private queue: Promise<unknown> = Promise.resolve();
  /** Why there is no offer (after a probe), or why maximize changed nothing. */
  refusal?: Refused;

  constructor(private readonly host: () => WindowHost | Refused, private readonly options: FirstRunWindowOptions = {}) {}

  probe(): Promise<boolean> {
    this.probing ??= (async () => {
      let found: Probe;
      try {
        const host = this.host();
        found = 'probe' in host ? await drive(host.probe(), this.options.run ?? runCommand, this.options.sleep) : host;
      } catch (error) { found = refuse('failed', error instanceof Error ? error.message : String(error)); }
      if (found.outcome !== 'available') { this.refusal = found; return false; }
      this.window = found.window;
      this.phase = 'offered';
      return true;
    })();
    return this.probing;
  }

  /** The offer is open: probed available, and neither accepted nor declined. */
  get offered(): boolean { return this.phase === 'offered'; }

  /** Whether NMSh has changed the window and not yet put it back. */
  get changed(): boolean { return Boolean(this.maximized); }

  decline(): void {
    if (this.phase === 'offered') this.phase = 'declined';
  }

  accept(): Promise<MaximizeResult['outcome'] | undefined> {
    const window = this.window;
    if (this.phase !== 'offered' || !window) return Promise.resolve(undefined);
    this.phase = 'accepted';
    return this.serial(async () => {
      let result: MaximizeResult;
      try { result = await drive(window.maximize(), this.options.run ?? runCommand, this.options.sleep); }
      catch (error) { result = refuse('failed', error instanceof Error ? error.message : String(error)); }
      if (result.outcome === 'maximized') this.maximized = result;
      else this.refusal = {outcome: result.outcome === 'unchanged' ? 'failed' : result.outcome, reason: result.reason};
      return result.outcome;
    });
  }

  restore(): Promise<RestoreResult | undefined> {
    return this.serial(async () => {
      const maximized = this.take();
      if (!maximized) return undefined;
      try { return await drive(maximized.restore(), this.options.run ?? runCommand, this.options.sleep); }
      catch (error) { return {outcome: 'failed', reason: error instanceof Error ? error.message : String(error)}; }
    });
  }

  /** Exit: the same restore, synchronous and bounded (best effort; a maximize still running is not waited for). */
  restoreNow(): RestoreResult | undefined {
    const maximized = this.take();
    if (!maximized) return undefined;
    try { return driveSync(maximized.restore(), this.options.runSync ?? runCommandSync, this.options.sleepSync ?? sleepSync); }
    catch (error) { return {outcome: 'failed', reason: error instanceof Error ? error.message : String(error)}; }
  }

  private take(): Maximized | undefined {
    const maximized = this.maximized;
    this.maximized = undefined;
    return maximized;
  }

  private serial<T>(work: () => Promise<T>): Promise<T> {
    const next = this.queue.then(work, work);
    this.queue = next.catch(() => undefined);
    return next;
  }
}
