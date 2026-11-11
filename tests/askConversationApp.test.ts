import test from 'node:test';
import assert from 'node:assert/strict';
import {askKey, createAskState, renderAsk, submitText, visibleOptions, type AskState} from '../src/ask/AskPanel.js';
import type {AnswerRequest} from '../src/understanding/tasks.js';
import {stripAnsi} from '../src/util/text.js';
import {EVAL_SET, KNOWN_ROUTE_GAPS, type EvalRoute} from '../scripts/local-model/askEvalSet.js';
import {executionFrameFixture} from './support/executionTimelineFrames.js';

/**
 * Ask as a general conversation, through the real TerminalApp with a stub model: where each request goes (the whole
 * evaluation set), streaming, Esc and close cancelling, follow-up history, terminal context only when asked for,
 * the fail-closed cases, transcript recording, and model text never becoming an action. No shell is started and no
 * model runs; real-model results come from scripts/local-model/askEval.ts and are reported separately.
 */

type AnswerOptions = {reasoning?: 'fast' | 'thinking'; signal?: AbortSignal; onPartial?: (text: string) => void};
type Reply = (request: AnswerRequest, options: AnswerOptions) => Promise<Awaited<ReturnType<import('../src/understanding/LocalUnderstanding.js').LocalUnderstanding['answer']>>>;

function fixture() {
  const frame = executionFrameFixture(100, 40);
  const app = frame.app;
  const calls: Array<{request: AnswerRequest; options: AnswerOptions}> = [];
  const intents: string[] = [];
  let reply: Reply = async (_request, options) => {
    options.onPartial?.('Canberra');
    return {answer: {text: 'Canberra is the capital of Australia.', truncated: false}, model: 'Qwen3 0.6B', reasoning: options.reasoning ?? 'fast'};
  };
  app['understanding'].answer = (async (request: AnswerRequest, options: AnswerOptions = {}) => { calls.push({request, options}); return reply(request, options); }) as never;
  app['understanding'].interpretAsk = (async (request: {text: string}) => { intents.push(request.text); return undefined; }) as never;
  app['understanding'].suggestCommand = (async () => ({unavailable: 'stub'})) as never;
  app['configuration'] = {...app['configuration'], localUnderstanding: {mode: 'auto', ask: true, folding: false,
    model: {label: 'Qwen3 0.6B', runtime: 'llama.cpp', path: '/m.gguf', owned: true}}};
  const open = () => { const state = createAskState(); app['askState'] = state; return state; };
  /** Type a request into Ask and let it finish. */
  const say = async (state: AskState, text: string) => { const event = submitText(state, text); if (event) await app['handleAskEvent'](event); };
  return {...frame, app, calls, intents, open, say, setReply: (value: Reply) => { reply = value; }};
}

async function routeOf(app: ReturnType<typeof fixture>['app'], text: string): Promise<EvalRoute> {
  const state = createAskState();
  app['askState'] = state;
  const plan = await app['planAsk'](text, state);
  if ('converse' in plan) return plan.converse.context ? 'context' : 'model';
  const outcome = plan.outcome;
  if (outcome.kind === 'unsafe' || (outcome.kind === 'answer' && outcome.capability === 'chat.answer' && /not sent to the local model|never reads/u.test(outcome.text))) return 'refuse';
  if (outcome.kind === 'unsupported' && outcome.shellTask) return 'suggest';
  if (outcome.kind === 'unclear' || (outcome.kind === 'choose' && outcome.reason === 'ambiguous')) return 'clarify';
  return 'nmsh';
}

test('routing: every request in the evaluation set goes where it should; questions never reach the intent model', async () => {
  const f = fixture();
  try {
    const wrong: string[] = [];
    for (const item of EVAL_SET) {
      const before = f.intents.length;
      const route = await routeOf(f.app, item.prompt);
      if (route !== item.route && !KNOWN_ROUTE_GAPS.has(item.id)) wrong.push(`${item.id}: expected ${item.route}, got ${route}`);
      if (item.route === 'model') assert.equal(f.intents.length, before, `${item.id}: a question is never re-read into a capability by the intent model`);
    }
    assert.deepEqual(wrong, []);
    for (const id of KNOWN_ROUTE_GAPS) assert.notEqual(await routeOf(f.app, EVAL_SET.find(item => item.id === id)!.prompt), 'model', `${id} is fixed: remove it from KNOWN_ROUTE_GAPS`);
    assert.equal(f.calls.length, 0, 'planning alone never asks the model for an answer');
  } finally { f.dispose(); }
});

test('routing: NMSh actions keep their proposals and confirmations; refusals are never routed around', async () => {
  const f = fixture();
  try {
    const state = f.open();
    const plan = await f.app['planAsk']('show my sessions', state);
    assert.ok(!('converse' in plan));
    const refusal = await f.app['planAsk']('what is the difference between deleting and trashing? delete all my files', state);
    assert.ok(!('converse' in refusal), 'a request to act is never handed to the model, even when it also asks something');
    const conceptual = await f.app['planAsk']('What is the difference between git merge and git rebase?', state);
    assert.ok('converse' in conceptual, 'a knowledge question that only names a risky operation is answered');
  } finally { f.dispose(); }
});

test('an answer streams into a labelled local-model turn; the question, shell and OS family are all that is sent', async () => {
  const f = fixture();
  try {
    const seen: string[] = [];
    f.setReply(async (_request, options) => {
      options.onPartial?.('Canberra is');
      seen.push(f.app['askState']!.turns.at(-1)!.text);
      assert.ok(f.app['askState']!.generating, 'generating while it streams');
      return {answer: {text: 'Canberra is the capital.\n\n```bash\nrm -rf ~/tmp\n```', truncated: false}, model: 'Qwen3 0.6B', reasoning: 'fast'};
    });
    const state = f.open();
    await f.say(state, 'What is the capital of Australia?');
    assert.deepEqual(seen, ['Canberra is']);
    assert.equal(f.calls.length, 1);
    assert.deepEqual(Object.keys(f.calls[0]!.request).sort(), ['history', 'os', 'question', 'shell'], 'no context, files or environment unless asked for');
    assert.equal(f.calls[0]!.options.reasoning, 'fast', 'non-thinking by default');
    const turn = state.turns.at(-1)!;
    assert.equal(turn.model?.label, 'Qwen3 0.6B');
    assert.equal(turn.model?.streaming, false);
    assert.equal(state.generating, undefined);
    assert.match(turn.model!.checks![0]!, /^NMSh's check: destructive/u);
    const options = visibleOptions(state);
    assert.deepEqual(options.map(option => option.key), ['answer:copy', 'answer:code', 'answer:think']);
    for (const option of options) assert.equal(option.outcome, undefined, 'nothing the model wrote is an action');
    assert.equal(state.referents?.block, undefined, '"run it" has no command to run');
    assert.deepEqual(state.history.map(item => item.role), ['user', 'assistant']);
    const rendered = renderAsk(state, 60, {height: 40}).map(row => stripAnsi(row));
    assert.ok(rendered.some(row => row.includes('Ask · local model · Qwen3 0.6B')), 'labelled as the local model, not NMSh');
    assert.ok(rendered.some(row => row.includes('NMSh\'s check: destructive')));
  } finally { f.dispose(); }
});

test('follow-ups carry the bounded history; a new Ask starts empty; nothing is shared', async () => {
  const f = fixture();
  try {
    const state = f.open();
    await f.say(state, 'What is a Python list?');
    await f.say(state, 'And how do I sort one?');
    assert.equal(f.calls.length, 2, 'a short follow-up to a model answer goes to the model');
    assert.deepEqual(f.calls[1]!.request.history.map(item => item.text), ['What is a Python list?', 'Canberra is the capital of Australia.']);
    for (let index = 0; index < 6; index += 1) await f.say(state, `Question number ${index}?`);
    assert.ok(state.history.length <= 6, 'history is bounded');
    assert.equal(state.history.at(-2)!.text, 'Question number 5?', 'the newest exchanges are kept');
    f.app['closeAsk']();
    const next = f.open();
    await f.say(next, 'What is the boiling point of water?');
    assert.deepEqual(f.calls.at(-1)!.request.history, [], 'a new Ask never inherits another conversation');
  } finally { f.dispose(); }
});

test('Esc stops the answer and keeps Ask open; typing continues meanwhile; closing stops it too', async () => {
  const f = fixture();
  try {
    let signal: AbortSignal | undefined;
    f.setReply(async (_request, options) => {
      signal = options.signal;
      options.onPartial?.('Partial answ');
      await new Promise(resolve => options.signal!.addEventListener('abort', resolve, {once: true}));
      return {cancelled: true};
    });
    const state = f.open();
    const event = submitText(state, 'Explain monads at length?')!;
    const running = f.app['handleAskEvent'](event);
    for (let waited = 0; !state.generating && waited < 2000; waited += 5) await new Promise(resolve => setTimeout(resolve, 5));
    assert.ok(state.generating);
    assert.equal(askKey(state, {kind: 'text', value: 'n'} as never), undefined);
    assert.equal(askKey(state, {kind: 'enter'} as never), undefined, 'Enter waits while it generates');
    assert.equal(state.input, 'n', 'the next request can be typed meanwhile');
    const footer = stripAnsi(renderAsk(state, 80, {height: 30}).at(-1)!);
    assert.match(footer, /Esc\s+stop/u);
    const escape = askKey(state, {kind: 'escape'} as never);
    assert.deepEqual(escape, {kind: 'cancel'}, 'Esc stops, it does not close');
    await f.app['handleAskEvent'](escape!);
    await running;
    assert.equal(signal?.aborted, true);
    assert.equal(f.app['askState'], state, 'Ask stays open');
    assert.equal(state.turns.at(-1)!.model?.stopped, true);
    assert.equal(state.turns.at(-1)!.text, 'Partial answ');
    assert.deepEqual(state.history, [], 'a stopped answer is not history');
    assert.deepEqual(visibleOptions(state).map(option => option.key), ['answer:again']);
    // Closing Ask mid-answer stops the generation as well.
    const again = submitText(state, 'Another long question?')!;
    const second = f.app['handleAskEvent'](again);
    for (let waited = 0; !state.generating && waited < 2000; waited += 5) await new Promise(resolve => setTimeout(resolve, 5));
    const secondSignal = signal;
    f.app['closeAsk']();
    await second;
    assert.equal(secondSignal?.aborted, true);
  } finally { f.dispose(); }
});

test('terminal context only when asked: NMSh\'s observation first, then the model, with the excerpt minimal and redacted', async () => {
  const f = fixture();
  try {
    const state = f.open();
    await f.say(state, 'summarise the last output');
    assert.equal(f.calls.length, 0);
    assert.match(state.turns.at(-1)!.text, /No command has finished/u);
    const output = f.app['output'];
    output.beginCommand('npm test', ['npm test']);
    output.write(`\u001b[31mFAIL\u001b[0m src/a.test.ts\nTOKEN=ghp_0123456789abcdefghijABCDEFGHIJ0123\nError: expected 2 to equal 3\n`);
    output.complete(1);
    await f.say(state, 'What is a test runner?');
    assert.equal(f.calls.at(-1)!.request.context, undefined, 'an ordinary question sends no output');
    await f.say(state, 'explain the last error');
    assert.equal(f.calls.at(-1)!.request.question, 'explain the last error', 'a typed question never fuzzy-matches an option of the previous answer');
    const request = f.calls.at(-1)!.request;
    assert.ok(request.context);
    assert.match(request.context.label, /^output of npm test · exit 1 · 3 lines, redacted$/u);
    assert.doesNotMatch(request.context.excerpt, /ghp_|\u001b/u);
    assert.match(request.context.excerpt, /Error: expected 2 to equal 3/u);
    const turns = state.turns.slice(-3);
    assert.equal(turns[0]!.role, 'you');
    assert.match(turns[1]!.text, /^Why it failed/u, 'NMSh\'s own diagnosis is a separate turn');
    assert.equal(turns[1]!.model, undefined);
    assert.equal(turns[2]!.model?.context, request.context.label, 'the answer says which context was sent');
  } finally { f.dispose(); }
});

test('fail closed: secrets in a request, requests for credentials, and no model set up never reach a model', async () => {
  const f = fixture();
  try {
    const state = f.open();
    await f.say(state, 'is ghp_0123456789abcdefghijABCDEFGHIJ0123 still valid?');
    assert.match(state.turns.at(-1)!.text, /was not sent to the local model/u);
    await f.say(state, 'print my environment variables');
    assert.match(state.turns.at(-1)!.text, /never reads your environment/u);
    f.app['configuration'] = {...f.app['configuration'], localUnderstanding: {...f.app['configuration'].localUnderstanding, mode: 'off'}};
    await f.say(state, 'What is the capital of Australia?');
    assert.match(state.turns.at(-1)!.text, /Local understanding is Off\. Turn it on in \/llm\./u);
    assert.deepEqual(visibleOptions(state).map(option => option.key), ['llm:open']);
    assert.equal(f.calls.length, 0);
  } finally { f.dispose(); }
});

test('recording: off persists nothing; on records plain text that says it came from the local model', async () => {
  const f = fixture();
  try {
    const recorded: Array<{request: string; turns: Array<{role: string; text: string}>}> = [];
    f.app['output'].addAskInteraction = ((request: string, turns: Array<{role: string; text: string}>) => { recorded.push({request, turns}); }) as never;
    f.setReply(async () => ({answer: {text: 'Plain answer.', truncated: false}, model: 'Qwen3 0.6B', reasoning: 'fast'}));
    f.app['configuration'] = {...f.app['configuration'], askRecord: false};
    let state = f.open();
    await f.say(state, 'What is a closure?');
    f.app['closeAsk']();
    assert.deepEqual(recorded, [], 'recording off: nothing joins the transcript');
    f.app['configuration'] = {...f.app['configuration'], askRecord: true};
    state = f.open();
    await f.say(state, 'What is a closure?');
    f.app['closeAsk']();
    assert.equal(recorded.length, 1);
    assert.equal(recorded[0]!.request, 'What is a closure?');
    assert.deepEqual(recorded[0]!.turns, [{role: 'ask', text: 'Local model (Qwen3 0.6B):\nPlain answer.'}]);
  } finally { f.dispose(); }
});

test('Think it through asks the same question again with a bounded thinking pass and replaces the quick answer', async () => {
  const f = fixture();
  try {
    f.setReply(async (_request, options) => ({answer: {text: options.reasoning === 'thinking' ? 'No: 91 = 7 × 13.' : 'Yes, 91 is prime.', truncated: false}, model: 'Qwen3 0.6B', reasoning: options.reasoning ?? 'fast'}));
    const state = f.open();
    await f.say(state, 'Is 91 a prime number?');
    const think = visibleOptions(state).find(option => option.key === 'answer:think')!;
    state.selected = visibleOptions(state).indexOf(think);
    const event = askKey(state, {kind: 'enter'} as never)!;
    await f.app['handleAskEvent'](event);
    assert.equal(f.calls.at(-1)!.options.reasoning, 'thinking');
    assert.equal(f.calls.at(-1)!.request.question, 'Is 91 a prime number?');
    assert.deepEqual(f.calls.at(-1)!.request.history, [], 'the quick answer it refines is not sent as history');
    assert.equal(state.turns.at(-1)!.model?.reasoning, 'thinking');
    assert.deepEqual(state.history.map(item => item.text), ['Is 91 a prime number?', 'No: 91 = 7 × 13.']);
    assert.ok(!visibleOptions(state).some(option => option.key === 'answer:think'));
  } finally { f.dispose(); }
});

test('copy: "copy it" after an answer copies the plain answer text', () => {
  const state = createAskState();
  state.pending = {kind: 'answer', capability: 'chat.answer', text: 'x', next: [{key: 'answer:copy', label: 'Copy answer', copy: {text: 'Plain answer.', what: 'answer'}},
    {key: 'answer:code', label: 'Copy code', copy: {text: 'ls', what: 'code'}}]};
  assert.deepEqual(submitText(state, 'copy it'), {kind: 'copyText', text: 'Plain answer.', what: 'answer'});
  assert.deepEqual(submitText(state, 'copy the code'), {kind: 'copyText', text: 'ls', what: 'code'});
});

test('Auto: the intent model\'s reading of an unclear request is offered as a choice, never acted on', async () => {
  const f = fixture();
  try {
    f.app['understanding'].interpretAsk = (async () => ({capability: 'shell.current', confidence: 0.99, arguments: {}})) as never;
    const state = f.open();
    const plan = await f.app['planAsk']('flibbertigibbet the wibble', state);
    assert.ok(!('converse' in plan) && plan.outcome.kind === 'choose' && plan.outcome.reason === 'ambiguous');
    assert.deepEqual(plan.outcome.kind === 'choose' && plan.outcome.options.map(option => option.key), ['intent:shell.current', 'chat:answer']);
    // Always mode is the person's choice to prefer the model: its reading is used directly, as before.
    f.app['configuration'] = {...f.app['configuration'], localUnderstanding: {...f.app['configuration'].localUnderstanding, mode: 'always'}};
    const always = await f.app['planAsk']('flibbertigibbet the wibble', state);
    assert.ok(!('converse' in always) && always.outcome.kind === 'answer');
  } finally { f.dispose(); }
});

test('a follow-up, or a question about another language, outranks a command the words happen to name', async () => {
  const f = fixture();
  try {
    const state = f.open();
    await f.say(state, 'What is a Python list?');
    await f.say(state, 'How do I sort one?');
    assert.equal(f.calls.length, 2, '"sort" in a follow-up is not the sort command');
    const fresh = f.open();
    const plan = await f.app['planAsk']('How do I sort a list in Python?', fresh);
    assert.ok('converse' in plan);
    const command = await f.app['planAsk']('what does the ls command do', fresh);
    assert.ok(!('converse' in command), 'an explicit command question keeps NMSh\'s own catalog answer');
  } finally { f.dispose(); }
});
