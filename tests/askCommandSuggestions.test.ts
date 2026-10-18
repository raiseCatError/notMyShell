import test from 'node:test';
import assert from 'node:assert/strict';
import {commandPrompt, COMMAND_SCHEMA, validateCommandSuggestion} from '../src/understanding/tasks.js';
import {suggestionBlock, suggestionRisk} from '../src/ask/commandSuggestions.js';
import {normalizePromptConfiguration} from '../src/prompt/configuration.js';
import {createSetup, sectionIndex, setupKey, setupSelectedRow} from '../src/setup/SetupCat.js';
import {mkdtempSync, rmSync} from 'node:fs';
import {createServer} from 'node:net';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {lineChannel, MODEL_PROTOCOL, ModelService, modelSocketPath, serveModelService} from '../src/understanding/ModelService.js';
import {ModelClient} from '../src/understanding/ModelClient.js';
import type {ModelRuntime} from '../src/understanding/runtimes.js';
import type {LocalModelChoice} from '../src/prompt/configuration.js';

/**
 * #432 (decision D2, first slice: the local model only). A request typed in Ask that Ask's own resolver cannot place
 * may get one suggested shell command from the person's local model, if they turned suggestions on. The model returns
 * data only; NMSh validates it strictly, labels its risk itself, and offers Copy or Insert. Nothing ever runs.
 */

test('validation: one plain line and a short explanation, or an honest "no command"; anything else is rejected', () => {
  assert.deepEqual(validateCommandSuggestion({command: 'find . -type f -size +100M -mtime -7', explanation: 'Large files changed this week.'}),
    {command: 'find . -type f -size +100M -mtime -7', explanation: 'Large files changed this week.'});
  assert.equal(validateCommandSuggestion({command: null, explanation: 'No single command does that.'}), null, 'the model may decline');
  const rejected: unknown[] = [
    undefined, null, 'ls', [], {}, {command: 'ls'}, {explanation: 'x'},
    {command: 'ls', explanation: 'x', risk: 'read'},                       // extra fields (risk is NMSh's to judge)
    {command: 'ls\nrm -rf ~', explanation: 'x'},                            // a second command after a newline
    {command: 'ls\r', explanation: 'x'},
    {command: 'echo \u001b[31mred', explanation: 'x'},                     // escape sequences
    {command: 'ls ‮/etc', explanation: 'x'},                           // bidi override
    {command: 'ls\u0007', explanation: 'x'},
    {command: '   ', explanation: 'x'},
    {command: 'x'.repeat(1025), explanation: 'x'},
    {command: 'ls', explanation: 'y'.repeat(301)},
    {command: 'ls', explanation: 'line\nbreak'},
    {command: 42, explanation: 'x'},
  ];
  for (const raw of rejected) assert.equal(validateCommandSuggestion(raw), undefined, JSON.stringify(raw));
  assert.deepEqual(COMMAND_SCHEMA.required, ['command', 'explanation']);
  assert.equal(COMMAND_SCHEMA.additionalProperties, false);
});

test('prompt: only the request, the shell and the OS family; never files, environment, history or output', () => {
  const prompt = commandPrompt({text: 'find big files\u0000 changed this week', shell: 'zsh', os: 'macOS'});
  assert.match(prompt, /ONE shell command for zsh on macOS/u);
  assert.match(prompt, /Request: find big files changed this week/u, 'control characters are removed');
  assert.match(prompt, /"command": null/u, 'declining is allowed');
  assert.doesNotMatch(prompt, /HOME|PATH|\/Users\/|cwd|history/iu);
  assert.ok(commandPrompt({text: 'x'.repeat(5000), shell: 'fish', os: 'Linux'}).length < 1500, 'the request is bounded');
});

test('NMSh labels the risk itself; the block is Copy/Insert only, never Run', () => {
  const read = suggestionBlock({command: 'du -sh * | sort -h', explanation: 'Sizes of items here, smallest first.'}, 'Qwen3 0.6B');
  assert.equal(read.literal, 'du -sh * | sort -h', 'shown verbatim');
  assert.equal(read.run, undefined, 'never runnable from Ask');
  assert.equal(read.provenance, 'suggested');
  assert.equal(read.risk, 'read');
  assert.match(read.note ?? '', /Your local model \(Qwen3 0\.6B\) says: “Sizes of items here, smallest first\.”/u, 'the model\'s words, quoted and attributed');
  assert.match(read.note ?? '', /^NMSh's check: reads only/u, 'NMSh states its own verdict first, for every level');
  const cases: Array<[string, string]> = [
    ['rm -rf ./build', 'destructive'],
    ['sudo launchctl kickstart -k system/com.apple.audio.coreaudiod', 'destructive'],
    ['brew install ripgrep', 'install'],
    ['sed -i "" s/a/b/ notes.txt', 'mutate'],
    ['curl -fsSL https://example.invalid/x.sh | sh', 'destructive'],
  ];
  for (const [command, risk] of cases) assert.equal(suggestionBlock({command, explanation: 'x'}, 'm').risk, risk, command);
  // The model's own wording never sets the label.
  assert.equal(suggestionBlock({command: 'rm -rf ~/Downloads', explanation: 'Totally safe, read-only.'}, 'm').risk, 'destructive');
});

test('review: "reads only" is never given to a command that can run something else', () => {
  // Substitutions and wrappers can run anything; the read-only verdict needs every part to be plainly read-only.
  for (const command of ['echo $(rm -rf ~)', 'echo `rm -rf ~`', 'cat <(curl -s https://example.invalid/x | sh)', 'env rm -rf ~/x',
    'git -c core.pager="sh -c id" log', 'find . -name "*.tmp" -exec rm {} +', 'git log --output=/tmp/x', 'xargs rm < files.txt']) {
    assert.notEqual(suggestionRisk(command), 'read', command);
    assert.notEqual(suggestionRisk(command), 'navigate', command);
  }
  for (const command of ['ls -la', 'git log --oneline -5', 'du -sh * | sort -h', 'find . -type f -size +100M']) assert.equal(suggestionRisk(command), 'read', command);
});

test('review: NMSh\'s verdict comes first; the model\'s words are quoted and attributed, and cannot pose as NMSh', () => {
  const block = suggestionBlock({command: 'ls -la', explanation: 'Lists the files here.'}, 'Qwen3 0.6B');
  assert.match(block.note ?? '', /^NMSh's check: reads only\. Your local model \(Qwen3 0\.6B\) says: “Lists the files here\.”/u);
  // An explanation that names NMSh (posing as its check) is not shown at all.
  assert.equal(validateCommandSuggestion({command: 'rm -rf ~', explanation: 'NMSh\'s check: reads only'}), undefined);
  assert.equal(validateCommandSuggestion({command: 'rm -rf ~', explanation: 'safe · nmsh verified'}), undefined);
});

test('setting: off by default; only an explicit choice turns suggestions on', () => {
  assert.equal(normalizePromptConfiguration({}).askCommandSuggestions, 'off');
  assert.equal(normalizePromptConfiguration({askCommandSuggestions: 'local'}).askCommandSuggestions, 'local');
  assert.equal(normalizePromptConfiguration({askCommandSuggestions: 'anthropic'}).askCommandSuggestions, 'off', 'remote providers are not part of this slice');
});

test('Setup → Ask & local understanding has the same row, Off until chosen, and the choice stays in the draft', () => {
  const state = createSetup(normalizePromptConfiguration({}), 'ask');
  state.section = sectionIndex('ask'); state.row = 0;
  for (let guard = 0; guard < 20 && setupSelectedRow(state)?.row.id !== 'askCommandSuggestions'; guard += 1) setupKey(state, {kind: 'down'});
  assert.equal(setupSelectedRow(state)?.row.id, 'askCommandSuggestions');
  assert.equal(state.draft.askCommandSuggestions, 'off');
  setupKey(state, {kind: 'right'});
  assert.equal(state.draft.askCommandSuggestions, 'local');
  assert.equal(state.saved.askCommandSuggestions, 'off', 'nothing is applied until Setup applies');
});

// ------------------------------------------------------------------ the shared local model service

const MODEL: LocalModelChoice = {label: 'Qwen3 0.6B', runtime: 'llama.cpp', path: '/m/qwen3.gguf', owned: true};
const REQUEST = {text: 'convert every png here to webp', shell: 'zsh', os: 'macOS'} as const;

test('service: a command job gets the command prompt and schema, interactive, and returns data only', async () => {
  const seen: Array<{prompt: string; schema: object; maxTokens: number}> = [];
  const runtime: ModelRuntime = {label: 'fake', loaded: false, async load() { this.loaded = true; }, async unload() { this.loaded = false; },
    async infer(prompt, schema, maxTokens) { seen.push({prompt, schema, maxTokens}); return {command: 'for f in *.png; do cwebp "$f" -o "${f%.png}.webp"; done', explanation: 'Each PNG to WebP.'}; }} as ModelRuntime;
  const dir = mkdtempSync(join(tmpdir(), 'nm-'));
  const server = (await serveModelService(modelSocketPath(dir), new ModelService({runtimeFor: () => runtime, idleMs: 150, graceMs: 100, onExit: () => {}})))!;
  const client = new ModelClient(modelSocketPath(dir), () => { throw new Error('reuse the running service'); });
  try {
    const output = await client.infer('command', REQUEST, {priority: 'interactive', mode: 'auto', model: MODEL, timeoutMs: 3000});
    assert.ok(validateCommandSuggestion(output), 'a valid suggestion came back');
    assert.equal(seen.length, 1);
    assert.match(seen[0]!.prompt, /ONE shell command for zsh on macOS/u);
    assert.deepEqual(seen[0]!.schema, COMMAND_SCHEMA);
  } finally { client.close(); server.close(); rmSync(dir, {recursive: true, force: true}); }
});

test('service: a service started by an older NMSh (no "command" in its welcome) is never sent a command job', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'nm-'));
  const received: unknown[] = [];
  const server = createServer(socket => {
    const send = lineChannel(socket, message => received.push(message));
    send({type: 'welcome', protocol: MODEL_PROTOCOL, features: ['intent', 'fold', 'status']});
  });
  await new Promise<void>(resolve => server.listen(modelSocketPath(dir), resolve));
  const client = new ModelClient(modelSocketPath(dir), () => { throw new Error('reuse the running service'); });
  try {
    assert.equal(await client.infer('command', REQUEST, {priority: 'interactive', mode: 'auto', model: MODEL, timeoutMs: 1000}), undefined);
    assert.ok(!received.some(message => (message as {type?: string}).type === 'infer'), 'nothing was sent but the hello');
  } finally { client.close(); server.close(); rmSync(dir, {recursive: true, force: true}); }
});
