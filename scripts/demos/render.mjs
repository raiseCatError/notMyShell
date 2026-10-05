#!/usr/bin/env node
/**
 * Renders the README and docs/demos.md media from the VHS tapes in this
 * directory, driving the real NMSh build.
 *
 *   npm run demos                 every tape
 *   npm run demos -- main themes  only these
 *
 * Every run gets a disposable demo home (HOME, XDG dirs, NMSh config and
 * runtime, git config, TMPDIR) with a small fixture repository, so recordings
 * never read or write your own NMSh settings, shell rc files, history, themes
 * or sessions, and never show your username, hostname or paths. No network is
 * used. Afterwards every process still holding files in the demo home
 * (frontends, the session service, shells, the inert Keep Awake helper) is
 * stopped and the directory is removed; the run fails if anything survives.
 */
import {execFileSync, spawnSync} from 'node:child_process';
import {existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../..');
const fail = message => { throw new Error(`demos: ${message}`); };

// ---- Dependencies ----------------------------------------------------------------------
const which = name => spawnSync('/usr/bin/env', ['which', name], {encoding: 'utf8'}).stdout.trim();
for (const tool of ['vhs', 'ttyd', 'ffmpeg', 'git', 'zsh', 'lsof']) {
  if (!which(tool)) fail(`${tool} is not installed. VHS needs ttyd and ffmpeg; see scripts/demos/README.md for installation.`);
}

const tapes = readdirSync(here).filter(name => name.endsWith('.tape') && name !== 'settings.tape').map(name => name.slice(0, -5)).sort();
const wanted = process.argv.slice(2);
for (const name of wanted) if (!tapes.includes(name)) fail(`unknown tape "${name}". Known: ${tapes.join(', ')}`);
const selected = wanted.length ? wanted : tapes;

console.log('demos: building NMSh');
const build = spawnSync('npm', ['run', 'build', '--silent'], {cwd: repo, stdio: 'inherit'});
if (build.status !== 0) fail('npm run build failed');

// ---- Disposable demo home --------------------------------------------------------------
function demoHome(configExtra = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'nmsh-demo-')));
  const home = join(root, 'home');
  const dirs = {home, config: join(home, '.config'), data: join(home, '.local/share'), state: join(home, '.local/state'),
    cache: join(home, '.cache'), runtime: join(root, 'run'), temp: join(root, 'tmp'), bin: join(root, 'bin')};
  for (const dir of Object.values(dirs)) mkdirSync(dir, {recursive: true, mode: 0o700});
  symlinkSync(join(repo, 'bin', 'nmsh'), join(dirs.bin, 'nmsh'));
  // Quiet, ordinary shells: no first-run wizards, nothing personal.
  writeFileSync(join(home, '.zshrc'), '# NMSh demo home\n');
  writeFileSync(join(home, '.zshenv'), '');
  writeFileSync(join(home, '.bashrc'), '');
  writeFileSync(join(home, '.gitconfig'), '[user]\n\tname = Demo\n\temail = demo@example.com\n[init]\n\tdefaultBranch = main\n[advice]\n\tdetachedHead = false\n');
  // NMSh as a first-time user who finished Setup, with update checks off (no network).
  mkdirSync(join(dirs.config, 'nmsh'), {recursive: true});
  writeFileSync(join(dirs.config, 'nmsh', 'config.json'), `${JSON.stringify({
    onboardingComplete: true, toolsSetupComplete: true, glyphChoiceComplete: true, glyphStyle: 'nerd',
    updateMode: 'off', toolUpdateChecks: 'off', installSuggestions: false, liveSessionStartup: 'ask',
    ...configExtra,
  }, null, 2)}\n`);
  // A small project to stand in: ~/Projects/demo on feature/theme-preview with one local change.
  const project = join(home, 'Projects', 'demo');
  mkdirSync(join(project, 'src'), {recursive: true});
  mkdirSync(join(project, 'test'), {recursive: true});
  writeFileSync(join(project, 'package.json'), `${JSON.stringify({name: 'demo', version: '1.0.0', type: 'module', scripts: {test: 'node --test'}}, null, 2)}\n`);
  writeFileSync(join(project, 'README.md'), '# demo\n\nA tiny project for NMSh recordings.\n');
  writeFileSync(join(project, 'src', 'sum.js'), 'export const sum = (a, b) => a + b;\n');
  writeFileSync(join(project, 'test', 'sum.test.js'), "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport {sum} from '../src/sum.js';\n\nfor (const [a, b] of [[1, 2], [2, 3], [5, 8], [13, 21]]) {\n  test(`sum ${a} + ${b}`, async () => {\n    await new Promise(r => setTimeout(r, 350));\n    assert.equal(sum(a, b), a + b);\n  });\n}\n");
  writeFileSync(join(project, 'build.sh'), "#!/bin/sh\n# A deterministic stand-in for a slow build (sessions demo).\nfor step in fetch compile link package; do\n  printf 'build: %s\\n' \"$step\"; sleep 2\ndone\nprintf 'build: done\\n'\n");
  execFileSync('chmod', ['+x', join(project, 'build.sh')]);
  const git = (...args) => execFileSync('git', args, {cwd: project, env: {...process.env, HOME: home, GIT_CONFIG_GLOBAL: join(home, '.gitconfig'), GIT_CONFIG_NOSYSTEM: '1'}, stdio: 'ignore'});
  git('init', '-q');
  git('add', '.');
  git('commit', '-q', '-m', 'Initial demo project');
  git('switch', '-q', '-c', 'feature/theme-preview');
  writeFileSync(join(project, 'README.md'), '# demo\n\nA tiny project for NMSh recordings.\n\nNow with themes.\n');
  return {root, dirs, project};
}

// ---- Environment for the recorded shell -----------------------------------------------
function demoEnv({dirs}, extra) {
  const nodeDir = dirname(process.execPath);
  return {
    HOME: dirs.home, USER: 'demo', LOGNAME: 'demo', SHELL: '/bin/zsh',
    PATH: [dirs.bin, nodeDir, '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin'].join(':'),
    XDG_CONFIG_HOME: dirs.config, XDG_DATA_HOME: dirs.data, XDG_STATE_HOME: dirs.state, XDG_CACHE_HOME: dirs.cache,
    NMSH_RUNTIME_DIR: dirs.runtime, TMPDIR: dirs.temp, TMP: dirs.temp, TEMP: dirs.temp,
    GIT_CONFIG_GLOBAL: join(dirs.home, '.gitconfig'), GIT_CONFIG_NOSYSTEM: '1',
    NMSH_DEMO: '1', NMSH_DISABLE_UPDATES: '1', TERM: 'xterm-256color', COLORTERM: 'truecolor', LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8',
    BASH_SILENCE_DEPRECATION_WARNING: '1', NPM_CONFIG_UPDATE_NOTIFIER: 'false', NPM_CONFIG_FUND: 'false', NPM_CONFIG_AUDIT: 'false', NO_UPDATE_NOTIFIER: '1', HISTFILE: join(dirs.home, '.demo_history'),
    // Host markers would describe the recording machine's terminal, not the recorder.
    TERM_PROGRAM: '', GHOSTTY_RESOURCES_DIR: '', KITTY_WINDOW_ID: '', VSCODE_INJECTION: '', ZED_TERM: '',
    ...extra,
  };
}

/**
 * `# demo-env: KEY=VALUE` lines choose per-tape presentation (for example NMSH_DETERMINISTIC);
 * `# demo-config: {...}` lines merge into the demo NMSh config (for example the Status Strip on).
 */
function tapeEnv(text) {
  return Object.fromEntries([...text.matchAll(/^# demo-env: ([A-Z0-9_]+)=(\S*)$/gmu)].map(match => [match[1], match[2]]));
}

const quote = value => `"${String(value).replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;

// ---- Cleanup ---------------------------------------------------------------------------
function holders(root) {
  const result = spawnSync('lsof', ['-t', '+D', root], {encoding: 'utf8', timeout: 10_000});
  if (result.error || (result.status !== 0 && result.status !== 1)) fail(`cannot check demo process cleanup: ${result.error?.message ?? result.stderr}`);
  return result.stdout.split('\n').map(Number).filter(pid => pid > 0 && pid !== process.pid);
}

async function cleanup(root) {
  for (const signal of ['SIGTERM', 'SIGKILL']) {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const pids = holders(root);
      if (!pids.length) return;
      for (const pid of pids) { try { process.kill(pid, signal); } catch { /* gone */ } }
      await new Promise(done => setTimeout(done, 250));
    }
  }
  const left = holders(root);
  if (left.length) fail(`processes still hold the demo home after cleanup: ${left.join(', ')}`);
}

// ---- Encode ----------------------------------------------------------------------------
// VHS records the real terminal as PNG frames (a text layer and a cursor layer per frame);
// encoding happens here so the GIF palette, size and frame rate stay under our control and
// do not depend on the ffmpeg filter arguments a given VHS build passes.
const FPS = 24;
const BACKGROUND = '0x15141c';
const PAD = 18;
function frameLayers(frames) {
  const layer = name => existsSync(join(frames, `frame-${name}-00001.png`)) ? join(frames, `frame-${name}-%05d.png`) : undefined;
  const text = layer('text');
  if (!text) fail('VHS produced no frames');
  return {text, cursor: layer('cursor')};
}
function encodeGif(frames, output) {
  const {text, cursor} = frameLayers(frames);
  const inputs = ['-framerate', String(FPS), '-i', text, ...(cursor ? ['-framerate', String(FPS), '-i', cursor] : [])];
  const base = cursor ? '[0][1]overlay' : '[0]null';
  const filter = `${base},pad=iw+${PAD * 2}:ih+${PAD * 2}:${PAD}:${PAD}:color=${BACKGROUND},split[a][b];[a]palettegen=max_colors=160:stats_mode=diff[p];[b][p]paletteuse=dither=none:diff_mode=rectangle`;
  mkdirSync(dirname(resolve(repo, output)), {recursive: true});
  const target = resolve(repo, output);
  const pending = `${target}.${process.pid}.pending.gif`;
  try {
    const run = spawnSync('ffmpeg', ['-v', 'error', '-y', ...inputs, '-filter_complex', filter, pending], {encoding: 'utf8'});
    if (run.status !== 0) fail(`ffmpeg could not encode ${output}: ${run.stderr}`);
    renameSync(pending, target);
  } finally { rmSync(pending, {force: true}); }
}
function encodeStill(frames, output, seconds) {
  const {text, cursor} = frameLayers(frames);
  const index = Math.max(1, Math.round(seconds * FPS));
  const pick = pattern => pattern.replace('%05d', String(index).padStart(5, '0'));
  if (!existsSync(pick(text))) fail(`${output}: no frame at ${seconds}s`);
  const inputs = ['-i', pick(text), ...(cursor && existsSync(pick(cursor)) ? ['-i', pick(cursor)] : [])];
  const filter = `${inputs.length > 2 ? '[0][1]overlay' : '[0]null'},pad=iw+${PAD * 2}:ih+${PAD * 2}:${PAD}:${PAD}:color=${BACKGROUND}`;
  const run = spawnSync('ffmpeg', ['-v', 'error', '-y', ...inputs, '-filter_complex', filter, '-frames:v', '1', resolve(repo, output)], {encoding: 'utf8'});
  if (run.status !== 0) fail(`ffmpeg could not write ${output}: ${run.stderr}`);
}

// ---- Render ----------------------------------------------------------------------------
const settings = readFileSync(join(here, 'settings.tape'), 'utf8');
const results = [];
for (const name of selected) {
  const source = readFileSync(join(here, `${name}.tape`), 'utf8');
  const output = /^Output "?([^"\s]+\.gif)"?$/mu.exec(source)?.[1];
  if (!output) fail(`${name}.tape needs one Output <path>.gif line`);
  const stills = [...source.matchAll(/^# demo-still: (\S+\.png) ([\d.]+)s$/gmu)].map(match => ({path: match[1], seconds: Number(match[2])}));
  const configExtra = Object.assign({}, ...[...source.matchAll(/^# demo-config: (\{.*\})$/gmu)].map(match => JSON.parse(match[1])));
  const home = demoHome(configExtra);
  try {
    const env = demoEnv(home, tapeEnv(source));
    const frames = join(home.root, 'frames');
    // settings first (VHS requires Set commands before actions), then the demo environment, then the tape body.
    const body = source.replace(/^Output .*$/mu, `Output ${quote(`${frames}/`)}`);
    const composed = `${settings}\n${Object.entries(env).map(([key, value]) => `Env ${key} ${quote(value)}`).join('\n')}\n\n${body}`;
    const file = join(home.root, `${name}.tape`);
    writeFileSync(file, composed);
    console.log(`demos: recording ${name}`);
    const run = spawnSync('vhs', [file], {cwd: repo, stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8', env: {...process.env, NO_COLOR: undefined}});
    if (run.status !== 0) fail(`vhs failed for ${name}:\n${run.stdout.slice(-2000)}`);
    encodeGif(frames, output);
    for (const still of stills) encodeStill(frames, still.path, still.seconds);
  } finally {
    try { await cleanup(home.root); }
    finally { rmSync(home.root, {recursive: true, force: true, maxRetries: 5, retryDelay: 200}); }
  }
  for (const file of [output, ...stills.map(still => still.path)]) results.push(`${file}  ${(statSync(resolve(repo, file)).size / 1024).toFixed(0)} KiB`);
}

// No recording may leave a keep-awake assertion or a demo process behind.
const stray = spawnSync('/bin/ps', ['-axo', 'pid=,command='], {encoding: 'utf8'}).stdout.split('\n').filter(line => /nmsh-demo-/u.test(line) && !line.includes('render.mjs'));
if (stray.length) fail(`demo processes survived:\n${stray.join('\n')}`);
console.log(`demos: done\n  ${results.join('\n  ')}`);
