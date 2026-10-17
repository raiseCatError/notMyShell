/**
 * First-run startup evidence, beside the archived references
 * (docs/design/archive/first-run-onboarding-2026-10/reference):
 *
 *   - production frames of the real TerminalApp (no shell, no PTY, no network) for every reference shot, as ANSI,
 *     plain text and SVG;
 *   - with --stills, VHS PNGs of those frames with the archive's font, theme and padding;
 *   - with --built, the built app's real first run recorded by VHS in a disposable T7 home (MP4 and stills), every
 *     process it started stopped afterwards (the run fails if one survives);
 *   - compare.html: each reference next to its production capture.
 *
 *   t7run node --import=tsx scripts/dev/startup-captures.ts /Volumes/T7Tmp/ai-dev/qa/.../captures [--stills] [--built]
 *
 * Evidence only: nothing here is a test, and none of it proves physical terminal behavior.
 */
import {execFileSync, spawnSync} from 'node:child_process';
import {existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {executionFrameFixture} from '../../tests/support/executionTimelineFrames.js';
import {terminalFrameCells} from './terminal-frame-cells.js';
import {stripAnsi} from '../../src/util/text.js';
import type {EnvironmentEvidence} from '../../src/setup/environment/detect.js';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const references = join(repo, 'docs/design/archive/first-run-onboarding-2026-10/reference');
const args = process.argv.slice(2);
const target = args.find(arg => !arg.startsWith('--'));
if (!target || !resolve(target).startsWith('/Volumes/T7Tmp/')) throw new Error('Pass an evidence directory on the T7 (/Volumes/T7Tmp/...).');
const out = resolve(target);
mkdirSync(out, {recursive: true});
const sha = execFileSync('git', ['rev-parse', 'HEAD'], {cwd: repo, encoding: 'utf8'}).trim();
const dirty = Boolean(execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], {cwd: repo, encoding: 'utf8'}).trim());

interface Shot {name: string; reference?: string; rows: string[]}
const shots: Shot[] = [];
const save = (name: string, rows: readonly string[], reference?: string) => {
  writeFileSync(join(out, `${name}.ansi`), `${rows.join('\r\n')}\r\n`);
  writeFileSync(join(out, `${name}.txt`), `${rows.map(stripAnsi).join('\n')}\n`);
  shots.push({name, rows: [...rows], ...(reference ? {reference} : {})});
};

// ---- Production frames ----------------------------------------------------------------------
const WIDE = [125, 35] as const;
const STARSHIP: EnvironmentEvidence = {home: '/Users/you', shell: {id: 'zsh', path: '/bin/zsh', label: 'zsh 5.9'}, host: 'Ghostty', files: ['~/.zshrc'],
  prompts: [{id: 'starship', label: 'Starship', state: 'active', started: true, runnable: true, version: 'starship 1.21.1', configPath: '/Users/you/.config/starship.toml',
    configExists: true, startedBy: '~/.zshrc'}],
  custom: [], tools: [{id: 'zoxide', label: 'zoxide', role: 'Navigation', state: 'active', startedBy: '~/.zshrc'}], notes: []};

type Fixture = ReturnType<typeof executionFrameFixture>;
const settle = async () => { for (let i = 0; i < 5; i++) await new Promise(done => setImmediate(done)); };
async function selector(run: (f: Fixture) => Promise<void> | void, size: readonly [number, number] = WIDE, firstRun = true): Promise<void> {
  const f = executionFrameFixture(size[0], size[1], 'rich');
  try {
    f.app['detectStartupEnvironment'] = async () => structuredClone(STARSHIP);
    if (firstRun) {
      Object.assign(f.app['promptConfiguration'], {onboardingComplete: false, introSeen: false, toolsSetupComplete: false, provider: 'nmsh'});
      f.app['startOnboarding']();
    } else f.app['startSetup']('quick');
    await settle();
    f.tick(3000);
    await run(f);
  } finally { f.dispose(); }
}
const key = (f: Fixture, value: string) => f.app['handleKey'](value.length === 1 ? {kind: 'text', value} : {kind: value} as never);
const frame = (f: Fixture) => f.capture().frame.rows;

for (const [choice, reference] of [['1', 'approved-recommended'], ['2', 'approved-minimal'], ['3', 'approved-customize'], ['4', 'approved-keep-existing']] as const) {
  await selector(f => { if (choice !== '1') { key(f, choice); f.tick(1500); } save(reference.replace('approved-', 'production-'), frame(f), reference); });
}
await selector(f => { key(f, '4'); key(f, 'enter'); f.tick(800); save('production-keep-existing-review', frame(f), 'approved-keep-existing-review'); });
await selector(f => { key(f, 'escape'); f.tick(400); save('production-leave-confirmation', frame(f), 'approved-leave-confirmation'); });
await selector(f => { key(f, '3'); key(f, 'enter'); key(f, 'complete'); key(f, 'complete'); f.tick(500); save('production-guided-tour', frame(f), 'approved-guided-tour'); });
// The ending after Recommended on a first run: the fold, then the welcome arriving, then the settled transcript.
await selector(f => {
  key(f, 'enter'); key(f, 'enter');
  let at = 0;
  const paint = (ms: number) => { const rows = f.paint(ms - at).frame.rows; at = ms; return rows; };
  for (const ms of [0, 120, 300, 520]) save(`production-ending-fold-${String(ms).padStart(4, '0')}`, paint(ms), ms === 0 ? 'approved-ending-fold-filmstrip' : undefined);
  for (const ms of [620, 760, 900, 1040, 1180, 1320, 1460, 1600]) save(`production-ending-welcome-${String(ms).padStart(4, '0')}`, paint(ms), ms === 620 ? 'approved-ending-welcome-filmstrip' : undefined);
  for (let t = at; t < 4000 && f.app['startupEnding']; t += 40) paint(t + 40);
  save('production-welcome', frame(f), 'approved-welcome');
});
// The four moods, as the selector's sky shows them when each choice is highlighted.
await selector(f => {
  for (const choice of ['1', '2', '3', '4']) { key(f, choice); f.tick(2000); save(`production-mood-${choice}`, frame(f).slice(0, 15), choice === '1' ? 'aurora-moods' : undefined); }
});
// The one-time window offer (no reference: added after the archive).
await selector(f => {
  f.app['setupState'].quick.windowOffer = true;
  save('production-window-offer', frame(f));
}, [103, 27]);

// ---- SVG ------------------------------------------------------------------------------------
const xml = (text: string) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const rgb = (color: {red: number; green: number; blue: number} | undefined, fallback: string) => color ? `rgb(${color.red},${color.green},${color.blue})` : fallback;
for (const shot of shots) {
  const cells = shot.rows.map(terminalFrameCells);
  const columns = Math.max(1, ...shot.rows.map(row => stripAnsi(row).length));
  const width = columns * 9 + 8, height = shot.rows.length * 19 + 8;
  const body = cells.flatMap((row, y) => row.flatMap(cell => [
    ...(cell.background ? [`<rect x="${cell.column * 9}" y="${y * 19}" width="${cell.width * 9}" height="19" fill="${rgb(cell.background, '#15141c')}"/>`] : []),
    ...(cell.text.trim() ? [`<text x="${cell.column * 9}" y="${y * 19 + 14}" fill="${rgb(cell.foreground, '#f2f0ec')}">${xml(cell.text)}</text>`] : [])])).join('');
  writeFileSync(join(out, `${shot.name}.svg`), `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="-4 -4 ${width} ${height}"><rect x="-4" y="-4" width="${width}" height="${height}" fill="#15141c"/><g font-family="JetBrainsMono Nerd Font Mono,Symbols Nerd Font Mono,Menlo,monospace" font-size="15">${body}</g></svg>\n`);
}

// ---- VHS ------------------------------------------------------------------------------------
const scratch = process.env.T7_RUN_DIR || process.env.TMPDIR || '';
const vhsReady = () => spawnSync('/usr/bin/env', ['which', 'vhs'], {encoding: 'utf8'}).stdout.trim() !== '';
const THEME = '{ "name": "NMSh Demo", "black": "#1b1a24", "red": "#cd737b", "green": "#74b59a", "yellow": "#e3c48f", "blue": "#8aa4e6", "magenta": "#c5b9e8", "cyan": "#7fc4cc", "white": "#d8d6de", "brightBlack": "#6b6f7b", "brightRed": "#e2939a", "brightGreen": "#94cdb4", "brightYellow": "#f0d9a8", "brightBlue": "#a9bdf0", "brightMagenta": "#dcd2f4", "brightCyan": "#a0d8de", "brightWhite": "#f2f0ec", "background": "#15141c", "foreground": "#f2f0ec", "selection": "#585f91", "cursor": "#c5b9e8" }';
const vhsSettings = (width: number, height: number) => ['Set Shell "bash"', 'Set FontFamily "JetBrainsMono Nerd Font Mono"', 'Set FontSize 18', 'Set LineHeight 1.15',
  `Set Width ${width}`, `Set Height ${height}`, 'Set Padding 18', 'Set BorderRadius 0', 'Set Margin 0', 'Set Framerate 24', 'Set TypingSpeed 1ms',
  'Set CursorBlink false', `Set Theme ${THEME}`];

function still(shot: Shot): void {
  if (!scratch.startsWith('/Volumes/T7Tmp/')) throw new Error('Run through t7run: VHS scratch must be on the T7.');
  const columns = Math.max(...shot.rows.map(row => stripAnsi(row).length));
  // The measured cell of this font in VHS's xterm.js is about 11.2 × 26.4 px.
  const width = Math.ceil((columns + 3) * 11.3) + 44, height = Math.ceil(shot.rows.length * 26.6) + 42;
  const work = mkdtempSync(join(scratch, 'still-'));
  try {
    const payload = join(work, 'frame.ansi');
    writeFileSync(payload, `\u001b[?25l\u001b[H\u001b[2J${shot.rows.join('\r\n')}`);
    // VHS writes its frames (text layer) to a directory; the settled one is padded like the archive's captures.
    const frames = join(work, 'frames');
    const tape = [`Output "${frames}/"`, ...vhsSettings(width, height), 'Hide', `Type "stty -echo; clear; cat '${payload}'; sleep 6"`, 'Enter', 'Sleep 1.2s', 'Show', 'Sleep 400ms', 'Hide'].join('\n');
    writeFileSync(join(work, 'still.tape'), `${tape}\n`);
    const run = spawnSync('vhs', [join(work, 'still.tape')], {encoding: 'utf8'});
    if (run.status !== 0) throw new Error(`vhs ${shot.name}: ${run.stdout.slice(-400)}${run.stderr.slice(-400)}`);
    const settled = readdirSync(frames).filter(name => name.startsWith('frame-text-')).sort();
    if (!settled.length) throw new Error(`vhs ${shot.name}: no frames`);
    const pick = join(frames, settled[Math.max(0, settled.length - 2)]!);
    const pad = spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', pick, '-vf', 'pad=iw+36:ih+36:18:18:color=0x15141c', '-frames:v', '1', join(out, `${shot.name}.png`)], {encoding: 'utf8'});
    if (pad.status !== 0) throw new Error(`ffmpeg ${shot.name}: ${pad.stderr}`);
  } finally { rmSync(work, {recursive: true, force: true}); }
}

if (args.includes('--stills')) {
  if (!vhsReady()) throw new Error('--stills needs VHS (vhs, ttyd, ffmpeg).');
  for (const shot of shots) { still(shot); console.log(`still ${shot.name}`); }
}

// ---- The built app's real first run ---------------------------------------------------------
function holders(root: string): number[] {
  const result = spawnSync('lsof', ['-t', '+D', root], {encoding: 'utf8', timeout: 15_000});
  if (result.error || (result.status !== 0 && result.status !== 1)) throw new Error(`cannot check process cleanup: ${result.error?.message ?? result.stderr}`);
  return result.stdout.split('\n').map(Number).filter(pid => pid > 0 && pid !== process.pid);
}
async function stopEverything(root: string): Promise<void> {
  for (const signal of ['SIGTERM', 'SIGKILL'] as const) {
    for (let attempt = 0; attempt < 20; attempt++) {
      const pids = holders(root);
      if (!pids.length) return;
      for (const pid of pids) { try { process.kill(pid, signal); } catch { /* gone */ } }
      await new Promise(done => setTimeout(done, 250));
    }
  }
  const left = holders(root);
  if (left.length) throw new Error(`processes still hold the capture home: ${left.join(', ')}`);
}

if (args.includes('--built')) {
  if (!vhsReady()) throw new Error('--built needs VHS (vhs, ttyd, ffmpeg).');
  if (!scratch.startsWith('/Volumes/T7Tmp/')) throw new Error('Run through t7run: the capture home must be on the T7.');
  const build = spawnSync('npm', ['run', 'build', '--silent'], {cwd: repo, stdio: 'inherit'});
  if (build.status !== 0) throw new Error('npm run build failed');
  const quote = (value: string) => `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
  const pad = 'pad=ceil((iw+36)/2)*2:ceil((ih+36)/2)*2:18:18:color=0x15141c';
  /**
   * One genuine first run (no NMSh configuration at all) in its own disposable T7 home, driven by VHS keys and
   * recorded as frames (VHS's own encoders are not relied on, as in scripts/demos/render.mjs). Every process it
   * started is stopped afterwards and the home removed; `use` gets the frames first.
   */
  async function firstRun(keys: readonly string[], use: (frames: string, recorded: string[]) => void): Promise<void> {
    const root = realpathSync(mkdtempSync(join(scratch, 'nmsh-first-run-')));
    const home = join(root, 'home'), runtime = join(root, 'run'), temp = join(root, 'tmp'), frames = join(root, 'frames');
    for (const dir of [home, runtime, temp, join(home, '.config'), join(home, '.local/share'), join(home, '.local/state'), join(home, '.cache')]) mkdirSync(dir, {recursive: true, mode: 0o700});
    writeFileSync(join(home, '.zshrc'), '# NMSh first-run capture home\n');
    writeFileSync(join(home, '.zshenv'), '');
    const env: Record<string, string> = {HOME: home, USER: 'demo', LOGNAME: 'demo', SHELL: '/bin/zsh',
      PATH: [join(repo, 'bin'), dirname(process.execPath), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin'].join(':'),
      XDG_CONFIG_HOME: join(home, '.config'), XDG_DATA_HOME: join(home, '.local/share'), XDG_STATE_HOME: join(home, '.local/state'), XDG_CACHE_HOME: join(home, '.cache'),
      NMSH_RUNTIME_DIR: runtime, TMPDIR: temp, TMP: temp, TEMP: temp, NMSH_DISABLE_UPDATES: '1', TERM: 'xterm-256color', COLORTERM: 'truecolor', LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8',
      // Host markers would describe the recording machine's terminal: none, so no host window is ever asked about.
      TERM_PROGRAM: '', GHOSTTY_RESOURCES_DIR: '', KITTY_WINDOW_ID: '', KITTY_LISTEN_ON: '', HYPRLAND_INSTANCE_SIGNATURE: '', VSCODE_INJECTION: '', ZED_TERM: ''};
    const tape = [`Output ${quote(`${frames}/`)}`, ...vhsSettings(1440, 960), ...Object.entries(env).map(([name, value]) => `Env ${name} ${quote(value)}`),
      'Hide', 'Type "clear; nmsh"', 'Enter', 'Sleep 6s', 'Show', 'Sleep 1500ms', ...keys].join('\n');
    const file = join(root, 'first-run.tape');
    writeFileSync(file, `${tape}\n`);
    try {
      const run = spawnSync('vhs', [file], {cwd: root, encoding: 'utf8', env: {...process.env, NO_COLOR: undefined}});
      if (run.status !== 0) throw new Error(`vhs first run: ${run.stdout.slice(-1500)}${run.stderr.slice(-800)}`);
      const recorded = readdirSync(frames).filter(name => name.startsWith('frame-text-')).sort();
      if (!recorded.length) throw new Error('VHS recorded no frames');
      use(frames, recorded);
    } finally {
      try { await stopEverything(root); } finally { rmSync(root, {recursive: true, force: true, maxRetries: 5, retryDelay: 200}); }
    }
  }
  // Stills: each its own first run, holding the state it shows, so the last settled frame is that state.
  const hold = 'Sleep 2500ms';
  const states: Array<[string, string[]]> = [
    ['selector', [hold]], ['minimal', ['Down', hold]], ['keep-existing', ['Down', 'Down', 'Down', hold]], ['review', ['Enter', hold]],
    ['welcome', ['Enter', 'Sleep 800ms', 'Enter', 'Sleep 4s']]];
  for (const [name, keys] of states) {
    await firstRun(keys, (frames, recorded) => {
      const still = spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', join(frames, recorded[Math.max(0, recorded.length - 2)]!), '-vf', pad, '-frames:v', '1', join(out, `built-${name}.png`)], {encoding: 'utf8'});
      if (still.status !== 0) throw new Error(`ffmpeg still ${name}: ${still.stderr}`);
    });
    console.log(`built ${name}`);
  }
  // The whole first run as one clip: browse the four, review Recommended, Apply, the ending and the welcome.
  await firstRun(['Down', 'Sleep 1200ms', 'Down', 'Sleep 1200ms', 'Down', 'Sleep 1200ms', 'Up', 'Up', 'Up', 'Sleep 1200ms', 'Enter', 'Sleep 1200ms', 'Enter', 'Sleep 4s'], frames => {
    const video = spawnSync('ffmpeg', ['-v', 'error', '-y', '-framerate', '24', '-i', join(frames, 'frame-text-%05d.png'), '-vf', `${pad},format=yuv420p`,
      '-c:v', 'libx264', '-crf', '20', join(out, 'built-first-run.mp4')], {encoding: 'utf8'});
    if (video.status !== 0) throw new Error(`ffmpeg video: ${video.stderr}`);
  });
  console.log('built first run recorded');
}

// ---- Side by side ---------------------------------------------------------------------------
const media = (name: string) => existsSync(join(out, `${name}.png`)) ? `${name}.png` : `${name}.svg`;
const pairs = shots.filter(shot => shot.reference);
const sections = pairs.map(shot => {
  const reference = join(references, `${shot.reference}.png`);
  const related = shot.name.startsWith('production-ending-fold') ? shots.filter(item => item.name.startsWith('production-ending-fold'))
    : shot.name.startsWith('production-ending-welcome') ? shots.filter(item => item.name.startsWith('production-ending-welcome'))
      : shot.name.startsWith('production-mood') ? shots.filter(item => item.name.startsWith('production-mood')) : [shot];
  return `<section><h2>${xml(shot.reference!)}</h2><div class="pair"><figure><img src="file://${xml(reference)}"><figcaption>Archived reference</figcaption></figure>
    <figure>${related.map(item => `<img src="${xml(media(item.name))}" title="${xml(item.name)}">`).join('')}<figcaption>Production · ${xml(related.map(item => item.name).join(', '))}</figcaption></figure></div></section>`;
});
const built = readdirSync(out).filter(name => name.startsWith('built-') && name.endsWith('.png')).sort();
writeFileSync(join(out, 'compare.html'), `<!doctype html><meta charset="utf-8"><title>First-run startup: references and production</title>
<style>body{background:#111116;color:#e8e6ee;font:14px system-ui;margin:24px}img{max-width:100%;display:block;margin:0 0 8px;border:1px solid #333}
.pair{display:grid;grid-template-columns:1fr 1fr;gap:16px}figcaption{color:#9a97a8;font-size:12px}h2{font-size:15px;margin-top:36px}</style>
<h1>First-run startup: archived references beside production</h1>
<p>${sha}${dirty ? ' · uncommitted changes' : ''}. Production frames come from the real TerminalApp with no shell or PTY${built.length ? '; the built-app shots are a real first run recorded by VHS in a disposable home' : ''}. Physical terminal QA is separate.</p>
${sections.join('\n')}
${built.length ? `<section><h2>Built app, real first run</h2>${built.map(name => `<figure><img src="${xml(name)}"><figcaption>${xml(name)}</figcaption></figure>`).join('')}${existsSync(join(out, 'built-first-run.mp4')) ? '<video src="built-first-run.mp4" controls width="900"></video>' : ''}</section>` : ''}
`);
writeFileSync(join(out, 'manifest.json'), `${JSON.stringify({sha, dirty, shots: shots.map(shot => ({name: shot.name, reference: shot.reference ?? null}))}, null, 2)}\n`);
console.log(`${shots.length} production frames, ${pairs.length} reference pairs → ${join(out, 'compare.html')}`);
