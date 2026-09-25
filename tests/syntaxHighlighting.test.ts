import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {TerminalApp} from '../src/app/TerminalApp.js';
import {parseSlashCommand, slashCommands, slashSuggestions} from '../src/commands/slashCommands.js';
import {Highlighter, type TokenType} from '../src/input/Highlighter.js';
import {
  handleSyntaxPanelKey,
  renderSyntaxPanel,
  renderSyntaxPreviewLine,
  SYNTAX_PREVIEW_LINES,
  SYNTAX_PREVIEW_SEMANTICS,
  type SyntaxPanelState,
} from '../src/input/SyntaxPanel.js';
import {resolveSyntaxStyles, styleSgr, syntaxCharStyles, syntaxSgr, TOKEN_TYPES} from '../src/input/syntaxTheme.js';
import {
  DEFAULT_PROMPT_CONFIGURATION,
  DEFAULT_SYNTAX_APPEARANCE,
  loadPromptConfiguration,
  NATIVE_PALETTE_IDS,
  normalizePromptConfiguration,
  normalizeSyntaxAppearance,
  savePromptConfiguration,
  type PromptConfiguration,
  type SyntaxAppearance,
} from '../src/prompt/configuration.js';
import {serializeCopyPayload} from '../src/output/OutputBuffer.js';
import type {CommandType} from '../src/shell/SemanticService.js';
import type {TerminalFrame} from '../src/terminal/TerminalRenderer.js';
import {foreground, UI_COLORS} from '../src/ui/palette.js';
import {stripAnsi} from '../src/util/text.js';

const on = (patch: Partial<SyntaxAppearance> = {}): SyntaxAppearance => ({...DEFAULT_SYNTAX_APPEARANCE, ...patch});
const isGray = ({red, green, blue}: {red: number; green: number; blue: number}) => red === green && green === blue;

async function withApp(run: (app: TerminalApp, path: string) => void | Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'nmsh-syntax-'));
  const previous = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = directory;
  const app = new TerminalApp();
  app['promptConfiguration'] = structuredClone(DEFAULT_PROMPT_CONFIGURATION);
  app['session'].submit = () => {};
  // Semantic lookups never spawn a shell here; the cache is primed per test.
  app['semanticService'].classifyCommand = async (command: string) => app['semanticService'].cache.get(command) ?? 'unknown';
  try {
    await run(app, join(directory, 'nmsh', 'config.json'));
  } finally {
    app['stop'](0);
    app['session'].kill();
    if (previous === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = previous;
    await rm(directory, {recursive: true, force: true});
  }
}

function commandRowAnsi(app: TerminalApp, command: string): string | undefined {
  return app['output'].wrapped(120).filter(row => stripAnsi(row.ansi).includes(command) && !row.isHistoricalHeader).at(-1)?.ansi;
}

// ---- configuration ----

test('syntax configuration defaults to highlighting On, following the prompt theme', () => {
  assert.deepEqual(DEFAULT_PROMPT_CONFIGURATION.syntax, {highlighting: true, colors: 'followPrompt', theme: 'lavender'});
  assert.deepEqual(normalizePromptConfiguration({}).syntax, DEFAULT_SYNTAX_APPEARANCE);
});

test('invalid syntax values normalize safely', () => {
  assert.deepEqual(normalizeSyntaxAppearance({highlighting: 'yes', colors: 'rainbow', theme: 'neon'}), DEFAULT_SYNTAX_APPEARANCE);
  assert.deepEqual(normalizeSyntaxAppearance(null), DEFAULT_SYNTAX_APPEARANCE);
  assert.equal(normalizeSyntaxAppearance({theme: 'semantic'}).theme, 'brand', 'retired theme ids keep working');
});

test('a chosen syntax theme persists; older configs gain defaults without repeating onboarding', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'nmsh-syntax-config-'));
  const path = join(directory, 'config.json');
  try {
    await writeFile(path, JSON.stringify({onboardingComplete: true, glyphStyle: 'safe', prompt: {provider: 'starship', nmsh: {palette: 'warm'}}}));
    const old = loadPromptConfiguration(path);
    assert.deepEqual(old.syntax, DEFAULT_SYNTAX_APPEARANCE);
    assert.equal(old.onboardingComplete, true);
    assert.equal(old.glyphStyle, 'safe');
    assert.equal(old.provider, 'starship');
    assert.equal(old.nmsh.palette, 'warm');

    savePromptConfiguration({...old, syntax: {highlighting: false, colors: 'theme', theme: 'cool'}}, path);
    const reloaded = loadPromptConfiguration(path);
    assert.deepEqual(reloaded.syntax, {highlighting: false, colors: 'theme', theme: 'cool'});
    assert.equal(reloaded.nmsh.palette, 'warm', 'unrelated settings are untouched');
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});

// ---- style resolver ----

test('default Follow prompt on Lavender Native reproduces the pre-#68 editor colors exactly', () => {
  const sgr = syntaxSgr(on(), 'lavender');
  const legacy: Record<TokenType, string> = {
    Command: foreground(UI_COLORS.primary), KnownCommand: foreground(UI_COLORS.accent), Builtin: foreground(UI_COLORS.accent),
    Alias: foreground(UI_COLORS.accent), Function: foreground(UI_COLORS.accent), UnknownCommand: foreground(UI_COLORS.failure),
    Argument: foreground(UI_COLORS.primary), String: foreground({red: 198, green: 156, blue: 109}), Variable: foreground(UI_COLORS.accent),
    Operator: foreground(UI_COLORS.subtle), Path: foreground(UI_COLORS.secondary), Flag: foreground(UI_COLORS.secondary),
    Comment: foreground(UI_COLORS.subtle), Normal: foreground(UI_COLORS.primary),
  };
  assert.deepEqual({...sgr}, legacy);
});

test('every token type has a deterministic style in every mode and theme', () => {
  const modes: SyntaxAppearance[] = [on(), on({colors: 'grayscale'}), on({highlighting: false}),
    ...NATIVE_PALETTE_IDS.map(theme => on({colors: 'theme', theme}))];
  for (const mode of modes) {
    for (const palette of NATIVE_PALETTE_IDS) {
      const first = resolveSyntaxStyles(mode, palette);
      const second = resolveSyntaxStyles(mode, palette);
      for (const type of TOKEN_TYPES) {
        assert.ok(first[type]?.foreground, `${type} has a style`);
        assert.deepEqual(first[type], second[type]);
      }
    }
  }
});

test('Follow prompt uses the prompt palette; Choose theme ignores it', () => {
  assert.notEqual(syntaxSgr(on(), 'cool').KnownCommand, syntaxSgr(on(), 'warm').KnownCommand);
  const chosen = on({colors: 'theme', theme: 'cool'});
  assert.equal(syntaxSgr(chosen, 'grayscale').KnownCommand, syntaxSgr(chosen, 'warm').KnownCommand);
  assert.equal(syntaxSgr(chosen, 'grayscale').KnownCommand, syntaxSgr(on(), 'cool').KnownCommand,
    'a chosen theme looks the same as following a prompt with that theme');
});

test('Grayscale has no hue yet keeps categories distinguishable', () => {
  for (const palette of NATIVE_PALETTE_IDS) {
    const styles = resolveSyntaxStyles(on({colors: 'grayscale'}), palette);
    assert.deepEqual(styles, resolveSyntaxStyles(on({colors: 'grayscale'}), 'lavender'), 'no palette dependence');
    for (const type of TOKEN_TYPES) assert.ok(isGray(styles[type].foreground), `${type} is gray`);
    const distinct = new Set(TOKEN_TYPES.map(type => styleSgr(styles[type])));
    assert.ok(distinct.size >= 7, 'lightness and weight carry distinctions');
    assert.ok(styles.UnknownCommand.underline, 'unknown commands keep a failure signal without color');
    assert.ok(styles.KnownCommand.bold);
  }
});

test('UnknownCommand keeps failure semantics and Comment stays subdued', () => {
  for (const palette of NATIVE_PALETTE_IDS) {
    const styles = resolveSyntaxStyles(on(), palette);
    assert.notDeepEqual(styles.UnknownCommand, styles.KnownCommand, `${palette}: unknown differs from known`);
    assert.notDeepEqual(styles.UnknownCommand, styles.Command);
    const luminance = ({red, green, blue}: {red: number; green: number; blue: number}) => red + green + blue;
    assert.ok(luminance(styles.Comment.foreground) < luminance(styles.Argument.foreground), `${palette}: comment dimmer than text`);
  }
  const unknown = resolveSyntaxStyles(on(), 'cool').UnknownCommand.foreground;
  assert.ok(unknown.red > unknown.blue, 'error reads as red-ish');
});

test('Highlighting Off renders every token as plain input text', () => {
  const sgr = syntaxSgr(on({highlighting: false}), 'cool');
  for (const type of TOKEN_TYPES) assert.equal(sgr[type], foreground(UI_COLORS.primary));
});

test('style resolution never changes token classification', () => {
  const highlighter = new Highlighter();
  const cache = new Map<string, CommandType>([['git', 'executable']]);
  const characters = [...'git commit -m "x" # note'];
  const tokens = highlighter.tokenize(characters, cache);
  const offStyles = syntaxCharStyles(tokens, characters.length, syntaxSgr(on({highlighting: false}), 'lavender'));
  assert.equal(offStyles.length, characters.length);
  assert.deepEqual(highlighter.tokenize(characters, cache).map(token => token.type), tokens.map(token => token.type));
});

// ---- live editor ----

async function liveFrame(app: TerminalApp, text: string): Promise<string> {
  const frames: TerminalFrame[] = [];
  app['renderer'].render = frame => frames.push(frame);
  app['editor'].insert(text);
  app['render']();
  const row = frames.at(-1)!.rows.find(candidate => stripAnsi(candidate).includes(text.split('\n')[0]!));
  assert.ok(row, 'composer row rendered');
  return row;
}

test('the live editor styles every token type through the resolver', () => withApp(async app => {
  const cache = app['semanticService'].cache;
  for (const [word, type] of SYNTAX_PREVIEW_SEMANTICS) cache.set(word, type);
  app['promptConfiguration'] = {...app['promptConfiguration'], nmsh: {...app['promptConfiguration'].nmsh, palette: 'cool'}};
  const sgr = syntaxSgr(on(), 'cool');
  const row = await liveFrame(app, 'git -v "s" $X ~/p | ll; echo; greet; unknown-cmd arg # c');
  const expect = (text: string, type: TokenType) => assert.ok(row.includes(`${sgr[type]}${text[0]}`), `${type} (${text}) styled`);
  expect('git', 'KnownCommand');
  expect('-v', 'Flag');
  expect('"s"', 'String');
  expect('$X', 'Variable');
  expect('~/p', 'Path');
  expect('|', 'Operator');
  expect('ll', 'Alias');
  expect('echo', 'Builtin');
  expect('greet', 'Function');
  expect('unknown-cmd', 'UnknownCommand');
  expect('arg', 'Argument');
  expect('#', 'Comment');
}));

test('an unresolved command renders as Command, then restyles when semantics arrive', () => withApp(async app => {
  let resolve!: (type: CommandType) => void;
  app['semanticService'].classifyCommand = (command: string) => new Promise(done => {
    resolve = type => { app['semanticService'].cache.set(command, type); done(type); };
  });
  const sgr = syntaxSgr(on(), 'lavender');
  const before = await liveFrame(app, 'mytool');
  assert.ok(before.includes(`${sgr.Command}m`), 'unresolved command uses the Command style without waiting');
  const frames: TerminalFrame[] = [];
  app['renderer'].render = frame => frames.push(frame);
  resolve('builtin');
  await new Promise(done => setImmediate(done));
  const after = frames.at(-1)!.rows.find(row => stripAnsi(row).includes('mytool'))!;
  assert.ok(after.includes(`${sgr.Builtin}m`), 'resolution restyles the live input');
}));

test('changing the prompt theme restyles live input under Follow prompt only', () => withApp(async app => {
  app['semanticService'].cache.set('git', 'executable');
  const withPalette = (palette: PromptConfiguration['nmsh']['palette'], syntax = on(), provider: PromptConfiguration['provider'] = 'nmsh') => {
    app['promptConfiguration'] = {...app['promptConfiguration'], provider, syntax, nmsh: {...app['promptConfiguration'].nmsh, palette}};
  };
  withPalette('warm');
  assert.ok((await liveFrame(app, 'git')).includes(syntaxSgr(on(), 'warm').KnownCommand));
  withPalette('cool', on(), 'starship');
  const external = app['syntaxSgr'];
  assert.equal(external.KnownCommand, syntaxSgr(on(), 'cool').KnownCommand, 'external providers follow the saved Native palette');
  withPalette('grayscale', on({colors: 'theme', theme: 'cool'}));
  assert.equal(app['syntaxSgr'].KnownCommand, syntaxSgr(on(), 'cool').KnownCommand, 'Choose theme is independent of the prompt');
  assert.deepEqual(app['promptConfiguration'].syntax, on({colors: 'theme', theme: 'cool'}), 'syntax theme is not mutated');
}));

test('Highlighting Off leaves live input uncolored without touching the text', () => withApp(async app => {
  app['semanticService'].cache.set('git', 'executable');
  app['promptConfiguration'] = {...app['promptConfiguration'], syntax: on({highlighting: false})};
  const row = await liveFrame(app, 'git status "x"');
  assert.ok(!row.includes(foreground(UI_COLORS.accent) + 'g'), 'no command accent');
  assert.ok(row.includes(`${foreground(UI_COLORS.primary)}g`));
  assert.equal(app['editor'].text, 'git status "x"');
}));

// ---- history ----

test('submitted commands keep their captured style when syntax settings change', () => withApp(async app => {
  app['semanticService'].cache.set('git', 'executable');
  app['promptConfiguration'] = {...app['promptConfiguration'], syntax: on({colors: 'theme', theme: 'cool'})};
  app['editor'].insert('git status');
  await app['submit']();
  const cool = commandRowAnsi(app, 'git status')!;
  assert.ok(cool.includes(syntaxSgr(on(), 'cool').KnownCommand));

  app['promptConfiguration'] = {...app['promptConfiguration'], syntax: on({colors: 'grayscale'})};
  assert.equal(commandRowAnsi(app, 'git status'), cool, 'old history is not recolored');

  app['output'].complete(0);
  app['running'] = undefined;
  app['editor'].insert('git log');
  await app['submit']();
  assert.ok(commandRowAnsi(app, 'git log')!.includes(syntaxSgr(on({colors: 'grayscale'}), 'lavender').KnownCommand), 'new commands use the new style');
}));

test('late semantic resolution restyles history with the style captured at submission', () => withApp(async app => {
  let resolve!: () => void;
  app['semanticService'].classifyCommand = (command: string) => new Promise(done => {
    resolve = () => { app['semanticService'].cache.set(command, 'executable'); done('executable'); };
  });
  app['promptConfiguration'] = {...app['promptConfiguration'], syntax: on({colors: 'theme', theme: 'warm'})};
  app['editor'].insert('slowtool run');
  await app['submit']();
  app['promptConfiguration'] = {...app['promptConfiguration'], syntax: on({highlighting: false})};
  resolve();
  await new Promise(done => setImmediate(done));
  const row = commandRowAnsi(app, 'slowtool run')!;
  assert.ok(row.includes(`${syntaxSgr(on(), 'warm').KnownCommand}s`), 'resolved with the submitted Warm First style, not the new Off setting');
}));

test('Highlighting Off affects only newly submitted commands and never the command text', () => withApp(async app => {
  const sent: string[] = [];
  app['session'].submit = command => { sent.push(command); };
  app['semanticService'].cache.set('git', 'executable');
  app['editor'].insert('git status');
  await app['submit']();
  const colored = commandRowAnsi(app, 'git status')!;
  app['output'].complete(0);
  app['running'] = undefined;

  app['promptConfiguration'] = {...app['promptConfiguration'], syntax: on({highlighting: false})};
  app['editor'].insert('git diff "a b"');
  await app['submit']();
  assert.deepEqual(sent, ['git status', 'git diff "a b"']);
  assert.equal(commandRowAnsi(app, 'git status'), colored);
  const plainRow = commandRowAnsi(app, 'git diff')!;
  assert.ok(!plainRow.includes(foreground(UI_COLORS.accent) + 'g'));
  assert.ok(!plainRow.includes(foreground({red: 198, green: 156, blue: 109})));
}));

// ---- /copy and PTY ----

test('/copy stays plain text and PTY output is never recolored', () => withApp(async app => {
  app['semanticService'].cache.set('git', 'executable');
  app['promptConfiguration'] = {...app['promptConfiguration'], syntax: on({colors: 'theme', theme: 'cool'})};
  app['editor'].insert('git status');
  await app['submit']();
  const ptyAnsi = '\u001B[32mOn branch main\u001B[0m';
  app['output'].write(`${ptyAnsi}\r\n`);
  const record = app['output'].complete(0)!;
  const payload = serializeCopyPayload(record);
  assert.ok(!payload.includes('\u001B['), 'no ANSI in /copy');
  assert.ok(payload.includes('On branch main'));
  const outputRow = app['output'].wrapped(120).find(row => row.plain.includes('On branch main'))!;
  assert.ok(outputRow.ansi.includes('\u001B[32m'), 'the program\'s own color survives');
  for (const sgr of Object.values(syntaxSgr(on(), 'cool'))) {
    assert.ok(!outputRow.ansi.includes(`${sgr}On`), 'no syntax style applied to output');
  }
}));

// ---- /syntax ----

test('/syntax is a registered slash command that never reaches zsh', () => withApp(async app => {
  assert.deepEqual(parseSlashCommand('/syntax'), {kind: 'syntax'});
  assert.ok(slashCommands.some(command => command.name === '/syntax'));
  assert.ok(slashSuggestions('/syn').some(command => command.name === '/syntax'));
  const sent: string[] = [];
  app['session'].submit = command => { sent.push(command); };
  app['editor'].insert('/syntax');
  await app['submit']();
  assert.deepEqual(sent, []);
  assert.ok(app['syntaxPanelState'], 'opens the syntax panel');
  assert.deepEqual(app['syntaxPanelState']!.draft, DEFAULT_SYNTAX_APPEARANCE);
  app['handleKey']({kind: 'escape'});
  assert.equal(app['syntaxPanelState'], undefined);
  assert.equal(app['settingsPanelState'], undefined, 'direct Esc closes to the composer');
}));

test('the syntax panel edits, previews, and persists its rows', () => withApp(async (app, path) => {
  app['startSyntaxSettings']();
  const state = app['syntaxPanelState']!;
  const panel = () => renderSyntaxPanel(state, 120, 'lavender').map(stripAnsi);
  assert.ok(panel().some(row => /Highlighting\s+‹ On ›/u.test(row)));
  assert.ok(panel().some(row => /Colors\s+‹ Follow prompt theme ›/u.test(row)));
  assert.ok(!panel().some(row => /^\s*›?\s*Theme\s+‹/u.test(row)), 'Theme row hidden outside Choose theme');

  app['handleKey']({kind: 'down'});
  app['handleKey']({kind: 'right'});
  assert.equal(state.draft.colors, 'theme');
  assert.ok(panel().some(row => /Theme\s+‹ Lavender Native ›/u.test(row)));
  assert.ok(panel().some(row => row.includes('Syntax themes')), 'theme gallery shown');
  app['handleKey']({kind: 'down'});
  app['handleKey']({kind: 'right'});
  app['handleKey']({kind: 'right'});
  assert.equal(state.draft.theme, 'cool');
  assert.ok(panel().some(row => row.includes('unsaved preview')));
  const preview = renderSyntaxPanel(state, 120, 'lavender').find(row => stripAnsi(row).includes('git commit'))!;
  assert.ok(preview.includes(syntaxSgr(on(), 'cool').KnownCommand), 'preview updates with the draft');
  assert.deepEqual(app['promptConfiguration'].syntax, DEFAULT_SYNTAX_APPEARANCE, 'draft is not live until saved');

  app['handleKey']({kind: 'enter'});
  assert.equal(app['syntaxPanelState'], undefined);
  assert.deepEqual(app['promptConfiguration'].syntax, {highlighting: true, colors: 'theme', theme: 'cool'});
  assert.deepEqual(JSON.parse(await readFile(path, 'utf8')).syntax, {highlighting: true, colors: 'theme', theme: 'cool'});

  app['startSyntaxSettings']();
  app['handleKey']({kind: 'right'});
  assert.equal(app['syntaxPanelState']!.draft.highlighting, false);
  assert.deepEqual(renderSyntaxPanel(app['syntaxPanelState']!, 120, 'lavender').map(stripAnsi).filter(row => /‹/u.test(row)).length, 1,
    'Off hides the Colors and Theme controls');
  app['handleKey']({kind: 'enter'});
  assert.equal(app['promptConfiguration'].syntax.highlighting, false);
}));

test('Colors cycles Follow prompt theme → Choose theme → Grayscale', () => {
  const state: SyntaxPanelState = {selectedIndex: 1, draft: on(), saved: on()};
  const seen = [state.draft.colors];
  for (let step = 0; step < 3; step++) {
    handleSyntaxPanelKey({kind: 'right'}, state);
    seen.push(state.draft.colors);
  }
  assert.deepEqual(seen, ['followPrompt', 'theme', 'grayscale', 'followPrompt']);
});

test('the preview uses the real highlighter with fixed semantics and never runs commands', () => withApp(async app => {
  let lookups = 0;
  app['semanticService'].classifyCommand = async () => { lookups++; return 'unknown'; };
  const sent: string[] = [];
  app['session'].submit = command => { sent.push(command); };
  app['startSyntaxSettings']();
  app['renderer'].render = () => {};
  app['render']();
  assert.equal(sent.length, 0);
  assert.equal(lookups, 0);
  const line = renderSyntaxPreviewLine(SYNTAX_PREVIEW_LINES[1], on(), 'lavender');
  const sgr = syntaxSgr(on(), 'lavender');
  assert.ok(line.includes(`${sgr.UnknownCommand}u`));
  assert.ok(line.includes(`${sgr.Variable}$`));
  assert.equal(stripAnsi(line), SYNTAX_PREVIEW_LINES[1]);
}));

test('/syntax opened from Settings returns to Settings on Esc', () => withApp(app => {
  app['settingsPanelState'] = {section: 'root', view: 'settings', selectedIndex: 0, contentIndex: 4, glyphStyle: 'nerd', onboarding: false};
  app['handleKey']({kind: 'enter'});
  assert.ok(app['syntaxPanelState']);
  app['handleKey']({kind: 'escape'});
  assert.equal(app['syntaxPanelState'], undefined);
  assert.equal(app['settingsPanelState']?.view, 'settings');
  assert.equal(app['settingsPanelState']?.contentIndex, 4);
}));
