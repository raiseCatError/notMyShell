import test from 'node:test';
import assert from 'node:assert/strict';
import {BatchSequencer, type SequenceHost, type SequenceItem, type SequenceQueueView} from '../src/input/batchSequence.js';

/**
 * Queue all runs a reviewed list in order: shell commands through the session's queue, NMSh's own commands in NMSh.
 * The fake host models only what the sequencer may look at: the queue's view, whether a program or a panel owns the
 * terminal, and whether the composer holds a draft.
 */
function fixture(items: SequenceItem[], options: {free?: number; policy?: 'pause' | 'continue'} = {}) {
  const log: string[] = [];
  const said: string[] = [];
  const state = {
    entries: [] as string[],
    dispatching: false,
    paused: false,
    chain: undefined as SequenceQueueView['chain'],
    busy: false,
    modal: false,
    draft: false,
    free: options.free ?? 50,
    nmsh: undefined as undefined | {resolve: () => void; reject: (error: Error) => void},
    holdNmsh: false,
  };
  const policy = options.policy ?? 'pause';
  const host: SequenceHost = {
    queueView: () => ({entries: state.entries.length, dispatching: state.dispatching, paused: state.paused, ...(state.chain ? {chain: {...state.chain}} : {})}),
    queueFree: () => state.free,
    addShell: text => {
      log.push(`shell:${text}`);
      state.entries.push(text);
      if (!state.chain || state.chain.status !== 'active') state.chain = {id: (state.chain?.id ?? 0) + 1, status: 'active', failurePolicy: policy, failed: 0, interrupted: 0};
    },
    foregroundBusy: () => state.busy,
    modalOpen: () => state.modal,
    composerEmpty: () => !state.draft,
    runNmsh: text => {
      log.push(`nmsh:${text}`);
      // /view opens a panel, which stays open until the person closes it.
      if (text.startsWith('/view')) state.modal = true;
      if (!state.holdNmsh) return Promise.resolve();
      return new Promise<void>((resolve, reject) => { state.nmsh = {resolve, reject}; });
    },
    say: text => said.push(text),
    changed: () => {},
  };
  const sequence = new BatchSequencer(items, host);
  /** The owner ran everything that was queued; `outcome` decides how the chain ended. */
  const drain = (outcome: 'ok' | 'failed' | 'interrupted' | 'cleared' = 'ok', pause = false) => {
    const count = state.entries.length;
    state.entries = [];
    state.dispatching = false;
    const chain = state.chain!;
    if (outcome === 'failed') chain.failed += 1;
    if (outcome === 'interrupted') chain.interrupted += 1;
    chain.status = outcome === 'cleared' ? 'cleared' : 'finished';
    if (pause) state.paused = true;
    return count;
  };
  const settle = () => new Promise<void>(done => setImmediate(done));
  return {sequence, state, log, said, drain, settle};
}
const shell = (text: string): SequenceItem => ({text, nmsh: false});
const nmsh = (text: string): SequenceItem => ({text, nmsh: true});

test('Queue all: a shell run goes to the queue together, NMSh commands run in NMSh between runs, in order', async () => {
  const f = fixture([shell('cd modules/bun-app'), nmsh('/modules'), shell('ls'), shell('pwd'), nmsh('/track df -h')]);
  f.sequence.poke();
  assert.deepEqual(f.log, ['shell:cd modules/bun-app'], 'only the first shell run; /modules waits for the queue to drain');
  f.sequence.poke();
  assert.deepEqual(f.log, ['shell:cd modules/bun-app'], 'still waiting while the queue holds the command');
  f.drain();
  f.sequence.poke();
  await f.settle();
  assert.deepEqual(f.log, ['shell:cd modules/bun-app', 'nmsh:/modules', 'shell:ls', 'shell:pwd'], 'NMSh dispatched /modules; the next two shell commands queued together');
  f.drain();
  f.sequence.poke();
  await f.settle();
  assert.deepEqual(f.log.at(-1), 'nmsh:/track df -h');
  assert.equal(f.sequence.active, false);
  assert.deepEqual(f.said, [], 'a clean finish says nothing');
  assert.ok(!f.log.some(line => line.startsWith('shell:/')), 'no NMSh command ever reached the shell queue');
});

test('Queue all: a shell-only list queues everything at once and finishes when the chain does', () => {
  const f = fixture([shell('git fetch'), shell('git pull --ff-only'), shell('npm ci')]);
  f.sequence.poke();
  assert.deepEqual(f.log, ['shell:git fetch', 'shell:git pull --ff-only', 'shell:npm ci']);
  assert.equal(f.sequence.active, true);
  f.drain();
  f.sequence.poke();
  assert.equal(f.sequence.active, false);
});

test('Queue all: a failure with the pause policy stops the sequence and reports what was not run', async () => {
  const f = fixture([shell('false'), nmsh('/modules'), shell('echo after')]);
  f.sequence.poke();
  f.drain('failed', true);
  f.sequence.poke();
  await f.settle();
  assert.equal(f.sequence.active, false);
  assert.deepEqual(f.log, ['shell:false'], 'neither /modules nor the later command ran');
  assert.match(f.said.join(' '), /Queue all stopped: The queue paused/u);
  assert.match(f.said.join(' '), /2 commands after it were not run/u);
});

test('Queue all: the failure policy is the session\'s; "continue" goes on after a failure, but Ctrl+C always stops', async () => {
  const keepGoing = fixture([shell('false'), nmsh('/modules')], {policy: 'continue'});
  keepGoing.sequence.poke();
  keepGoing.drain('failed');
  keepGoing.sequence.poke();
  await keepGoing.settle();
  assert.deepEqual(keepGoing.log, ['shell:false', 'nmsh:/modules']);

  const interrupted = fixture([shell('sleep 30'), nmsh('/modules')], {policy: 'continue'});
  interrupted.sequence.poke();
  interrupted.drain('interrupted');
  interrupted.sequence.poke();
  await interrupted.settle();
  assert.deepEqual(interrupted.log, ['shell:sleep 30']);
  assert.match(interrupted.said.join(' '), /interrupted/u);
});

test('Queue all: a cleared queue or a ended shell stops it', () => {
  const cleared = fixture([shell('a'), shell('b'), nmsh('/modules')]);
  cleared.sequence.poke();
  cleared.drain('cleared');
  cleared.sequence.poke();
  assert.equal(cleared.sequence.active, false);
  assert.match(cleared.said.join(' '), /The queue was cleared/u);
  assert.deepEqual(cleared.log, ['shell:a', 'shell:b']);
});

test('Queue all: an NMSh command waits for a free prompt, a closed panel and an empty composer; nothing is ever typed over them', async () => {
  const f = fixture([nmsh('/modules'), shell('ls')]);
  f.state.busy = true;
  f.sequence.poke();
  await f.settle();
  assert.deepEqual(f.log, [], 'a foreground program (possibly asking for input) is never bypassed');
  f.state.busy = false;
  f.state.draft = true;
  f.sequence.poke();
  assert.deepEqual(f.log, [], 'a draft in the composer is never replaced');
  assert.match(f.sequence.statusLine(), /continues when the composer is empty/u);
  f.state.draft = false;
  f.state.modal = true;
  f.sequence.poke();
  assert.deepEqual(f.log, [], 'a panel is never run over');
  assert.match(f.sequence.statusLine(), /continues when the panel closes/u);
  f.state.modal = false;
  f.state.entries = ['queued earlier'];
  f.sequence.poke();
  assert.deepEqual(f.log, [], 'commands the person queued first run first');
  f.state.entries = [];
  f.sequence.poke();
  await f.settle();
  assert.deepEqual(f.log, ['nmsh:/modules', 'shell:ls']);
});

test('Queue all: a panel a command opened holds the next step until it closes', async () => {
  const f = fixture([nmsh('/view README.md'), nmsh('/theme')]);
  f.sequence.poke();
  await f.settle();
  assert.deepEqual(f.log, ['nmsh:/view README.md']);
  assert.equal(f.state.modal, true);
  f.sequence.poke();
  await f.settle();
  assert.deepEqual(f.log, ['nmsh:/view README.md'], '/theme waits while the viewer is open');
  f.state.modal = false;
  f.sequence.poke();
  await f.settle();
  assert.deepEqual(f.log, ['nmsh:/view README.md', 'nmsh:/theme']);
});

test('Queue all: Esc stops what has not started; an NMSh command already running is left to finish', async () => {
  const f = fixture([shell('ls'), nmsh('/modules'), shell('pwd')]);
  f.state.draft = false;
  f.sequence.poke();
  f.sequence.stop();
  assert.equal(f.sequence.active, true, 'the queued command is still running: the sequence ends when it does');
  f.drain();
  f.sequence.poke();
  assert.equal(f.sequence.active, false);
  assert.deepEqual(f.log, ['shell:ls'], 'the rest never started');
  assert.match(f.said.join(' '), /2 commands after it were not run/u);

  const running = fixture([nmsh('/a'), nmsh('/b')]);
  running.state.holdNmsh = true;
  running.sequence.poke();
  running.sequence.stop();
  running.state.nmsh!.resolve();
  await running.settle();
  assert.deepEqual(running.log, ['nmsh:/a']);
  assert.equal(running.sequence.active, false);
});

test('Queue all: an NMSh command that throws stops the sequence', async () => {
  const f = fixture([nmsh('/a'), nmsh('/b')]);
  f.state.holdNmsh = true;
  f.sequence.poke();
  f.state.nmsh!.reject(new Error('boom'));
  await f.settle();
  assert.equal(f.sequence.active, false);
  assert.deepEqual(f.log, ['nmsh:/a']);
  assert.match(f.said.join(' '), /That command failed/u);
});

test('Queue all: a full queue waits instead of partially queueing; a paused queue still takes the commands, which wait for /queue', () => {
  const full = fixture([shell('a'), shell('b')], {free: 1});
  full.sequence.poke();
  assert.deepEqual(full.log, [], 'two do not fit in one place: nothing is queued');
  full.state.free = 5;
  full.sequence.poke();
  assert.deepEqual(full.log, ['shell:a', 'shell:b']);

  const paused = fixture([shell('a'), nmsh('/modules')]);
  paused.state.paused = true;
  paused.sequence.poke();
  assert.deepEqual(paused.log, ['shell:a'], 'the command waits in the paused queue');
  paused.sequence.poke();
  assert.equal(paused.sequence.active, false);
  assert.match(paused.said.join(' '), /The queue paused/u);
});

test('Queue all: the status strip counts started commands and says how to stop', () => {
  const f = fixture([shell('a'), nmsh('/modules'), shell('b')]);
  f.sequence.poke();
  assert.equal(f.sequence.statusLine(), 'Queue all · 1 of 3 · Esc stops');
});
