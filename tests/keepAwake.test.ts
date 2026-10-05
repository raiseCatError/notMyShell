import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {
  CAFFEINATE, detectBackend, ES_CONTINUOUS, ES_DISPLAY_REQUIRED, ES_SYSTEM_REQUIRED, executionStateFlags, KeepAwakeController, linuxBackend, macBackend,
  parseDuration, systemProbe, windowsBackend, windowsHelperScript, type LaunchPlan, type ProcessProbe,
} from '../src/keepAwake/keepAwake.js';
import {createKeepAwakePanel, keepAwakeKey, renderKeepAwakePanel} from '../src/keepAwake/KeepAwakePanel.js';
import {parseSlashCommand, slashCommands} from '../src/commands/slashCommands.js';
import {paletteItems} from '../src/ui/CommandPalette.js';
import {helpMarkdown} from '../src/help/helpContent.js';
import {resolveConfigRequest} from '../src/ask/configActions.js';
import {knownToolForExecutable, TOOLS} from '../src/tools/catalog.js';
import {stripAnsi} from '../src/util/text.js';

/** A fake process table: starts get fresh PIDs; command lines are exactly the launch. */
function fakeProbe(): ProcessProbe & {processes: Map<number, string>; started: LaunchPlan[]; signals: Array<[number, string]>; clock: number; failNext?: boolean} {
  const probe = {
    processes: new Map<number, string>(), started: [] as LaunchPlan[], signals: [] as Array<[number, string]>, clock: 1_000_000, failNext: false, next: 4000,
    start(plan: LaunchPlan) {
      probe.started.push(plan);
      if (probe.failNext) { probe.failNext = false; return undefined; }
      const pid = probe.next++;
      probe.processes.set(pid, [plan.command, ...plan.args].join(' '));
      return pid;
    },
    alive: (pid: number) => probe.processes.has(pid),
    commandLine: (pid: number) => probe.processes.get(pid),
    signal(pid: number, signal: string) { probe.signals.push([pid, signal]); if (signal === 'SIGTERM') probe.processes.delete(pid); },
    now: () => probe.clock,
  };
  return probe;
}
const box = () => { const root = mkdtempSync(join(tmpdir(), 'nmsh-awake-')); return {path: join(root, 'keep-awake.json'), done: () => rmSync(root, {recursive: true, force: true})}; };

test('aliases: /caffeinate, /awake and /zoomies parse to one canonical action', () => {
  for (const name of ['/caffeinate', '/awake', '/zoomies']) {
    assert.deepEqual(parseSlashCommand(name), {kind: 'keepAwake', op: 'panel'});
    assert.deepEqual(parseSlashCommand(`${name} display`), {kind: 'keepAwake', op: 'start', mode: 'display'});
    assert.deepEqual(parseSlashCommand(`${name} idle 30m`), {kind: 'keepAwake', op: 'start', mode: 'idle', timeoutSeconds: 1800});
    assert.deepEqual(parseSlashCommand(`${name} system 2h`), {kind: 'keepAwake', op: 'start', mode: 'system', timeoutSeconds: 7200});
    assert.deepEqual(parseSlashCommand(`${name} all 45s`), {kind: 'keepAwake', op: 'start', mode: 'all', timeoutSeconds: 45});
    assert.deepEqual(parseSlashCommand(`${name} status`), {kind: 'keepAwake', op: 'status'});
    assert.deepEqual(parseSlashCommand(`${name} stop`), {kind: 'keepAwake', op: 'stop'});
  }
  assert.deepEqual(parseSlashCommand('/caffeinate-stop'), {kind: 'keepAwake', op: 'stop'});
  for (const bad of ['/zoomies display 1d', '/zoomies display 30', '/zoomies display $(id)', '/zoomies display 9999999h', '/zoomies turbo']) {
    const parsed = parseSlashCommand(bad);
    assert.equal(parsed?.kind === 'keepAwake' && parsed.op, 'panel', bad);
    assert.ok(parsed?.kind === 'keepAwake' && parsed.invalid, bad);
  }
  assert.equal(parseDuration('30m'), 1800);
  assert.equal(parseDuration('0m'), 'invalid');
  assert.equal(parseDuration('1.5h'), 'invalid');
});

test('discoverability: one palette entry per surface plus human actions; help and Ask', () => {
  const awake = slashCommands.filter(command => ['/caffeinate', '/awake', '/zoomies'].includes(command.name));
  assert.equal(awake.length, 3);
  assert.deepEqual(awake.filter(command => command.alias).map(command => command.name), ['/awake', '/zoomies']);
  const labels = paletteItems().map(item => item.label);
  for (const label of ['Keep computer awake', 'Keep display awake', 'Keep-awake status', 'Stop keep-awake']) assert.ok(labels.includes(label), label);
  for (const word of ['caffeinate', 'awake', 'zoomies', 'sleep', 'display']) {
    assert.ok(paletteItems().some(item => `${item.label} ${item.detail}`.toLowerCase().includes(word)), word);
  }
  assert.match(helpMarkdown(), /Keep Awake \(\/caffeinate, also \/awake and \/zoomies\)/u);
  const ask = (text: string) => resolveConfigRequest(text, {}) as {safety?: string; action?: {slash?: unknown; label?: string}} | undefined;
  assert.deepEqual([ask('keep my computer awake')?.action?.label, ask('keep my computer awake')?.safety], ['/caffeinate idle', 'mutate']);
  assert.equal(ask('keep my screen awake')?.action?.label, '/caffeinate display');
  assert.equal(ask("don't let my computer sleep")?.action?.label, '/caffeinate system');
  assert.deepEqual([ask('give my computer zoomies')?.action?.label, ask('give my computer zoomies')?.safety], ['/zoomies', 'navigate'], 'a joke only opens the panel');
  assert.deepEqual([ask('stop keeping my computer awake')?.action?.label, ask('stop keeping my computer awake')?.safety], ['/caffeinate stop', 'mutate']);
  assert.deepEqual([ask('is caffeinate running')?.action?.label, ask('is caffeinate running')?.safety], ['/caffeinate status', 'navigate']);
  assert.equal(knownToolForExecutable('caffeinate'), undefined, 'no command-not-found install for caffeinate');
  const capability = TOOLS.find(tool => tool.id === 'keep-awake')!;
  assert.deepEqual([capability.category, capability.package, capability.commandNotFound], ['System capabilities', '', false]);
});

test('macOS: fixed /usr/bin/caffeinate and exact argv per mode', () => {
  const mac = macBackend();
  assert.deepEqual(mac.plan('idle', 't'), {command: CAFFEINATE, args: ['-i']});
  assert.deepEqual(mac.plan('display', 't'), {command: CAFFEINATE, args: ['-d', '-i']});
  assert.deepEqual(mac.plan('system', 't'), {command: CAFFEINATE, args: ['-s']});
  assert.deepEqual(mac.plan('all', 't'), {command: CAFFEINATE, args: ['-d', '-i', '-s']});
  assert.deepEqual(mac.plan('display', 't', 1800)?.args, ['-d', '-i', '-t', '1800']);
  assert.equal(CAFFEINATE, '/usr/bin/caffeinate');
  assert.match(mac.notes.join(' '), /AC power/u);
  assert.equal(detectBackend('darwin', path => path === '/usr/bin/caffeinate')?.id, 'macos-caffeinate');
  assert.equal(detectBackend('darwin', () => false), undefined);
});

test('Linux: systemd-inhibit with idle/sleep only, an NMSh wait helper, Display unsupported, no systemd → nothing guessed', () => {
  assert.equal(detectBackend('linux', () => false), undefined);
  const linux = detectBackend('linux', path => path === '/usr/bin/systemd-inhibit')!;
  assert.equal(linux.id, 'linux-systemd-inhibit');
  assert.deepEqual(linux.capabilities, {idle: true, display: false, system: true});
  const what = (mode: 'idle' | 'system' | 'all') => linux.plan(mode, 'abc', 60)!.args.find(arg => arg.startsWith('--what='));
  assert.equal(what('idle'), '--what=idle');
  assert.equal(what('system'), '--what=sleep');
  assert.equal(what('all'), '--what=idle:sleep');
  assert.equal(linux.plan('display', 'abc'), undefined);
  const plan = linuxBackend('/usr/bin/systemd-inhibit', '/node').plan('all', 'abc', 60)!;
  assert.deepEqual(plan.args.slice(0, 4), ['--what=idle:sleep', '--mode=block', '--who=notMyShell', '--why=Keep-awake requested by NMSh']);
  assert.deepEqual(plan.args.slice(4, 6), ['/node', '-e']);
  assert.deepEqual(plan.args.slice(-3), ['--', '60', 'nmsh-keep-awake=abc']);
  assert.doesNotMatch(plan.args.join(' '), /shutdown|handle-lid-switch|handle-power-key|handle-suspend-key/u);
  const controller = new KeepAwakeController(linux, fakeProbe(), box().path, 'linux');
  assert.deepEqual(controller.start('display'), {kind: 'unsupported', reason: 'Display is not supported by the systemd inhibitor. Display: not supported by the systemd inhibitor (it is not a display API); use Idle or System.'});
  assert.match(new KeepAwakeController(undefined, fakeProbe(), box().path, 'linux').start('idle').kind === 'unsupported'
    ? (new KeepAwakeController(undefined, fakeProbe(), box().path, 'linux').start('idle') as {reason: string}).reason : '', /No supported Linux inhibitor was detected/u);
});

test('Windows: SetThreadExecutionState flags; never away mode; fixed script with only validated values', () => {
  const AWAYMODE = 0x40;
  assert.equal(executionStateFlags('idle'), (ES_CONTINUOUS | ES_SYSTEM_REQUIRED) >>> 0);
  assert.equal(executionStateFlags('system'), (ES_CONTINUOUS | ES_SYSTEM_REQUIRED) >>> 0);
  assert.equal(executionStateFlags('display'), (ES_CONTINUOUS | ES_SYSTEM_REQUIRED | ES_DISPLAY_REQUIRED) >>> 0);
  assert.equal(executionStateFlags('all'), executionStateFlags('display'));
  for (const mode of ['idle', 'display', 'system', 'all'] as const) assert.equal(executionStateFlags(mode) & AWAYMODE, 0);
  const token = 'a'.repeat(32);
  const script = windowsHelperScript(executionStateFlags('display'), token, 600);
  assert.match(script, /SetThreadExecutionState\(\[uint32\]2147483651\)/u);
  assert.match(script, /AddSeconds\(600\)/u);
  assert.match(script, /finally \{ \[void\]\[NMSh\.Power\]::SetThreadExecutionState\(\[uint32\]2147483648\) \}/u, 'cleared on exit');
  assert.doesNotMatch(script, /powercfg|Set-ItemProperty|HKLM|HKCU|RunAs/iu);
  assert.throws(() => windowsHelperScript(1, '"; Remove-Item C:\\ #', 1));
  assert.throws(() => windowsHelperScript(1, token, 0));
  const plan = windowsBackend('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe').plan('system', token)!;
  assert.deepEqual(plan.args.slice(0, 6), ['-NoLogo', '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand']);
  assert.equal(Buffer.from(plan.args[6]!, 'base64').toString('utf16le'), windowsHelperScript(executionStateFlags('system'), token));
  assert.equal(detectBackend('win32', path => path.endsWith('powershell.exe'), {SystemRoot: 'C:\\Windows'})?.id, 'windows-execution-state');
});

test('controller: one assertion, same mode idempotent, a different mode asks then replaces start-first, stop idempotent', () => {
  const file = box();
  try {
    const probe = fakeProbe();
    const controller = new KeepAwakeController(macBackend(), probe, file.path, 'darwin');
    assert.equal(controller.status().state, 'off');
    const first = controller.start('idle');
    assert.equal(first.kind, 'started');
    const pid = first.kind === 'started' ? first.record.pid : 0;
    assert.equal(controller.start('idle').kind, 'already');
    assert.equal(probe.started.length, 1, 'no duplicate assertion');
    assert.deepEqual(controller.start('display'), {kind: 'needsConfirm', from: 'idle', to: 'display'});
    assert.equal(probe.started.length, 1, 'nothing changes before confirmation');
    const replaced = controller.start('display', undefined, true);
    assert.equal(replaced.kind === 'started' && replaced.replaced, 'idle');
    assert.ok(probe.signals.some(([signalled, signal]) => signalled === pid && signal === 'SIGTERM'), 'old one stopped gracefully after the new one started');
    assert.equal(probe.processes.size, 1);
    // A failed replacement does not claim the old one stopped.
    probe.failNext = true;
    const failed = controller.start('all', undefined, true);
    assert.match(failed.kind === 'failed' ? failed.reason : '', /did not start\. The Display keep-awake is still running\./u);
    assert.equal(controller.status().state, 'running');
    assert.match(controller.stop(), /Keep Awake stopped \(Display\)/u);
    assert.equal(controller.stop(), 'Keep Awake is off.', 'stop is idempotent');
    assert.equal(existsSync(file.path), false);
  } finally { file.done(); }
});

test('ownership: a reused PID or a foreign command line is never killed; the record is cleared as stale; timeout expiry is reported', () => {
  const file = box();
  try {
    const probe = fakeProbe();
    const controller = new KeepAwakeController(macBackend(), probe, file.path, 'darwin');
    const started = controller.start('idle', 60);
    assert.equal(started.kind, 'started');
    const pid = started.kind === 'started' ? started.record.pid : 0;
    // The PID now belongs to something else.
    probe.processes.set(pid, '/usr/bin/vim notes.txt');
    assert.match(controller.stop(), /could not be verified as NMSh's, so nothing was stopped/u);
    assert.deepEqual(probe.signals, []);
    assert.equal(existsSync(file.path), false);
    // Persisted across restarts: a new controller verifies before saying Running.
    const again = controller.start('idle', 60);
    const restarted = new KeepAwakeController(macBackend(), probe, file.path, 'darwin');
    assert.equal(restarted.status().state, 'running');
    // Timeout: the backend process ended on its own.
    probe.processes.delete(again.kind === 'started' ? again.record.pid : 0);
    probe.clock += 61_000;
    const status = restarted.status();
    assert.equal(status.state, 'off');
    assert.match(status.state === 'off' ? status.note ?? '' : '', /ended after its 1m timeout/u);
    // A corrupt record is ignored.
    writeFileSync(file.path, '{"version":1,"pid":"1; kill"}');
    assert.equal(restarted.status().state, 'off');
  } finally { file.done(); }
});

test('Linux ownership needs the token in the command line', () => {
  const file = box();
  try {
    const probe = fakeProbe();
    const controller = new KeepAwakeController(linuxBackend('/usr/bin/systemd-inhibit', '/node'), probe, file.path, 'linux');
    const started = controller.start('system');
    assert.equal(started.kind, 'started');
    const record = JSON.parse(readFileSync(file.path, 'utf8'));
    assert.match(probe.commandLine(record.pid)!, new RegExp(`nmsh-keep-awake=${record.token}`, 'u'));
    probe.processes.set(record.pid, '/usr/bin/systemd-inhibit --what=sleep sleep 99');
    assert.equal(controller.status().state, 'off', 'same PID without our token is not ours');
    assert.deepEqual(probe.signals, []);
  } finally { file.done(); }
});

test('panel: same surface for every alias; unsupported modes stay visible and factual; mode change defaults to No', () => {
  const file = box();
  try {
    const probe = fakeProbe();
    const controller = new KeepAwakeController(linuxBackend('/usr/bin/systemd-inhibit', '/node'), probe, file.path, 'linux');
    const panel = createKeepAwakePanel(controller);
    let text = renderKeepAwakePanel(panel, controller, 120, 40).map(stripAnsi).join('\n');
    assert.match(text, /Display\s+Unavailable on the systemd inhibitor/u);
    assert.match(text, /Current\s+Off/u);
    assert.match(text, /Backend\s+systemd inhibitor/u);
    keepAwakeKey(panel, controller, {kind: 'enter'});
    assert.equal(controller.status().state, 'running');
    keepAwakeKey(panel, controller, {kind: 'down'});
    keepAwakeKey(panel, controller, {kind: 'down'});
    keepAwakeKey(panel, controller, {kind: 'enter'});
    assert.equal(panel.confirm?.state.choice, 'no');
    keepAwakeKey(panel, controller, {kind: 'enter'});
    assert.match(panel.message!, /Kept Idle\. Nothing was changed\./u);
    text = renderKeepAwakePanel(panel, controller, 120, 40).map(stripAnsi).join('\n');
    assert.match(text, /Idle .*● running/u);
    keepAwakeKey(panel, controller, {kind: 'text', value: 's'});
    assert.equal(controller.status().state, 'off');
  } finally { file.done(); }
});

test('real macOS caffeinate: start, verify, stop (bounded by a 30s timeout)', {skip: process.platform !== 'darwin' || !existsSync(CAFFEINATE) ? 'macOS only' : false}, () => {
  const file = box();
  const controller = new KeepAwakeController(macBackend(), systemProbe, file.path, 'darwin');
  try {
    const started = controller.start('idle', 30);
    assert.equal(started.kind, 'started', JSON.stringify(started));
    assert.equal(controller.status().state, 'running');
    assert.match(controller.stop(), /stopped/u);
    assert.equal(controller.status().state, 'off');
  } finally { controller.stop(); file.done(); }
});
