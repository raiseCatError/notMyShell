import {arch, platform, totalmem} from 'node:os';
import {performance} from 'node:perf_hooks';
import {HyperlinkPresenter} from '../src/output/Hyperlinks.js';
import {AnsiOutputParser, type StyledLine} from '../src/output/AnsiOutputParser.js';
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
import {ConfiguredCompletionSource, parseConfiguredCompletions} from '../src/shell/ConfiguredCompletion.js';
import {NativeCompletionSource, ShellCompletionSource} from '../src/shell/CompletionService.js';
import {parseShellKnowledge} from '../src/shell/ShellKnowledge.js';
import {mkdirSync, mkdtempSync, writeFileSync, rmSync} from 'node:fs';
import {ContextEngine, type ContextDemand} from '../src/context/engine.js';
import {CORE_CAPABILITIES} from '../src/context/registry.js';
import type {CapabilityScopeInput} from '../src/context/capability.js';
import {parseShellEnvironment} from '../src/context/shellEnvironment.js';
import {resetServiceCaches} from '../src/context/services.js';
import {contextDemand} from '../src/context/demand.js';
import {allModuleDefinitions} from '../src/context/modules.js';
import {normalizePromptConfiguration} from '../src/prompt/configuration.js';
import {moduleShowcaseContext, renderedModules} from '../src/prompt/prompt.js';
import {resolvePromptContext} from '../src/shell/ShellContext.js';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {CommandEntry, SuggestionContext} from '../src/suggestions/types.js';

type Benchmark = {name: string; run: () => unknown; prepare?: () => unknown; samples?: number; warmup?: number; units?: number; unitName?: string;
  /** p95 ceiling (ms) enforced when NMSH_BENCH_ENFORCE=1 (the timing smoke): generous, it catches gross regressions such as a synchronous probe, not noise. */
  budgetP95Ms?: number};

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
const shellNamesFixture = Array.from({length: 4096}, (_, index) => `alias n${index}\n`).join('') + 'complete\n';
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

let hyperlinkLines: StyledLine[] = [];
const cachedLinks = new HyperlinkPresenter();

function setup(): void {
  if (selected.length === 0 || selected.some(name => name.includes('hyperlinks'))) {
    const parser = new AnsiOutputParser();
    for (let index = 0; index < 1000; index++) parser.write(`link ${index} https://example.com/path/${index} http://example.org/test?q=${index}\n`);
    hyperlinkLines = parser.allLines();
    for (const line of hyperlinkLines) cachedLinks.line(line);
  }
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
const configuredWire = Array.from({length: 4096}, (_, i) => [`value${i}`, `value${i}`, 'description', 'group', '', '', 'argument'].join('\0') + '\0').join('');
let completionHome: string | undefined;
let configuredSource: ConfiguredCompletionSource | undefined;
let configuredBigResults: number | undefined;
let configuredBigHits = 0;
let configuredBigMisses = 0;
// ---- Context Engine ------------------------------------------------------------------
// A realistic workspace: a repository with manifests and version pins, a cwd 24
// levels deep inside it, and kube/aws/docker configuration in a private home.
let contextRoot: string | undefined;
let contextScopes: CapabilityScopeInput[] = [];
let contextEngine: ContextEngine | undefined;
const allDemand = (): ContextDemand => new Map(CORE_CAPABILITIES.map(capability => [capability.id, new Set(capability.fields)]));

function contextFixture(): CapabilityScopeInput[] {
  if (contextScopes.length) return contextScopes;
  contextRoot = mkdtempSync(join(tmpdir(), 'nmsh-bench-context-'));
  const home = join(contextRoot, 'home');
  const repo = join(home, 'src', 'shop');
  const files: Record<string, string> = {
    '.git/HEAD': 'ref: refs/heads/main\n', '.git/config': '[core]\n\trepositoryformatversion = 0\n[branch "main"]\n\tremote = origin\n\tmerge = refs/heads/main\n',
    'package.json': JSON.stringify({name: 'shop', version: '2.4.0', packageManager: 'pnpm@9.12.0', engines: {node: '>=20'}}),
    '.nvmrc': 'v22.11.0\n', 'pyproject.toml': '[project]\nname = "shop-tools"\nversion = "0.3.1"\nrequires-python = ">=3.12"\n',
    'go.mod': 'module example.com/shop\n\ngo 1.23\n', 'Cargo.toml': '[package]\nname = "shop-core"\nversion = "0.9.0"\nedition = "2021"\n',
    'rust-toolchain.toml': '[toolchain]\nchannel = "1.82.0"\n', '.tool-versions': 'nodejs 22.11.0\npython 3.12.7\n', 'mise.toml': '[tools]\nnode = "22"\n',
    'Chart.yaml': 'apiVersion: v2\nname: shop\nversion: 1.2.3\n', 'Pulumi.yaml': 'name: shop-infra\nruntime: nodejs\n', '.terraform/environment': 'staging',
  };
  for (const [path, text] of Object.entries(files)) { mkdirSync(join(repo, path, '..'), {recursive: true}); writeFileSync(join(repo, path), text); }
  for (const [path, text] of Object.entries({'.kube/config': 'apiVersion: v1\ncurrent-context: prod\ncontexts:\n- name: prod\n  context:\n    cluster: prod\n    namespace: shop\n',
    '.aws/config': '[profile dev]\nregion = eu-west-1\n', '.docker/config.json': '{"currentContext":"colima"}'})) {
    mkdirSync(join(home, path, '..'), {recursive: true}); writeFileSync(join(home, path), text);
  }
  const env = parseShellEnvironment(`envsnapshot 1\nenv PATH=${process.env.PATH ?? '/usr/bin:/bin'}\nenv AWS_PROFILE=dev\n`)!;
  let cwd = repo;
  for (let level = 0; level < 24; level += 1) {
    cwd = join(cwd, `level${level}`);
    mkdirSync(cwd, {recursive: true});
    contextScopes.push({cwd, home, root: repo, session: 'bench', env, live: {jobs: 0, startedAt: Date.UTC(2026, 0, 1)}});
  }
  return contextScopes;
}

/** Stage, demand every core capability's fields, settle, commit: what a prompt in a new directory pays off the typing path. */
async function collectContext(engine: ContextEngine, scope: CapabilityScopeInput) {
  const generation = engine.stage(scope);
  engine.demand(allDemand());
  await engine.settle(10_000);
  engine.commit(generation);
  const facts = engine.facts();
  if (!facts['project.package'] || !facts['runtime.node']) throw new Error(`Context benchmark collected no project facts: ${Object.keys(facts).join(', ')} ${JSON.stringify(engine.status('project.package'))}`);
  return facts;
}

/** A large repository: ~3,000 tracked files in nested directories, a few edits and untracked files. Informational: setup takes seconds. */
let largeRepo: string | undefined;
function largeRepository(): string {
  if (largeRepo) return largeRepo;
  largeRepo = join(mkdtempSync(join(tmpdir(), 'nmsh-bench-git-')), 'repo');
  for (let directory = 0; directory < 60; directory += 1) {
    const path = join(largeRepo, `pkg${directory}`, 'src', 'lib');
    mkdirSync(path, {recursive: true});
    for (let file = 0; file < 50; file += 1) writeFileSync(join(path, `module${file}.ts`), `export const value${file} = ${directory * 50 + file};\n`);
  }
  const git = (...args: string[]) => {
    const result = spawnSync('git', ['-c', 'user.name=bench', '-c', 'user.email=bench@example.invalid', '-c', 'commit.gpgsign=false', ...args], {cwd: largeRepo, encoding: 'utf8'});
    if (result.status !== 0) throw new Error(`git ${args[0]} failed: ${result.stderr}`);
  };
  git('init', '-q', '-b', 'main'); git('add', '-A'); git('commit', '-q', '-m', 'bench');
  for (let file = 0; file < 20; file += 1) writeFileSync(join(largeRepo, `pkg${file}`, 'src', 'lib', 'module0.ts'), `export const edited = ${file};\n`);
  for (let file = 0; file < 10; file += 1) writeFileSync(join(largeRepo, `untracked${file}.txt`), 'new\n');
  return largeRepo;
}

const everyModule = () => normalizePromptConfiguration({modules: allModuleDefinitions().map(definition => ({id: definition.id, visible: true}))});
const noModule = () => normalizePromptConfiguration({modules: allModuleDefinitions().map(definition => ({id: definition.id, visible: false}))});
const showcase = moduleShowcaseContext('/home/bench');

function configuredFixture(): {home: string; source: ConfiguredCompletionSource} {
  if (!completionHome) {
    completionHome = mkdtempSync(join(tmpdir(), 'nmsh-completion-bench-'));
    writeFileSync(join(completionHome, '.zshrc'), `autoload -Uz compinit\ncompinit -D\n_bench() { compadd -- alpha alpine; }\ncompdef _bench bench\n_bench_cancel() { sleep 0.1; compadd -- value; }\ncompdef _bench_cancel benchcancel\n_bench_big() { compadd -- value{1..4096}; }\ncompdef _bench_big benchbig\n`);
    writeFileSync(join(completionHome, 'alpha.txt'), '');
    configuredSource = new ConfiguredCompletionSource({env: {...process.env, HOME: completionHome}});
  }
  return {home: completionHome, source: configuredSource!};
}

const directoryServices = new Map(suggestionCounts.map(count => [count, new DirectoryService()]));
const benchmarks: Benchmark[] = [
  {name: 'context/collect-cold', samples: 8, warmup: 1, budgetP95Ms: 2500, prepare: () => {
    resetServiceCaches(); contextEngine?.dispose();
    contextEngine = new ContextEngine({capabilities: CORE_CAPABILITIES});
  }, run: () => collectContext(contextEngine!, contextFixture()[23]!)},
  {name: 'context/collect-warm', budgetP95Ms: 60, prepare: async () => {
    if (contextEngine) return;
    contextEngine = new ContextEngine({capabilities: CORE_CAPABILITIES});
    await collectContext(contextEngine, contextFixture()[23]!);
  }, run: () => collectContext(contextEngine!, contextFixture()[23]!)},
  // Twenty directory changes before the first settles: superseded work is cancelled, only the last scope commits.
  {name: 'context/rapid-cwd-20', samples: 8, warmup: 1, budgetP95Ms: 4000, prepare: () => {
    resetServiceCaches(); contextEngine?.dispose();
    contextEngine = new ContextEngine({capabilities: CORE_CAPABILITIES});
  }, run: async () => {
    const scopes = contextFixture();
    for (const scope of scopes.slice(0, 19)) { contextEngine!.stage(scope); contextEngine!.demand(allDemand()); }
    return collectContext(contextEngine!, scopes[19]!);
  }},
  // Rendering is pure: every module on every surface from facts already in memory, as each keystroke's frame does.
  {name: 'context/render-every-module-100', budgetP95Ms: 1500, run: () => {
    const configuration = everyModule();
    let segments = 0;
    for (let frame = 0; frame < 100; frame += 1) {
      for (const surface of ['prompt', 'contextRail', 'statusStrip'] as const) segments += renderedModules(showcase, configuration, 0, surface).length;
    }
    if (segments === 0) throw new Error('Render benchmark produced no segments');
  }, units: 300, unitName: 'surface renders'},
  // Disabled modules cost nothing: no demand, so nothing is ever scheduled.
  {name: 'context/demand-every-module-hidden', budgetP95Ms: 25, run: () => {
    const demand = contextDemand(noModule(), {commandWords: ['kubectl', 'terraform', 'aws'], nativePrompt: true, railVisible: true, statusStripVisible: true, inRepository: true});
    if (demand.size !== 0) throw new Error('Hidden modules demanded facts');
  }},
  // Git context in a large repository, deep inside it: branch plus porcelain status (the prompt's Rich Git), off the typing path.
  {name: 'context/git-status-large-repo', samples: 10, warmup: 2, budgetP95Ms: 2000, prepare: () => { largeRepository(); }, run: async () => {
    const context = await resolvePromptContext(join(largeRepository(), 'pkg42', 'src', 'lib'), undefined, tmpdir(), {status: true});
    if (context.branch !== 'main' || !context.git) throw new Error('Large repository benchmark found no Git status');
  }, units: 3000, unitName: 'tracked files'},
  {name: 'shell/name-snapshot-4096', run: () => parseShellKnowledge(shellNamesFixture), units: 4096, unitName: 'names'},
  {name: 'hyperlinks/recognize-1000', run: () => {
    const presenter = new HyperlinkPresenter();
    for (const line of hyperlinkLines) presenter.line(line);
  }, units: 1000, unitName: 'lines'},
  {name: 'hyperlinks/cached-1000', run: () => {
    for (const line of hyperlinkLines) cachedLinks.line(line);
  }, units: 1000, unitName: 'lines'},
  ...suggestionCounts.map(count => ({name: `history/index-import-${count}`, run: () => indexImportedHistory(new HistoryIndex(), histories.get(count)!, 'zsh'), samples: 5, warmup: 1, units: count, unitName: 'entries'})),
  ...suggestionCounts.map(count => ({name: `navigation/rank-${count}`, run: () => rankDirectories(historyIndexes.get(count)!.all()), units: count, unitName: 'entries'})),
  ...suggestionCounts.map(count => ({name: `navigation/cached-query-${count}`, run: () => directoryServices.get(count)!.query(historyIndexes.get(count)!.all(), 'pr7', 'native')})),
  ...suggestionCounts.map(count => ({name: `history/structured-query-${count}`,
    run: () => historyIndexes.get(count)!.search('cwd:/work/project-7 exit:failure duration:>1s nonexistent'), units: count, unitName: 'entries'})),
  {name: 'completion/filter-500', run: () => filterCompletions(completionFixture, 'op4'), units: 500, unitName: 'candidates'},
  {name: 'completion/configured-parse-4096', run: () => parseConfiguredCompletions(configuredWire, {buffer: 'bench v', cwd: '/'}), units: 4096, unitName: 'candidates'},
  {name: 'completion/configured-cold', samples: 5, warmup: 0, run: async () => {
    const {home, source} = configuredFixture(); source.dispose();
    const values = await source.query({buffer: 'bench al', cwd: home}, new AbortController().signal);
    if (!values.length) throw new Error('Configured cold benchmark returned no candidates');
    return values;
  }},
  {name: 'completion/configured-warm', run: async () => {
    const {home, source} = configuredFixture();
    const values = await source.query({buffer: 'bench al', cwd: home}, new AbortController().signal);
    if (!values.length) throw new Error('Configured warm benchmark returned no candidates');
    return values;
  }},
  {name: 'completion/configured-files', run: async () => {
    const {home, source} = configuredFixture();
    const values = await source.query({buffer: 'cat al', cwd: home}, new AbortController().signal);
    if (!values.length) throw new Error('Configured file benchmark returned no candidates');
    return values;
  }},
  {name: 'completion/configured-cancel', run: async () => {
    const {home, source} = configuredFixture(); const controller = new AbortController();
    const result = source.query({buffer: 'bench al', cwd: home}, controller.signal); controller.abort(); return result;
  }},
  {name: 'completion/configured-cancel-inflight', samples: 5, warmup: 0, prepare: async () => {
    const {home} = configuredFixture();
    // Production cancellation intentionally backs off config reloads. Prepare
    // an independent warm generation rather than timing a cooldown cache miss.
    configuredSource?.dispose();
    configuredSource = new ConfiguredCompletionSource({env: {...process.env, HOME: home}});
    if (!(await configuredSource.query({buffer: 'bench al', cwd: home}, new AbortController().signal)).length) throw new Error('Cancellation preparation failed');
  }, run: async () => {
    const {home, source} = configuredFixture(); const controller = new AbortController();
    const result = source.query({buffer: 'benchcancel v', cwd: home}, controller.signal);
    await new Promise(resolve => setTimeout(resolve, 10));
    controller.abort(); return result;
  }},
  {name: 'completion/configured-large-query', samples: 5, warmup: 0, prepare: async () => {
    const {home} = configuredFixture();
    configuredSource?.dispose();
    configuredSource = new ConfiguredCompletionSource({env: {...process.env, HOME: home}});
    if (!(await configuredSource.query({buffer: 'bench al', cwd: home}, new AbortController().signal)).length) throw new Error('Large-query preparation failed');
  }, run: async () => {
    const {home, source} = configuredFixture();
    configuredBigResults = (await source.query({buffer: 'benchbig v', cwd: home}, new AbortController().signal)).length;
    if (configuredBigResults === 4096) configuredBigHits++; else configuredBigMisses++;
  }},
  {name: 'completion/native-fallback', samples: 5, run: async () => {
    const {home} = configuredFixture();
    const source = new ShellCompletionSource({id: 'unavailable', query: async () => []}, new NativeCompletionSource());
    const values = await source.query({buffer: 'cat al', cwd: home}, new AbortController().signal);
    if (!values.length) throw new Error('Native fallback benchmark returned no candidates');
    return values;
  }},
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
  for (let index = 0; index < warmup; index += 1) { await benchmark.prepare?.(); await benchmark.run(); }
  const times: number[] = [];
  for (let index = 0; index < samples; index += 1) {
    await benchmark.prepare?.();
    const start = performance.now();
    await benchmark.run();
    times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  const median = percentile(times, 0.5);
  const mean = times.reduce((sum, item) => sum + item, 0) / times.length;
  const rate = benchmark.units === undefined ? '' : `, ${((benchmark.units * 1000) / mean).toFixed(0)} ${benchmark.unitName}/s`;
  const p95 = percentile(times, 0.95);
  const over = benchmark.budgetP95Ms !== undefined && p95 > benchmark.budgetP95Ms;
  console.log(`${benchmark.name}: samples=${samples}, warmup=${warmup}, p50=${median.toFixed(2)}ms, p95=${p95.toFixed(2)}ms, min=${times[0]!.toFixed(2)}ms, max=${times.at(-1)!.toFixed(2)}ms, mean=${mean.toFixed(2)}ms${rate}${benchmark.budgetP95Ms === undefined ? '' : `, budget p95<=${benchmark.budgetP95Ms}ms${over ? ' EXCEEDED' : ''}`}`);
  if (over && process.env.NMSH_BENCH_ENFORCE === '1') process.exitCode = 1;
}

console.log(`NMSh benchmark harness | Node ${process.version} | ${platform()} ${arch()} | ${totalmem()} bytes RAM`);
console.log('Fixtures: seeded command histories, generated ANSI and Unicode lines; timings are informational.');
setup();
process.on('exit', () => {
  configuredSource?.dispose(); contextEngine?.dispose();
  if (completionHome) rmSync(completionHome, {recursive: true, force: true});
  if (contextRoot) rmSync(contextRoot, {recursive: true, force: true});
  if (largeRepo) rmSync(join(largeRepo, '..'), {recursive: true, force: true});
});
const runnable = benchmarks.filter(benchmark => selected.length === 0 || selected.some(name => benchmark.name.includes(name)));
if (runnable.length === 0) {
  console.error(`No benchmarks matched: ${selected.join(', ')}`);
  process.exitCode = 1;
} else {
  try { for (const benchmark of runnable) await report(benchmark); }
  finally { configuredSource?.dispose(); if (completionHome) rmSync(completionHome, {recursive: true, force: true}); }
  if (configuredBigResults !== undefined) console.log(`Configured large query: ${configuredBigHits} complete, ${configuredBigMisses} budget/failure fallbacks; last result=${configuredBigResults}/4096.`);
}
if (memory) {
  if (globalThis.gc) globalThis.gc();
  console.log(`memory: rss=${(process.memoryUsage().rss / 1024 / 1024).toFixed(1)}MiB, heapUsed=${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(1)}MiB`);
}
