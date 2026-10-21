/**
 * Queue all: a reviewed list that may mix shell commands and NMSh's own commands, run in order after one confirmation.
 *
 * It owns no queue of its own. A run of shell commands is added to the session's queue (the owner that already runs them
 * one at a time, in the session's shell, with its failure policy, approval, interrupt and session-isolation rules), and
 * NMSh commands (`/modules`, `/track …`, `/view`) are handed to NMSh's own dispatcher through the composer's submit path,
 * so none of them can reach the shell. Between steps it waits: for the queue to drain, for a foreground program to end,
 * for a panel a command opened to close and for the composer to be empty. It never types into a running program, so a
 * command waiting for input is never answered or bypassed. A failure, an interrupt, a paused or cleared queue, or Esc
 * stops it, and the commands not yet started are reported, never run.
 */
export interface SequenceItem {
  text: string;
  /** One of NMSh's own commands: dispatched in NMSh, never added to the shell's queue. */
  nmsh: boolean;
}

export interface SequenceQueueView {
  entries: number;
  dispatching: boolean;
  paused: boolean;
  /** The newest execution chain, when the owner has one. */
  chain?: {id: number; status: 'active' | 'finished' | 'cleared' | 'shell-ended'; failurePolicy: 'pause' | 'continue'; failed: number; interrupted: number};
}

export interface SequenceHost {
  queueView(): SequenceQueueView;
  /** Free places in the session's queue. */
  queueFree(): number;
  addShell(text: string): void;
  /** A foreground program, a passthrough or a start-up in progress owns the terminal. */
  foregroundBusy(): boolean;
  /** A panel or viewer is open (a command opened it): the next step waits for it to close. */
  modalOpen(): boolean;
  composerEmpty(): boolean;
  /** Dispatch one NMSh command exactly as if it were submitted from the composer. */
  runNmsh(text: string): Promise<void>;
  say(text: string): void;
  changed(): void;
}

type Phase =
  | {kind: 'idle'}
  | {kind: 'nmsh'}
  | {kind: 'shell'; count: number; base?: {id: number; status: string; bad: number}};

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

export class BatchSequencer {
  /** Items finished (the one in flight is not counted until it ends). */
  private done = 0;
  private phase: Phase = {kind: 'idle'};
  private ended = false;
  private stopping: string | undefined;

  constructor(private readonly items: readonly SequenceItem[], private readonly host: SequenceHost) {}

  get active(): boolean { return !this.ended; }
  get total(): number { return this.items.length; }

  /** One quiet line for the strip above the composer: where the sequence is and how to stop it. */
  statusLine(): string {
    const inFlight = this.phase.kind === 'shell' ? this.phase.count : this.phase.kind === 'nmsh' ? 1 : 0;
    const waiting = this.phase.kind === 'idle' && this.done < this.items.length
      ? (this.host.modalOpen() ? ' · continues when the panel closes' : !this.host.composerEmpty() ? ' · continues when the composer is empty' : '') : '';
    return `Queue all · ${Math.min(this.items.length, this.done + inFlight)} of ${this.items.length}${waiting}${this.stopping !== undefined ? ' · stopping' : ' · Esc stops'}`;
  }

  /** End the sequence: nothing more is started, and what already runs is left to finish. */
  stop(why = 'Stopped'): void {
    if (this.ended) return;
    this.stopping = why;
    if (this.phase.kind === 'idle') this.finish(why);
    else this.host.say('Queue all will stop when the command that is running or queued now ends; the rest will not start. /queue manages what is queued.');
  }

  /** Advance as far as the current state allows. Safe to call as often as the state changes. */
  poke(): void {
    if (this.ended) return;
    const phase = this.phase;
    if (phase.kind === 'nmsh') return;
    if (phase.kind === 'shell') { this.watchShell(phase); return; }
    if (this.stopping !== undefined) { this.finish(this.stopping); return; }
    if (this.done >= this.items.length) { this.finish(); return; }
    const view = this.host.queueView();
    const item = this.items[this.done]!;
    if (item.nmsh) {
      if (view.paused) { this.finish('The queue is paused'); return; }
      // NMSh's own command: only at a free prompt with nothing queued ahead of it, and never over a panel or a draft.
      if (this.host.foregroundBusy() || this.host.modalOpen() || !this.host.composerEmpty()) return;
      if (view.entries > 0 || view.dispatching) return;
      this.phase = {kind: 'nmsh'};
      const settle = (why?: string) => {
        this.phase = {kind: 'idle'};
        if (why === undefined) this.done += 1;
        if (why !== undefined) this.finish(why);
        else { this.host.changed(); this.poke(); }
      };
      this.host.runNmsh(item.text).then(() => settle(), () => settle('That command failed'));
      return;
    }
    // A run of shell commands goes to the session's queue together, so /queue shows them and the owner runs them in order.
    // A queue the person paused still takes them (they wait there for /queue), and the sequence ends with that said.
    let count = 0;
    while (this.done + count < this.items.length && !this.items[this.done + count]!.nmsh) count += 1;
    if (this.host.queueFree() < count) return;
    const chain = view.chain;
    const base = chain ? {id: chain.id, status: chain.status, bad: chain.failed + chain.interrupted} : undefined;
    for (let index = 0; index < count; index += 1) this.host.addShell(this.items[this.done + index]!.text);
    this.phase = {kind: 'shell', count, ...(base ? {base} : {})};
    this.host.changed();
  }

  private watchShell(phase: Extract<Phase, {kind: 'shell'}>): void {
    const view = this.host.queueView();
    const chain = view.chain;
    if (view.paused) {
      // The owner paused its queue (a failure, an interrupt or the person): what is left stays there for /queue to review.
      this.phase = {kind: 'idle'};
      this.done += phase.count;
      this.finish(view.entries > 0 ? `The queue paused with ${plural(view.entries, 'command')} still waiting in /queue` : 'The queue paused');
      return;
    }
    // The chain our commands ran in is a newer one, or the one that was already active when they were added.
    const same = chain && phase.base && chain.id === phase.base.id;
    const ours = chain && (!phase.base || chain.id > phase.base.id || (same && phase.base.status === 'active'));
    if (!chain || !ours) return;
    if (chain.status === 'cleared') { this.phase = {kind: 'idle'}; this.done += phase.count; this.finish('The queue was cleared'); return; }
    if (chain.status === 'shell-ended') { this.phase = {kind: 'idle'}; this.done += phase.count; this.finish('The shell ended'); return; }
    if (chain.status !== 'finished' || view.entries > 0 || view.dispatching) return;
    const bad = chain.failed + chain.interrupted - (same && phase.base ? phase.base.bad : 0);
    this.phase = {kind: 'idle'};
    this.done += phase.count;
    // The failure policy is the session's own: "pause" stops here; "continue" was chosen by the person, but an interrupt (Ctrl+C) still stops.
    if (bad > 0 && (chain.failurePolicy === 'pause' || chain.interrupted > 0)) { this.finish(chain.interrupted > 0 ? 'A command was interrupted' : 'A command failed'); return; }
    this.host.changed();
    this.poke();
  }

  private finish(why?: string): void {
    if (this.ended) return;
    this.ended = true;
    const left = this.items.length - this.done;
    if (why && left > 0) this.host.say(`Queue all stopped: ${why}. The ${left === 1 ? 'next command was' : `${left} commands after it were`} not run.`);
    else if (why) this.host.say(`Queue all stopped: ${why}.`);
    this.host.changed();
  }
}
