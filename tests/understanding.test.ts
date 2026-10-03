import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {existsSync, mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {createServer} from 'node:http';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ModelService, modelSocketPath, serveModelService} from '../src/understanding/ModelService.js';
import {ModelClient} from '../src/understanding/ModelClient.js';
import {LocalUnderstanding, understandingWelcomeText} from '../src/understanding/LocalUnderstanding.js';
import type {ModelRuntime} from '../src/understanding/runtimes.js';
import {foldExcerpt, redact, validateFoldHint, validateInterpretation} from '../src/understanding/tasks.js';
import {assessModel, discoverLocal, knownModelDirectories, nmshModelDirectory, proposeSetup, type DiscoveryAdapters} from '../src/understanding/discovery.js';
import {ggufFixture, parseGgufMetadata} from '../src/understanding/gguf.js';
import {downloadPinned, loadRecommendedModel} from '../src/understanding/recommended.js';
import {applyFoldHint, evaluateFold, hintEligible} from '../src/output/FoldPolicy.js';
import {OutputBuffer} from '../src/output/OutputBuffer.js';
import {CAPABILITIES, resolveWithInterpretation} from '../src/ask/resolver.js';
import type {AskContext} from '../src/ask/types.js';
import type {LocalModelChoice, LocalUnderstandingSettings} from '../src/prompt/configuration.js';

const MODEL: LocalModelChoice = {label: 'Qwen3 0.6B Q4_K_M', runtime: 'llama.cpp', path: '/m/qwen3.gguf', owned: true};
const until = async (check: () => boolean, ms = 3000) => { const end = Date.now() + ms; while (!check()) { if (Date.now() > end) throw new Error('timeout'); await new Promise(resolve => setTimeout(resolve, 10)); } };

class FakeRuntime implements ModelRuntime {
  static instances: FakeRuntime[] = [];
  loaded = false;
  prompts: string[] = [];
  unloads = 0;
  constructor(readonly label: string, private readonly reply: (prompt: string) => unknown = () => ({capability: 'git.diff', confidence: 0.9}), private readonly delayMs = 5) { FakeRuntime.instances.push(this); }
  async load(): Promise<void> { this.loaded = true; }
  async infer(prompt: string): Promise<unknown> {
    this.prompts.push(prompt);
    await new Promise(resolve => setTimeout(resolve, this.delayMs));
    const value = this.reply(prompt);
    if (value instanceof Error) throw value;
    return value;
  }
  async unload(): Promise<void> { this.loaded = false; this.unloads += 1; }
}

async function serviceFixture(options: Partial<ConstructorParameters<typeof ModelService>[0]> = {}) {
  const dir = mkdtempSync(join('/tmp', 'nm-'));
  let exited = 0;
  const service = new ModelService({runtimeFor: model => new FakeRuntime(model.label), idleMs: 150, graceMs: 100, onExit: () => { exited += 1; }, ...options});
  const server = (await serveModelService(modelSocketPath(dir), service))!;
  const client = () => new ModelClient(modelSocketPath(dir), () => { throw new Error('a running service must be reused, not started'); });
  return {dir, service, server, client, exited: () => exited, close: () => { server.close(); rmSync(dir, {recursive: true, force: true}); }};
}
const intent = (text: string) => ({text, capabilities: [{id: 'git.diff', title: 'diff'}], facts: {shell: 'zsh'}});

test('defaults: local understanding Off with every scope Off; Off creates no client and runs no inference', async () => {
  const settings: LocalUnderstandingSettings = {mode: 'off', ask: true, folding: true, model: MODEL};
  let created = 0;
  const understanding = new LocalUnderstanding(() => settings, () => { created += 1; return new ModelClient('/nonexistent', () => {}); });
  assert.equal(understanding.eligible('ask'), false, 'global Off wins over enabled scopes');
  assert.equal(await understanding.interpretAsk(intent('x'), new Set(['git.diff'])), undefined);
  assert.equal(await understanding.foldHint({command: 'npm install', exitCode: 0, lines: []}), undefined);
  assert.equal(await understanding.refreshStatus(), undefined);
  assert.equal(created, 0);
  assert.equal(understanding.requests, 0);
  settings.mode = 'auto'; settings.ask = false;
  assert.equal(understanding.eligible('ask'), false, 'a disabled scope never uses the model');
  assert.equal(understanding.eligible('folding'), true);
  assert.equal(new LocalUnderstanding(() => ({mode: 'auto', ask: true, folding: true})).eligible('ask'), false, 'no model chosen: nothing to use');
});

test('one shared service: three clients, one model load; Ask and folding share it; contexts never cross', async () => {
  FakeRuntime.instances = [];
  const fixture = await serviceFixture();
  try {
    const clients = [fixture.client(), fixture.client(), fixture.client()];
    const results = await Promise.all(clients.map((client, index) => client.infer('intent', intent(`request-from-window-${index}`), {priority: 'interactive', mode: 'auto', model: MODEL, timeoutMs: 2000})));
    assert.deepEqual(results, [0, 1, 2].map(() => ({capability: 'git.diff', confidence: 0.9})));
    const fold = await clients[1]!.infer('fold', {command: 'npm install', exitCode: 0, lines: ['added 1 package']}, {priority: 'background', mode: 'auto', model: MODEL, timeoutMs: 2000});
    assert.ok(fold);
    assert.equal(FakeRuntime.instances.length, 1, 'one runtime for every window and both features');
    assert.equal(fixture.service.loads, 1);
    const prompts = FakeRuntime.instances[0]!.prompts;
    for (const [index, prompt] of prompts.slice(0, 3).entries()) {
      const own = /request-from-window-(\d)/u.exec(prompt)![1];
      assert.ok(prompts.length >= 3 && [0, 1, 2].every(other => other === Number(own) || !prompt.includes(`request-from-window-${other}`)), `prompt ${index} carries only its own request`);
    }
    assert.equal((await clients[0]!.status())?.clients, 3);
    for (const client of clients) client.close();
  } finally { fixture.close(); }
});

test('lifecycle: closing one client keeps the model for the others; Auto unloads once after global idle; no clients → exit', async () => {
  FakeRuntime.instances = [];
  const fixture = await serviceFixture();
  try {
    const a = fixture.client();
    const b = fixture.client();
    await a.infer('intent', intent('a'), {priority: 'interactive', mode: 'auto', model: MODEL, timeoutMs: 2000});
    a.close();
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.equal(FakeRuntime.instances[0]!.loaded, true, 'another window is still connected');
    await b.infer('intent', intent('b'), {priority: 'interactive', mode: 'auto', model: MODEL, timeoutMs: 2000});
    assert.equal(fixture.service.loads, 1, 'reused, not reloaded');
    await until(() => !FakeRuntime.instances[0]!.loaded);
    assert.equal(FakeRuntime.instances[0]!.unloads, 1, 'one global idle unload');
    b.close();
    await until(() => fixture.exited() === 1);
  } finally { fixture.close(); }
});

test('Always keeps one model warm while windows are connected; Off unloads and lets the service exit', async () => {
  FakeRuntime.instances = [];
  const fixture = await serviceFixture();
  try {
    const client = fixture.client();
    await client.infer('intent', intent('x'), {priority: 'interactive', mode: 'always', model: MODEL, timeoutMs: 2000});
    await new Promise(resolve => setTimeout(resolve, 300));
    assert.equal(FakeRuntime.instances[0]!.loaded, true, 'warm past the Auto idle period');
    assert.equal(FakeRuntime.instances.length, 1);
    client.configure('off');
    await until(() => fixture.exited() === 1);
    assert.equal(FakeRuntime.instances[0]!.loaded, false);
    client.close();
  } finally { fixture.close(); }
});

test('priority: interactive Ask runs before queued folding; stale or excess folding is dropped', async () => {
  FakeRuntime.instances = [];
  const order: string[] = [];
  const fixture = await serviceFixture({runtimeFor: () => new FakeRuntime('slow', prompt => { order.push(/Classify/u.test(prompt) ? 'fold' : 'ask'); return {kind: 'noise', confidence: 0.9}; }, 40)});
  try {
    const client = fixture.client();
    const folds = [0, 1, 2, 3, 4].map(index => client.infer('fold', {command: `x${index}`, exitCode: 0, lines: []}, {priority: 'background', mode: 'auto', model: MODEL, timeoutMs: 3000}));
    await new Promise(resolve => setTimeout(resolve, 5));
    const ask = client.infer('intent', intent('now'), {priority: 'interactive', mode: 'auto', model: MODEL, timeoutMs: 3000});
    await ask;
    const settled = await Promise.all(folds);
    assert.ok(order.indexOf('ask') <= 1, `Ask was not stuck behind folding: ${order.join(',')}`);
    assert.ok(settled.filter(result => result === undefined).length >= 1, 'excess advisory work was dropped');
    client.close();
  } finally { fixture.close(); }
});

test('failures fall back: a crashing runtime or no service yields no answer, never an error to the window', async () => {
  const fixture = await serviceFixture({runtimeFor: () => new FakeRuntime('broken', () => new Error('crashed'))});
  try {
    const client = fixture.client();
    assert.equal(await client.infer('intent', intent('x'), {priority: 'interactive', mode: 'auto', model: MODEL, timeoutMs: 2000}), undefined);
    assert.match((await client.status())?.error ?? '', /crashed/u);
    client.close();
  } finally { fixture.close(); }
  const none = new ModelClient('/tmp/nmsh-no-such-dir/x.sock', () => {});
  assert.equal(await none.infer('intent', intent('x'), {priority: 'interactive', mode: 'auto', model: MODEL, timeoutMs: 300}), undefined);
});

test('validation: unknown capabilities, extra fields, command-like output and malformed values are rejected', () => {
  const ids = new Set(CAPABILITIES.map(capability => capability.id));
  assert.deepEqual(validateInterpretation({capability: 'git.diff', confidence: 0.8, arguments: {worktree: 'release'}}, ids), {capability: 'git.diff', confidence: 0.8, arguments: {worktree: 'release'}});
  assert.equal(validateInterpretation({capability: 'shell.exec', confidence: 0.9}, ids), undefined);
  assert.equal(validateInterpretation({capability: 'git.diff', confidence: 0.9, command: 'rm -rf ~'}, ids), undefined, 'a command field is just an unexpected field');
  assert.equal(validateInterpretation({capability: 'git.diff', confidence: 0.9, arguments: {argv: ['rm']}}, ids), undefined);
  assert.equal(validateInterpretation({capability: 'git.diff', confidence: 2}, ids), undefined);
  assert.equal(validateInterpretation('git diff', ids), undefined);
  assert.equal(validateInterpretation({capability: 'git.diff', confidence: 0.9, arguments: {target: 'a\nb'}}, ids), undefined);
  assert.deepEqual(validateFoldHint({kind: 'noise', confidence: 0.9}), {kind: 'noise', confidence: 0.9});
  assert.equal(validateFoldHint({kind: 'delete', confidence: 0.9}), undefined);
  assert.equal(validateFoldHint({kind: 'noise', confidence: 0.9, hide: true}), undefined);
});

test('a model interpretation never invents objects: arguments are re-resolved against facts; low confidence is ignored', () => {
  const context: AskContext = {cwd: '/r', home: '/h', repoRoot: '/r', worktrees: [{path: '/r', current: true}, {path: '/w/release', branch: 'release', current: false}],
    shell: 'zsh', defaultShell: 'zsh', shells: [], sessions: [], transcripts: [], recentFiles: [], recentCommands: [], editor: {label: 'Zed', available: true},
    providers: [], sessionMode: 'service', now: Date.now(), files: ['src/a.ts']};
  const diff = resolveWithInterpretation('show me what i messed up since my last commit', {capability: 'git.diff', confidence: 0.9, arguments: {}}, context);
  assert.deepEqual(diff?.kind === 'proposal' && diff.action, {kind: 'read', command: {id: 'git.diff'}}, 'the typed capability builds its own fixed argv');
  const invented = resolveWithInterpretation('open the secret file', {capability: 'file.open', confidence: 0.95, arguments: {target: '/etc/shadow-invented'}}, context);
  assert.equal(invented?.kind, 'answer', 'a path that does not exist is never proposed');
  const worktree = resolveWithInterpretation('changes over there', {capability: 'git.diff', confidence: 0.9, arguments: {worktree: 'release'}}, context);
  assert.deepEqual(worktree?.kind === 'proposal' && worktree.action, {kind: 'read', command: {id: 'git.diff', cwd: '/w/release'}});
  assert.equal(resolveWithInterpretation('x', {capability: 'git.diff', confidence: 0.3, arguments: {}}, context), undefined, 'low confidence keeps the deterministic outcome');
  assert.equal(resolveWithInterpretation('x', {capability: null, confidence: 0.9, arguments: {}}, context), undefined);
});

function fakeAdapters(files: Record<string, Buffer | number>, extra: Partial<DiscoveryAdapters> = {}): DiscoveryAdapters & {listed: string[]; urls: string[]} {
  const listed: string[] = [];
  const urls: string[] = [];
  const adapters = {
    home: '/h', env: {} as NodeJS.ProcessEnv, platform: 'linux' as NodeJS.Platform, listed, urls,
    which: () => undefined,
    listDirectory: (path: string) => {
      listed.push(path);
      const prefix = `${path}/`;
      const children = new Map<string, boolean>();
      for (const file of Object.keys(files)) if (file.startsWith(prefix)) { const rest = file.slice(prefix.length); children.set(rest.split('/')[0]!, rest.includes('/')); }
      if (!children.size) throw new Error('ENOENT');
      return [...children].map(([name, directory]) => ({name, directory}));
    },
    size: (path: string) => typeof files[path] === 'number' ? files[path] as number : (files[path] as Buffer | undefined)?.length,
    gguf: (path: string) => Buffer.isBuffer(files[path]) ? parseGgufMetadata(files[path] as Buffer) : undefined,
    localJson: async (url: string) => { urls.push(url); return undefined; },
    ...extra,
  };
  return adapters;
}

test('discovery: bounded known directories only, GGUF metadata without loading, owned vs found, local APIs only', async () => {
  const qwen = ggufFixture({'general.architecture': 'qwen3', 'general.name': 'Qwen3 0.6B', 'general.size_label': '0.6B', 'general.file_type': 15});
  const embed = ggufFixture({'general.architecture': 'nomic-bert', 'general.name': 'nomic-embed-text'});
  const big = ggufFixture({'general.architecture': 'qwen2', 'general.name': 'Qwen2.5 14B Instruct', 'general.size_label': '14B'});
  const owned = nmshModelDirectory({}, '/h');
  const adapters = fakeAdapters({[`${owned}/qwen3.gguf`]: qwen, '/h/.cache/llama.cpp/embed.gguf': embed, '/h/.lmstudio/models/x/big.gguf': big,
    '/h/Documents/private/other.gguf': qwen}, {which: (name: string) => name === 'llama-server' ? '/usr/bin/llama-server' : undefined});
  const found = await discoverLocal(adapters);
  assert.deepEqual(found.runtimes.map(runtime => runtime.kind), ['llama.cpp']);
  assert.deepEqual(found.models.map(model => [model.label, model.suitability, model.owned]),
    [['Qwen3 0.6B Q4_K_M', 'recommended', true], ['Qwen2.5 14B Instruct', 'large', false], ['nomic-embed-text', 'unsuitable', false]]);
  assert.ok(!found.models.some(model => model.path?.includes('Documents')), 'personal directories are never crawled');
  assert.ok(adapters.listed.every(path => knownModelDirectories(adapters).some(root => path === root || path.startsWith(`${root}/`))));
  assert.ok(!adapters.listed.includes('/h'));
  assert.ok(adapters.urls.every(url => url.startsWith('http://127.0.0.1:')), 'no remote network');
  assert.equal(proposeSetup(found).kind, 'use', 'an existing compatible model is offered before any download');
});

test('discovery: running Ollama is reused; incompatible is never selected; only-large asks', async () => {
  const ollama = fakeAdapters({}, {which: (name: string) => name === 'ollama' ? '/usr/bin/ollama' : undefined,
    localJson: async (url: string) => url.includes('11434') ? {models: [{name: 'qwen3:0.6b', size: 523_000_000, details: {family: 'qwen3', parameter_size: '751.63M', quantization_level: 'Q4_K_M'}}]} : undefined});
  const found = await discoverLocal(ollama);
  assert.deepEqual(found.runtimes, [{kind: 'ollama', label: 'Ollama', executable: '/usr/bin/ollama', running: true}]);
  const proposal = proposeSetup(found);
  assert.equal(proposal.kind === 'use' && proposal.model.name, 'qwen3:0.6b');
  assert.equal(proposeSetup({runtimes: [{kind: 'llama.cpp', label: 'llama.cpp', running: false}], models: [{label: 'emb', runtime: 'llama.cpp', path: '/e', suitability: 'unsuitable', reason: 'embedding', owned: false}]}).kind, 'download');
  assert.equal(proposeSetup({runtimes: [{kind: 'llama.cpp', label: 'llama.cpp', running: false}], models: [{label: 'big', runtime: 'llama.cpp', path: '/b', suitability: 'large', reason: '14B', owned: false}]}).kind, 'choose-large');
  assert.equal(assessModel({family: 'llama', label: 'Llama 3.2 1B', parametersB: 1.2}).suitability, 'compatible');
  assert.equal(assessModel({family: 'llama', label: 'Llama 70B', parametersB: 70}).suitability, 'unsuitable');
});

test('folding hints are advisory: errors stay visible, noise may fold a borderline block, nothing is deleted', () => {
  const noisy = {command: 'npm install', output: Array.from({length: 40}, (_, index) => `added package-${index % 7} in ${index}ms`).join('\n'), exitCode: 0, lineCount: 40};
  const failing = {...noisy, output: `${noisy.output}\nError: build failed`};
  assert.equal(applyFoldHint(failing, {kind: 'noise', confidence: 0.99}), false, 'error lines veto any hint');
  assert.equal(applyFoldHint(noisy, {kind: 'error', confidence: 0.8}), false, 'an error hint keeps output visible');
  const borderline = {command: 'tool run', output: Array.from({length: 40}, (_, index) => `step ${index}: ${['alpha', 'beta', 'gamma', 'delta'][index % 4]} ok`).join('\n'), exitCode: 0, lineCount: 40};
  assert.equal(hintEligible('smart', borderline), true, `score ${evaluateFold(borderline).score}`);
  assert.equal(applyFoldHint(borderline, {kind: 'noise', confidence: 0.9}), true);
  assert.equal(applyFoldHint(borderline, {kind: 'noise', confidence: 0.5}), evaluateFold(borderline).fold, 'unsure hints change nothing');
  assert.equal(hintEligible('never', borderline), false);
  assert.equal(hintEligible('always', borderline), false);
  assert.equal(applyFoldHint(borderline, undefined), evaluateFold(borderline).fold, 'no hint (failure, timeout, Off) is the deterministic decision');
  const buffer = new OutputBuffer();
  buffer.setOutputFolding('never');
  buffer.beginCommand('tool run', ['tool run']);
  buffer.write(borderline.output + '\n');
  const record = buffer.complete(0)!;
  const before = record.output;
  assert.equal(buffer.applyAdvisoryFold(record.startId, true), true);
  assert.equal(record.output, before, 'presentation only');
  buffer.toggleExpanded(0);
  assert.equal(buffer.applyAdvisoryFold(record.startId, true), false, 'a block the user toggled is never overridden');
});

test('folding context is bounded and redacted: program word only, head and tail, secrets masked', () => {
  const output = Array.from({length: 500}, (_, index) => `line ${index} token=abc${index}secretvalue`).join('\n');
  const excerpt = foldExcerpt('curl -H "Authorization: Bearer xyz" https://example.com', output, 0);
  assert.equal(excerpt.command, 'curl');
  assert.equal(excerpt.lines.length, 41);
  assert.match(excerpt.lines[20]!, /460 lines/u);
  assert.ok(excerpt.lines.every(line => !/secretvalue/u.test(line)));
  assert.equal(redact('see https://user:pa55@host/x'), 'see https://[redacted]@host/x');
  assert.match(redact('key ghp_abcdefghijklmnopqrstuvwx'), /\[redacted\]/u);
});

test('welcome text never claims a model that is not loaded; it names the actual model and scopes', () => {
  const base: LocalUnderstandingSettings = {mode: 'auto', ask: true, folding: false, model: MODEL};
  assert.equal(understandingWelcomeText({mode: 'off', ask: true, folding: true}), 'Off');
  assert.equal(understandingWelcomeText(base), 'Auto · model idle · Ask');
  assert.equal(understandingWelcomeText(base, {state: 'unloaded', clients: 1, queued: 0}), 'Auto · model idle · Ask');
  assert.equal(understandingWelcomeText(base, {state: 'ready', model: 'Qwen3 0.6B Q4_K_M', clients: 2, queued: 0}), 'Qwen3 0.6B Q4_K_M · Ask');
  assert.equal(understandingWelcomeText({...base, ask: false, folding: true}, {state: 'busy', model: 'Llama 3.2 1B Q4_K_M', clients: 1, queued: 1}), 'Llama 3.2 1B Q4_K_M · Smart Folding');
  assert.equal(understandingWelcomeText({...base, folding: true}, {state: 'ready', model: 'M', clients: 1, queued: 0}), 'M · Ask, Smart Folding');
  assert.equal(understandingWelcomeText({mode: 'always', ask: false, folding: false}), 'Always · no features enabled');
});

test('download: only a pinned artifact, verified by exact size and sha256; a mismatch leaves nothing behind', async () => {
  assert.equal(loadRecommendedModel()?.artifact, null, 'this build pins no artifact, so nothing downloads');
  const payload = Buffer.from('GGUF fake weights for test');
  const server = createServer((_request, response) => { response.end(payload); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as {port: number}).port;
  const dir = mkdtempSync(join(tmpdir(), 'nmsh-dl-'));
  const artifact = {repository: 'r', revision: 'abc', file: 'm.gguf', url: `http://127.0.0.1:${port}/m.gguf`, quantization: 'Q4_K_M', license: 'Apache-2.0',
    bytes: payload.length, sha256: createHash('sha256').update(payload).digest('hex')};
  try {
    const path = await downloadPinned(artifact, dir, () => {});
    assert.deepEqual(readFileSync(path), payload);
    await assert.rejects(downloadPinned({...artifact, file: 'bad.gguf', sha256: '0'.repeat(64)}, dir, () => {}), /sha256/u);
    assert.equal(existsSync(join(dir, 'bad.gguf')), false);
    await assert.rejects(downloadPinned({...artifact, file: 'short.gguf', bytes: payload.length + 5}, dir, () => {}), /size mismatch/u);
  } finally { server.close(); rmSync(dir, {recursive: true, force: true}); }
});
