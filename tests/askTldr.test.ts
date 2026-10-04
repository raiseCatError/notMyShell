import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {parseTldrPage} from '../src/shell/tldr.js';
import {parseCommandQuestion, type CommandEnvironment} from '../src/ask/commands.js';
import {resolveRequest} from '../src/ask/resolver.js';
import {BundledCatalog} from '../src/shell/BundledCatalog.js';
import {CommandReference} from '../src/shell/CommandReference.js';
import {DeclarativeSpecSource} from '../src/shell/CompletionSources.js';
import {TOOLS} from '../src/tools/catalog.js';
import type {AskContext} from '../src/ask/types.js';

const specs = mkdtempSync(join(tmpdir(), 'nmsh-specs-'));
test.after(() => rmSync(specs, {recursive: true, force: true}));
const PAGE = '# tar\n\n> Archiving utility.\n\n- Create an archive from files:\n\n`tar cf {{target.tar}} {{file1 file2}}`\n\n- Something unrelated:\n\n`rm -rf {{path}}`\n\n- Extract an archive:\n\n`tar xf {{source.tar}}`\n';
const context = {cwd: '/r', home: '/h', worktrees: [], shell: 'zsh', defaultShell: 'zsh', shells: [], sessions: [], transcripts: [], recentFiles: [], recentCommands: [],
  editor: {label: 'Zed', available: true}, providers: [], sessionMode: 'service', now: 0} as AskContext;
const env = (examples?: CommandEnvironment['examples']): CommandEnvironment => ({reference: new CommandReference(new BundledCatalog(), new DeclarativeSpecSource(specs)),
  identity: name => name === 'tar' ? {kind: 'executable', path: '/usr/bin/tar'} : undefined, ...(examples ? {examples} : {}), install: name => name === 'tldr' ? {tool: 'tealdeer', label: 'brew install tealdeer'} : undefined});

test('TLDR pages: examples of this command only; placeholders shown as <...>', () => {
  assert.deepEqual(parseTldrPage(PAGE, 'tar'), [
    {description: 'Create an archive from files', command: 'tar cf <target.tar> <file1 file2>'},
    {description: 'Extract an archive', command: 'tar xf <source.tar>'},
  ]);
  assert.deepEqual(parseTldrPage('garbage', 'tar'), []);
});

test('examples requests use TLDR when present and fall back cleanly when not', () => {
  assert.deepEqual(parseCommandQuestion('show examples of tar'), {intent: 'examples', words: ['tar']});
  assert.deepEqual(parseCommandQuestion('tar examples'), {intent: 'examples', words: ['tar']});
  const withTldr = resolveRequest('show examples of tar', context, {}, env(() => parseTldrPage(PAGE, 'tar')));
  assert.match((withTldr as {text: string}).text, /Examples from TLDR\n {2}Create an archive from files\n {4}tar cf <target\.tar> <file1 file2>/u);
  const without = resolveRequest('show examples of tar', context, {}, env());
  assert.match((without as {text: string}).text, /^tar: /u, 'built-in knowledge still answers');
  assert.match((without as {text: string}).text, /No local TLDR examples for tar\./u);
  assert.ok((without as {next?: Array<{label: string}>}).next?.some(option => option.label === 'Install tealdeer for TLDR examples'), 'install offered only through the curated recipe');
  assert.ok(TOOLS.some(tool => tool.id === 'tealdeer' && tool.executable === 'tldr' && tool.package === 'tealdeer'), 'tealdeer is a curated /tools entry');
});
