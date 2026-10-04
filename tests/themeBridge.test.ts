import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DEFAULT_PROMPT_CONFIGURATION, normalizePromptConfiguration, type PromptConfiguration} from '../src/prompt/configuration.js';
import {addTheme, setActiveTheme} from '../src/appearance/themeLibraryActions.js';
import {assetRef, builtinTheme} from '../src/appearance/themeRefs.js';
import {paletteFromTheme, resolveSemanticPalette} from '../src/appearance/semanticPalette.js';
import {anyBridgeTargetActive, BRIDGE_TARGETS, effectiveMode, normalizeThemeBridge, type BridgeTargetId} from '../src/themeBridge/model.js';
import {
  BRIDGE_ENV_VARIABLES, bridgeBootstrap, bridgeEnvPath, fishLiteral, posixAnsiQuote, renderEnvironmentFile, validateEnvironmentFile, writeEnvironmentFiles,
} from '../src/themeBridge/environment.js';
import {
  fzfColorArgs, lsColorsFallback, neovimColorscheme, pagerEnvironment, tmuxFragment, validateNeovimColorscheme, validateTmuxFragment,
  validateVimColorscheme, vimColorscheme, withFzfTheme, TMUX_STYLE_OPTIONS,
} from '../src/themeBridge/targets.js';
import {
  applyHook, applyHookRemoval, artifactPath, hookSpec, ledgerPath, loadLedger, ownership, planHook, planHookRemoval, removeArtifact, writeArtifact,
} from '../src/themeBridge/artifacts.js';
import {applyThemeBridge, bridgeColorLevel, bridgeEnvironment, fzfBridgeArgs, reloadTmux, reportTargets, type BridgeContext, type TargetFacts} from '../src/themeBridge/runtime.js';
import {themeBridgeKey} from '../src/themeBridge/runtime.js';

const installed = (...targets: BridgeTargetId[]): Record<BridgeTargetId, TargetFacts> =>
  Object.fromEntries(BRIDGE_TARGETS.map(target => [target, {installed: targets.includes(target), ...(target === 'fzf' ? {version: '0.74.4 (brew)'} : {})}])) as Record<BridgeTargetId, TargetFacts>;

function sandbox(): {env: NodeJS.ProcessEnv; home: string; root: string; done: () => void} {
  const root = mkdtempSync(join(tmpdir(), 'nmsh-bridge-'));
  const home = join(root, 'home');
  mkdirSync(home);
  return {root, home, env: {HOME: home, XDG_CONFIG_HOME: join(root, 'config'), PATH: ''}, done: () => rmSync(root, {recursive: true, force: true})};
}

function configWith(targets: Partial<Record<BridgeTargetId, {mode: 'independent' | 'follow' | 'choose'; theme?: string}>>, active = 'builtin:lavender'): PromptConfiguration {
  const config = normalizePromptConfiguration({...structuredClone(DEFAULT_PROMPT_CONFIGURATION), themeBridge: {enabled: true, targets}});
  const set = setActiveTheme(config, active);
  assert.ok(set.ok);
  return set.config;
}

const context = (config: PromptConfiguration, env: NodeJS.ProcessEnv, facts = installed(...BRIDGE_TARGETS)): BridgeContext => ({source: config, facts, level: 'truecolor', env});

test('defaults: every target Independent, the switch Off, and Independent injects nothing at all', () => {
  const config = normalizePromptConfiguration({});
  assert.equal(config.themeBridge.enabled, false);
  assert.ok(BRIDGE_TARGETS.every(target => config.themeBridge.targets[target].mode === 'independent'));
  assert.equal(anyBridgeTargetActive(config.themeBridge), false);
  const env = {PATH: ''};
  assert.deepEqual(bridgeEnvironment(context(config, env)), {});
  assert.deepEqual(fzfBridgeArgs(context(config, env)), []);
  // Choices are kept while the switch is Off, but nothing is in effect.
  const off = normalizePromptConfiguration({themeBridge: {enabled: false, targets: {fzf: {mode: 'follow'}}}});
  assert.equal(off.themeBridge.targets.fzf.mode, 'follow');
  assert.equal(effectiveMode(off.themeBridge, 'fzf'), 'independent');
  assert.deepEqual(fzfBridgeArgs(context(off, env)), []);
  // Malformed settings read as Independent; Choose without a reference has nothing to pin.
  const malformed = normalizeThemeBridge({enabled: true, targets: {fzf: {mode: 'sideways'}, tmux: {mode: 'choose'}, vim: 'x', bogus: {mode: 'follow'}}});
  assert.equal(malformed.targets.fzf.mode, 'independent');
  assert.equal(malformed.targets.tmux.mode, 'independent');
  assert.equal(normalizeThemeBridge({targets: {fzf: {mode: 'follow'}}}).enabled, true, 'pre-switch configs with active targets read as On');
});

test('Follow tracks the active theme; Choose stays pinned; different targets use different themes at once', () => {
  let config = configWith({fzf: {mode: 'follow'}, tmux: {mode: 'choose', theme: 'builtin:gruvboxDark'}, vim: {mode: 'choose', theme: 'builtin:catppuccinMocha'}});
  const env = {PATH: ''};
  const before = fzfBridgeArgs(context(config, env));
  const pinnedBefore = reportTargets(context(config, env)).find(report => report.target === 'tmux')!;
  config = setActiveTheme(config, 'builtin:nord').ok ? (setActiveTheme(config, 'builtin:nord') as {config: PromptConfiguration}).config : config;
  const after = fzfBridgeArgs(context(config, env));
  const reports = reportTargets(context(config, env));
  assert.notDeepEqual(before, after, 'Follow NMSh changes with the main theme');
  assert.equal(reports.find(report => report.target === 'fzf')!.themeLabel, 'Nord');
  assert.equal(reports.find(report => report.target === 'tmux')!.themeLabel, 'Gruvbox Dark');
  assert.deepEqual(reports.find(report => report.target === 'tmux')!.palette, pinnedBefore.palette, 'the pinned palette is unchanged');
  assert.equal(reports.find(report => report.target === 'vim')!.themeLabel, 'Catppuccin Mocha');
  assert.equal(reports.find(report => report.target === 'tmux')!.status, 'Pinned theme');
  assert.equal(reports.find(report => report.target === 'fzf')!.status, 'Following NMSh');
  assert.notEqual(themeBridgeKey(config), themeBridgeKey(configWith({fzf: {mode: 'follow'}})), 'a theme or setting change re-applies');
});

test('built-in, imported and custom themes all resolve; a deleted pin never resolves elsewhere', () => {
  let config = configWith({});
  const custom = addTheme(config, {...builtinTheme('dracula'), name: 'Mine'});
  assert.ok(custom.ok);
  config = custom.config;
  const imported = addTheme(config, {...builtinTheme('nord'), name: 'Imp'}, {kind: 'kitty', sourceName: 'Imp'});
  assert.ok(imported.ok);
  config = imported.config;
  for (const ref of ['builtin:lavender', 'builtin:catppuccinLatte@peach', assetRef(custom.id!), assetRef(imported.id!)]) {
    const resolved = resolveSemanticPalette(ref, config);
    assert.ok(resolved.ok, ref);
    assert.ok(Object.isFrozen(resolved.palette) && Object.isFrozen(resolved.palette.ansi), 'immutable snapshot');
    assert.equal(resolved.palette.ansi.length, 16);
  }
  assert.equal(resolveSemanticPalette('builtin:catppuccinLatte', config).ok && (resolveSemanticPalette('builtin:catppuccinLatte', config) as {palette: {dark: boolean}}).palette.dark, false);
  config.themeBridge.targets.tmux = {mode: 'choose', theme: 'asset:t-000000000000'};
  const report = reportTargets(context(config, {PATH: ''})).find(item => item.target === 'tmux')!;
  assert.equal(report.status, 'Missing theme');
  assert.equal(report.palette, undefined, 'no other theme is substituted');
});

test('fzf: deterministic --color for NMSh launches; explicit caller options win; NO_COLOR and capability fallbacks', () => {
  const palette = paletteFromTheme(builtinTheme('nord'), 'builtin:nord');
  const args = fzfColorArgs(palette, 'truecolor', [0, 74]);
  assert.deepEqual(args, fzfColorArgs(palette, 'truecolor', [0, 74]), 'deterministic');
  assert.equal(args.length, 1);
  assert.match(args[0]!, /^--color=bg:-1,fg:#[0-9a-f]{6},hl:#[0-9a-f]{6},fg\+:#[0-9a-f]{6},bg\+:#[0-9a-f]{6}/u);
  assert.match(args[0]!, /gutter:-1/u, 'the terminal background stays the terminal\'s');
  assert.doesNotMatch(fzfColorArgs(palette, 'truecolor', [0, 20])[0]!, /separator|scrollbar|query|label|border/u, 'old fzf never gets unknown color names');
  assert.match(fzfColorArgs(palette, 'ansi256', [0, 74])[0]!, /fg:\d{1,3},/u);
  assert.deepEqual(fzfColorArgs(palette, 'none'), []);
  const caller = ['--no-multi', '--color=bw'];
  assert.deepEqual(withFzfTheme(caller, args), [...args, ...caller], 'NMSh colors first, the launching surface\'s explicit options last (they win)');
  assert.equal(bridgeColorLevel('truecolor', {NO_COLOR: '1'}), 'none');
  assert.equal(bridgeColorLevel('truecolor', {NO_COLOR: ''}), 'truecolor', 'an empty NO_COLOR is not set');
  const config = configWith({fzf: {mode: 'follow'}});
  assert.deepEqual(fzfBridgeArgs({...context(config, {NO_COLOR: '1', PATH: ''})}), []);
});

test('less/man and LS_COLORS: scoped allowlisted variables, bounded deterministic values', () => {
  const palette = paletteFromTheme(builtinTheme('gruvboxDark'), 'builtin:gruvboxDark');
  const pager = pagerEnvironment(palette, 'truecolor');
  assert.deepEqual(Object.keys(pager).sort(), ['GROFF_NO_SGR', 'LESS_TERMCAP_mb', 'LESS_TERMCAP_md', 'LESS_TERMCAP_me', 'LESS_TERMCAP_se', 'LESS_TERMCAP_so', 'LESS_TERMCAP_ue', 'LESS_TERMCAP_us']);
  assert.ok(!('LESS' in pager) && !('PAGER' in pager) && !('MANPAGER' in pager), 'the user\'s pager options are never set');
  assert.match(pager.LESS_TERMCAP_md!, /^\u001B\[1;38;2;\d+;\d+;\d+m$/u);
  assert.match(pagerEnvironment(palette, 'ansi256').LESS_TERMCAP_md!, /^\u001B\[1;38;5;\d+m$/u);
  assert.deepEqual(pagerEnvironment(palette, 'none'), {});
  const ls = lsColorsFallback(palette, 'truecolor')!;
  assert.equal(ls, lsColorsFallback(palette, 'truecolor'));
  assert.ok(ls.length < 2500, `small fallback (${ls.length})`);
  assert.ok(ls.split(':').length < 60, 'not an extension database');
  assert.match(ls, /^di=1;38;2;\d+;\d+;\d+:/u);
  assert.ok(ls.split(':').every(entry => /^[^=:\s]+=[0-9;]+$/u.test(entry)));
  assert.equal(lsColorsFallback(palette, 'none'), undefined);
  const config = configWith({pager: {mode: 'follow'}, lsColors: {mode: 'choose', theme: 'builtin:nord'}});
  const environment = bridgeEnvironment(context(config, {PATH: ''}));
  assert.ok(Object.keys(environment).every(name => (BRIDGE_ENV_VARIABLES as readonly string[]).includes(name)));
  assert.ok(environment.LS_COLORS && environment.LESS_TERMCAP_md);
});

test('environment sink: exact quoting, strict validation, allowlist only', () => {
  const tricky = "\u001B[1m it's \\ $HOME `x` $(rm -rf ~) ;|&";
  assert.equal(posixAnsiQuote(tricky), "$'\\e[1m it\\'s \\\\ $HOME `x` $(rm -rf ~) ;|&'");
  assert.equal(fishLiteral(tricky), "\\e'[1m it\\'s \\\\ $HOME `x` $(rm -rf ~) ;|&'");
  for (const shell of ['zsh', 'bash', 'fish'] as const) {
    const content = renderEnvironmentFile(shell, {LS_COLORS: 'di=1;34', LESS_TERMCAP_md: tricky});
    assert.ok(validateEnvironmentFile(shell, content), shell);
    assert.equal(validateEnvironmentFile(shell, `${content}rm -rf ~\n`), false, 'appended commands fail validation');
    assert.equal(validateEnvironmentFile(shell, content.replace('nmsh_bridge_clear GROFF_NO_SGR', 'nmsh_bridge_clear PATH')), false, 'non-allowlisted names fail');
    assert.ok(content.split('\n').filter(line => line.startsWith('  ')).length === BRIDGE_ENV_VARIABLES.length);
  }
  assert.throws(() => renderEnvironmentFile('zsh', {PATH: '/evil'} as never), /Refusing/u);
  assert.throws(() => renderEnvironmentFile('zsh', {LS_COLORS: 'a\nb'}), /Refusing/u);
});

const shells: Array<{id: 'zsh' | 'bash' | 'fish'; bin: string | undefined}> = [
  {id: 'zsh', bin: ['/bin/zsh', '/usr/bin/zsh'].find(existsSync)},
  {id: 'bash', bin: ['/opt/homebrew/bin/bash', '/usr/local/bin/bash', '/bin/bash', '/usr/bin/bash'].find(path => existsSync(path) && /version [45]\.|version [6-9]\./u.test(spawnSync(path, ['--version'], {encoding: 'utf8'}).stdout ?? ''))},
  {id: 'fish', bin: ['/opt/homebrew/bin/fish', '/usr/local/bin/fish', '/usr/bin/fish'].find(existsSync)},
];

for (const {id, bin} of shells) {
  test(`environment sink in a real ${id}: apply, follow update, Independent restores only NMSh-owned values, no history or rc writes`, {skip: bin ? false : `${id} not installed`}, () => {
    const box = sandbox();
    try {
      const file = bridgeEnvPath(id, box.env);
      const value = '\u001B[1;38;2;1;2;3m';
      writeEnvironmentFiles({LESS_TERMCAP_md: value, LS_COLORS: 'di=1;34'}, box.env);
      const first = readFileSync(file, 'utf8');
      writeEnvironmentFiles({LESS_TERMCAP_md: value, LS_COLORS: 'di=1;35'}, box.env);
      const second = readFileSync(file, 'utf8');
      writeEnvironmentFiles({}, box.env);
      const cleared = readFileSync(file, 'utf8');
      const stage = (content: string) => { const path = join(box.root, `stage-${Math.random()}`); writeFileSync(path, content); return path; };
      const [a, b, c] = [first, second, cleared].map(stage);
      const show = id === 'fish'
        ? `printf '%s|%s\\n' (set -q LESS_TERMCAP_md; and printf %s "$LESS_TERMCAP_md" | od -An -c | tr -d ' \\n'; or echo unset) "$LS_COLORS"`
        : `printf '%s|%s\\n' "\${LESS_TERMCAP_md+set}" "\${LS_COLORS-unset}"`;
      const userSets = id === 'fish' ? 'set -gx LS_COLORS user-value' : 'export LS_COLORS=user-value';
      const script = `${bridgeBootstrap(id, file)}\n${userSets}\ncp ${a} ${file}; nmsh_bridge_sync; ${show}\ncp ${b} ${file}; nmsh_bridge_sync; ${show}\nnmsh_bridge_sync; ${show}\ncp ${c} ${file}; nmsh_bridge_sync; ${show}\n`;
      // The shell's own data/cache directories live outside HOME here, so HOME shows only what NMSh might have written (nothing).
      const result = spawnSync(bin!, ['-c', script], {encoding: 'utf8', env: {...box.env, PATH: process.env.PATH, HISTFILE: join(box.root, 'history'),
        XDG_DATA_HOME: join(box.root, 'data'), XDG_CACHE_HOME: join(box.root, 'cache')}});
      const lines = result.stdout.trim().split('\n');
      assert.equal(lines.length, 4, result.stderr);
      assert.match(lines[0]!, /\|di=1;34$/u, 'applied');
      assert.match(lines[1]!, /\|di=1;35$/u, 'a changed theme updates the value');
      assert.equal(lines[2], lines[1], 'an unchanged generation is not re-applied');
      assert.match(lines[3]!, id === 'fish' ? /^unset\|user-value$/u : /^\|user-value$/u, 'Independent restores the user\'s own value and removes NMSh\'s');
      assert.equal(existsSync(join(box.root, 'history')), false, 'nothing is written to history');
      assert.deepEqual(readdirSync(box.home), [], 'no rc or dotfile was created or changed');
    } finally { box.done(); }
  });
}

test('environment sink: a value the user changed after NMSh set it is left alone on clear', {skip: shells[0]!.bin ? false : 'zsh not installed'}, () => {
  const box = sandbox();
  try {
    const file = bridgeEnvPath('zsh', box.env);
    writeEnvironmentFiles({LS_COLORS: 'di=1;34'}, box.env);
    const on = readFileSync(file, 'utf8');
    writeEnvironmentFiles({}, box.env);
    const off = readFileSync(file, 'utf8');
    const onPath = join(box.root, 'on'); const offPath = join(box.root, 'off');
    writeFileSync(onPath, on); writeFileSync(offPath, off);
    const script = `${bridgeBootstrap('zsh', file)}\ncp ${onPath} ${file}; nmsh_bridge_sync\nexport LS_COLORS=mine-now\ncp ${offPath} ${file}; nmsh_bridge_sync\nprint -r -- "$LS_COLORS"`;
    assert.equal(spawnSync(shells[0]!.bin!, ['-c', script], {encoding: 'utf8', env: {...box.env, PATH: process.env.PATH}}).stdout.trim(), 'mine-now');
  } finally { box.done(); }
});

test('managed artifacts: staged validated writes, ownership ledger, never overwrite or delete what NMSh cannot prove it owns', () => {
  const box = sandbox();
  try {
    const palette = paletteFromTheme(builtinTheme('nord'), 'builtin:nord');
    const record = {mode: 'follow' as const, themeRef: 'builtin:nord', format: 'tmux-fragment', formatVersion: 1};
    assert.equal(writeArtifact('tmux', 'bind-key x kill-server\n', validateTmuxFragment, record, box.env).ok, false, 'invalid content is never written');
    assert.equal(existsSync(artifactPath('tmux', box.env)), false);
    const written = writeArtifact('tmux', tmuxFragment(palette), validateTmuxFragment, record, box.env);
    assert.ok(written.ok && written.changed);
    assert.equal(ownership('tmux', loadLedger(box.env), box.env), 'owned');
    // An edited file is no longer provably NMSh's: no overwrite, no delete.
    writeFileSync(artifactPath('tmux', box.env), `${tmuxFragment(palette)}# my edit\n`);
    assert.equal(ownership('tmux', loadLedger(box.env), box.env), 'modified');
    assert.equal(writeArtifact('tmux', tmuxFragment(palette), validateTmuxFragment, record, box.env).ok, false);
    assert.equal(removeArtifact('tmux', box.env).ok, false);
    assert.match(readFileSync(artifactPath('tmux', box.env), 'utf8'), /# my edit/u);
    // A file without a ledger entry (or with a malformed ledger) is unknown.
    writeFileSync(ledgerPath(box.env), '{not json');
    assert.equal(ownership('tmux', loadLedger(box.env), box.env), 'unknown');
    assert.equal(removeArtifact('tmux', box.env).ok, false);
    // A ledger cannot point NMSh at other files.
    const victim = join(box.home, '.tmux.conf');
    writeFileSync(victim, 'set -g mouse on\n');
    writeFileSync(ledgerPath(box.env), JSON.stringify({version: 1, entries: {vim: {target: 'vim', artifactPath: victim, sha256: 'a'.repeat(64)}}}));
    assert.deepEqual(loadLedger(box.env).entries, {});
    assert.equal(removeArtifact('vim', box.env).ok, true);
    assert.equal(readFileSync(victim, 'utf8'), 'set -g mouse on\n', 'user files are untouched');
  } finally { box.done(); }
});

test('exact includes: shown plan, exact lines appended, exact removal, duplicates refused, user content untouched', () => {
  const box = sandbox();
  try {
    const conf = join(box.home, '.tmux.conf');
    writeFileSync(conf, 'set -g mouse on\nbind r source-file ~/.tmux.conf\n');
    const palette = paletteFromTheme(builtinTheme('nord'), 'builtin:nord');
    assert.ok(writeArtifact('tmux', tmuxFragment(palette), validateTmuxFragment, {mode: 'follow', themeRef: 'builtin:nord', format: 'tmux-fragment', formatVersion: 1}, box.env).ok);
    const spec = hookSpec('tmux', box.env, box.home);
    assert.ok(!('error' in spec));
    assert.equal(spec.configPath, conf, 'the existing user config is the target');
    assert.deepEqual(spec.lines, ['# NMSh Theme Bridge: loads NMSh-managed colors (remove with /theme-bridge)', `source-file -q '${artifactPath('tmux', box.env)}'`]);
    const planned = planHook(spec, box.home);
    assert.ok('plan' in planned);
    assert.ok(planned.plan.preview.some(line => line.startsWith('+ source-file -q')), 'the exact line is previewed');
    assert.equal(readFileSync(conf, 'utf8'), 'set -g mouse on\nbind r source-file ~/.tmux.conf\n', 'planning writes nothing');
    assert.ok(applyHook('tmux', planned.plan, spec, box.env).ok);
    const after = readFileSync(conf, 'utf8');
    assert.ok(after.startsWith('set -g mouse on\nbind r source-file ~/.tmux.conf\n'), 'nothing of the user\'s is rewritten');
    assert.ok(after.endsWith(`${spec.lines.join('\n')}\n`));
    assert.ok('noop' in planHook(spec, box.home), 'already present: nothing to add');
    const removal = planHookRemoval('tmux', box.home, box.env);
    assert.ok('plan' in removal);
    assert.ok(applyHookRemoval('tmux', removal.plan, box.env).ok);
    assert.equal(readFileSync(conf, 'utf8'), 'set -g mouse on\nbind r source-file ~/.tmux.conf\n\n', 'only the NMSh lines are removed');
    assert.equal(loadLedger(box.env).entries.tmux?.hook, undefined);
    // Duplicated includes are never guessed at.
    assert.ok(applyHook('tmux', (planHook(spec, box.home) as {plan: never}).plan, spec, box.env).ok);
    writeFileSync(conf, `${readFileSync(conf, 'utf8')}${spec.lines.join('\n')}\n`);
    assert.match((planHookRemoval('tmux', box.home, box.env) as {error: string}).error, /more than once/u);
    // A missing Neovim init is created with only the hook lines; Vim targets ~/.vimrc.
    const nvim = hookSpec('neovim', box.env, box.home);
    assert.ok(!('error' in nvim) && nvim.createIfMissing && nvim.configPath.endsWith(join('nvim', 'init.lua')));
    assert.match(nvim.lines[1]!, /^pcall\(function\(\) vim\.opt\.runtimepath:append\('.+'\); vim\.cmd\.colorscheme\('nmsh-bridge'\) end\)$/u);
    const vim = hookSpec('vim', box.env, box.home);
    assert.ok(!('error' in vim) && vim.configPath === join(box.home, '.vimrc'));
  } finally { box.done(); }
});

test('tmux fragment: broad style coverage, no behavior, real tmux loads it', () => {
  for (const ref of ['builtin:lavender', 'builtin:gruvboxLight', 'builtin:catppuccinMocha@peach']) {
    const resolved = resolveSemanticPalette(ref, {themes: []});
    assert.ok(resolved.ok);
    const fragment = tmuxFragment(resolved.palette);
    assert.ok(validateTmuxFragment(fragment));
    const options = fragment.split('\n').filter(line => line.startsWith('set ')).map(line => line.split(' ')[2]);
    assert.ok(options.length >= 20, 'status, windows, panes, messages, modes, menus, popups, clock, display-panes, copy-mode');
    assert.ok(options.every(option => (TMUX_STYLE_OPTIONS as readonly string[]).includes(option!)));
    assert.doesNotMatch(fragment, /\b(?:bind|unbind|prefix|mouse|run|if-shell|source|set-hook|default-shell|default-command)\b/u);
  }
  assert.equal(validateTmuxFragment('set -gq status-style "fg=#ffffff"\nbind x kill-server\n'), false);
  assert.equal(validateTmuxFragment('set -gq default-command "rm -rf ~"\n'), false);
  const tmux = ['/opt/homebrew/bin/tmux', '/usr/local/bin/tmux', '/usr/bin/tmux'].find(existsSync);
  if (!tmux) return;
  const box = sandbox();
  try {
    const path = join(box.root, 'fragment.conf');
    writeFileSync(path, tmuxFragment(paletteFromTheme(builtinTheme('nord'), 'builtin:nord')));
    const socket = `nmsh-test-${process.pid}`;
    const result = spawnSync(tmux, ['-L', socket, '-f', '/dev/null', 'new-session', '-d', ';', 'source-file', path, ';', 'show-options', '-g', 'pane-active-border-style', ';', 'kill-server'],
      {encoding: 'utf8', env: {...process.env, TMUX: '', TMUX_TMPDIR: box.root}});
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /pane-active-border-style "?fg=#[0-9a-f]{6}/u);
  } finally { box.done(); }
});

test('Neovim and Vim colorschemes: broad native coverage, separate dialects, real Vim loads its file', () => {
  const dark = paletteFromTheme(builtinTheme('tokyonightNight'), 'builtin:tokyonightNight');
  const light = paletteFromTheme(builtinTheme('solarizedLight'), 'builtin:solarizedLight');
  const nvim = neovimColorscheme(dark);
  assert.ok(validateNeovimColorscheme(nvim));
  for (const group of ['Normal', 'NormalFloat', 'Comment', 'String', 'Function', 'Keyword', 'Visual', 'Search', 'Pmenu', 'PmenuSel', 'StatusLine', 'WinSeparator', 'MatchParen',
    'DiffAdd', 'DiffText', 'DiagnosticError', 'DiagnosticUnderlineWarn', 'DiagnosticSignInfo', '@comment', '@function.call', '@keyword.return', '@type.builtin']) {
    assert.ok(nvim.includes(`set(0, '${group}'`), group);
  }
  assert.match(nvim, /set\(0, '@function', \{link = 'Function'\}\)/u, 'Tree-sitter captures link onto base groups');
  assert.match(nvim, /vim\.o\.background = 'dark'/u);
  assert.match(neovimColorscheme(light), /vim\.o\.background = 'light'/u);
  assert.equal(validateNeovimColorscheme(`${nvim}os.execute('rm -rf ~')\n`), false, 'nothing but highlight data validates');
  const vim = vimColorscheme(dark);
  assert.ok(validateVimColorscheme(vim));
  for (const group of ['Normal', 'Comment', 'Constant', 'Exception', 'Typedef', 'Todo', 'CursorLineNr', 'PmenuSel', 'StatusLineNC', 'VertSplit', 'DiffDelete']) assert.match(vim, new RegExp(`^hi ${group} `, 'mu'), group);
  assert.doesNotMatch(vim, /@|nvim_|Diagnostic|NormalFloat|WinSeparator/u, 'no Neovim-only groups or APIs in the Vim file');
  assert.match(vim, /^hi Comment guifg=#[0-9a-f]{6} guibg=NONE ctermfg=\d{1,3} ctermbg=NONE/mu, 'truecolor plus a 256-color fallback');
  assert.equal(validateVimColorscheme(`${vim}!rm -rf ~\n`), false);
  const vimBinary = ['/usr/bin/vim', '/opt/homebrew/bin/vim', '/usr/local/bin/vim'].find(existsSync);
  if (!vimBinary) return;
  const box = sandbox();
  try {
    mkdirSync(join(box.root, 'colors'));
    writeFileSync(join(box.root, 'colors', 'nmsh-bridge.vim'), vim);
    const result = spawnSync(vimBinary, ['-u', 'NONE', '-N', '-es', '-c', `set rtp+=${box.root}`, '-c', 'colorscheme nmsh-bridge', '-c', 'redir => x | silent hi Keyword | redir END | put =x | %print | qa!'],
      {encoding: 'utf8', env: {...process.env, HOME: box.home}});
    assert.match(result.stdout, /Keyword\s+xxx .*guifg=#[0-9a-f]{6}/u, result.stderr);
  } finally { box.done(); }
});

test('applyThemeBridge: isolated per target; independent targets get nothing; failures are reported, others proceed', async () => {
  const box = sandbox();
  try {
    let config = configWith({pager: {mode: 'follow'}, tmux: {mode: 'follow'}, vim: {mode: 'choose', theme: 'builtin:nord'}, neovim: {mode: 'independent'}});
    // Something that is not NMSh's sits at the tmux path.
    mkdirSync(join(box.env.XDG_CONFIG_HOME!, 'nmsh', 'theme-bridge', 'tmux'), {recursive: true});
    writeFileSync(artifactPath('tmux', box.env), 'set -g status-style bg=red\n');
    const outcomes = await applyThemeBridge(context(config, box.env));
    assert.equal(outcomes.find(outcome => outcome.target === 'tmux')?.ok, false);
    assert.equal(readFileSync(artifactPath('tmux', box.env), 'utf8'), 'set -g status-style bg=red\n', 'never overwritten');
    assert.ok(outcomes.find(outcome => outcome.target === 'vim')?.ok);
    assert.ok(existsSync(artifactPath('vim', box.env)));
    assert.equal(existsSync(artifactPath('neovim', box.env)), false, 'Independent: no artifact');
    assert.match(readFileSync(bridgeEnvPath('zsh', box.env), 'utf8'), /nmsh_bridge_apply LESS_TERMCAP_md/u);
    assert.deepEqual(readdirSync(box.home), [], 'no user config was touched');
    // Switching Vim to Independent removes the owned artifact; the env clears the pager values.
    config = configWith({vim: {mode: 'independent'}});
    await applyThemeBridge(context(config, box.env));
    assert.equal(existsSync(artifactPath('vim', box.env)), false);
    assert.doesNotMatch(readFileSync(bridgeEnvPath('bash', box.env), 'utf8'), /nmsh_bridge_apply/u);
    assert.equal((await reloadTmux(box.env)).ok, false, 'no reload without an owned fragment (and no tmux on this PATH)');
  } finally { box.done(); }
});

test('reports: factual statuses; bat and delta are honest about unsupported custom themes', () => {
  const config = configWith({fzf: {mode: 'follow'}, bat: {mode: 'follow'}});
  const reports = reportTargets(context(config, {PATH: ''}, installed('fzf', 'bat', 'delta')));
  const by = (target: BridgeTargetId) => reports.find(report => report.target === target)!;
  assert.equal(by('fzf').status, 'Following NMSh');
  assert.equal(by('bat').status, 'Unsupported capability');
  assert.deepEqual(by('bat').modes, ['independent']);
  assert.match(by('bat').notes.join(' '), /theme cache/u);
  assert.match(by('delta').notes.join(' '), /gitconfig/u);
  assert.equal(by('tmux').status, 'Not installed');
  assert.equal(by('pager').status, 'Not installed');
  const colorless = reportTargets({...context(config, {PATH: '', NO_COLOR: '1'}, installed('fzf'))}).find(report => report.target === 'fzf')!;
  assert.match(colorless.notes.join(' '), /NO_COLOR/u);
});
