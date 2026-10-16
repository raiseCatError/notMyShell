/** Real TerminalApp frames, driven by simulated owner observations. No shell/PTY is started. */
import {EventEmitter} from 'node:events';
import {mkdtempSync, mkdirSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {TerminalApp} from '../../src/app/TerminalApp.js';
import {QueueDispatcher} from '../../src/session/QueueDispatcher.js';
import {CommandQueue, type QueueOp} from '../../src/session/CommandQueue.js';
import {SERVICE_FEATURES} from '../../src/session/SessionProtocol.js';
import type {SessionClient, SessionClientEvents} from '../../src/session/SessionClient.js';
import {DEFAULT_MOTION, DEFAULT_PROMPT_CONFIGURATION} from '../../src/prompt/configuration.js';
import type {TerminalFrame} from '../../src/terminal/TerminalRenderer.js';
import {getIconStyle, setIconStyle} from '../../src/ui/glyphs.js';

class CaptureSession extends EventEmitter<SessionClientEvents> implements SessionClient {
  readonly features = new Set(SERVICE_FEATURES);
  readonly sizes: Array<{columns: number; rows: number}> = [];
  start() {}
  submit(): never { throw new Error('A frame capture must never submit shell commands'); }
  write(): never { throw new Error('A frame capture must never write to a PTY'); }
  interrupt() {}
  endInput() {}
  resize(columns: number, rows: number) { this.sizes.push({columns, rows}); }
  kill() {}
  detach() {}
  ack() {}
  async switchShell(): Promise<never> { throw new Error('A capture cannot switch shells'); }
  queue(_op: QueueOp) {}
}

export type CaptureMode = 'normal' | 'reduced' | 'effects-off' | 'safe' | 'no-color' | 'safe-no-color' | 'low-color' | 'rich';

export function executionFrameFixture(columns = 80, rows = 30, mode: CaptureMode = 'normal') {
  const root = mkdtempSync(join(tmpdir(), 'nmsh-queue-frame-'));
  const cwd = join(root, 'project'); mkdirSync(cwd);
  const envKeys = ['HOME', 'XDG_CONFIG_HOME', 'TERM', 'COLORTERM', 'TERM_PROGRAM', 'NO_COLOR', 'NMSH_COLOR', 'NMSH_ICONS', 'NMSH_RETURN_SESSION', 'NMSH_HANDOFF_SHELL', 'NMSH_DETERMINISTIC', 'NMSH_REDUCED_MOTION'];
  const savedEnv = new Map(envKeys.map(key => [key, process.env[key]]));
  const oldCwd = process.cwd(), oldNow = Date.now, oldPerformance = Object.getOwnPropertyDescriptor(performance, 'now'), oldIcons = getIconStyle();
  process.chdir(cwd);
  for (const key of envKeys) delete process.env[key];
  Object.assign(process.env, {HOME: root, XDG_CONFIG_HOME: join(root, 'config'), TERM: 'xterm-256color', COLORTERM: 'truecolor', TERM_PROGRAM: 'nmsh-capture', NMSH_ICONS: mode.startsWith('safe') ? 'safe' : 'nerd'});
  if (mode.includes('no-color')) process.env.NO_COLOR = '1';
  if (mode === 'low-color') process.env.NMSH_COLOR = '16';
  let now = Date.UTC(2026, 9, 16, 12, 0, 0);
  Date.now = () => now;
  Object.defineProperty(performance, 'now', {value: () => now, configurable: true});
  const session = new CaptureSession();
  // Fish uses the synchronous PathClassifier; this fixture needs no semantic helper subprocess either.
  const app = new TerminalApp({client: session, mode: 'in-process', shell: 'fish'});
  app['welcomeGeneration']++;
  app['output'].clearPresentation();
  app['startupPending'] = false;
  clearTimeout(app['startupTimer']); app['startupTimer'] = undefined;
  app['presetShellReady'] = true;
  app['promptConfiguration'] = structuredClone(DEFAULT_PROMPT_CONFIGURATION);
  Object.assign(app['promptConfiguration'], {provider: 'none', onboardingComplete: true, outputFolding: 'never'});
  app['effectivePromptProvider'] = 'none';
  app['promptConfiguration'].transcript.historicalPrompt = false;
  app['promptConfiguration'].motion = {...structuredClone(DEFAULT_MOTION), contextTransitions: 'off', rendering: mode === 'rich' ? 'rich' : 'clean'};
  Object.assign(app['promptConfiguration'].presentation, {reducedMotion: mode === 'reduced', effectsOff: mode === 'effects-off', motion: 'static'});
  app['output'].setTranscriptAppearance(app['promptConfiguration'].transcript);
  app['output'].setOutputFolding('never');
  app['output'].presenter.setTreatment(app['promptConfiguration'].presentation);
  Object.defineProperty(app, 'dimensions', {value: () => ({columns, rows}), configurable: true});
  Object.defineProperty(app, 'terminalDimensions', {value: () => ({columns, rows}), configurable: true});
  Object.defineProperty(app, 'fetchSuggestions', {value: async () => {}});
  Object.defineProperty(app, 'refreshContext', {value: async () => {}});
  let frame: TerminalFrame | undefined;
  app['renderer'].render = value => { frame = structuredClone(value); };
  const owner = new QueueDispatcher({isReady: true, adapter: {id: 'fish'}, submit() {}}, new CommandQueue(() => now), {now: () => now, monotonic: () => now});
  owner.on('state', (state, news) => app['onQueueState'](state, {...(news.dispatched ? {dispatched: news.dispatched.id} : {}), ...(news.refused ? {refused: news.refused} : {})}));
  const tick = (ms: number) => { now += ms; app['activityAnimationNow'] = now; };
  const capture = () => {
    app['activityAnimationNow'] = now;
    app['render']();
    if (!frame || !app['presentationFrame']) throw new Error('Production render did not emit a frame');
    return {frame: structuredClone(frame), plan: structuredClone(app['presentationFrame'].plan), state: owner.state, at: now};
  };
  const paint = (ms: number) => {
    tick(ms); app['paintPresentation'](now);
    if (!frame || !app['presentationFrame']) throw new Error('No frame to repaint');
    return {frame: structuredClone(frame), plan: structuredClone(app['presentationFrame'].plan), state: owner.state, at: now};
  };
  const begin = (command: string, output = '') => {
    const entry = owner.onExec(command);
    app['onShellExec'](command, now, 0, entry?.text);
    if (output) app['onShellData'](output);
  };
  const complete = (exitCode = 0) => {
    app['onShellPrompt'](exitCode, cwd, now);
    owner.onPrompt(exitCode);
  };
  return {app, owner, session, tick, capture, paint, begin, complete,
    dispose() {
      app['stop'](0); session.kill();
      Date.now = oldNow;
      if (oldPerformance) Object.defineProperty(performance, 'now', oldPerformance); else delete (performance as unknown as {now?: unknown}).now;
      process.chdir(oldCwd);
      for (const [key, value] of savedEnv) if (value === undefined) delete process.env[key]; else process.env[key] = value;
      setIconStyle(oldIcons);
      rmSync(root, {recursive: true, force: true});
    },
  };
}
