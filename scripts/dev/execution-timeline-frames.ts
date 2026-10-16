/** Capture actual TerminalApp frames. Simulated observations only; never executes displayed commands. */
import {execFileSync} from 'node:child_process';
import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {executionFrameFixture, type CaptureMode} from '../../tests/support/executionTimelineFrames.js';
import {terminalFrameCells} from './terminal-frame-cells.js';
import {displayWidth, stripAnsi} from '../../src/util/text.js';
import {regionOf} from '../../src/app/screenPlan.js';

type Observation = ReturnType<ReturnType<typeof executionFrameFixture>['capture']>;
type Capture = Observation & {name: string; columns: number; rows: number; mode: CaptureMode; sequence?: string};
const modes: CaptureMode[] = ['normal', 'reduced', 'safe-no-color', 'rich'];

function captureMode(mode: CaptureMode): Capture[] {
  const captures: Capture[] = [];
  for (const [columns, rows] of [[80, 30], [32, 18]]) {
    for (const scenario of ['progression', 'failure', 'interruption', 'manual']) {
      const f = executionFrameFixture(columns, rows, mode);
      const record = (name: string, observation = f.capture(), sequence?: string) => {
        if (observation.frame.rows.length !== rows || observation.frame.rows.some(row => displayWidth(row) > columns)) throw new Error(`Frame overflow: ${name}`);
        if (regionOf(observation.plan, 'input')?.top !== observation.frame.cursorRow - 1) throw new Error('Composer geometry diverged');
        if (mode === 'safe-no-color' && /\u001b\[(?:38|48);/u.test(observation.frame.rows.join(''))) throw new Error('Color leaked into NO_COLOR frame');
        captures.push({...observation, name, columns, rows, mode, ...(sequence ? {sequence} : {})});
      };
      try {
        f.begin('npm run build', '> nmsh build\nCompiling project...\n'); f.tick(500);
        const foreground = f.capture();
        if (scenario === 'progression') record('foreground-only', foreground);
        f.owner.request({op: 'add', text: 'npm test'});
        if (scenario === 'progression') record('first-queued');
        f.owner.request({op: 'add', text: 'git status'}); f.owner.request({op: 'add', text: 'echo done'});
        f.tick(2600);
        if (scenario === 'progression') {
          const running = f.capture(); record('running', running);
          if (running.plan.ptyRows !== foreground.plan.ptyRows || regionOf(running.plan, 'input')?.top !== regionOf(foreground.plan, 'input')?.top) throw new Error('Timeline changed foreground PTY/composer geometry');
        }
        f.tick(5100); f.complete();
        if (scenario === 'progression') record('success-before-promotion');
        f.begin('npm test', 'Running test suite...\n');
        if (scenario === 'progression') {
          record('promotion-000', f.capture(), 'promotion');
          record('promotion-040', f.paint(40), 'promotion');
          record('promotion-120', f.paint(80), 'promotion');
          record('promotion-205', f.paint(85), 'promotion');
          record('promotion-settled', f.paint(855), 'promotion');
          f.tick(2040); f.complete();
          f.begin('git status', 'On branch feature/example\n'); f.tick(200); f.complete();
          f.begin('echo done', 'done\n'); f.tick(100); f.complete();
          record('completed-000', f.capture(), 'completion');
          record('completed-040', f.paint(40), 'completion');
          record('completed-120', f.paint(80), 'completion');
          record('completed-205', f.paint(85), 'completion');
          record('completed-settled', f.paint(855), 'completion');
          f.tick(7100); record('retention-dismissed');
        } else if (scenario === 'failure') {
          f.tick(3100); f.complete(17); record('failure-000', f.capture(), 'failure');
          record('failure-040', f.paint(40), 'failure'); record('failure-120', f.paint(80), 'failure'); record('failure-205', f.paint(85), 'failure'); record('failure-settled', f.paint(855), 'failure');
        } else if (scenario === 'interruption') {
          f.tick(3100); f.owner.onInterrupt(); f.app['running']!.interrupted = true; f.complete(130);
          record('interruption-000', f.capture(), 'interruption'); record('interruption-040', f.paint(40), 'interruption'); record('interruption-120', f.paint(80), 'interruption'); record('interruption-205', f.paint(85), 'interruption'); record('interruption-settled', f.paint(855), 'interruption');
        } else {
          f.tick(3100); f.owner.request({op: 'pause'}); record('manual-pause-running');
          f.complete(); record('manual-pause'); f.paint(1000);
          // Owner operations here stand for the already-reviewed UI confirmation; they never execute real commands.
          f.owner.request({op: 'resume', expectedRevision: f.owner.state.revision}); record('reviewed-resume');
          f.begin('git status', 'On branch feature/example\n'); record('resumed-promotion'); f.paint(1000); record('resume-settled');
        }
      } finally { f.dispose(); }
    }
  }
  return captures;
}

if (process.argv[2] === '--worker') {
  writeFileSync(process.argv[3]!, JSON.stringify(captureMode(process.argv[4] as CaptureMode)));
} else {
  const args = process.argv.slice(2);
  const full = args.includes('--full');
  const target = args.find(value => !value.startsWith('--'));
  const directory = resolve(target ?? 'docs/development/execution-timeline-slice-1/revised');
  mkdirSync(directory, {recursive: true});
  const sha = execFileSync('git', ['rev-parse', 'HEAD'], {encoding: 'utf8'}).trim();
  const dirty = Boolean(execFileSync('git', ['status', '--porcelain'], {encoding: 'utf8'}).trim());
  const temp = mkdtempSync(join(tmpdir(), 'nmsh-frame-captures-'));
  const captures: Capture[] = [];
  try {
    for (const mode of modes) {
      const file = join(temp, `${mode}.json`);
      const env: NodeJS.ProcessEnv = {...process.env, TZ: 'UTC', TERM: 'xterm-256color', COLORTERM: 'truecolor'};
      delete env.NMSH_COLOR; delete env.NO_COLOR;
      if (mode === 'safe-no-color') env.NO_COLOR = '1';
      // Startup environment is set before imports, including existing transcript module constants.
      execFileSync(process.execPath, ['--import=tsx', fileURLToPath(import.meta.url), '--worker', file, mode], {env, stdio: 'pipe'});
      captures.push(...JSON.parse(readFileSync(file, 'utf8')) as Capture[]);
    }
  } finally { rmSync(temp, {recursive: true, force: true}); }
  const escape = (text: string) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
  const nameOf = (value: Capture) => `${value.mode}-${value.columns}x${value.rows}-${value.name}`;
  function frameSvg(value: Capture, x = 0, y = 0): string {
    const cellWidth = 8, cellHeight = 18;
    const result = [`<g transform="translate(${x},${y})"><rect width="${value.columns * cellWidth + 24}" height="${value.rows * cellHeight + 24}" fill="#17171d"/>`];
    value.frame.rows.forEach((row, index) => {
      for (const cell of terminalFrameCells(row)) {
        const {column, foreground, background} = cell;
        if (background) result.push(`<rect x="${12 + column * cellWidth}" y="${12 + index * cellHeight}" width="${cell.width * cellWidth}" height="${cellHeight}" fill="rgb(${background.red},${background.green},${background.blue})"/>`);
        const fill = foreground ? `rgb(${foreground.red},${foreground.green},${foreground.blue})` : '#f2f0ec';
        result.push(`<text x="${12 + column * cellWidth}" y="${26 + index * cellHeight}" fill="${fill}" xml:space="preserve">${escape(cell.text)}</text>`);
      }
    });
    // The production cursor coordinates are recorded; show its host bar, without changing any frame text.
    if (value.frame.cursorVisible !== false) result.push(`<rect x="${12 + (value.frame.cursorColumn - 1) * cellWidth}" y="${12 + (value.frame.cursorRow - 1) * cellHeight}" width="1" height="${cellHeight}" fill="#f2f0ec"/>`);
    return result.join('\n') + '</g>';
  }
  const wrap = (width: number, height: number, content: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><style>text{font:13px Menlo,DejaVu Sans Mono,monospace}</style>${content}</svg>\n`;
  const markdown = ['# Revised Slice 1 integrated production frames', '', `Source HEAD: \`${sha}\`${dirty ? ' (working tree has uncommitted changes; development preview only)' : ' (clean source tree)'}.`, '',
    `Generated by \`rtk env -u NO_COLOR -u NMSH_RETURN_SESSION -u NMSH_HANDOFF_SHELL TERM=xterm-256color COLORTERM=truecolor node --import=tsx scripts/dev/execution-timeline-frames.ts${full ? ' --full' : ''}\`.`, '',
    'The committed review set is every raw ANSI frame, the complete frame/state JSON, one color gallery covering all four modes and a player of the recorded motion sequences. `--full` additionally writes one SVG per frame and replays every mode; those derived SVGs stay out of the checkpoint commit to keep the evidence review-sized.', '',
    'Every frame below comes from **TerminalApp.render()/paintPresentation()**, the real OutputBuffer, queue owner observations, screen plan and shared Transitions/cell-overlay renderer. The fixture substitutes the session boundary and workspace lookups; displayed commands never execute. It uses a private temporary HOME/config and the Fish frontend adapter to avoid starting a shell or semantic helper. This is renderer evidence, not real-PTY or physical terminal QA.', '',
    'The SVG serializer reads the emitted ANSI cell foregrounds/backgrounds. The dark canvas represents a sample terminal host; row fills are opaque ANSI surfaces, with no claimed alpha or background detection. The bar uses the actual frame cursor coordinates. JSON preserves every full frame, plan and owner snapshot. Time is deterministic UTC.', '',
    'Normal and Rich use existing motion tuning; Reduced Motion and Safe/NO_COLOR settle instantly. Each event sequence includes first, +40 ms, +120 ms, +205 ms and settled frames. The promotion frame already shows the truthful new state; no execution waits for an effect. Unchanged cell positions and PTY/composer geometry are asserted in focused tests.', '',
    '[Full frame/state JSON](frames.json) · [Motion player](motion.html) · [Original 80b9736 gallery](../previews.md)', ''];
  for (const value of captures) {
    const name = nameOf(value);
    writeFileSync(join(directory, `${name}.ansi`), value.frame.rows.join('\r\n') + '\r\n');
    if (full) {
      writeFileSync(join(directory, `${name}.svg`), wrap(value.columns * 8 + 24, value.rows * 18 + 24, frameSvg(value)));
      markdown.push(`## ${name}`, '', `[ANSI](${name}.ansi) · [Full frame](${name}.svg)`, '', `![${escape(name)}](${name}.svg)`, '');
    } else markdown.push(`### ${name}`, '', `[ANSI frame](${name}.ansi)`, '');
  }
  const selected: Array<[CaptureMode, string]> = [
    ['normal', 'running'], ['normal', 'promotion-040'], ['normal', 'failure-settled'], ['normal', 'interruption-settled'],
    ['normal', 'manual-pause'], ['normal', 'completed-settled'],
    ['rich', 'promotion-040'], ['reduced', 'running'], ['safe-no-color', 'failure-settled'], ['safe-no-color', 'manual-pause'],
  ];
  let gallery = '';
  selected.forEach(([mode, name], index) => {
    const values = captures.filter(value => value.mode === mode && value.name === name);
    gallery += `<text x="20" y="${24 + index * 610}" fill="#b0b8c2">${mode} · ${name} · 80×30 / 32×18</text>`;
    for (const value of values) gallery += frameSvg(value, value.columns === 80 ? 8 : 690, 36 + index * 610);
  });
  writeFileSync(join(directory, 'gallery.svg'), wrap(990, selected.length * 610, `<rect width="990" height="${selected.length * 610}" fill="#17171d"/>${gallery}`));
  // A finite player of recorded frames, not a new NMSh animation implementation.
  // Reduced Motion and Safe/NO_COLOR settle instantly, so the default player records the animated modes only.
  const playerModes: CaptureMode[] = full ? modes : ['normal', 'rich'];
  const groups = playerModes.flatMap(mode => [80, 32].flatMap(columns => ['promotion', 'failure', 'interruption', 'completion'].map(sequence => {
    const frames = captures.filter(value => value.mode === mode && value.columns === columns && value.sequence === sequence);
    return `<section><h2>${mode} · ${columns} columns · ${sequence}</h2><button type="button">Replay recorded frames</button><div class="sequence">${frames.map((value, index) => `<figure data-index="${index}" ${index ? 'hidden' : ''}>${wrap(value.columns * 8 + 24, value.rows * 18 + 24, frameSvg(value))}<figcaption>${value.name} · observed ${value.at - frames[0]!.at} ms</figcaption></figure>`).join('')}</div></section>`;
  })));
  writeFileSync(join(directory, 'motion.html'), `<!doctype html><meta charset="utf-8"><title>NMSh recorded production frames · ${sha}</title><style>body{background:#17171d;color:#f2f0ec;font:14px system-ui;padding:20px}section{display:inline-block;vertical-align:top;margin:16px}figure{margin:8px 0}button{padding:8px}figcaption{color:#b0b8c2}</style><h1>Recorded production frames</h1><p>Source ${sha}${dirty ? ' (development working tree)' : ''}. Replay only; no shell execution. Final state stays visible.</p>${groups.join('')}<script>for(const section of document.querySelectorAll('section')){let timers=[];section.querySelector('button').onclick=()=>{timers.forEach(clearTimeout);const frames=[...section.querySelectorAll('figure')];const delays=[0,40,120,205,1060];frames.forEach((frame,index)=>{timers.push(setTimeout(()=>frames.forEach(value=>value.hidden=value!==frame),delays[index]));});};}</script>\n`);
  writeFileSync(join(directory, 'frames.json'), JSON.stringify({sourceSha: sha, dirty, captures}, null, 2) + '\n');
  writeFileSync(join(directory, 'previews.md'), markdown.join('\n'));
  process.stdout.write(`Captured ${captures.length} complete production frames into ${directory}\n`);
}
