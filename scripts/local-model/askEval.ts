// Maintainer-only: evaluate /ask against a real local model and measure it. Not part of the test suite.
//
//   node --import=tsx scripts/local-model/askEval.ts --model <file.gguf> --out <dir> [--only id,id] [--skip-measure] [--ctx-compare]
//
// It drives the real TerminalApp (no shell is started) with a private model service on a socket in <dir>: never the
// user's shared service, never a download. For every case it records what the previous /ask did (Ask's resolver plus
// the intent model, exactly as before this change), where the request goes now, and the model's answer verbatim
// with timings. Loose correctness checks are signals for a reader, not a grade. Results: <dir>/ask-eval.json and
// <dir>/ask-eval.md.
import {execFileSync, spawnSync} from 'node:child_process';
import {mkdirSync, writeFileSync} from 'node:fs';
import {createServer} from 'node:net';
import {join, resolve} from 'node:path';
import {createAskState, submitText, type AskState} from '../../src/ask/AskPanel.js';
import {LocalUnderstanding} from '../../src/understanding/LocalUnderstanding.js';
import {ModelClient} from '../../src/understanding/ModelClient.js';
import {ModelService, modelSocketPath, serveModelService} from '../../src/understanding/ModelService.js';
import {CONTEXT_TOKENS, LlamaServerRuntime} from '../../src/understanding/runtimes.js';
import {ANSWER_LIMITS, type AnswerRequest, type AnswerStats} from '../../src/understanding/tasks.js';
import type {LocalModelChoice} from '../../src/prompt/configuration.js';
import {executionFrameFixture} from '../../tests/support/executionTimelineFrames.js';
import {ADMITS_LIMIT, EVAL_SET, type EvalCase} from './askEvalSet.js';

const args = process.argv.slice(2);
/** The TerminalApp test fixture freezes Date.now and performance.now; measurements use the monotonic clock. */
const clock = () => Number(process.hrtime.bigint()) / 1e6;
const flag = (name: string) => { const index = args.indexOf(`--${name}`); return index === -1 ? undefined : args[index + 1]; };
const modelPath = resolve(flag('model') ?? '');
const out = resolve(flag('out') ?? '.');
const only = flag('only')?.split(',');
const executable = execFileSync('which', ['llama-server'], {encoding: 'utf8'}).trim();
mkdirSync(out, {recursive: true});

const MODEL: LocalModelChoice = {label: modelPath.split('/').pop()!.replace(/\.gguf$/u, ''), runtime: 'llama.cpp', path: modelPath, owned: false};
let runtime: LlamaServerRuntime | undefined;
const service = new ModelService({runtimeFor: model => (runtime = new LlamaServerRuntime(executable, model.path!, model.label)), idleMs: 10 * 60_000, graceMs: 10 * 60_000});
const socket = modelSocketPath(join(out, 'run'));
mkdirSync(join(out, 'run'), {recursive: true, mode: 0o700});
const server = (await serveModelService(socket, service))!;

/** Resident memory of the llama-server process, sampled every 100 ms. */
const pidOf = () => (runtime as unknown as {child?: {pid?: number; exitCode: number | null}} | undefined)?.child;
const rssMb = (pid: number) => { try { return Number(execFileSync('ps', ['-o', 'rss=', '-p', String(pid)], {encoding: 'utf8'}).trim()) / 1024; } catch { return 0; } };
let peakMb = 0;
const sampler = setInterval(() => { const child = pidOf(); if (child?.pid && child.exitCode === null) peakMb = Math.max(peakMb, rssMb(child.pid)); }, 100);

const frame = executionFrameFixture(100, 40);
const app = frame.app;
const settings = {mode: 'auto' as const, ask: true, folding: false, model: MODEL};
app['configuration'] = {...app['configuration'], localUnderstanding: settings};
const understanding = new LocalUnderstanding(() => settings, () => new ModelClient(socket, () => { throw new Error('the private service must already run'); }));
(app as unknown as {understanding: LocalUnderstanding}).understanding = understanding;

function writeResults(): void {
  writeFileSync(join(out, 'ask-eval.json'), `${JSON.stringify({measures, rows}, null, 2)}\n`);
  const cell = (text: string | undefined) => (text ?? '').replace(/\|/gu, '\\|').replace(/\n+/gu, ' ⏎ ');
  const lines = ['# /ask evaluation', '', '```json', JSON.stringify(measures, null, 2), '```', '',
    '| id | expected | now | before | check | first text / total | answer |', '|---|---|---|---|---|---|---|'];
  const line = (row: Row) => `| ${row.id} | ${row.expected} | ${row.route} | ${cell(row.before)} | ${row.ok === undefined ? '' : row.ok ? 'ok' : 'MISS'}${row.admits === undefined ? '' : row.admits ? ' admits' : ' no-admit'} | ${row.firstTextMs ? `${Math.round(row.firstTextMs)} / ${Math.round(row.totalMs ?? 0)} ms` : ''} | ${cell(row.answer)} |`;
  for (const row of rows) { lines.push(line(row)); if (row.thinking) lines.push(line(row.thinking)); for (const followUp of row.followUps ?? []) lines.push(line(followUp)); }
  writeFileSync(join(out, 'ask-eval.md'), `${lines.join('\n')}\n`);
}

interface Timing {totalMs: number; firstTextMs?: number; stats?: AnswerStats; request: AnswerRequest; outcome: string}
const timings: Timing[] = [];
const answer = understanding.answer.bind(understanding);
understanding.answer = async (request, options = {}) => {
  const started = clock();
  let first: number | undefined;
  const result = await answer(request, {...options, onPartial: text => { first ??= clock() - started; options.onPartial?.(text); }});
  timings.push({totalMs: clock() - started, ...(first !== undefined ? {firstTextMs: first} : {}), ...('stats' in result && result.stats ? {stats: result.stats} : {}), request,
    outcome: 'cancelled' in result ? 'cancelled' : 'unavailable' in result ? `unavailable: ${result.unavailable}` : 'answered'});
  return result;
};

const say = async (state: AskState, text: string) => { const event = submitText(state, text); if (event) await app['handleAskEvent'](event); };
const describe = (outcome: {kind: string; capability?: string; text?: string; question?: string}) =>
  `${outcome.kind}${outcome.capability ? `:${outcome.capability}` : ''} · ${(outcome.text ?? outcome.question ?? '').split('\n')[0]!.slice(0, 100)}`;
const routeOf = (state: AskState, before: number) => {
  const turn = state.turns.at(-1);
  if (timings.length > before && turn?.model) return turn.model.context ? 'context' : 'model';
  const pending = state.pending;
  if (!pending) return 'nmsh';
  if (pending.kind === 'unsafe' || /not sent to the local model|never reads/u.test(turn?.text ?? '')) return 'refuse';
  if (pending.kind === 'unsupported' && pending.shellTask) return 'suggest';
  if (pending.kind === 'unclear' || (pending.kind === 'choose' && pending.reason === 'ambiguous')) return 'clarify';
  return 'nmsh';
};

interface Row {id: string; category: string; prompt: string; expected: string; before: string; route: string; answer?: string; reasoning?: string; ok?: boolean; admits?: boolean;
  firstTextMs?: number; totalMs?: number; tokensPerSecond?: number; outputTokens?: number; promptTokens?: number; truncated?: boolean; thinking?: Row; followUps?: Row[]}
const rows: Row[] = [];
const judge = (item: {expect?: RegExp; admits?: boolean}, text: string) => ({...(item.expect ? {ok: item.expect.test(text)} : {}), ...(item.admits ? {admits: ADMITS_LIMIT.test(text)} : {})});
const fromTurn = (state: AskState, timing: Timing | undefined) => {
  const turn = state.turns.at(-1)!;
  return {answer: turn.text, reasoning: turn.model?.reasoning, truncated: turn.model?.truncated, totalMs: timing?.totalMs, firstTextMs: timing?.firstTextMs,
    tokensPerSecond: timing?.stats?.tokensPerSecond, outputTokens: timing?.stats?.outputTokens, promptTokens: timing?.stats?.promptTokens};
};

const measures: Record<string, unknown> = {model: MODEL.label, runtime: `llama-server (${(() => { const run = spawnSync(executable, ['--version'], {encoding: 'utf8'}); return `${run.stdout}${run.stderr}`; })().split('\n').find(line => /version/u.test(line))?.trim()})`,
  contextTokens: CONTEXT_TOKENS, machine: `${execFileSync('sysctl', ['-n', 'machdep.cpu.brand_string'], {encoding: 'utf8'}).trim()}, ${Math.round(Number(execFileSync('sysctl', ['-n', 'hw.memsize'], {encoding: 'utf8'})) / 2 ** 30)} GB`};

try {
  // Cold start: the first answer loads the model.
  if (!args.includes('--skip-measure')) {
    const state = createAskState(); app['askState'] = state;
    const before = timings.length;
    const started = clock();
    await say(state, 'What is the capital of France?');
    measures.cold = {totalMs: clock() - started, firstTextMs: timings[before]?.firstTextMs, answer: state.turns.at(-1)?.text, loads: service.loads};
    const child = pidOf();
    await new Promise(done => setTimeout(done, 1500));
    measures.steadyMb = child?.pid ? rssMb(child.pid) : undefined;
  }

  for (const item of EVAL_SET.filter(entry => !only || only.includes(entry.id))) {
    // Before: Ask's resolver and, in Auto, the intent model (exactly the path /ask had; no conversation).
    const old = createAskState(); app['askState'] = old;
    const previous = await app['resolveAsk'](item.prompt, old);
    const state = createAskState(); app['askState'] = state;
    const before = timings.length;
    await say(state, item.prompt);
    const route = routeOf(state, before);
    const row: Row = {id: item.id, category: item.category, prompt: item.prompt, expected: item.route, before: describe(previous), route};
    if (route === 'model' || route === 'context') Object.assign(row, fromTurn(state, timings.at(-1)), judge(item, state.turns.at(-1)!.text));
    else row.answer = state.turns.at(-1)!.text.split('\n').slice(0, 3).join(' / ');
    if (item.thinking && route === 'model') {
      const plan = await app['planAsk'](item.prompt, state, {reasoning: 'thinking', again: true});
      if ('converse' in plan) await app['converse'](state, plan.converse);
      row.thinking = {id: `${item.id}+thinking`, category: item.category, prompt: item.prompt, expected: 'model', before: '', route: 'model', ...fromTurn(state, timings.at(-1)), ...judge(item, state.turns.at(-1)!.text)};
    }
    for (const followUp of item.followUps ?? []) {
      const start = timings.length;
      await say(state, followUp.prompt);
      (row.followUps ??= []).push({id: `${item.id}>`, category: item.category, prompt: followUp.prompt, expected: 'model', before: '', route: routeOf(state, start),
        ...fromTurn(state, timings.at(-1)), ...judge(followUp, state.turns.at(-1)!.text)});
    }
    rows.push(row);
    console.log(`${row.route === row.expected ? '✓' : '✗'} ${item.id.padEnd(18)} ${row.route.padEnd(8)} ${row.ok === undefined ? '' : row.ok ? 'ok ' : 'MISS'}${row.admits === undefined ? '' : row.admits ? ' admits' : ' NO-ADMIT'} ${row.firstTextMs ? `${Math.round(row.firstTextMs)}ms/${Math.round(row.totalMs ?? 0)}ms` : ''}`);
  }

  if (!args.includes('--skip-measure')) {
    // History: the same question with no history and with the largest history the bound allows.
    const question = 'What is a closure in JavaScript?';
    const long = (index: number) => `${index % 2 ? 'Answer' : 'Question'} ${index}: ${'filler words about shells and git '.repeat(40)}`.slice(0, ANSWER_LIMITS.turnChars);
    const history = Array.from({length: ANSWER_LIMITS.historyTurns}, (_, index) => ({role: index % 2 ? 'assistant' as const : 'user' as const, text: long(index)}));
    const sample = async (withHistory: boolean) => {
      const results = [];
      for (let run = 0; run < 3; run += 1) {
        const started = clock();
        let first = 0;
        const result = await answer({question, history: withHistory ? history : [], shell: 'zsh', os: 'macOS'}, {onPartial: () => { first ||= clock() - started; }});
        results.push({firstTextMs: first, totalMs: clock() - started, ...('stats' in result ? result.stats : {})});
      }
      return results;
    };
    measures.history = {none: await sample(false), max: await sample(true)};
    // The largest request the bounds allow still fits the context window with room for the answer.
    const worst = await answer({question: 'Summarize. '.repeat(200).slice(0, ANSWER_LIMITS.question), history, shell: 'zsh', os: 'macOS',
      context: {label: 'output of make · exit 2', excerpt: 'src/main.c:12:5: error: expected ‘;’ before ‘}’ token\n'.repeat(60).slice(0, ANSWER_LIMITS.context), observed: 'exit code 2'}});
    measures.worstCase = 'stats' in worst ? {...worst.stats, room: CONTEXT_TOKENS - (worst.stats?.promptTokens ?? 0)} : worst;
    // Cancellation: stop a long answer one second after its first text; how fast it stops, and the next answer.
    const controller = new AbortController();
    const started = clock();
    let firstAt = 0;
    let abortedAt = 0;
    const cancelled = answer({question: 'Write a detailed 400-word essay about the history of Unix.', history: [], shell: 'zsh', os: 'macOS'}, {signal: controller.signal,
      onPartial: () => { if (!firstAt) { firstAt = clock(); setTimeout(() => { abortedAt = clock(); controller.abort(); }, 1000); } }});
    const result = await cancelled;
    const resolvedAt = clock();
    const nextStarted = clock();
    let nextFirst = 0;
    await answer({question: 'Say hello.', history: [], shell: 'zsh', os: 'macOS'}, {onPartial: () => { nextFirst ||= clock() - nextStarted; }});
    measures.cancel = {result: 'cancelled' in result ? 'cancelled' : 'not cancelled', firstTextMs: firstAt - started, cancelToResolvedMs: resolvedAt - abortedAt, nextFirstTextMs: nextFirst, serviceState: service.state};
    // Unload and reload.
    const child = pidOf();
    const unloadStarted = clock();
    await service.unload();
    for (let waited = 0; child?.exitCode === null && waited < 5000; waited += 20) await new Promise(done => setTimeout(done, 20));
    const reloadStarted = clock();
    let reloadFirst = 0;
    await answer({question: 'Say hello.', history: [], shell: 'zsh', os: 'macOS'}, {onPartial: () => { reloadFirst ||= clock() - reloadStarted; }});
    measures.unload = {unloadMs: reloadStarted - unloadStarted, processExited: child?.exitCode !== null, rssAfterUnloadMb: child?.pid ? rssMb(child.pid) : 0, reloadFirstTextMs: reloadFirst, loads: service.loads};
    measures.peakMb = peakMb;
  }
  writeResults();
  if (args.includes('--ctx-compare')) try {
    // Memory of the same model with a 2048 and a 4096 token context, after one short answer each.
    const compare: Record<string, number> = {};
    for (const context of [2048, 4096]) {
      const port = await new Promise<number>(done => { const probe = createServer().listen(0, '127.0.0.1', () => { const address = probe.address(); probe.close(() => done(typeof address === 'object' && address ? address.port : 0)); }); });
      const child = (await import('node:child_process')).spawn(executable, ['-m', modelPath, '--host', '127.0.0.1', '--port', String(port), '-c', String(context), '-np', '1'], {stdio: 'ignore'});
      for (let waited = 0; waited < 60_000; waited += 250) { try { if ((await fetch(`http://127.0.0.1:${port}/health`)).ok) break; } catch { /* starting */ } await new Promise(done => setTimeout(done, 250)); }
      await fetch(`http://127.0.0.1:${port}/completion`, {method: 'POST', body: JSON.stringify({prompt: 'Hello', n_predict: 16})});
      compare[`ctx${context}Mb`] = rssMb(child.pid!);
      child.kill('SIGTERM');
    }
    measures.contextMemory = compare;
  } catch (error) { measures.contextMemory = {error: String(error)}; }
} finally {
  clearInterval(sampler);
  await service.unload();
  server.close();
  frame.dispose();
}

writeResults();
console.log(JSON.stringify(measures, null, 2));
process.exit(0);
