import {performance} from 'node:perf_hooks';
import {readFileSync, writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {isAbsolute} from 'node:path';
import {spawnSync} from 'node:child_process';
import os from 'node:os';
import {CommandEditor} from '../../src/input/CommandEditor.js';
import {layoutInput, graphemes} from '../../src/input/inputLayout.js';
import {Highlighter} from '../../src/input/Highlighter.js';

const destination = process.argv[2];
if (!destination || !isAbsolute(destination)) throw new Error('Pass an absolute output JSON path on T7');
const highlighter = new Highlighter();
const semanticCache = new Map([['printf', 'builtin']]);
const cases = [];
let checksum = 0;
const short = 'git status --short';
const long = Array.from({length: 18}, (_, i) => `printf "café 界 👩🏽‍💻 é ${i}" | rg --color=never output`).join(' ');
const prefixes = [undefined, '', '\x1b[36mproject/main ❯ \x1b[0m'];
for (const [name, text] of [['short', short], ['long-unicode', long]]) {
  const length = graphemes(text).length;
  for (const prefix of prefixes) {
    cases.push({name: `layout/${name}/${prefix === '' ? 'none' : prefix ? 'context' : 'default'}`, run() {
      for (let i = 0; i < 25; i++) {
        const result = layoutInput(text, i % length, [30, 80, 120][i % 3], 8, prefix);
        checksum += result.caretColumn + result.allRows.length;
      }
    }});
  }
  cases.push({name: `editing/${name}`, run() {
    const editor = new CommandEditor();
    editor.insert(text);
    for (const key of 'abcdefghijklmno') {
      editor.insert(key);
      const result = layoutInput(editor.displayText, editor.displayCursorIndex, 80, 8);
      highlighter.tokenize(graphemes(editor.text), semanticCache);
      checksum += result.caretColumn;
    }
    for (let i = 0; i < 15; i++) {
      editor.backspace();
      const result = layoutInput(editor.displayText, editor.displayCursorIndex, 80, 8);
      highlighter.tokenize(graphemes(editor.text), semanticCache);
      checksum += result.caretColumn;
    }
    if (editor.text !== text) throw new Error('Editing changed source');
  }});
}
cases.push({name: 'vertical/long-unicode', warmup: 1, samples: 6, run() {
  const editor = new CommandEditor();
  editor.insert(long);
  editor.moveUp(80);
  checksum += editor.cursorIndex;
  if (editor.text !== long) throw new Error('Vertical movement changed source');
}});
const results = [];
for (const item of cases) {
  for (let i = 0; i < (item.warmup ?? 8); i++) item.run();
  global.gc?.();
  const samples = [];
  const cpu = process.cpuUsage();
  const memoryBefore = process.memoryUsage();
  for (let i = 0; i < (item.samples ?? 40); i++) {
    const started = performance.now();
    item.run();
    samples.push(performance.now() - started);
  }
  const usedCpu = process.cpuUsage(cpu);
  const memoryAfter = process.memoryUsage();
  global.gc?.();
  results.push({name: item.name, samples, cpu: usedCpu, memoryBefore, memoryAfter, retained: process.memoryUsage()});
}
writeFileSync(destination, JSON.stringify({environment: {node: process.version, os: os.release(), cpu: os.cpus()[0].model, memory: os.totalmem(), sourceHashes: Object.fromEntries(['src/input/inputLayout.ts', 'src/input/CommandEditor.ts'].map(file => [file, createHash('sha256').update(readFileSync(file)).digest('hex')])), commit: spawnSync('git', ['rev-parse', 'HEAD'], {encoding: 'utf8'}).stdout.trim(), notes: 'Component benchmark, source tsx loader; 25 layouts or 30 edit/layout/highlight steps per sample; warmup 8, repetitions 40 (vertical: 1 and 6); not physical latency'}, results, checksum, peakRss: process.resourceUsage().maxRSS * 1024}, null, 2));
console.log(destination);
