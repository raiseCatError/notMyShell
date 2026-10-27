/**
 * Explicit diagnostic import, not a production hook or canonical test preload:
 * node --import=tsx --import=./tests/fixtures/hostProfileCompletionGate.mjs --test tests/hostProfiles.test.ts
 * Delay a reattached STATE command's completion batch until the test observes its journal,
 * or until premature SIZE input exposes the old harness ordering. No timing sleeps.
 */
import {appendFileSync, existsSync, watch, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const entry = fileURLToPath(import.meta.url);
const repo = fileURLToPath(new URL('../../', import.meta.url));
function trace(event, detail = {}) {
  const path = process.env.NMSH_HOST_COMPLETION_TRACE;
  if (path) appendFileSync(path, JSON.stringify({ns: process.hrtime.bigint().toString(), pid: process.pid, event, ...detail}) + '\n');
}

if (process.argv[1] === entry) {
  const {TerminalApp} = await import(repo + 'src/app/TerminalApp.ts');
  const prompt = TerminalApp.prototype.onShellPrompt;
  const input = TerminalApp.prototype.onInputState;
  const route = TerminalApp.prototype.routeComposer;
  const stop = TerminalApp.prototype.stop;
  const states = new WeakMap();
  const signal = process.env.HOME + '/host-completion-' + process.pid;
  const held = app => {
    let state = states.get(app);
    if (!state) { state = {}; states.set(app, state); }
    return state;
  };
  const eligible = app => app.attachedSession && app.running?.command.startsWith('printf "STATE-');
  function release(app) {
    const state = held(app);
    if (!state.prompt || !existsSync(signal)) return;
    state.watcher?.close();
    const args = state.prompt;
    state.prompt = undefined;
    trace('completion-batch.released');
    if (state.done) { input.call(app, state.done); state.done = undefined; }
    prompt.apply(app, args);
  }
  TerminalApp.prototype.onInputState = function (value) {
    if (eligible(this) && value.done) { held(this).done = value; trace('done.held'); return; }
    return input.call(this, value);
  };
  TerminalApp.prototype.onShellPrompt = function (...args) {
    if (!eligible(this)) return prompt.apply(this, args);
    const state = held(this);
    state.prompt = args;
    state.watcher = watch(process.env.HOME, () => release(this));
    trace('prompt.held');
    release(this);
  };
  TerminalApp.prototype.routeComposer = function (...args) {
    const premature = held(this).prompt && this.editor.text.startsWith('echo SIZE-$(stty size)');
    const result = route.apply(this, args);
    if (premature) { trace('size.entered.before.completion', {done: Boolean(this.running?.done)}); writeFileSync(signal, 'release'); }
    return result;
  };
  TerminalApp.prototype.stop = function (...args) { held(this).watcher?.close(); return stop.apply(this, args); };
  await import(repo + 'src/index.ts');
} else if (process.argv.some(arg => arg.endsWith('/hostProfiles.test.ts'))) {
  const {LiveSandbox, Frontend} = await import(repo + 'tests/helpers/liveFrontend.ts');
  const launch = LiveSandbox.prototype.launch;
  const completions = Frontend.prototype.completions;
  const homes = new WeakMap();
  let generation = 0;
  LiveSandbox.prototype.launch = function (args, size, env) {
    const frontend = launch.call(this, args, size, env, entry);
    homes.set(frontend, this.home);
    trace('attachment', {generation: ++generation, profile: env?.TERM_PROGRAM, frontendPid: frontend.pty.pid});
    return frontend;
  };
  Frontend.prototype.completions = function (command) {
    if (command.startsWith('printf "STATE-')) {
      trace('test.observes.state.completion', {frontendPid: this.pty.pid});
      writeFileSync(homes.get(this) + '/host-completion-' + this.pty.pid, 'release');
    }
    return completions.call(this, command);
  };
}
