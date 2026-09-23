import test from 'node:test';
import assert from 'node:assert/strict';
import {buildContextLine, buildInlineContextPrefix, buildPromptLine, FADE_TAIL_GLYPHS} from '../src/prompt/prompt.js';
import {DEFAULT_PROMPT_CONFIGURATION, normalizePromptConfiguration} from '../src/prompt/configuration.js';
import {displayWidth, stripAnsi} from '../src/util/text.js';
import {homedir} from 'node:os';

test('renders neutral-gap Powerline blocks with owned caps and a right-only fade', () => {
  const rendered = buildPromptLine({cwd: '/tmp/project', project: 'project', branch: 'main'}, 60);
  const plain = stripAnsi(rendered);
  assert.equal(displayWidth(rendered), 60);
  assert.match(plain, /^ project   \/tmp\/project    main ▓▒░ /u);
  assert.equal((plain.match(/[░▒▓]/gu) ?? []).join(''), FADE_TAIL_GLYPHS);
  assert.ok(plain.indexOf(FADE_TAIL_GLYPHS) > plain.indexOf('main'));
  assert.ok(!plain.startsWith('░'));
  assert.ok(plain.includes(''));
  assert.match(rendered, /48;2;84;82;132/u);
  assert.match(rendered, /48;2;52;105;98/u);
});

test('shared context modules render in header and composer placements', () => {
  const configuration = normalizePromptConfiguration({
    placement: 'composer',
    separator: '|',
    spacing: 2,
    gap: 1,
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

  assert.match(header, /  notMyShell     ~\/Projects\/notMyShell      dev     ✘ 3  ▓▒░/u);
  assert.match(composer, /  notMyShell     ~\/Projects\/notMyShell      dev     ✘ 3/u);
  assert.ok(!composer.includes(FADE_TAIL_GLYPHS));
  assert.equal(displayWidth(buildContextLine(context, 100, configuration, 'composer')), displayWidth(stripAnsi(buildContextLine(context, 100, configuration, 'composer'))));
});

test('prompt configuration validates order, conditions, placement, spacing, gap, separators, and colors', () => {
  const configuration = normalizePromptConfiguration({
    placement: 'composer',
    separator: '::',
    spacing: 8,
    gap: 8,
    modules: [
      {id: 'gitBranch', visible: false, condition: 'always', foreground: '#abcdef'},
      {id: 'cwd', visible: true, condition: 'inRepository', background: '#012345'},
      {id: 'cwd', visible: false},
      {id: 'unknown', visible: true},
    ],
  });
  assert.equal(configuration.placement, 'composer');
  assert.equal(configuration.spacing, 3);
  assert.equal(configuration.gap, 3);
  assert.equal(configuration.separator, '::');
  assert.deepEqual(configuration.modules, [
    {id: 'gitBranch', visible: false, condition: 'always', foreground: '#abcdef'},
    {id: 'cwd', visible: true, condition: 'inRepository', background: '#012345'},
  ]);
  assert.equal(DEFAULT_PROMPT_CONFIGURATION.placement, 'header');
  assert.equal(DEFAULT_PROMPT_CONFIGURATION.composerLayout, 'twoLine');
  assert.equal(normalizePromptConfiguration({spacing: 2}).gap, 1, 'legacy configs use the subtle default gap');
  assert.equal(normalizePromptConfiguration({placement: 'composer'}).composerLayout, 'twoLine', 'legacy configs keep the existing two-line layout');
  const customColor = buildContextLine(
    {cwd: `${homedir()}/project`, project: 'repo', branch: 'main'},
    60,
    configuration,
    'composer',
  );
  assert.match(customColor, /48;2;1;35;69m/u);
});

test('composer layout accepts oneLine and safely defaults invalid values to twoLine', () => {
  assert.equal(normalizePromptConfiguration({composerLayout: 'oneLine'}).composerLayout, 'oneLine');
  assert.equal(normalizePromptConfiguration({composerLayout: 'twoLine'}).composerLayout, 'twoLine');
  assert.equal(normalizePromptConfiguration({composerLayout: 'compact'}).composerLayout, 'twoLine');
  assert.equal(normalizePromptConfiguration({}).composerLayout, 'twoLine');
});

test('inline context prefix combines shared modules and prompt while yielding width to editable input', () => {
  const configuration = normalizePromptConfiguration({
    composerLayout: 'oneLine',
    placement: 'header',
    modules: [
      {id: 'project', visible: true, condition: 'always'},
      {id: 'cwd', visible: true, condition: 'always'},
      {id: 'gitBranch', visible: true, condition: 'inRepository'},
      {id: 'exitStatus', visible: true, condition: 'nonzeroExit'},
    ],
  });
  const context = {cwd: '/tmp/work', project: 'work', branch: 'dev', exitStatus: 7};
  const prefix = buildInlineContextPrefix(context, 80, configuration);
  const plain = stripAnsi(prefix);
  assert.match(plain, /work .*\/tmp\/work .* dev .*✘ 7  ❯ $/u);
  assert.ok(displayWidth(prefix) <= 79);
  assert.equal(plain.split('\n').length, 1);

  const hiddenModules = normalizePromptConfiguration({composerLayout: 'oneLine', modules: []});
  assert.match(stripAnsi(buildInlineContextPrefix(context, 40, hiddenModules)), /^❯ $/u);
  const reordered = normalizePromptConfiguration({
    composerLayout: 'oneLine',
    separator: '|',
    gap: 2,
    spacing: 0,
    modules: [
      {id: 'gitBranch', visible: true, condition: 'inRepository'},
      {id: 'cwd', visible: true, condition: 'always'},
      {id: 'exitStatus', visible: true, condition: 'nonzeroExit'},
    ],
  });
  const reorderedPlain = stripAnsi(buildInlineContextPrefix(context, 80, reordered));
  assert.ok(reorderedPlain.indexOf(' dev') < reorderedPlain.indexOf('/tmp/work'));
  assert.ok(reorderedPlain.includes('dev  /tmp/work'), reorderedPlain);
  assert.ok(reorderedPlain.includes('✘ 7 ❯'), reorderedPlain);
  for (let width = 4; width <= 30; width += 1) {
    const narrow = buildInlineContextPrefix({
      cwd: '/tmp/a-long-working-directory',
      project: 'a-long-project-name',
      branch: 'a-long-feature-branch',
    }, width, configuration);
    assert.ok(displayWidth(narrow) <= width - 1, `width ${width}`);
    assert.ok(stripAnsi(narrow).endsWith('❯ '), `width ${width}`);
    assert.doesNotMatch(stripAnsi(narrow), /(?:||>|<)…/u, `width ${width} must not leave a dangling Powerline cap`);
  }
});

test('neutral gap separates pointed blocks independently from internal padding', () => {
  const context = {cwd: '/tmp/work', project: 'repo', branch: 'main', exitStatus: 2};
  const config = normalizePromptConfiguration({
    placement: 'header',
    gap: 2,
    spacing: 0,
    modules: [
      {id: 'project', visible: true},
      {id: 'cwd', visible: true, background: '#346962'},
      {id: 'exitStatus', visible: true, condition: 'nonzeroExit', background: '#346962'},
    ],
  });
  const header = buildContextLine(context, 100, config, 'header');
  const plain = stripAnsi(header);
  assert.ok(plain.includes('repo  /tmp/work  ✘ 2'), plain);
  assert.match(header, /\u001B\[0m\u001B\[49m  \u001B\[38;2;52;105;98m\u001B\[38;2;245;244;250m\u001B\[48;2;52;105;98m/u);
  assert.equal(displayWidth(header), 100);
  const composer = buildContextLine(context, 100, config, 'composer');
  assert.ok(displayWidth(composer) <= 100);
  assert.equal(stripAnsi(composer).split('\n').length, 1);

  const noBranch = {...context, branch: undefined, exitStatus: 0};
  const hidden = stripAnsi(buildContextLine(noBranch, 100, config, 'composer'));
  assert.equal((hidden.match(//gu) ?? []).length, 1, 'hidden conditional modules do not leave phantom gaps or caps');
});

test('safe glyph mode uses simple reverse/forward caps and home does not repeat project and cwd', () => {
  process.env.NMSH_ICONS = 'safe';
  try {
    const home = homedir();
    const rendered = stripAnsi(buildContextLine({cwd: home, project: '~'}, 40, DEFAULT_PROMPT_CONFIGURATION, 'composer'));
    assert.equal(rendered, ' ~ ');
    const blocks = stripAnsi(buildContextLine({cwd: '/tmp/work', project: 'work', branch: 'dev'}, 80, DEFAULT_PROMPT_CONFIGURATION, 'composer'));
    assert.match(blocks, /^ work > < \/tmp\/work > < git: dev $/u);
  } finally {
    delete process.env.NMSH_ICONS;
  }
});

test('duplicate HOME location keeps the live project color and distinct locations keep their own colors', () => {
  const home = buildContextLine({cwd: homedir(), project: '~'}, 50, DEFAULT_PROMPT_CONFIGURATION, 'composer');
  assert.equal(stripAnsi(home), ' ~ ');
  assert.match(home, /\u001B\[48;2;84;82;132m/u);
  assert.doesNotMatch(home, /\u001B\[48;2;69;73;94m/u);

  const distinct = buildPromptLine({cwd: `${homedir()}/Projects`, project: 'Projects', branch: 'dev'}, 80);
  assert.match(distinct, /\u001B\[48;2;84;82;132m/u);
  assert.match(distinct, /\u001B\[48;2;69;73;94m/u);
  assert.match(distinct, /\u001B\[48;2;52;105;98m/u);
  assert.doesNotMatch(distinct, /\u001B\[48;2;82;73;111m/u, 'archive palette must stay out of live prompt');
});

test('each edge and the density fade use terminal-neutral background', () => {
  const context = {cwd: '/tmp/work', project: 'work', branch: 'dev'};
  for (const placement of ['header', 'composer'] as const) {
    const rendered = buildContextLine(context, 90, DEFAULT_PROMPT_CONFIGURATION, placement);
    assert.match(rendered, /\u001B\[0m\u001B\[49m\u001B\[38;2;84;82;132m\u001B\[0m\u001B\[49m \u001B\[38;2;69;73;94m/u);
    assert.match(rendered, /\u001B\[0m\u001B\[49m\u001B\[38;2;69;73;94m\u001B\[0m\u001B\[49m \u001B\[38;2;52;105;98m/u);
    if (placement === 'header') {
      assert.match(rendered, /\u001B\[0m\u001B\[49m\u001B\[38;2;52;105;98m▓▒░ \u001B\[38;2;139;132;178m─/u);
    } else {
      assert.doesNotMatch(stripAnsi(rendered), /▓▒░|─/u);
    }
  }
});

test('header width fitting counts its fade once and keeps available modules', () => {
  const rendered = buildPromptLine({cwd: '/cwd', project: 'p', branch: 'b'}, 25);
  assert.equal(displayWidth(rendered), 25);
  assert.match(stripAnsi(rendered), / p   \/cwd    b ▓▒░/u);
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
    assert.doesNotMatch(stripAnsi(rendered), /(?:||>|<)…/u, `width ${width} must not leave a dangling Powerline cap`);
  }
});
