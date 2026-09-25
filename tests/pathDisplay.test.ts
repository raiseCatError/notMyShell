import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, rm} from 'node:fs/promises';
import {homedir, tmpdir} from 'node:os';
import {join} from 'node:path';
import {displayPath, PATH_DISPLAY_LEVELS, resolvePathAbbreviations, uniquePrefix} from '../src/prompt/pathDisplay.js';
import {buildContextLine, nativePromptSnapshot, renderedModules} from '../src/prompt/prompt.js';
import {DEFAULT_PROMPT_CONFIGURATION} from '../src/prompt/configuration.js';
import {displayWidth, stripAnsi} from '../src/util/text.js';

const home = '/Users/test';
const repo = {cwd: '/Users/test/Projects/work/notMyShell/src/prompt', home, root: '/Users/test/Projects/work/notMyShell'};

test('levels shorten parents first, keep the repository and final directory whole, then collapse', () => {
  assert.deepEqual(Array.from({length: PATH_DISPLAY_LEVELS}, (_, level) => displayPath(repo, level)), [
    '~/Projects/work/notMyShell/src/prompt',
    '~/P/w/notMyShell/src/prompt',
    '~/P/w/notMyShell/s/prompt',
    '…/notMyShell/…/prompt',
    '…/prompt',
  ]);
});

test('outside a repository only the final directory is kept whole', () => {
  const input = {cwd: '/Users/test/Documents/notes/2026', home};
  assert.equal(displayPath(input, 0), '~/Documents/notes/2026');
  assert.equal(displayPath(input, 1), '~/D/n/2026');
  assert.equal(displayPath(input, 3), '…/2026');
  assert.equal(displayPath({cwd: '/var/log/nginx', home}, 1), '/v/l/nginx');
  assert.equal(displayPath({cwd: '/var/log/nginx', home}, 3), '…/nginx');
});

test('HOME, root, trailing slashes, and the repository root itself stay intuitive', () => {
  assert.equal(displayPath({cwd: home, home}, 3), '~');
  assert.equal(displayPath({cwd: `${home}/`, home}, 0), '~');
  assert.equal(displayPath({cwd: '/', home}, 3), '/');
  assert.equal(displayPath({cwd: '/Users/testing/x', home}, 0), '/Users/testing/x', 'a sibling of HOME is not under HOME');
  const atRoot = {cwd: repo.root, home, root: repo.root};
  assert.equal(displayPath(atRoot, 2), '~/P/w/notMyShell');
  assert.equal(displayPath(atRoot, 3), '…/notMyShell');
  assert.equal(displayPath(atRoot, 4), '…/notMyShell');
  assert.equal(displayPath({cwd: '/Users/test/.config/nvim/lua', home}, 1), '~/.c/n/lua', 'hidden directories keep their dot');
  assert.equal(displayPath({cwd: '/Users/test/a', home, root: '/elsewhere'}, 1), '~/a', 'an unrelated root is ignored');
});

test('known abbreviations avoid ambiguity; unique prefixes are case-insensitive', () => {
  assert.equal(displayPath({...repo, abbreviations: {'/Users/test/Projects': 'Proj', '/Users/test/Projects/work': 'wo'}}, 1),
    '~/Proj/wo/notMyShell/src/prompt');
  assert.equal(uniquePrefix('Projects', ['Pictures', 'Public', 'Projects', 'projects-old']), 'Projects');
  assert.equal(uniquePrefix('Projects', ['Pictures', 'Public', 'Projects']), 'Pr');
  assert.equal(uniquePrefix('Documents', ['Downloads', 'Desktop', 'Documents']), 'Doc');
  assert.equal(uniquePrefix('.config', ['.cache', '.config']), '.co');
  assert.equal(uniquePrefix('only', ['only']), 'o');
});

test('abbreviations resolve from real sibling directories without touching cwd', async () => {
  const base = await mkdtemp(join(tmpdir(), 'nmsh-path-'));
  try {
    await mkdir(join(base, 'Projects', 'app', 'src'), {recursive: true});
    await mkdir(join(base, 'Pictures'));
    await mkdir(join(base, 'Public'));
    const cwd = join(base, 'Projects', 'app', 'src');
    const before = process.cwd();
    const abbreviations = await resolvePathAbbreviations(cwd, base);
    assert.equal(process.cwd(), before);
    assert.deepEqual(abbreviations, {[join(base, 'Projects')]: 'Pr', [join(base, 'Projects', 'app')]: 'a'});
    assert.equal(displayPath({cwd, home: base, abbreviations}, 1), '~/Pr/a/src');
  } finally {
    await rm(base, {recursive: true, force: true});
  }
});

test('the live prompt shortens the path only as the width requires; snapshots keep the full path', () => {
  const context = {cwd: join(homedir(), 'Projects/work/notMyShell/src/prompt'), project: 'notMyShell',
    root: join(homedir(), 'Projects/work/notMyShell'), branch: 'main'};
  const wide = stripAnsi(buildContextLine(context, 160, DEFAULT_PROMPT_CONFIGURATION, 'header'));
  assert.ok(wide.includes('~/Projects/work/notMyShell/src/prompt'));
  const texts = new Set<string>();
  for (let width = 20; width <= 160; width += 1) {
    const line = buildContextLine(context, width, DEFAULT_PROMPT_CONFIGURATION, 'header');
    assert.equal(displayWidth(line), width, `width ${width}`);
    const match = /~\S*prompt|…\/\S*prompt/u.exec(stripAnsi(line));
    if (match) texts.add(match[0]);
  }
  assert.ok(texts.has('~/P/w/notMyShell/src/prompt') && texts.has('…/notMyShell/…/prompt') && texts.has('…/prompt'), [...texts].join(' | '));
  const narrow = stripAnsi(buildContextLine(context, 50, DEFAULT_PROMPT_CONFIGURATION, 'header'));
  assert.ok(narrow.includes('main'), 'shortening the path keeps the branch visible');
  assert.equal(nativePromptSnapshot(context, DEFAULT_PROMPT_CONFIGURATION).segments.find(segment => segment.role === 'cwd')?.text,
    '~/Projects/work/notMyShell/src/prompt', 'history is width-independent');
  assert.equal(renderedModules(context, DEFAULT_PROMPT_CONFIGURATION).find(module => module.role === 'cwd')?.text,
    '~/Projects/work/notMyShell/src/prompt');
});
