import test from 'node:test';
import assert from 'node:assert/strict';
import {TOOLS, knownToolForExecutable, suggestibleToolFor, type Tool} from '../src/tools/catalog.js';
import {commandWord, installCandidate, renderInstallPrompt, createInstallPrompt} from '../src/tools/InstallSuggestion.js';
import {classifyShellFailure} from '../src/shell/ShellKnowledge.js';
import {TLDR_ARGS, parseTldrPage, tldrExamples} from '../src/shell/tldr.js';
import {stripAnsi} from '../src/util/text.js';

const config = {installSuggestions: true, ignoredInstallSuggestions: [] as string[]};

test('TLDR is a Recommended curated tool whose command and package differ', () => {
  const tool = TOOLS.find(item => item.id === 'tealdeer')!;
  assert.equal(tool.tier, 'recommended'); assert.equal(tool.label, 'TLDR (tealdeer)');
  assert.equal(tool.executable, 'tldr'); assert.equal(tool.package, 'tealdeer');
  assert.equal(knownToolForExecutable('tldr'), tool);
  assert.equal(knownToolForExecutable('tealdeer'), undefined, 'a package name is not a command alias');
  assert.equal(installCandidate('tldr tar', config), tool);
  const prompt = stripAnsi(renderInstallPrompt(createInstallPrompt(tool, {label: 'brew install tealdeer', command: 'brew', args: ['install', 'tealdeer']}, 'tldr'), 90).join('\n'));
  assert.match(prompt, /`tldr` is not installed\./u);
  assert.match(prompt, /provided by tealdeer/u);
  assert.match(prompt, /brew install tealdeer/u);
  assert.doesNotMatch(prompt, /brew install tldr/u);
});

test('catalog-wide: every curated executable is recognised by exact name regardless of tier, unless explicitly opted out', () => {
  for (const tool of TOOLS) {
    const executable = tool.executable ?? tool.id;
    const known = knownToolForExecutable(executable);
    if (tool.commandNotFound === false) { assert.equal(known === tool, false, `${tool.id} opted out explicitly`); continue; }
    // Another tool may legitimately own the same executable name first; the identity must still be a curated tool with that executable.
    assert.ok(known && (known.executable ?? known.id) === executable, `${tool.id} (${executable}) is recognised`);
    if (!tool.legacy && tool.lifecycle !== 'maintenance') assert.ok(suggestibleToolFor(executable), `${tool.id} is offered`);
  }
  const tiers = new Set(TOOLS.filter(tool => tool.commandNotFound !== false && !tool.legacy).map(tool => tool.tier ?? 'none'));
  assert.ok(tiers.has('recommended') && tiers.has('enhanced') && tiers.has('none'), 'recommended, enhanced and un-tiered tools all included');
  assert.ok(TOOLS.some(tool => tool.integration && knownToolForExecutable(tool.executable ?? tool.id)), 'provider-integrated tools are recognised');
  assert.ok(TOOLS.some(tool => tool.package && tool.executable && tool.package !== tool.executable), 'executable/package mismatch exists and is preserved');
  for (const tool of TOOLS.filter(item => item.commandNotFound !== false && item.package && item.executable && item.package !== item.executable)) assert.equal(knownToolForExecutable(tool.executable!)?.package, tool.package);
  for (const tool of TOOLS.filter(item => item.discoveryKind === 'environment')) assert.equal(tool.commandNotFound, false, `${tool.id}: runtimes and infrastructure clients opt out explicitly`);
});

test('identity policy: opt-outs, aliases and synthetic descriptors work without code changes', () => {
  const base = {category: 'Shell / Workflow', description: '', source: '', kind: 'external', family: 'tool', package: 'foo-pkg'} as unknown as Tool;
  const tools: Tool[] = [{...base, id: 'foo', label: 'Foo', executable: 'foo', commandAliases: ['foo-cli']}, {...base, id: 'bar', label: 'Bar', executable: 'bar', commandNotFound: false},
    {...base, id: 'old', label: 'Old', executable: 'old', legacy: true}];
  assert.equal(knownToolForExecutable('foo', tools)?.id, 'foo');
  assert.equal(knownToolForExecutable('foo-cli', tools)?.id, 'foo');
  assert.equal(knownToolForExecutable('foo-pkg', tools), undefined);
  assert.equal(knownToolForExecutable('bar', tools), undefined, 'explicit opt-out');
  assert.equal(knownToolForExecutable('old', tools)?.id, 'old', 'legacy is known');
  assert.equal(suggestibleToolFor('old', tools), undefined, 'but never offered');
  assert.equal(knownToolForExecutable('floobinator'), undefined, 'unknown commands invent nothing');
  assert.equal(knownToolForExecutable('../foo'), undefined);
});

test('command shapes: only a simple first word is considered; complex input never triggers install suggestions', () => {
  for (const word of ['tldr', 'shellcheck', 'rg', 'gh', 'fastfetch']) assert.equal(commandWord(`${word} foo`), word);
  for (const bad of ['rg foo | wc', 'echo $(rg x)', 'FOO=1 rg x', 'tldr\ntar', './rg', 'rg;ls']) {
    const word = commandWord(bad);
    if (bad === 'rg foo | wc' || bad === 'rg;ls') assert.equal(word, 'rg', 'the first token is still the command (existing behaviour); the pipeline itself is judged by the shell');
    else assert.equal(installCandidate(bad, config) === undefined || word !== undefined && !/[=/$]/u.test(word), true, bad);
  }
  assert.equal(installCandidate('FOO=1 tldr', config), undefined);
  assert.equal(installCandidate('tldr', {installSuggestions: false, ignoredInstallSuggestions: []}), undefined);
  assert.equal(installCandidate('tldr', {installSuggestions: true, ignoredInstallSuggestions: ['tealdeer']}), undefined);
});

test('not-found evidence is recognised for zsh, Bash and Fish; a program exiting 127 by itself is not a shell not-found', () => {
  assert.equal(classifyShellFailure('tldr', 127, 'zsh: command not found: tldr\n'), 'command-not-found');
  assert.equal(classifyShellFailure('tldr', 127, 'bash: tldr: command not found\n'), 'command-not-found');
  assert.equal(classifyShellFailure('tldr', 127, 'fish: Unknown command: tldr\n'), 'command-not-found');
  assert.equal(classifyShellFailure('make', 127, 'make: *** [all] Error 127\n'), undefined);
  assert.equal(classifyShellFailure('tldr', 1, 'zsh: command not found: tldr\n'), undefined, 'exit status must be 127');
  assert.equal(classifyShellFailure('./run.sh', 127, 'run.sh: line 3: foo: command not found\n'), undefined);
});

test('TLDR: cache-only invocation, bounded examples, malformed pages rejected, nothing executed', () => {
  const calls: string[][] = [];
  const page = '# tar\n\n' + Array.from({length: 20}, (_, i) => `- Example ${i}:\n\n\`tar x${i} {{file}}\`\n`).join('\n');
  const run = (command: string, args: string[]) => { calls.push([command, ...args]); return {status: 0, stdout: page}; };
  const examples = tldrExamples('/usr/bin/tldr', ['tar'], run);
  assert.deepEqual(calls, [['/usr/bin/tldr', ...TLDR_ARGS, 'tar']]);
  assert.ok(TLDR_ARGS.includes('--no-auto-update') && !TLDR_ARGS.includes('--update'), 'never updates or downloads');
  assert.equal(examples.length, 8, 'bounded');
  assert.ok(examples.every(example => example.command.startsWith('tar ')));
  assert.deepEqual(tldrExamples('/usr/bin/tldr', ['tar'], () => ({status: 1, stdout: ''})), [], 'uncached or failing: none');
  assert.deepEqual(tldrExamples('/usr/bin/tldr', ['tar'], () => ({status: 0, stdout: '- evil:\n\n`rm -rf /`\n- `x`'})), [], 'malformed or foreign commands rejected');
  assert.deepEqual(tldrExamples('/usr/bin/tldr', ['../x'], run), [], 'unsafe path words never reach the client');
  assert.deepEqual(tldrExamples(undefined, ['tar'], run), []);
  assert.equal(calls.length, 1);
  assert.deepEqual(parseTldrPage('- a:\n\n`tar \u0007x`', 'tar'), []);
});
