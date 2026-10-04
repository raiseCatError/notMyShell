import test from 'node:test';
import assert from 'node:assert/strict';
import {chmod, mkdtemp, rm, writeFile, readFile, access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {
  clearProviderDetection,
  detectProvider,
  providerRowText,
  providerStatusLabel,
  resolveProvider,
  runExternal,
  type ProviderDescriptor,
} from '../src/providers/providers.js';
import {createProviderPanel, handleProviderPanelKey, providerPanelEnterAction, renderProviderPanel} from '../src/providers/ProviderPanel.js';
import {PROMPT_PROVIDERS, providerLabel} from '../src/prompt/PromptPanel.js';
import {stripAnsi} from '../src/util/text.js';
import {until, processAlive} from './helpers/liveFrontend.js';

type Id = 'native' | 'tool' | 'none';
const PROVIDERS: readonly ProviderDescriptor<Id>[] = [
  {id: 'native', family: 'welcome', label: 'Native', kind: 'native', description: 'built in'},
  {id: 'tool', family: 'welcome', label: 'Tool', kind: 'external', executable: 'nmsh-test-tool', versionArgs: ['--version'],
    description: 'external', install: {label: 'brew install tool', command: 'brew', args: ['install', 'tool']}},
  {id: 'none', family: 'welcome', label: 'None', kind: 'none', description: 'nothing'},
];

async function withTool<T>(script: string, run: (path: string) => Promise<T>): Promise<T> {
  const directory = await mkdtemp(join(tmpdir(), 'nmsh-provider-'));
  try {
    const binary = join(directory, 'nmsh-test-tool');
    await writeFile(binary, `#!/bin/sh\n${script}\n`);
    await chmod(binary, 0o755);
    clearProviderDetection();
    return await run(directory);
  } finally {
    clearProviderDetection();
    await rm(directory, {recursive: true, force: true});
  }
}

test('detection reports installed version, missing binaries, and native providers without probing', async () => {
  assert.deepEqual(await detectProvider(PROVIDERS[0]!), {state: 'builtin'});
  clearProviderDetection();
  assert.equal((await detectProvider(PROVIDERS[1]!, '/nonexistent-nmsh')).state, 'missing');
  await withTool('echo "tool 1.2.3"', async path => {
    const status = await detectProvider(PROVIDERS[1]!, path);
    assert.equal(status.state, 'installed');
    assert.equal(status.version, 'tool 1.2.3');
    assert.equal(providerStatusLabel(PROVIDERS[1]!, status), 'tool 1.2.3');
    assert.strictEqual(detectProvider(PROVIDERS[1]!, path), detectProvider(PROVIDERS[1]!, path), 'detection is cached');
  });
});

test('external invocation is argv-only, bounded, and never throws', async () => {
  await withTool('printf "%s|" "$@"; cat', async path => {
    const result = await runExternal(join(path, 'nmsh-test-tool'), ['a b', '$(whoami)']);
    assert.deepEqual(result, {ok: true, stdout: 'a b|$(whoami)|'}, 'no shell interpolation, stdin closed');
  });
  await withTool('sleep 5', async path => {
    const started = Date.now();
    const result = await runExternal(join(path, 'nmsh-test-tool'), [], {timeoutMs: 100});
    assert.equal(result.ok, false);
    assert.equal(result.error, 'timed out');
    assert.ok(Date.now() - started < 2000);
  });
  assert.equal((await runExternal('/nonexistent/nmsh-tool', [])).ok, false);
});

test('missing or broken providers fall back with a factual notice', () => {
  assert.deepEqual(resolveProvider(PROVIDERS, 'tool', {state: 'installed'}, 'native'), {id: 'tool'});
  assert.deepEqual(resolveProvider(PROVIDERS, 'tool', {state: 'missing'}, 'native'),
    {id: 'native', notice: 'Tool is not installed; using Native.'});
  assert.deepEqual(resolveProvider(PROVIDERS, 'tool', {state: 'unhealthy', detail: 'timed out'}, 'native'),
    {id: 'native', notice: 'Tool is unavailable (timed out); using Native.'});
  assert.deepEqual(resolveProvider(PROVIDERS, 'none', undefined, 'native'), {id: 'none'});
});

test('shared panel shows status badges, preview, and asks before installing', () => {
  const state = createProviderPanel('welcome', 'Welcome', PROVIDERS, 'native');
  state.statuses = {native: {state: 'builtin'}, tool: {state: 'missing'}};
  const rows = renderProviderPanel(state, 100, ['preview line']).map(stripAnsi);
  assert.ok(rows.includes('› Native · built in  [Native]  ●  ✓ saved'));
  assert.ok(rows.includes('  Tool · external  [Not installed]'));
  assert.ok(rows.includes('preview line'));
  assert.equal(providerPanelEnterAction(state), 'save');
  assert.ok(handleProviderPanelKey({kind: 'down'} as never, state));
  assert.equal(providerPanelEnterAction(state), 'installConfirm');
  state.step = 'installConfirm';
  assert.ok(renderProviderPanel(state, 100, []).map(stripAnsi).includes('Runs: brew install tool'));
});

test('prompt providers run on the shared descriptor with unchanged labels and rows', () => {
  assert.deepEqual(PROMPT_PROVIDERS.map(provider => providerLabel(provider.id)), ['NMSh Native', 'Starship', 'Powerlevel10k', 'None']);
  assert.equal(providerRowText(PROMPT_PROVIDERS[1]!, {draft: 'starship', saved: 'nmsh', status: 'none'}),
    'Starship · use its themes/configuration  ●');
});


test('external cancellation is bounded and pre-aborted requests never launch', async () => {
  const cancelled = new AbortController();
  cancelled.abort();
  assert.deepEqual(await runExternal('/nonexistent', [], {signal: cancelled.signal}),
    {ok: false, stdout: '', error: 'cancelled'});
  await withTool('sleep 5', async path => {
    const active = new AbortController();
    const request = runExternal(join(path, 'nmsh-test-tool'), [], {signal: active.signal});
    active.abort();
    assert.deepEqual(await request, {ok: false, stdout: '', error: 'cancelled'});
  });
});

test('graceful parent termination still kills TERM-ignoring group descendants', async () => {
  await withTool(`trap 'exit 0' TERM
(trap '' TERM; : > "$2"; exec sleep 20) >/dev/null 2>&1 &
echo $! > "$1"
while :; do sleep .05; done`, async path => {
    const controller = new AbortController();
    const pidfile = join(path, 'pid'); const ready = join(path, 'ready');
    const request = runExternal(join(path, 'nmsh-test-tool'), [pidfile, ready], {signal: controller.signal, terminationGraceMs: 100});
    let pid = 0;
    try {
      await until(async () => {
        try { await access(ready); pid = Number(await readFile(pidfile, 'utf8')); return pid > 1; } catch { return false; }
      }, 2000, 'TERM-ignoring descendant');
      controller.abort();
      assert.equal((await request).error, 'cancelled');
      await until(() => !processAlive(pid), 2000, 'remaining provider group cleanup');
    } finally {
      controller.abort(); await request;
      if (pid) { try { process.kill(pid, 'SIGKILL'); } catch { /* Already reaped. */ } }
    }
  });
});
