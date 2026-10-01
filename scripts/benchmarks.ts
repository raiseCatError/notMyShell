import {arch, platform, totalmem} from 'node:os';
import {performance} from 'node:perf_hooks';
import {AnsiOutputParser} from '../src/output/AnsiOutputParser.js';
import {OutputBuffer} from '../src/output/OutputBuffer.js';
import {CommandEditor} from '../src/input/CommandEditor.js';
import {layoutInput} from '../src/input/inputLayout.js';
import {Highlighter} from '../src/input/Highlighter.js';
import {rankDirectories, DirectoryService} from '../src/shell/DirectoryService.js';
import {HistoryIndex} from '../src/shell/HistoryIndex.js';
import {filterCompletions, parseNativeCompletions} from '../src/shell/completion.js';
import {planScreen} from '../src/app/screenPlan.js';
import {encodeMessage, FrameDecoder} from '../src/session/SessionProtocol.js';
import {parseZshHistory, indexImportedHistory} from '../src/shell/HistoryService.js';
import {NativeSuggestions} from '../src/suggestions/NativeSuggestions.js';
import type {CommandEntry, SuggestionContext} from '../src/suggestions/types.js';

type Benchmark = {name: string; run: () => unknown; samples?: number; warmup?: number; units?: number; unitName?: string};

const args = new Set(process.argv.slice(2));
const memory = args.has('--memory');
const selected = [...args].filter(arg => !arg.startsWith('--'));
const sampleDefault = positiveInt(process.env.NMSH_BENCH_SAMPLES, 20);
const warmupDefault = positiveInt(process.env.NMSH_BENCH_WARMUP, 3);
const commandNames = ['git status --short', 'npm run typecheck', 'rg -n "TODO" src tests', 'zsh -lc "print -r -- ready"'];
const unicodeLine = 'λ café 👩🏽‍💻 界面 e\u0301  →  ';
const ansiPayload = Array.from({length: 400}, (_, index) =>
  `\u001B[38;5;${index % 256}m${unicodeLine}${index.toString().padStart(4, '0')}\u001B[0m\n`).join('');
const editorText = Array.from({length: 24}, (_, index) => `${commandNames[index % commandNames.length]} # ${unicodeLine}`).join(' ');
const highlighter = new Highlighter();
const semanticCache = new Map<string, 'executable' | 'builtin'>();
for (const name of ['git', 'npm', 'rg', 'zsh', 'print']) semanticCache.set(name, 'executable');
const editorCharacters = Array.from(editorText);
const suggestionCounts = [10_000, 100_000];
const historyIndexes = new Map<number, HistoryIndex>();
const histories = new Map<number, CommandEntry[]>();
const historyFiles = new Map<number, string>();
const protocolFrames = Array.from({length: 400}, (_, seq) => encodeMessage({type: 'output', data: ansiPayload.slice(0, 256), seq, at: 1000 + seq})).join('');
const transcripts = new Map<number, OutputBuffer>();
const suggestions = new Map<number, {provider: NativeSuggestions; queries: SuggestionContext[]}>();

function generatedHistory(count: number): CommandEntry[] {
  const base = Date.UTC(2025, 0, 1);
  return Array.from({length: count}, (_, index) => ({
    command: `${commandNames[index % commandNames.length]} --workspace project-${index % 80} --item ${index}`,
    cwd: `/work/project-${index % 80}`,
    exitCode: index % 17 === 0 ? 1 : 0,
    at: base + index * 60_000,
    previous: index > 0 ? commandNames[(index - 1) % commandNames.length] : undefined,
  }));
}

function transcript(count: number): OutputBuffer {
  const output = new OutputBuffer();
  for (let index = 0; index < count; index += 1) {
    output.addHistoryLine(`${index.toString().padStart(6, '0')} ${unicodeLine} ${'界'.repeat(index % 3)} ${index % 2 ? '\u001B[36mcyan\u001B[0m' : 'plain'}`);
  }
  return output;
}

function setup(): void {
  const requested = selected.length === 0 ? ['suggestions', 'transcript'] : selected;
  if (selected.length === 0 || selected.some(name => name.includes('history') || name.includes('navigation'))) {
    for (const count of suggestionCounts) {
      const entries = generatedHistory(count);
      histories.set(count, entries);
      const index = new HistoryIndex();
      entries.forEach((entry, id) => index.add({...entry, id: String(id), source: 'nmsh', project: `project-${id % 80}`, session: `session-${id % 8}`, durationMs: id % 3000}));
      index.all();
      historyIndexes.set(count, index);
      historyFiles.set(count, entries.map(entry => `: ${entry.at! / 1000}:1;${entry.command}`).join('\n'));
    }
  }
  if (requested.some(name => name.includes('suggestions'))) {
    for (const count of suggestionCounts) {
      const provider = new NativeSuggestions();
      provider.load(generatedHistory(count), Date.UTC(2026, 0, 1));
      const queries = Array.from({length: 16}, (_, index) => ({
        buffer: ['git ', 'npm r', 'zsh -', 'rg -n', 'git status --s'][index % 5]!,
        cwd: `/work/project-${index % 80}`,
        previous: [commandNames[index % commandNames.length]!],
        now: Date.UTC(2026, 0, 1),
      }));
      suggestions.set(count, {provider, queries});
    }
  }
  if (requested.some(name => name.includes('transcript'))) {
    transcripts.set(10_000, transcript(10_000));
    transcripts.set(100_000, transcript(100_000));
  }
}

const completionFixture = parseNativeCompletions(Array.from({length: 500}, (_, index) => `--option-${index} -- description ${index}`).join('\n'), {buffer: 'tool ', cwd: '/work'});

const directoryServices = new Map(suggestionCounts.map(count => [count, new DirectoryService()]));
const benchmarks: Benchmark[] = [
  ...suggestionCounts.map(count => ({name: `history/index-import-${count}`, run: () => indexImportedHistory(new HistoryIndex(), histories.get(count)!, 'zsh'), samples: 5, warmup: 1, units: count, unitName: 'entries'})),
  ...suggestionCounts.map(count => ({name: `navigation/rank-${count}`, run: () => rankDirectories(historyIndexes.get(count)!.all()), units: count, unitName: 'entries'})),
  ...suggestionCounts.map(count => ({name: `navigation/cached-query-${count}`, run: () => directoryServices.get(count)!.query(historyIndexes.get(count)!.all(), 'pr7', 'native')})),
  ...suggestionCounts.map(count => ({name: `history/structured-query-${count}`,
    run: () => historyIndexes.get(count)!.search('cwd:/work/project-7 exit:failure duration:>1s nonexistent'), units: count, unitName: 'entries'})),
  {name: 'completion/filter-500', run: () => filterCompletions(completionFixture, 'op4'), units: 500, unitName: 'candidates'},
  ...suggestionCounts.map(count => ({
    name: `history/current-text-scan-${count}`,
    run: () => histories.get(count)!.map(entry => entry.command).filter(command => command.toLowerCase().includes('nonexistent')).slice(0, 100),
    units: count, unitName: 'entries',
  })),
  ...suggestionCounts.map(count => ({
    name: `history/zsh-import-${count}`,
    run: () => parseZshHistory(historyFiles.get(count)!),
    units: count, unitName: 'entries',
  })),
  {
    name: 'session/frame-decode-400',
    run: () => {
      const decoder = new FrameDecoder();
      for (let index = 0; index < protocolFrames.length; index += 4096) decoder.push(protocolFrames.slice(index, index + 4096));
    },
    units: 400, unitName: 'frames',
  },
  ...(['bottom', 'top', 'flow'] as const).map(composerPosition => ({
    name: `composer/screen-plan-${composerPosition}`,
    run: () => planScreen({rows: 24, inputRows: 8, suggestions: 500, running: false, detached: false,
      hasOutput: true, contextPlacement: 'composer', hasVisibleContext: true, composerLayout: 'twoLine',
      composerPosition, transcriptRows: 100_000}),
  })),
  {
    name: 'editor/edit-layout-highlight',
    run: () => {
      const editor = new CommandEditor();
      editor.insert(editorText);
      const text = editor.displayText;
      layoutInput(text, editor.displayCursorIndex, 100, 8);
      highlighter.tokenize(editorCharacters, semanticCache);
    },
    units: editorText.length,
    unitName: 'input chars',
  },
  {
    name: 'ansi/parse-ansi-unicode',
    run: () => new AnsiOutputParser().write(ansiPayload),
    units: Buffer.byteLength(ansiPayload),
    unitName: 'bytes',
  },
  {
    name: 'suggestions/query-10k-repeated',
    run: createSuggestionQuery(10_000),
    samples: 320,
    units: 1,
    unitName: 'queries',
  },
  {
    name: 'suggestions/query-100k-repeated',
    run: createSuggestionQuery(100_000),
    samples: 160,
    units: 1,
    unitName: 'queries',
  },
  ...[10_000, 100_000].map(count => ({
    name: `transcript/wrap-present-${count}`,
    run: () => transcripts.get(count)!.wrapped(100),
    samples: count === 100_000 ? 5 : 10,
    units: count,
    unitName: 'source lines',
  })),
  ...[10_000, 100_000].map(count => ({
    name: `transcript/snapshot-json-${count}`,
    run: () => JSON.stringify(transcripts.get(count)!.transcript()),
    samples: count === 100_000 ? 5 : 10,
    units: count,
    unitName: 'source lines',
  })),
];

function createSuggestionQuery(count: number): () => void {
  let index = 0;
  return () => {
    const fixture = suggestions.get(count)!;
    fixture.provider.query(fixture.queries[index % fixture.queries.length]!);
    index += 1;
  };
}

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function percentile(sorted: number[], value: number): number {
  return sorted[Math.max(0, Math.ceil(value * sorted.length) - 1)]!;
}

async function report(benchmark: Benchmark): Promise<void> {
  const samples = benchmark.samples ?? sampleDefault;
  const warmup = benchmark.warmup ?? warmupDefault;
  for (let index = 0; index < warmup; index += 1) await benchmark.run();
  const times: number[] = [];
  for (let index = 0; index < samples; index += 1) {
    const start = performance.now();
    await benchmark.run();
    times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  const median = percentile(times, 0.5);
  const mean = times.reduce((sum, item) => sum + item, 0) / times.length;
  const rate = benchmark.units === undefined ? '' : `, ${((benchmark.units * 1000) / mean).toFixed(0)} ${benchmark.unitName}/s`;
  console.log(`${benchmark.name}: samples=${samples}, warmup=${warmup}, p50=${median.toFixed(2)}ms, p95=${percentile(times, 0.95).toFixed(2)}ms, min=${times[0]!.toFixed(2)}ms, max=${times.at(-1)!.toFixed(2)}ms, mean=${mean.toFixed(2)}ms${rate}`);
}

console.log(`NMSh benchmark harness | Node ${process.version} | ${platform()} ${arch()} | ${totalmem()} bytes RAM`);
console.log('Fixtures: seeded command histories, generated ANSI and Unicode lines; timings are informational.');
setup();
const runnable = benchmarks.filter(benchmark => selected.length === 0 || selected.some(name => benchmark.name.includes(name)));
if (runnable.length === 0) {
  console.error(`No benchmarks matched: ${selected.join(', ')}`);
  process.exitCode = 1;
} else {
  for (const benchmark of runnable) await report(benchmark);
}
if (memory) {
  if (globalThis.gc) globalThis.gc();
  console.log(`memory: rss=${(process.memoryUsage().rss / 1024 / 1024).toFixed(1)}MiB, heapUsed=${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(1)}MiB`);
}
