import test from 'node:test';
import assert from 'node:assert/strict';
import {buildContextLine, buildPromptLine, FADE_TAIL_GLYPHS} from '../src/prompt/prompt.js';
import {DEFAULT_PROMPT_CONFIGURATION, normalizePromptConfiguration} from '../src/prompt/configuration.js';
import {displayWidth, stripAnsi} from '../src/util/text.js';
import {homedir} from 'node:os';

test('renders sharp, distinct Powerline segments with a right-only fade', () => {
  const rendered = buildPromptLine({cwd: '/tmp/project', project: 'project', branch: 'main'}, 60);
  const plain = stripAnsi(rendered);
  assert.equal(displayWidth(rendered), 60);
  assert.match(plain, /^ project  \/tmp\/project   main ▓▒░ /u);
  assert.equal((plain.match(/[░▒▓]/gu) ?? []).join(''), FADE_TAIL_GLYPHS);
  assert.ok(plain.indexOf(FADE_TAIL_GLYPHS) > plain.indexOf('main'));
  assert.ok(!plain.startsWith('░'));
  assert.ok(!plain.includes(''));
  assert.ok(!plain.includes(''));
  assert.match(rendered, /48;2;84;82;132/u);
  assert.match(rendered, /48;2;52;105;98/u);
});

test('shared context modules render in header and composer placements', () => {
  const configuration = normalizePromptConfiguration({
    placement: 'composer',
    separator: '|',
    spacing: 2,
    modules: [
      {id: 'project', visible: true},
      {id: 'cwd', visible: true},
      {id: 'gitBranch', visible: true, condition: 'inRepository'},
      {id: 'exitStatus', visible: true, condition: 'nonzeroExit'},
    ],
  });
  const context = {cwd: `${homedir()}/Projects/notMyShell`, project: 'notMyShell', branch: 'dev', exitStatus: 3};
  const header = stripAnsi(buildContextLine(context, 100, configuration, 'header'));
  const composer = stripAnsi(buildContextLine(context, 100, configuration, 'composer'));

  assert.match(header, /notMyShell \|  ~\/Projects\/notMyShell \|   dev \|  ✘ 3 ▓▒░/u);
  assert.match(composer, /notMyShell \|  ~\/Projects\/notMyShell \|   dev \|  ✘ 3/u);
  assert.ok(!composer.includes(FADE_TAIL_GLYPHS));
  assert.equal(displayWidth(buildContextLine(context, 100, configuration, 'composer')), displayWidth(stripAnsi(buildContextLine(context, 100, configuration, 'composer'))));
});

test('prompt configuration validates order, conditions, placement, spacing, separators, and colors', () => {
  const configuration = normalizePromptConfiguration({
    placement: 'composer',
    separator: '::',
    spacing: 8,
    modules: [
      {id: 'gitBranch', visible: false, condition: 'always', foreground: '#abcdef'},
      {id: 'cwd', visible: true, condition: 'inRepository', background: '#012345'},
      {id: 'cwd', visible: false},
      {id: 'unknown', visible: true},
    ],
  });
  assert.equal(configuration.placement, 'composer');
  assert.equal(configuration.spacing, 3);
  assert.equal(configuration.separator, '::');
  assert.deepEqual(configuration.modules, [
    {id: 'gitBranch', visible: false, condition: 'always', foreground: '#abcdef'},
    {id: 'cwd', visible: true, condition: 'inRepository', background: '#012345'},
  ]);
  assert.equal(DEFAULT_PROMPT_CONFIGURATION.placement, 'header');
  const customColor = buildContextLine(
    {cwd: `${homedir()}/project`, project: 'repo', branch: 'main'},
    60,
    configuration,
    'composer',
  );
  assert.match(customColor, /48;2;1;35;69m/u);
});

test('prompt context replaces terminal control characters before rendering', () => {
  const rendered = stripAnsi(buildPromptLine({
    cwd: '/tmp/project\u001B[2J',
    project: 'repo\u0007',
    branch: 'main\nbranch',
  }, 80));
  assert.ok(!rendered.includes('\u001B'));
  assert.ok(!rendered.includes('\u0007'));
  assert.ok(rendered.includes('�'));
});

test('never wraps or duplicates metadata at narrow widths', () => {
  for (let width = 4; width <= 30; width += 1) {
    const rendered = buildPromptLine(
      {cwd: '/tmp/notMyShell', project: 'notMyShell', branch: 'very-long-branch-name'},
      width,
    );
    assert.equal(displayWidth(rendered), width, `width ${width}`);
    assert.equal(stripAnsi(rendered).split('\n').length, 1);
  }
});
