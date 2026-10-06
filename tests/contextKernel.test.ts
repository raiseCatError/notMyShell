import test from 'node:test';
import assert from 'node:assert/strict';
import {ContextEngine, type ContextDemand} from '../src/context/engine.js';
import {defineCapability, type CapabilityContext, type CapabilityDefinition, type CapabilityScopeInput} from '../src/context/capability.js';
import {EMPTY_SHELL_ENVIRONMENT, parseShellEnvironment, frontendEnvironment, restrictEnvironment, type ShellEnvironment} from '../src/context/shellEnvironment.js';
import {projectFactValue, sanitizeFactValue, type ContextFact} from '../src/context/facts.js';

interface Deferred<T> {promise: Promise<T>; resolve(value: T): void; reject(error: unknown): void}
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((ok, fail) => { resolve = ok; reject = fail; });
  return {promise, resolve, reject};
}
const tick = () => new Promise(resolve => setImmediate(resolve));

function capability(id: string, overrides: Partial<CapabilityDefinition<unknown>> = {}, resolver?: (context: CapabilityContext) => Promise<{value: unknown; evidence: string} | undefined>): CapabilityDefinition<unknown> {
  return defineCapability<unknown>({id, title: id, reads: [], scope: 'workspace', family: 'metadata', cost: 'bounded-async', trust: 'workspace',
    sensitivity: 'public', persistence: 'snapshot-safe', fields: ['name', 'version', 'detail'], env: [], ttlMs: 10_000, timeoutMs: 1_000,
    invalidateOn: ['command'], preview: {name: 'preview'}, resolve: resolver ?? (async () => ({value: {name: id}, evidence: 'fixture'})), ...overrides});
}

const scope = (cwd: string, env: ShellEnvironment = EMPTY_SHELL_ENVIRONMENT): CapabilityScopeInput => ({cwd, home: '/home/user', session: 's1', env});
const demand = (...ids: string[]): ContextDemand => new Map(ids.map(id => [id, new Set<string>()]));

test('only demanded capabilities run: hidden or disabled modules cost nothing', async () => {
  let runs = 0;
  const engine = new ContextEngine({capabilities: [capability('a.one', {}, async () => { runs++; return {value: {name: 'one'}, evidence: 'x'}; }), capability('b.two')]});
  engine.stage(scope('/w')); engine.commit();
  await tick();
  assert.equal(runs, 0, 'no demand, no work');
  engine.demand(demand('a.one'));
  await engine.settle(1000);
  assert.equal(runs, 1);
  assert.deepEqual(Object.keys(engine.facts()), ['a.one']);
  assert.equal(engine.stats.started, 1);
});

test('concurrent demand coalesces and fresh values are cache hits; expiry refreshes while showing stale', async () => {
  let now = 1_000;
  const gate = deferred<{value: unknown; evidence: string}>();
  let runs = 0;
  const engine = new ContextEngine({now: () => now, capabilities: [capability('a.one', {ttlMs: 500}, () => { runs++; return runs === 1 ? gate.promise : Promise.resolve({value: {name: 'second'}, evidence: 'x'}); })]});
  engine.stage(scope('/w')); engine.commit();
  engine.demand(demand('a.one')); engine.demand(demand('a.one')); engine.demand(demand('a.one'));
  assert.equal(runs, 1, 'one in-flight task per key');
  assert.ok(engine.stats.coalesced >= 2);
  gate.resolve({value: {name: 'first'}, evidence: 'x'});
  await engine.settle(1000);
  assert.deepEqual(engine.facts()['a.one']!.value, {name: 'first'});
  engine.demand(demand('a.one'));
  assert.equal(runs, 1); assert.equal(engine.stats.cacheHits, 1);
  now += 600;
  assert.equal(engine.facts()['a.one']!.freshness, 'stale', 'expired value is disclosed as stale');
  engine.demand(demand('a.one'));
  assert.equal(engine.facts()['a.one']!.value && (engine.facts()['a.one']!.value as {name: string}).name, 'first', 'stale value stays visible while refreshing');
  await engine.settle(1000);
  assert.equal(runs, 2);
  assert.deepEqual(engine.facts()['a.one']!.value, {name: 'second'});
  assert.equal(engine.facts()['a.one']!.freshness, 'fresh');
});

test('field demand reaches the resolver; an extra field re-resolves, an unknown field is ignored', async () => {
  const seen: string[][] = [];
  const engine = new ContextEngine({capabilities: [capability('cloud.x', {}, async context => { seen.push([...context.fields].sort()); return {value: {name: 'n'}, evidence: 'x'}; })]});
  engine.stage(scope('/w')); engine.commit();
  engine.demand(new Map([['cloud.x', new Set(['name', 'bogus'])]]));
  await engine.settle(1000);
  engine.demand(new Map([['cloud.x', new Set(['name'])]]));
  await engine.settle(1000);
  engine.demand(new Map([['cloud.x', new Set(['name', 'version'])]]));
  await engine.settle(1000);
  assert.deepEqual(seen, [['name'], ['name', 'version']]);
});

test('global and per-family concurrency caps hold, cheap work is scheduled first', async () => {
  let active = 0, peak = 0, probeActive = 0, probePeak = 0;
  const gates: Array<Deferred<{value: unknown; evidence: string}>> = [];
  const order: string[] = [];
  const make = (id: string, family: 'metadata' | 'probe', cost: 'cheap' | 'bounded-async' | 'probe') => capability(id, {family, cost}, async () => {
    order.push(id);
    active++; peak = Math.max(peak, active);
    if (family === 'probe') { probeActive++; probePeak = Math.max(probePeak, probeActive); }
    const gate = deferred<{value: unknown; evidence: string}>(); gates.push(gate);
    try { return await gate.promise; } finally { active--; if (family === 'probe') probeActive--; }
  });
  const capabilities = [...Array.from({length: 4}, (_, i) => make(`probe.${i}`, 'probe', 'probe')), ...Array.from({length: 6}, (_, i) => make(`meta.${i}`, 'metadata', 'bounded-async')), make('cheap.one', 'metadata', 'cheap')];
  const engine = new ContextEngine({capabilities, concurrency: 3, familyLimits: {probe: 1}});
  engine.stage(scope('/w')); engine.commit();
  engine.demand(demand(...capabilities.map(item => item.id)));
  assert.equal(order[0], 'cheap.one', 'cheap capabilities start first');
  while (engine.pendingCount) {
    await tick();
    gates.shift()?.resolve({value: {name: 'v'}, evidence: 'x'});
    await tick();
  }
  assert.ok(peak <= 3, `global cap held (peak ${peak})`);
  assert.equal(probePeak, 1, 'probe family cap held');
  assert.equal(Object.keys(engine.facts()).length, capabilities.length);
});

test('timeouts are failures with backoff; refresh retries; a previous value stays visible as stale', async () => {
  let now = 0, mode: 'ok' | 'hang' | 'throw' = 'ok', runs = 0;
  const engine = new ContextEngine({now: () => now, capabilities: [capability('slow.one', {timeoutMs: 20, ttlMs: 100}, async context => {
    runs++;
    if (mode === 'ok') return {value: {name: 'good'}, evidence: 'x'};
    if (mode === 'throw') throw new Error('bad\u001b[31m thing');
    return new Promise((_, reject) => context.signal.addEventListener('abort', () => reject(context.signal.reason)));
  })]});
  engine.stage(scope('/w')); engine.commit();
  engine.demand(demand('slow.one')); await engine.settle(1000);
  assert.equal(engine.status('slow.one').state, 'fresh');
  mode = 'hang'; now += 200;
  engine.demand(demand('slow.one')); await engine.settle(1000);
  assert.equal(engine.status('slow.one').state, 'timeout');
  assert.match(engine.status('slow.one').error!, /timed out after 20 ms/);
  assert.equal(engine.facts()['slow.one']!.freshness, 'stale', 'old value kept, marked stale, never refreshed by invention');
  assert.equal(engine.stats.timedOut, 1);
  engine.demand(demand('slow.one'));
  assert.equal(runs, 2, 'backoff suppresses an immediate retry');
  mode = 'throw'; engine.refresh(); await engine.settle(1000);
  assert.equal(runs, 3, 'explicit refresh ignores backoff');
  assert.equal(engine.status('slow.one').state, 'failed');
  assert.ok(!/\u001b/u.test(engine.status('slow.one').error!), 'error text is sanitized');
  now += 120_000; mode = 'ok';
  engine.demand(demand('slow.one')); await engine.settle(1000);
  assert.equal(engine.status('slow.one').state, 'fresh');
});

test('a capability\'s first resolution gets a cold-start allowance; later ones keep the declared timeout', async () => {
  let delay = 60;
  const engine = new ContextEngine({capabilities: [capability('cold.one', {timeoutMs: 30, ttlMs: 1}, async () => {
    await new Promise(resolve => setTimeout(resolve, delay));
    return {value: {ok: true}, evidence: 'x'};
  })]});
  engine.stage(scope('/w')); engine.commit();
  engine.demand(demand('cold.one')); await engine.settle(2000);
  assert.equal(engine.status('cold.one').state, 'fresh', 'a slow cold start (parsers, cold caches, contention) still lands');
  engine.stage(scope('/other')); engine.commit();
  engine.demand(demand('cold.one')); await engine.settle(2000);
  assert.equal(engine.status('cold.one').state, 'timeout', 'once warm, the declared limit applies');
  assert.match(engine.status('cold.one').error!, /timed out after 30 ms/u);
  delay = 0;
  engine.refresh(); await engine.settle(2000);
  assert.equal(engine.status('cold.one').state, 'fresh');
  engine.dispose();
});

test('scope change cancels superseded work; late results never appear; staging keeps the old scope visible until commit', async () => {
  const gates = new Map<string, Deferred<{value: unknown; evidence: string}>>();
  let aborted = 0;
  const engine = new ContextEngine({capabilities: [capability('ws.pkg', {}, context => {
    const gate = deferred<{value: unknown; evidence: string}>(); gates.set(context.cwd, gate);
    context.signal.addEventListener('abort', () => { aborted++; });
    return gate.promise;
  })]});
  const first = engine.stage(scope('/a')); engine.demand(demand('ws.pkg'));
  assert.equal(engine.commit(first), true);
  gates.get('/a')!.resolve({value: {name: 'A'}, evidence: 'x'}); await engine.settle(1000);
  assert.deepEqual(engine.facts()['ws.pkg']!.value, {name: 'A'});
  const second = engine.stage(scope('/b'));
  const third = engine.stage(scope('/c'));
  assert.equal(aborted, 1, 'in-flight /b work cancelled when /c was staged');
  gates.get('/b')!.resolve({value: {name: 'B'}, evidence: 'x'});
  await tick();
  assert.deepEqual(engine.facts()['ws.pkg']!.value, {name: 'A'}, 'old scope stays visible until commit');
  assert.equal(engine.commit(second), false, 'a superseded generation cannot commit');
  gates.get('/c')!.resolve({value: {name: 'C'}, evidence: 'x'});
  await engine.settle(1000);
  assert.equal(engine.commit(third), true);
  assert.deepEqual(engine.facts()['ws.pkg']!.value, {name: 'C'});
  assert.ok(engine.stats.cancelled >= 1);
  engine.stage(scope('/a')); engine.commit();
  assert.deepEqual(engine.facts()['ws.pkg']!.value, {name: 'A'}, 'returning to a cached workspace reuses work');
});

test('settle honors its deadline and a disposed engine ignores late results', async () => {
  const gate = deferred<{value: unknown; evidence: string}>();
  let updates = 0;
  const engine = new ContextEngine({onUpdate: () => { updates++; }, capabilities: [capability('a.one', {}, () => gate.promise)]});
  engine.stage(scope('/w')); engine.commit(); engine.demand(demand('a.one'));
  const started = Date.now();
  await engine.settle(30);
  assert.ok(Date.now() - started < 1000);
  engine.dispose();
  gate.resolve({value: {name: 'late'}, evidence: 'x'});
  await tick(); await tick();
  assert.deepEqual(engine.facts(), {});
  assert.equal(updates, 0);
});

test('command invalidation refreshes on the next demand; updates batch into one notification', async () => {
  let version = 0, updates = 0;
  const caps = ['a.one', 'b.two', 'c.three'].map(id => capability(id, id === 'c.three' ? {invalidateOn: []} : {}, async () => ({value: {name: `${id}-${version}`}, evidence: 'x'})));
  const engine = new ContextEngine({onUpdate: () => { updates++; }, capabilities: caps});
  engine.stage(scope('/w')); engine.commit();
  engine.demand(demand('a.one', 'b.two', 'c.three')); await engine.settle(1000); await tick();
  assert.equal(updates, 1, 'three completions, one batched render request');
  version = 1;
  engine.invalidate('command');
  assert.equal(engine.facts()['a.one']!.freshness, 'stale');
  assert.equal(engine.facts()['c.three']!.freshness, 'fresh', 'capabilities not affected by commands stay fresh');
  engine.demand(demand('a.one', 'b.two', 'c.three')); await engine.settle(1000);
  assert.deepEqual(engine.facts()['a.one']!.value, {name: 'a.one-1'});
  assert.deepEqual(engine.facts()['c.three']!.value, {name: 'c.three-0'});
});

test('the sanitization boundary removes controls, bidi, prototypes, functions and unbounded data', async () => {
  const hostile = {name: `x\u001b]8;;file:///etc/passwd\u0007\u202eevil${'y'.repeat(10_000)}`, list: Array.from({length: 100}, (_, i) => i),
    fn: () => 1, nan: Number.NaN, nested: {a: {b: {c: {d: {e: 'deep'}}}}}, ['__proto__']: {polluted: true}, date: new Date(0), 'bad key': 1};
  const engine = new ContextEngine({capabilities: [capability('a.one', {}, async () => ({value: hostile, evidence: 'evil\u001b[2J'}))]});
  engine.stage(scope('/w')); engine.commit(); engine.demand(demand('a.one')); await engine.settle(1000);
  const fact = engine.facts()['a.one']!;
  const value = fact.value as Record<string, unknown>;
  assert.ok(!/[\u0000-\u001f\u007f-\u009f\u202a-\u202e]/u.test(JSON.stringify(value).replace(/\\u[0-9a-f]{4}/giu, '')), 'no controls or bidi');
  assert.ok((value.name as string).length <= 512);
  assert.equal((value.list as unknown[]).length, 32);
  assert.equal(value.fn, undefined); assert.equal(value.nan, undefined); assert.equal(value.date, undefined); assert.equal(value['bad key'], undefined);
  assert.equal(({} as Record<string, unknown>).polluted, undefined, 'no prototype pollution');
  assert.ok(!fact.source.evidence.includes('\u001b'));
  assert.equal(sanitizeFactValue(Symbol('s')), undefined);
});

test('environment is part of the cache key and capabilities see only what they declared', async () => {
  const seen: Array<Record<string, string>> = [];
  const engine = new ContextEngine({capabilities: [capability('cloud.aws', {scope: 'user', env: ['AWS_PROFILE']}, async context => {
    seen.push({...context.env.values}); return {value: {name: context.env.values.AWS_PROFILE ?? 'default'}, evidence: 'AWS_PROFILE'};
  })]});
  const env = (profile: string): ShellEnvironment => ({values: {AWS_PROFILE: profile, PATH: '/secret/path', KUBECONFIG: '/k'}, present: new Set(['AWS_PROFILE', 'AWS_SECRET_ACCESS_KEY']), source: 'shell'});
  engine.stage(scope('/w', env('dev'))); engine.commit(); engine.demand(demand('cloud.aws')); await engine.settle(1000);
  engine.stage(scope('/other', env('dev'))); engine.commit(); engine.demand(demand('cloud.aws')); await engine.settle(1000);
  assert.equal(seen.length, 1, 'user-scoped value is not recomputed on cd');
  engine.stage(scope('/other', env('prod'))); engine.commit(); engine.demand(demand('cloud.aws')); await engine.settle(1000);
  assert.deepEqual(seen, [{AWS_PROFILE: 'dev'}, {AWS_PROFILE: 'prod'}]);
  assert.deepEqual(engine.facts()['cloud.aws']!.value, {name: 'prod'});
  assert.deepEqual([...restrictEnvironment(env('x'), ['AWS_SECRET_ACCESS_KEY']).present], ['AWS_SECRET_ACCESS_KEY']);
  assert.deepEqual(restrictEnvironment(env('x'), ['AWS_SECRET_ACCESS_KEY']).values, {});
});

test('cache stays bounded under rapid directory changes', async () => {
  const engine = new ContextEngine({maxEntries: 16, capabilities: [capability('ws.pkg')]});
  for (let i = 0; i < 200; i++) { engine.stage(scope(`/w${i}`)); engine.demand(demand('ws.pkg')); engine.commit(); await engine.settle(1000); }
  assert.deepEqual(engine.facts()['ws.pkg']!.value, {name: 'ws.pkg'});
  assert.ok((engine as unknown as {entries: Map<string, unknown>}).entries.size <= 17);
});

test('shell environment snapshots are allowlisted, bounded and control-free', () => {
  const knowledge = ['jobs 0', 'envsnapshot 1', 'env AWS_PROFILE=dev', 'env AWS_SECRET_ACCESS_KEY=SHOULD_NOT_APPEAR', 'envset AWS_SECRET_ACCESS_KEY',
    'env HOME=/nope', `env AWS_REGION=${'x'.repeat(65)}`, 'env TF_WORKSPACE=stage\u001b[2J', 'env VIRTUAL_ENV=/p/.venv', 'envset NOT_ALLOWED', 'alias ll', 'complete'].join('\n');
  const env = parseShellEnvironment(knowledge)!;
  assert.deepEqual(env.values, {AWS_PROFILE: 'dev', VIRTUAL_ENV: '/p/.venv'});
  assert.ok(env.present.has('AWS_SECRET_ACCESS_KEY'));
  assert.ok(!env.present.has('NOT_ALLOWED'));
  assert.equal(env.source, 'shell');
  assert.equal(parseShellEnvironment('jobs 0\nalias ll\ncomplete'), undefined, 'older bootstraps are distinguishable from an empty environment');
  const fallback = frontendEnvironment({AWS_PROFILE: 'p', AWS_SECRET_ACCESS_KEY: 'k', HOME: '/h'});
  assert.deepEqual(fallback.values, {AWS_PROFILE: 'p'});
  assert.ok(fallback.present.has('AWS_SECRET_ACCESS_KEY'));
  assert.equal(fallback.source, 'frontend');
});

test('field policy projection keeps private fields out of snapshots', () => {
  const fact: ContextFact<unknown> = {value: {project: 'p', account: 'me@example.com'}, source: {capability: 'cloud.gcp', evidence: 'x'}, collectedAt: 1,
    freshness: 'fresh', trust: 'user-metadata', sensitivity: 'public', persistence: 'snapshot-safe', resolution: 'bounded-async',
    fieldPolicy: {account: {sensitivity: 'private', persistence: 'display-only'}}};
  assert.deepEqual(projectFactValue(fact, 'display'), {project: 'p', account: 'me@example.com'});
  assert.deepEqual(projectFactValue(fact, 'snapshot'), {project: 'p'});
  assert.equal(projectFactValue({...fact, sensitivity: 'secret'}, 'display'), undefined);
});
