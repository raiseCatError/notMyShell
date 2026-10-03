import test from 'node:test';
import assert from 'node:assert/strict';
import {commandIdentity, isInternalHelper, rankCommandCandidates, usageScore, type CompletionCandidate, type CompletionSource} from '../src/shell/completion.js';
import {COMPLETION_VIEWPORT, completionIcon, completionMenuRows, completionTypeLabel, renderCompletion, renderCompletionMore} from '../src/shell/CompletionMenu.js';
import {CompletionService} from '../src/shell/CompletionService.js';
import {CommandDescriptions, identityDescription, manPageCandidates, parseManSummary} from '../src/shell/CommandDescriptions.js';
import {parseConfiguredCompletions} from '../src/shell/ConfiguredCompletion.js';
import {TerminalApp} from '../src/app/TerminalApp.js';
import {historyId} from '../src/shell/HistoryIndex.js';
import {setIconStyle} from '../src/ui/glyphs.js';
import {displayWidth, stripAnsi} from '../src/util/text.js';

const candidate = (value: string, extra: Partial<CompletionCandidate> = {}): CompletionCandidate => ({
  value, display: value, name: value, description: '', kind: 'command', source: 'test', replacement: {start: 0, end: value.length},
  context: {buffer: value, cwd: '/'}, insertion: value, ...extra,
});

test('semantic identity is separate from syntactic kind, from zsh groups and session metadata', () => {
  assert.equal(commandIdentity('alias'), 'alias');
  assert.equal(commandIdentity('shell function'), 'function');
  assert.equal(commandIdentity('builtin command'), 'builtin');
  assert.equal(commandIdentity('reserved word'), 'keyword');
  assert.equal(commandIdentity('external command'), 'executable');
  assert.equal(commandIdentity('local branches'), undefined);
  const fields = (value: string, group: string) => [value, value, '', group, '', '', ''].join('\0') + '\0';
  const parsed = parseConfiguredCompletions(fields('gst', 'alias') + fields('gs', 'shell function'), {buffer: 'g', cwd: '/', cursor: 1});
  assert.deepEqual(parsed.map(item => [item.kind, item.identity]), [['command', 'alias'], ['command', 'function']]);
});

test('types get distinct icons with Safe fallbacks; command and subcommand differ; no redundant [command] label', () => {
  const kinds: CompletionCandidate[] = [
    candidate('ls', {identity: 'executable'}), candidate('ll', {identity: 'alias'}), candidate('mkcd', {identity: 'function'}),
    candidate('cd', {identity: 'builtin'}), candidate('if', {identity: 'keyword'}), candidate('status', {kind: 'subcommand'}),
    candidate('--all', {kind: 'option'}), candidate('README', {kind: 'file'}), candidate('src/', {kind: 'directory'}),
  ];
  for (const mode of ['nerd', 'safe'] as const) {
    setIconStyle(mode);
    try {
      const icons = kinds.map(completionIcon);
      assert.equal(new Set(icons).size, icons.length, `${mode} icons distinct`);
      if (mode === 'safe') assert.ok(icons.every(icon => /^[\x20-\x7e]$/u.test(icon)));
    } finally { setIconStyle('nerd'); }
  }
  assert.equal(completionTypeLabel(kinds[0]!), '', 'executables need no label');
  assert.deepEqual(kinds.slice(1, 5).map(completionTypeLabel), ['alias', 'function', 'builtin', 'keyword']);
  assert.equal(completionTypeLabel(candidate('main', {kind: 'argument', group: 'local branches'})), 'local branches');
  for (const item of kinds) assert.doesNotMatch(stripAnsi(renderCompletion(item, false, 100)), /\[command\]/u);
});

test('selection is a full band with pointer and bright label; descriptions on every row', () => {
  const item = candidate('git', {identity: 'executable', description: 'Distributed version control'});
  const selected = renderCompletion(item, true, 80);
  assert.match(selected, /\u001b\[48;/u, 'selection band');
  assert.equal(displayWidth(selected), 80, 'band spans the row');
  assert.match(stripAnsi(selected), /› \S git +Distributed version control/u);
  assert.match(stripAnsi(renderCompletion(item, false, 80)), /git +Distributed version control/u, 'unselected rows show the description too');
  for (const width of [1, 6, 27, 40, 120]) assert.ok(displayWidth(renderCompletion(item, true, width)) <= width);
});

test('bounded viewport: at most ten candidates plus a factual cue', () => {
  assert.equal(completionMenuRows(4), 4);
  assert.equal(completionMenuRows(COMPLETION_VIEWPORT), COMPLETION_VIEWPORT);
  assert.equal(completionMenuRows(73), COMPLETION_VIEWPORT + 1);
  assert.match(stripAnsi(renderCompletionMore(63, 0, 40)), /↓ 63 more/u);
  assert.match(stripAnsi(renderCompletionMore(0, 63, 40)), /↑ 63 above/u);
  const app = new TerminalApp();
  try {
    Object.defineProperty(app, 'dimensions', {value: () => ({columns: 90, rows: 50})});
    Object.defineProperty(app, 'fetchSuggestions', {value: async () => {}});
    const frames: string[][] = [];
    app['renderer'].render = ((frame: {rows: string[]}) => { frames.push(frame.rows); }) as never;
    app['session'].resize = (() => {}) as never;
    app['onInput']('x');
    app['shellSuggestions'] = Array.from({length: 73}, (_, index) => candidate(`xcmd${index}`, {context: {buffer: 'x', cwd: app['context'].cwd, cursor: 1}})) as never;
    app['render']();
    const rows = frames.at(-1)!.map(stripAnsi);
    assert.equal(rows.filter(row => /xcmd\d+/u.test(row)).length, COMPLETION_VIEWPORT, 'ten rows even with room for more');
    assert.ok(rows.some(row => /↓ 63 more/u.test(row)));
    for (let index = 0; index < 72; index += 1) app['onInput']('\u001b[B');
    app['render']();
    const end = frames.at(-1)!.map(stripAnsi);
    assert.ok(end.some(row => row.includes('xcmd72') && row.includes('›')), 'selection stays visible');
    assert.ok(end.some(row => /↑ 63 above/u.test(row)));
  } finally { app['stop'](0); app['session'].kill(); }
});

test('internal helpers are hidden while typing ordinary names, offered when the word starts with _', async () => {
  assert.equal(isInternalHelper(candidate('_fzf_compgen_path'), 'f'), true);
  assert.equal(isInternalHelper(candidate('__atuin_history'), '_'), false);
  assert.equal(isInternalHelper(candidate('_zoxide_hook', {kind: 'argument'}), 'z'), false, 'only command names');
  const source: CompletionSource = {id: 'test', query: async context => ['_zoxide_hook', 'zoxide', 'zip', '__zsh_helper']
    .filter(name => name.startsWith(context.buffer)).map(name => candidate(name, {context}))};
  const service = new CompletionService(source);
  service.setShellKnowledge(new Map([['_z_internal', 'function'], ['zz', 'alias']]));
  const ordinary = (await service.suggest('z', '/')).map(item => item.value);
  assert.ok(!ordinary.some(name => name.startsWith('_')), ordinary.join(','));
  assert.ok(ordinary.includes('zz'));
  const explicit = (await service.suggest('_', '/')).map(item => item.value);
  assert.ok(explicit.includes('_zoxide_hook') && explicit.includes('_z_internal'), 'still known and offered on request');
  service.dispose();
});

test('ranking: match quality first, then local frecency, deterministic for equal input', async () => {
  const now = Date.UTC(2026, 9, 3);
  const usage = new Map([['gitk', {count: 1, last: now - 90 * 86_400_000}], ['git', {count: 40, last: now - 3_600_000}], ['gist', {count: 12, last: now}]]);
  const list = ['gitk', 'gist', 'git', 'gimp', 'go-gi'].map(name => candidate(name));
  const ranked = rankCommandCandidates(list, 'gi', usage, now).map(item => item.value);
  assert.deepEqual(ranked, ['git', 'gist', 'gitk', 'gimp', 'go-gi']);
  assert.deepEqual(rankCommandCandidates(list, 'gi', usage, now).map(item => item.value), ranked, 'stable');
  assert.deepEqual(rankCommandCandidates(list, 'git', usage, now)[0]!.value, 'git', 'exact match leads');
  assert.ok(usageScore(usage.get('git'), now) > usageScore(usage.get('gitk'), now));
  assert.equal(usageScore(undefined, now), 0);
});

test('usage comes from the eligible history index only: private commands never rank', () => {
  const app = new TerminalApp();
  try {
    const index = app['historyService'].index;
    let at = 1000;
    for (const command of ['ls -la', 'ls', 'lsof -i', ' lspriv secret', 'ls']) index.add({id: historyId('nmsh', `u${at}`), source: 'nmsh', command, at: at++});
    let captured: ReadonlyMap<string, {count: number}> = new Map();
    app['completionService'].setCommandUsage = (usage: ReadonlyMap<string, {count: number; last: number}>) => { captured = usage; };
    app['refreshCommandUsage']();
    assert.equal(captured.get('ls')?.count, 3);
    assert.equal(captured.get('lsof')?.count, 1);
    assert.equal(captured.has('lspriv'), false, 'private (leading space) excluded by the index');
    const before = captured;
    app['refreshCommandUsage']();
    assert.equal(captured, before, 'unchanged history is not recomputed');
  } finally { app['stop'](0); app['session'].kill(); }
});

test('descriptions: structured first, identity fallback never shows bodies, man summaries are parsed locally', async () => {
  assert.equal(identityDescription({identity: 'alias'}), 'Alias in the current zsh session');
  assert.equal(identityDescription({identity: 'function'}), 'Function in the current zsh session');
  assert.equal(identityDescription({identity: 'executable'}), undefined);
  assert.equal(parseManSummary('.Dd x\n.Sh NAME\n.Nm ls\n.Nd list directory contents\n.Sh SYNOPSIS'), 'list directory contents');
  assert.equal(parseManSummary('.TH RG 1\n.SH NAME\nrg \\- recursively search \\fBfiles\\fR\n.SH SYNOPSIS'), 'recursively search files');
  assert.equal(parseManSummary('.SH NAME\nno dash here\n.SH X'), undefined);
  assert.equal(parseManSummary('.SH NAME\nx \\- ok\u001b[31m red\u0007'), 'ok[31m red', 'control characters stripped');
  assert.ok(manPageCandidates('rg', ['/opt/homebrew/bin/rg']).includes('/opt/homebrew/share/man/man1/rg.1'));
  let lookups = 0;
  const descriptions = new CommandDescriptions(async name => { lookups += 1; return name === 'tool' ? 'does a thing' : undefined; });
  assert.equal(descriptions.cached('tool'), undefined, 'never blocks');
  assert.equal(await descriptions.request('tool'), 'does a thing');
  assert.equal(await descriptions.request('tool'), 'does a thing');
  await descriptions.request('missing');
  await descriptions.request('missing');
  assert.equal(lookups, 2, 'hits and misses are both cached');
  assert.equal(await descriptions.request('rm -rf /'), undefined, 'unsafe names are never looked up');
  assert.equal(lookups, 2);
  descriptions.dispose();
  const app = new TerminalApp();
  try {
    app['commandDescriptions'] = descriptions;
    assert.equal(app['completionDescription'](candidate('git', {identity: 'executable'})), 'Distributed version control', 'local knowledge');
    assert.equal(app['completionDescription'](candidate('gco', {identity: 'alias'})), 'Alias in the current zsh session');
    assert.equal(app['completionDescription'](candidate('x', {description: 'from zsh'})), 'from zsh');
  } finally { app['stop'](0); app['session'].kill(); }
});
