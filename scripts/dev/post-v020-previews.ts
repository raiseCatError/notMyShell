/** Production-renderer evidence only. No shell, host config, clipboard, journal or network access. */
import {mkdirSync, writeFileSync, readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {resolve, join} from 'node:path';
import {executionFrameFixture, type CaptureMode} from '../../tests/support/executionTimelineFrames.js';
import {terminalFrameCells} from './terminal-frame-cells.js';
import {renderSetupIntro} from '../../src/setup/SetupCat.js';
import {renderCursorPreview} from '../../src/cursor/CursorPreview.js';
import {applyFireColor} from '../../src/cursor/palette.js';
import {resolveCursorSettings, contextFor} from '../../src/cursor/colors.js';
import {chooseBackend} from '../../src/cursor/backends.js';
import {DEFAULT_PROMPT_CONFIGURATION} from '../../src/prompt/configuration.js';
import {stripAnsi} from '../../src/util/text.js';

if (!process.argv[2]) throw new Error('Pass an explicit external-drive evidence directory.');
const directory = resolve(process.argv[2]); mkdirSync(directory, {recursive: true});
const sha = execFileSync('git', ['rev-parse', 'HEAD'], {encoding: 'utf8'}).trim();
const dirty = Boolean(execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], {encoding: 'utf8'}).trim());
const frames: Array<{name: string; rows: string[]; cells: ReturnType<typeof terminalFrameCells>[]}> = [];
const capture = (name: string, rows: string[]) => {
  writeFileSync(join(directory, `${name}.ansi`), rows.join('\r\n') + '\r\n');
  writeFileSync(join(directory, `${name}.txt`), rows.map(stripAnsi).join('\n') + '\n');
  frames.push({name, rows, cells: rows.map(terminalFrameCells)});
};
for (const [width, height, mode] of [[80, 30, 'normal'], [32, 18, 'normal'], [32, 18, 'reduced'], [32, 18, 'safe-no-color']] as const) {
  for (const choice of [0, 1, 2]) for (const layout of choice === 1 ? ['oneLine', 'twoLine'] : ['oneLine']) {
    const f = executionFrameFixture(width, height, mode as CaptureMode);
    try {
      f.app['startSetup']('quick'); f.app['handleKey']({kind: 'text', value: String(choice + 1)});
      if (choice === 1 && layout === 'twoLine') f.app['handleKey']({kind: 'right'});
      // Captures deliberately use the accessibility condition for the highlighted draft as well as the host environment.
      if (mode === 'reduced') f.app['setupState']!.draft.presentation.reducedMotion = true;
      f.capture(); let previous = 0;
      for (const elapsed of [0, 700, 1200, 2400, 3400, 4500, 5700, 7000]) {
        f.tick(elapsed - previous); previous = elapsed;
        capture(`${choice}-${layout}-${width}-${mode}-${elapsed}`, f.capture().frame.rows);
      }
      f.app['handleKey']({kind: 'text', value: 'r'});
      capture(`${choice}-${layout}-${width}-${mode}-replay`, f.capture().frame.rows);
      for (const value of ['1', '3', '2', String(choice + 1)]) { f.app['handleKey']({kind: 'text', value}); f.capture(); }
      capture(`${choice}-${layout}-${width}-${mode}-refocus`, f.capture().frame.rows);
      f.app['handleKey']({kind: 'escape'});
      if (f.app['setupCursorClock']) throw new Error('Preview leaked its clock after cancellation.');
    } finally { f.dispose(); }
  }
}
for (const width of [32, 80]) {
  const f = executionFrameFixture(width, 24);
  try {
    for (const elapsed of [0, 700, 1300, 2000, 2600]) capture(`intro-${width}-${elapsed}`, renderSetupIntro(width, 24, elapsed, false).rows);
    capture(`intro-${width}-static`, renderSetupIntro(width, 24, 0, true).rows);
    for (const color of ['purple', 'blue', 'green', 'classic', 'theme'] as const) {
      const config = DEFAULT_PROMPT_CONFIGURATION;
      const settings = resolveCursorSettings(applyFireColor(config.cursor, color), contextFor(config));
      const choice = chooseBackend(settings, {host: 'other', caretColor: 'host-controlled', integrated: false});
      capture(`fire-${color}-${width}`, renderCursorPreview({scene: 'jump', title: `Fire · ${color} · Portable demo`, settings, choice, columns: width, elapsed: 450, still: false}).rows);
    }
  } finally { f.dispose(); }
}
{
  const f = executionFrameFixture(80, 30);
  try {
    f.app['promptConfiguration'].provider = 'nmsh'; f.app['effectivePromptProvider'] = 'nmsh';
    f.app['promptConfiguration'].transcript.historicalPrompt = true;
    f.app['output'].setTranscriptAppearance(f.app['promptConfiguration'].transcript);
    f.begin('printf selected', 'selected output\n'); f.complete(); await f.app['copySlash']('/copy', '');
    capture('selection-after', f.capture().frame.rows);
  } finally { f.dispose(); }
}
if (process.argv[3]) capture('selection-before', readFileSync(process.argv[3], 'utf8').split(/\r?\n/u));
const xml = (s: string) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const rgb = (c: {red: number; green: number; blue: number} | undefined, fallback: string) => c ? `rgb(${c.red},${c.green},${c.blue})` : fallback;
const svg = (frame: typeof frames[number]) => {
  const body = frame.cells.flatMap((cells, row) => cells.flatMap(cell => [
    ...(cell.background ? [`<rect x="${cell.column * 8}" y="${row * 17}" width="${cell.width * 8}" height="17" fill="${rgb(cell.background, '#17171d')}"/>`] : []),
    `<text x="${cell.column * 8}" y="${row * 17 + 13}" fill="${rgb(cell.foreground, '#f2f0ec')}">${xml(cell.text)}</text>`])).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="660" height="${frame.rows.length * 17 + 8}" viewBox="-4 -4 660 ${frame.rows.length * 17 + 8}"><rect x="-4" y="-4" width="660" height="100%" fill="#17171d"/><g font-family="MesloLGS NF,Symbols Nerd Font Mono,Menlo,monospace" font-size="13">${body}</g></svg>`;
};
const manifest = {sha, dirty, description: 'Production TerminalApp and shared pure renderers; deterministic synthetic demo, no PTY or commands.', frames};
writeFileSync(join(directory, 'frames.json'), JSON.stringify(manifest));
const galleries = frames.filter(frame => /^(?:[012]-.*-80-normal-(?:700|2400|3400|5700)|intro-80-(?:1300|2000)|selection-(?:before|after)|fire-.*-80)$/u.test(frame.name));
for (const frame of galleries) writeFileSync(join(directory, `${frame.name}.svg`), svg(frame));
writeFileSync(join(directory, 'gallery.html'), `<!doctype html><meta charset="utf-8"><title>NMSh production captures</title><style>body{background:#111116;color:#eee;font:15px system-ui;margin:24px}button,select,input{margin:8px}svg{display:block;border:1px solid #555;max-width:100%}article{display:inline-block;vertical-align:top;margin:12px}h3{font-size:14px}</style><h1>NMSh production captures</h1><p>${sha}${dirty ? ' · working tree changes' : ''}. Synthetic demonstrations; no shell commands executed. Physical terminal QA remains separate.</p><select id="choice"></select><button id="replay">R Replay</button><input id="time" type="range" min="0" max="7" value="0"><p id="label"></p><div id="player"></div><h2>Frozen evidence</h2>${galleries.map(frame => `<article><h3>${xml(frame.name)}</h3>${svg(frame)}</article>`).join('')}<script>const frames=${JSON.stringify(frames.filter(frame => /-80-normal-(0|700|1200|2400|3400|4500|5700|7000)$/.test(frame.name)).map(frame => ({name: frame.name, svg: svg(frame)}))).replaceAll('<', '\u003c')};const groups=[...new Set(frames.map(f=>f.name.replace(/-\d+$/,'')))];choice.innerHTML=groups.map(g=>'<option>'+g+'</option>').join('');let timer;function show(){const list=frames.filter(f=>f.name.startsWith(choice.value+'-'));const f=list[+time.value];player.innerHTML=f.svg;label.textContent=f.name}function play(){clearInterval(timer);time.value=0;show();timer=setInterval(()=>{if(+time.value===7){clearInterval(timer);return}time.value=+time.value+1;show()},700)}choice.onchange=play;replay.onclick=play;time.oninput=()=>{clearInterval(timer);show()};show();</script>`);
console.log(`Production captures: ${directory}`);
