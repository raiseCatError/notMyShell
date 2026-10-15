import test from 'node:test';
import assert from 'node:assert/strict';
import {readdirSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import {ModBroker, type ModPermission, type PortableDescriptor, type TargetSnapshot} from '../src/agents/mods/broker.js';
import {builtinModInventory, CONTEXT_METER} from '../src/agents/mods/model.js';

/**
 * The executable Portable Mod gate (#341, docs/design/portable-mod-isolation.md). These tests keep execution disabled
 * until enforced isolation exists: lifting the block means changing them together with the isolation, its review and
 * its adversarial suite.
 */

const MODS = join(import.meta.dirname, '..', 'src', 'agents', 'mods');
const LOADERS: ReadonlyArray<[RegExp, string]> = [
  [/\bimport\s*\(/u, 'dynamic import()'], [/\brequire\s*\(/u, 'require()'], [/\bnew\s+Function\b/u, 'new Function'], [/\beval\s*\(/u, 'eval'],
  [/['"]node:vm['"]|['"]vm['"]/u, 'node:vm'], [/worker_threads/u, 'worker threads'], [/WebAssembly\.(?:instantiate|compile|Module|Instance)/u, 'WebAssembly'],
  [/\bcreateRequire\b|['"]node:module['"]|\bprocess\.(?:dlopen|binding)\b/u, 'node:module or a native addon'],
];

/** Every argv the mods code may give Claude's CLI, verbatim. */
const PROVIDER_CLI: Readonly<Record<string, readonly string[]>> = {
  'claudePlugins.ts': [
    "['plugin', 'list', '--json']",
    "['plugin', enable ? 'enable' : 'disable', claude.pluginId, '--scope', claude.scope, '--json']",
    "['plugin', 'details', claude.pluginId]",
    "['plugin', 'validate', entry.reference]",
  ],
};

/**
 * Names a mods file may import from a module outside this folder that can itself start processes or load code (one
 * level deep): `resolveCommand` only looks the executable up on PATH.
 */
const PROCESS_CAPABLE_IMPORTS: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>> = {
  'inventory.ts': {'../../providers/providers.js': ['resolveCommand']},
};
const PROCESS_CAPABLE = /child_process|\bspawn\s*\(|\bexecFile\b|\bimport\s*\(|\brequire\s*\(|\bcreateRequire\b/u;

/**
 * Why `source` (a file of src/agents/mods named `file`) breaks the gate; empty when it passes. `outside` reads a
 * module imported from outside the folder by its specifier.
 */
function gateProblems(file: string, source: string, outside: (specifier: string) => string): string[] {
  const problems: string[] = [];
  for (const [pattern, name] of LOADERS) if (pattern.test(source)) problems.push(`${file} must not use ${name} until #341's isolation gate passes`);
  for (const match of source.matchAll(/^import\s+(?!type\b)([^;']+?)\s+from\s+'(\.\.\/[^']+)'/gmu)) {
    if (!PROCESS_CAPABLE.test(outside(match[2]!))) continue;
    const names = match[1]!.trim().replace(/^\{|\}$/gu, '').split(',').map(name => name.trim()).filter(Boolean);
    const allowed = PROCESS_CAPABLE_IMPORTS[file]?.[match[2]!] ?? [];
    for (const name of names) if (!allowed.includes(name)) problems.push(`${file} imports ${name} from ${match[2]}, which can start processes`);
  }
  // The only process use is Claude's own plugin CLI (list, details, validate, and enable/disable at the installed
  // scope, #347): it inventories and manages provider-native code inside the provider; nothing here runs mod code in
  // NMSh. Each argv form is reviewed; any other call, a shell, or another process API fails this gate.
  if (!/child_process/u.test(source)) return problems;
  if (!Object.hasOwn(PROVIDER_CLI, file)) return [...problems, `${file} spawns processes`];
  const imports = [...source.matchAll(/import\s*\{([^}]*)\}\s*from\s*'node:child_process'/gu)].map(match => match[1]!.trim());
  if (imports.length !== 1 || imports[0] !== 'execFile') problems.push(`${file} uses only execFile`);
  if ([...source.matchAll(/['"](?:node:)?child_process['"]/gu)].length !== 1) problems.push(`${file} imports child_process once, by name`);
  // Any shell option, whether true or a shell's path.
  if (/\bshell\s*:/u.test(source)) problems.push(`${file} never uses a shell`);
  // execFile is only wrapped as run; every run is Claude's resolved executable with a reviewed argv.
  if ([...source.matchAll(/\bexecFile\b/gu)].length !== 2 || !/\bconst run = promisify\(execFile\);/u.test(source)) problems.push(`${file} uses execFile only through run`);
  const runs = [...source.matchAll(/\brun\(/gu)].length;
  const reviewedRuns = [...source.matchAll(/\brun\(executable,\s*(?:args\b|\[\s*'plugin')/gu)].length;
  if (runs === 0 || runs !== reviewedRuns) problems.push(`${file}: every run passes Claude's executable and a reviewed argv`);
  const argsDeclarations = [...source.matchAll(/\b(?:const|let|var)\s+args\b/gu)].length;
  if (argsDeclarations !== (/\brun\(executable,\s*args\b/u.test(source) ? 1 : 0) || /\bargs\s*(?:=[^=]|\.push|\.splice|\.unshift|\[)/u.test(source.replace(/\bconst args = \[/u, ''))) {
    problems.push(`${file}: args is declared once, as a reviewed literal, and never changed`);
  }
  const calls = [...source.matchAll(/\[\s*'plugin'[^\]]*\]/gu)].map(match => match[0]);
  for (const call of calls) if (!PROVIDER_CLI[file]!.includes(call)) problems.push(`${file}: ${call} is not a reviewed provider CLI call`);
  return problems;
}

const readOutside = (specifier: string) => readFileSync(join(MODS, specifier.replace(/\.js$/u, '.ts')), 'utf8');

test('no code-loading path exists under src/agents/mods', () => {
  const files = readdirSync(MODS).filter(name => name.endsWith('.ts'));
  assert.ok(files.length > 0);
  for (const file of files) assert.deepEqual(gateProblems(file, readFileSync(join(MODS, file), 'utf8'), readOutside), [], file);
});

test('the code-loading gate rejects each known way around it', () => {
  const reviewed = readFileSync(join(MODS, 'claudePlugins.ts'), 'utf8');
  const quiet = () => '';
  assert.deepEqual(gateProblems('claudePlugins.ts', reviewed, readOutside), [], 'the reviewed file passes');
  const bypasses: Array<[string, string, (specifier: string) => string]> = [
    ['a shell given by path', reviewed.replace("timeout: 30_000, maxBuffer: 256", "shell: '/bin/sh', timeout: 30_000, maxBuffer: 256"), quiet],
    ['a second, namespace import', reviewed.replace("import {execFile} from 'node:child_process';", "import {execFile} from 'node:child_process';\nimport * as cp from 'node:child_process';"), quiet],
    ['a bare child_process import', reviewed.replace("import {promisify} from 'node:util';", "import {promisify} from 'node:util';\nimport {spawn} from 'child_process';"), quiet],
    ['another executable', reviewed.replace("run(executable, ['plugin', 'details'", "run('/bin/sh', ['plugin', 'details'"), quiet],
    ['an argv that is not a plugin call', reviewed.replace("run(executable, ['plugin', 'list', '--json']", "run(executable, ['-c', 'true']"), quiet],
    ['an unreviewed plugin call', reviewed.replace("['plugin', 'details', claude.pluginId]", "['plugin', 'install', claude.pluginId]"), quiet],
    ['args changed after review', reviewed.replace("  const env = claude.configDir ? {...process.env, CLAUDE_CONFIG_DIR: claude.configDir} : process.env;\n  let stdout", "  args.push('--plugin-dir', '.');\n  const env = claude.configDir ? {...process.env, CLAUDE_CONFIG_DIR: claude.configDir} : process.env;\n  let stdout"), quiet],
    ['execFile called directly', reviewed.replace("const run = promisify(execFile);", "const run = promisify(execFile);\nexecFile('sh');"), quiet],
    ['createRequire', `${reviewed}\nexport const load = createRequire(import.meta.url);\n`, quiet],
    ['a process helper imported from elsewhere', "import {runExternal} from '../../providers/providers.js';\n", () => "import {spawn} from 'node:child_process';"],
  ];
  for (const [name, source, outside] of bypasses) {
    assert.notEqual(source, reviewed, `${name}: the fixture applies`);
    assert.notDeepEqual(gateProblems(name.includes('elsewhere') ? 'inventory.ts' : 'claudePlugins.ts', source, outside), [], name);
  }
});

test('Portable descriptors are inert and the inventory says they are not executable', () => {
  const execution: PortableDescriptor['execution'] = CONTEXT_METER.execution;
  assert.equal(execution, 'inert');
  for (const entry of builtinModInventory().filter(item => item.kind === 'Portable')) {
    assert.equal(entry.sandbox, 'Not executable');
    assert.match(entry.executesInside, /inert/u);
    assert.equal(entry.enabled, 'no');
  }
});

test('the broker is read-only and deny-by-default: only requested, granted, read permissions answer', () => {
  const target: TargetSnapshot = {id: 't1', provider: 'claude', state: 'idle', context: {percent: 40, observedAt: 1},
    capabilities: {'context.status': {availability: 'available'}} as unknown as TargetSnapshot['capabilities']};
  const other: TargetSnapshot = {...target, id: 't2'};
  const broker = new ModBroker(() => [target, other]);
  const everything: ModPermission[] = ['context.status', 'session.status', 'conversation.read', 'tool.observe', 'approval.observe', 'approval.decorate', 'approval.explain', 'targets.list', 'targets.aggregate'];
  const descriptor: PortableDescriptor = {id: 'probe', name: 'Probe', requested: everything, providers: ['claude'], execution: 'inert'};
  const api = broker.bind(descriptor, 't1', 'i1', everything);
  // Writes, approvals and conversation content are never granted, whatever is requested and granted.
  for (const permission of ['conversation.read', 'tool.observe', 'approval.observe', 'approval.decorate', 'approval.explain'] as ModPermission[]) {
    assert.equal(api.request(permission).ok, false, permission);
  }
  assert.deepEqual(api.request('context.status'), {ok: true, value: {targetId: 't1', percent: 40, observedAt: 1}});
  // Not requested by the descriptor: denied even if granted.
  const narrow = broker.bind({...descriptor, requested: ['context.status']}, 't1', 'i2', everything);
  assert.equal(narrow.request('session.status').ok, false);
  // Not granted: denied even if requested.
  assert.deepEqual(broker.bind(descriptor, 't1', 'i3', []).request('context.status'), {ok: false, reason: 'Capability not granted (deny by default)'});
  // A provider the descriptor does not apply to: denied.
  assert.equal(broker.bind({...descriptor, providers: ['codex']}, 't1', 'i4', everything).request('context.status').ok, false);
  // The API carries nothing but identity and request; it cannot be extended.
  assert.deepEqual(Object.keys(api).sort(), ['identity', 'request']);
  assert.ok(Object.isFrozen(api) && Object.isFrozen(api.identity));
  assert.throws(() => { (api as unknown as Record<string, unknown>).provider = {}; });
});
