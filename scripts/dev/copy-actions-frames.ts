/** Deterministic evidence from TerminalApp.render(), OutputBuffer and screenPlan; never starts a shell. */
import {execFileSync} from 'node:child_process';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {executionFrameFixture, type CaptureMode} from '../../tests/support/executionTimelineFrames.js';
import {AnsiOutputParser} from '../../src/output/AnsiOutputParser.js';
import {currentBackground, currentForeground} from '../../src/presentation/cellOverlay.js';
import {copyPickerKey} from '../../src/ui/CopyPicker.js';
import {stripAnsi} from '../../src/util/text.js';

type Capture = ReturnType<ReturnType<typeof executionFrameFixture>['capture']> & {name: string; columns: number; rows: number; mode: CaptureMode};
async function captureMode(mode: CaptureMode) {
  const captures: Capture[] = [];
  for (const [columns, rows] of [[80, 30], [32, 18]]) {
    const f = executionFrameFixture(columns, rows, mode);
    try {
      f.app['promptConfiguration'].liveActivity.style = 'classic';
      f.begin('printf status', 'alpha\tbeta\n日本語\n'); f.tick(1200); f.complete();
      f.begin('npm test', 'PASS editor\nFAIL integration\n  expected 0, received 2\n'); f.tick(2500); f.complete(2);
      const capture = (name: string) => captures.push({...f.capture(), name, columns, rows, mode});
      capture('entry-view');
      await f.app['copySlash']('/copy', ''); capture('copy-selection');
      f.app['handleKey']({kind: 'escape'}); capture('esc-restoration');
      await f.app['runSlash']('/actions', {kind: 'actions'}); capture('actions-selection');
      f.app['handleKey']({kind: 'up'}); f.app['handleKey']({kind: 'enter'}); capture('contextual-palette');
      f.app['handleKey']({kind: 'escape'}); capture('palette-return');
      f.app['handleKey']({kind: 'escape'});
      await f.app['copySlash']('/copy ui', 'ui');
      copyPickerKey(f.app['copyPicker']!, {kind: 'text', value: ' '}); capture('copy-ui');
      f.app['handleKey']({kind: 'escape'});
      const records = f.app['output'].recentShellCommands();
      f.app['openCompare'](records[0]!, records[1]); capture('compare');
      f.app['handleKey']({kind: 'escape'}); f.app['handleKey']({kind: 'escape'});
      const output = f.app['output'];
      output.beginCommand('seq 1 400', ['seq 1 400']);
      output.write(Array.from({length: 400}, (_, index) => `${index + 1}\n`).join(''));
      output.complete(0, {queued: true, foldQueued: true});
      await f.app['copySlash']('/copy', ''); capture('folded-copy-selection');
      f.app['handleKey']({kind: 'escape'});
    } finally { f.dispose(); }
  }
  return captures;
}

if (process.argv[2] === '--worker') {
  writeFileSync(process.argv[3]!, JSON.stringify(await captureMode(process.argv[4] as CaptureMode)));
} else {
  const directory = resolve(process.argv[2] ?? join(process.env.T7_RUN_DIR ?? process.env.TMPDIR ?? '.', 'copy-actions-evidence'));
  mkdirSync(directory, {recursive: true});
  const captures: Capture[] = [];
  for (const mode of ['normal', 'safe-no-color'] as const) {
    const file = join(directory, `${mode}.json`);
    const env: NodeJS.ProcessEnv = {...process.env, TZ: 'UTC', TERM: 'xterm-256color', COLORTERM: 'truecolor'};
    delete env.NO_COLOR; delete env.NMSH_COLOR;
    if (mode === 'safe-no-color') env.NO_COLOR = '1';
    execFileSync(process.execPath, ['--import=tsx', fileURLToPath(import.meta.url), '--worker', file, mode], {env, stdio: 'pipe'});
    captures.push(...JSON.parse(readFileSync(file, 'utf8')));
  }
  const source = execFileSync('git', ['rev-parse', 'HEAD'], {encoding: 'utf8'}).trim();
  const dirty = Boolean(execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], {encoding: 'utf8'}).trim());
  const escape = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
  const links: string[] = [];
  for (const value of captures) {
    const name = `${value.mode}-${value.columns}x${value.rows}-${value.name}`;
    writeFileSync(join(directory, `${name}.ansi`), value.frame.rows.join('\r\n') + '\u001b[0m\n');
    writeFileSync(join(directory, `${name}.txt`), value.frame.rows.map(stripAnsi).join('\n') + '\n');
    const svg: string[] = [];
    value.frame.rows.forEach((row, index) => {
      const parser = new AnsiOutputParser(); parser.write(row);
      (parser.allLines()[0] ?? []).forEach((cell, column) => {
        if (!cell) return;
        let fg = currentForeground(cell.style), bg = currentBackground(cell.style);
        // Host inverse-video fallback is part of the actual emitted ANSI, not an invented selection marker.
        let inverse = false;
        for (const match of cell.style.matchAll(/\u001b\[([0-9;]*)m/gu)) {
          for (const code of match[1]!.split(';').map(Number)) { if (code === 0 || code === 27) inverse = false; else if (code === 7) inverse = true; }
        }
        if (inverse) [fg, bg] = [bg ?? {red: 23, green: 23, blue: 29}, fg ?? {red: 242, green: 240, blue: 236}];
        const rgb = (color: {red: number; green: number; blue: number}) => `rgb(${color.red},${color.green},${color.blue})`;
        if (bg) svg.push(`<rect x="${12 + column * 8}" y="${12 + index * 18}" width="${cell.width * 8}" height="18" fill="${rgb(bg)}"/>`);
        svg.push(`<text x="${12 + column * 8}" y="${26 + index * 18}" fill="${fg ? rgb(fg) : '#f2f0ec'}" xml:space="preserve">${escape(cell.text)}</text>`);
      });
    });
    const image = `<svg xmlns="http://www.w3.org/2000/svg" width="${value.columns * 8 + 24}" height="${value.rows * 18 + 24}"><style>text{font:13px Menlo,monospace}</style><rect width="100%" height="100%" fill="#17171d"/>${svg.join('')}</svg>`;
    writeFileSync(join(directory, `${name}.svg`), image);
    links.push(`<figure><figcaption>${escape(name)}</figcaption><img src="${name}.svg" alt="${escape(name)}"></figure>`);
  }
  writeFileSync(join(directory, 'frames.json'), JSON.stringify({source, dirty, captures}, null, 2));
  writeFileSync(join(directory, 'index.html'), `<!doctype html><meta charset="utf-8"><title>Slice 3 production frames</title><style>body{background:#222;color:#eee;font:14px system-ui}main{display:flex;gap:20px;flex-wrap:wrap}figure{margin:8px}img{max-width:100%}</style><h1>Slice 3 production frames</h1><p>Source ${source}${dirty ? ' (working changes)' : ''}. Deterministic renderer evidence; physical QA pending.</p><main>${links.join('')}</main>`);
  console.log(directory);
}
