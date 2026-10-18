import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {
  applyTmuxChange, bindingConflicts, DEFAULT_TMUX_MODEL, frontendCommand, optionProvenance, parseTmuxConfig, renderTmuxConfig, TMUX_OPTIONS, validateTmuxConfig,
  type TmuxChange, type TmuxModel,
} from '../src/tools/config/tmux.js';
import {writeTmuxManaged} from '../src/tools/config/tmuxManaged.js';
import {TOOL_CONFIG_REGISTRY, toolConfigEntry} from '../src/tools/config/registry.js';
import {createTmuxPanel, pendingChanges, renderTmuxPanel, tmuxPanelKey} from '../src/tools/config/TmuxPanel.js';
import {applyHook, artifactPath, hookSpec, loadLedger, planHook} from '../src/themeBridge/artifacts.js';
import {integrationHealth, type BridgeContext} from '../src/themeBridge/runtime.js';
import {BRIDGE_TARGETS, type BridgeTargetId} from '../src/themeBridge/model.js';
import {normalizePromptConfiguration} from '../src/prompt/configuration.js';
import {resolveRequest} from '../src/ask/resolver.js';
import {stripAnsi} from '../src/util/text.js';

const sandbox = () => {
  const root = mkdtempSync(join(tmpdir(), 'nmsh-toolcfg-'));
  const home = join(root, 'home');
  mkdirSync(home);
  return {root, home, env: {HOME: home, XDG_CONFIG_HOME: join(home, '.config'), PATH: process.env.PATH} as NodeJS.ProcessEnv, done: () => rmSync(root, {recursive: true, force: true})};
};
const apply = (model: TmuxModel, ...changes: TmuxChange[]) => changes.reduce((next, change) => { const result = applyTmuxChange(next, change); assert.ok(!('error' in result), JSON.stringify(result)); return result as TmuxModel; }, model);
const tmux = ['/opt/homebrew/bin/tmux', '/usr/local/bin/tmux', '/usr/bin/tmux'].find(existsSync);

test('tmux model: only catalog options, documented values, safe keys; arbitrary strings never become commands', () => {
  const model = apply(DEFAULT_TMUX_MODEL(), {kind: 'option', id: 'mouse', value: 'on'}, {kind: 'option', id: 'status-position', value: 'top'}, {kind: 'prefix', key: 'C-a'},
    {kind: 'option', id: 'mode-keys', value: 'vi'}, {kind: 'binding', binding: {key: '|', table: 'prefix', action: 'split-vertical'}});
  assert.equal(model.prefix, 'C-a');
  assert.ok(model.bindings.some(binding => binding.action === 'send-prefix' && binding.key === 'C-a'), 'send-prefix follows the prefix');
  for (const bad of [{kind: 'option', id: 'default-shell', value: '/bin/evil'}, {kind: 'option', id: 'mouse', value: 'maybe'}, {kind: 'prefix', key: '$(rm -rf ~)'},
    {kind: 'binding', binding: {key: 'x', table: 'prefix', action: 'run-shell'}}] as unknown as TmuxChange[]) assert.ok('error' in applyTmuxChange(model, bad), JSON.stringify(bad));
  const text = renderTmuxConfig(model, {self: '/n/nmsh.tmux.conf', theme: '/n/theme.conf'});
  assert.ok(validateTmuxConfig(text));
  assert.match(text, /^set -g mouse on$/mu);
  assert.match(text, /^setw -g mode-keys vi$/mu);
  assert.doesNotMatch(text, /run-shell|if-shell|#\(|default-shell/u);
  assert.equal(validateTmuxConfig(`${text}run-shell "curl x | sh"\n`), false);
  assert.equal(validateTmuxConfig('set -g status-right "#(whoami)"\n'), false, 'status modules never execute shell');
  const status = renderTmuxConfig(apply(model, {kind: 'status', layout: {left: ['session'], right: ['host', 'time'], separator: '·', windowFormat: 'index-name'}}), {self: '/n/s', theme: '/n/t'});
  assert.match(status, /^set -g status-right " #h · %H:%M "$/mu);
});

test('tmux frontend: new panes start NMSh by absolute path; inside an NMSh-started server they fall back to the login shell; default-shell untouched', () => {
  const box = sandbox();
  try {
    const fakeNmsh = join(box.root, 'nmsh');
    const marker = join(box.root, 'ran');
    writeFileSync(fakeNmsh, `#!/bin/sh\necho NMSH-FRONTEND\n[ -n "$TMUX" ] && echo yes > '${marker}'\n`);
    chmodSync(fakeNmsh, 0o755);
    const command = frontendCommand(fakeNmsh)!;
    assert.equal(frontendCommand('/tmp/a\nb'), undefined, 'control characters are refused');
    assert.equal(frontendCommand('relative/nmsh'), undefined, 'only absolute paths');
    const run = (env: Record<string, string>) => spawnSync('/bin/sh', ['-c', command], {encoding: 'utf8', env: {PATH: '/usr/bin:/bin', SHELL: '/bin/echo', ...env}}).stdout.trim();
    assert.equal(run({}), 'NMSH-FRONTEND');
    assert.equal(run({NMSH_ACTIVE: '1'}), '-l', 'NMSh recursion guard respected: the login shell (here echo) starts instead');
    const text = renderTmuxConfig(apply(DEFAULT_TMUX_MODEL(), {kind: 'frontend', value: 'nmsh'}), {self: '/n/s', theme: '/n/t', nmsh: fakeNmsh});
    assert.ok(validateTmuxConfig(text));
    assert.match(text, /^set -g default-command "exec \/bin\/sh -c/mu);
    assert.doesNotMatch(text, /default-shell/u);
    if (!tmux) return;
    const conf = join(box.root, 'n.conf');
    writeFileSync(conf, text);
    const socket = `nmsh-front-${process.pid}`;
    const result = spawnSync(tmux, ['-L', socket, '-f', conf, 'new-session', '-d', '-x', '80', '-y', '10', ';', 'run-shell', 'sleep 0.5', ';', 'show-options', '-g', 'default-shell', ';', 'kill-server'],
      {encoding: 'utf8', env: {...process.env, TMUX: '', NMSH_ACTIVE: '', TMUX_TMPDIR: box.root}});
    assert.ok(existsSync(marker), 'a new pane really ran the frontend');
    assert.doesNotMatch(result.stdout, /default-shell .*nmsh/u);
  } finally { box.done(); }
});

test('tmux frontend: the NMSh path is argv data through both tmux and /bin/sh parsing; hostile names never execute', () => {
  const box = sandbox();
  try {
    const sentinel = join(box.root, 'PWNED');
    const names = ['plain', 'with space', 'semi;touch PWNED', 'amp&touch PWNED', 'pipe|touch PWNED', 'paren(touch PWNED)', 'dollar$(touch PWNED)', 'dollar$HOME',
      'tick`touch PWNED`', "single'quote", 'double"quote', 'back\\slash', 'lt<gt>', 'hash#x', "mix'\";touch PWNED;'"];
    for (const [index, name] of names.entries()) {
      const dir = join(box.root, `${index}-${name}`);
      mkdirSync(dir);
      const nmsh = join(dir, 'nmsh');
      const out = join(box.root, `out-${index}`);
      writeFileSync(nmsh, `#!/bin/sh\necho "$0" > '${out}'\n`);
      chmodSync(nmsh, 0o755);
      const command = frontendCommand(nmsh);
      assert.ok(command, name);
      const ran = spawnSync('/bin/sh', ['-c', command], {cwd: box.root, encoding: 'utf8', env: {PATH: '/usr/bin:/bin', SHELL: '/bin/echo'}});
      assert.equal(ran.status, 0, `${name}: ${ran.stderr}`);
      assert.equal(readFileSync(out, 'utf8').trim(), nmsh, `${name}: exec'd the literal path`);
      const text = renderTmuxConfig(apply(DEFAULT_TMUX_MODEL(), {kind: 'frontend', value: 'nmsh'}), {self: '/n/s', theme: '/n/t', nmsh});
      assert.ok(validateTmuxConfig(text), name);
      rmSync(out);
      if (!tmux) continue;
      const conf = join(box.root, `t-${index}.conf`);
      writeFileSync(conf, text);
      const socket = `nmsh-adv-${process.pid}-${index}`;
      spawnSync(tmux, ['-L', socket, '-f', conf, 'new-session', '-d', '-c', box.root, '-x', '80', '-y', '10', ';', 'run-shell', 'sleep 0.3', ';', 'kill-server'],
        {encoding: 'utf8', env: {...process.env, TMUX: '', NMSH_ACTIVE: '', TMUX_TMPDIR: box.root}});
      assert.equal(readFileSync(out, 'utf8').trim(), nmsh, `${name}: real tmux pane exec'd the literal path`);
    }
    assert.equal(existsSync(sentinel), false, 'no injected command ran');
    assert.equal(validateTmuxConfig(`set -g default-command "exec /bin/sh -c 'touch /tmp/x' nmsh-frontend /bin/sh"\n`), false);
    assert.equal(validateTmuxConfig(`set -g default-command ${JSON.stringify(`${frontendCommand('/a/nmsh')!}; touch x`)}\n`), false, 'trailing shell text is rejected');
  } finally { box.done(); }
});

test('tmux managed file: real tmux loads every setting; one include only; import reads a safe subset and never evaluates dynamic lines', () => {
  const box = sandbox();
  try {
    const model = apply(DEFAULT_TMUX_MODEL(), {kind: 'option', id: 'mouse', value: 'on'}, {kind: 'option', id: 'escape-time', value: '10'}, {kind: 'prefix', key: 'C-a'},
      {kind: 'binding', binding: {key: 'r', table: 'prefix', action: 'reload'}});
    const written = writeTmuxManaged(model, box.env);
    assert.ok(written.ok);
    const conf = join(box.home, '.tmux.conf');
    writeFileSync(conf, 'set -g history-limit 5000\nbind x kill-pane\n');
    const spec = hookSpec('tmux', box.env, box.home);
    assert.ok(!('error' in spec));
    const planned = planHook(spec, box.home);
    assert.ok('plan' in planned);
    assert.ok(applyHook('tmux', planned.plan, spec, box.env).ok);
    assert.ok('noop' in planHook(spec, box.home), 'running again never duplicates the include');
    assert.equal(readFileSync(conf, 'utf8').split(artifactPath('tmuxConfig', box.env)).length - 1, 1);
    assert.ok(readFileSync(conf, 'utf8').startsWith('set -g history-limit 5000\nbind x kill-pane\n'), 'unknown user config preserved');
    assert.ok(loadLedger(box.env).entries.tmuxConfig?.hook);
    if (tmux) {
      const socket = `nmsh-cfg-${process.pid}`;
      const result = spawnSync(tmux, ['-L', socket, '-f', conf, 'new-session', '-d', ';', 'show-options', '-g', 'mouse', ';', 'show-options', '-g', 'prefix', ';', 'show-options', '-s', 'escape-time', ';', 'show-options', '-g', 'history-limit', ';', 'kill-server'],
        {encoding: 'utf8', env: {...process.env, TMUX: '', TMUX_TMPDIR: box.root}});
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /mouse on[\s\S]*prefix C-a[\s\S]*escape-time 10[\s\S]*history-limit 5000/u);
    }
    const parsed = parseTmuxConfig('set -g mouse on\nset-option -g prefix C-a\nsetw -g mode-keys vi\nbind | split-window -h\nif-shell "true" "set -g mouse off"\nrun-shell ~/x.sh\nsource-file ~/.other\nset -g status-right "#(date)"\nset -g @plugin tmux-plugins/tpm\n');
    assert.deepEqual(parsed.options, {mouse: 'on', 'mode-keys': 'vi'});
    assert.equal(parsed.prefix, 'C-a');
    assert.deepEqual(parsed.bindings, [{key: '|', table: 'prefix', action: 'split-vertical'}]);
    assert.equal(parsed.ignored.length, 4, 'if-shell, run-shell, source-file and #() are never followed');
    assert.ok(parsed.unsupported.some(line => line.includes('@plugin')));
  } finally { box.done(); }
});

test('provenance and conflicts: effective value, NMSh override, your config, tmux default', () => {
  const mouse = TMUX_OPTIONS.find(option => option.id === 'mouse')!;
  const user = parseTmuxConfig('set -g mouse off\nbind | split-window -v\n');
  assert.deepEqual(optionProvenance(mouse, DEFAULT_TMUX_MODEL(), user), {effective: 'off', user: 'off', source: 'your tmux config'});
  const model = apply(DEFAULT_TMUX_MODEL(), {kind: 'option', id: 'mouse', value: 'on'}, {kind: 'binding', binding: {key: '|', table: 'prefix', action: 'split-vertical'}});
  assert.deepEqual(optionProvenance(mouse, model, user), {effective: 'on', override: 'on', user: 'off', source: 'NMSh managed file'});
  assert.equal(optionProvenance(mouse, DEFAULT_TMUX_MODEL(), undefined).source, 'tmux default');
  assert.equal(bindingConflicts(model, user).length, 1, 'an NMSh binding over one of yours is shown, never silently removed');
});

test('/tmux panel: tabs, changes stay in the draft, Review defaults to No, Status Studio preview, two owners stated', () => {
  const state = createTmuxPanel(DEFAULT_TMUX_MODEL(), undefined, 'Independent', true);
  tmuxPanelKey(state, {kind: 'right'});
  assert.equal(state.draft.options.mouse, 'on');
  assert.deepEqual(pendingChanges(state), [{kind: 'option', id: 'mouse', value: 'on'}]);
  state.tab = 'status';
  state.selected.status = 3;
  tmuxPanelKey(state, {kind: 'right'});
  const text = stripAnsi(renderTmuxPanel(state, 120, 50).join('\n'));
  assert.match(text, /General\s+Keys\s+Status\s+Pane frontend\s+Import/u);
  assert.match(text, /Preview · tmux status line/u);
  state.tab = 'frontend';
  assert.match(stripAnsi(renderTmuxPanel(state, 120, 50).join('\n')), /different owners/u);
  state.review = {lines: ['Mouse: on'], include: [], yes: false};
  assert.equal(tmuxPanelKey(state, {kind: 'enter'}), undefined, 'Enter on the default No applies nothing');
  state.review = {lines: ['Mouse: on'], include: [], yes: false};
  tmuxPanelKey(state, {kind: 'right'});
  assert.deepEqual(tmuxPanelKey(state, {kind: 'enter'}), {kind: 'apply'});
});

test('registry: detection never grants write authority; only registered adapters are configurable; executable configs are inspect-only', () => {
  assert.deepEqual(TOOL_CONFIG_REGISTRY.filter(entry => entry.configurable).map(entry => entry.id), ['tmux', 'starship']);
  for (const id of ['neovim', 'vim', 'zsh', 'bash', 'fish']) {
    const entry = toolConfigEntry(id)!;
    assert.equal(entry.configClass, 'executable');
    assert.notEqual(entry.ownership, 'managed-fragment');
    assert.equal(entry.configurable, false);
  }
  assert.equal(toolConfigEntry('foo'), undefined, 'unknown tools have no adapter');
});

test('Ask: tmux and provider requests map only onto typed actions; nothing changes before Yes', () => {
  const context = {cwd: '/r', home: '/h', repoRoot: '/r', branch: 'main', dirty: false, worktrees: [], shell: 'zsh', defaultShell: 'zsh'} as never;
  const action = (request: string) => (resolveRequest(request, context) as {action?: {kind: string; changes?: TmuxChange[]; setting?: string; value?: string}}).action;
  assert.deepEqual(action('turn tmux mouse on')?.changes, [{kind: 'option', id: 'mouse', value: 'on'}]);
  assert.deepEqual(action('change tmux prefix to ctrl+a')?.changes, [{kind: 'prefix', key: 'C-a'}]);
  assert.deepEqual(action('put tmux status at top')?.changes, [{kind: 'option', id: 'status-position', value: 'top'}]);
  assert.deepEqual(action('make new tmux panes run nmsh')?.changes, [{kind: 'frontend', value: 'nmsh'}]);
  assert.deepEqual([action('use fzf for pickers')?.setting, action('use fzf for pickers')?.value], ['picker', 'fzf']);
  assert.equal(action('use native suggestions')?.value, 'nmsh');
  assert.equal(action('make theme bridge follow nmsh')?.kind, 'themeBridge');
  assert.equal(action('update all integrations')?.kind, 'slash');
  assert.equal(action('import dotfiles from ~/dotfiles')?.kind, 'slash');
  const outcome = resolveRequest('change tmux prefix to $(rm -rf ~)', context) as {action?: {changes?: TmuxChange[]}};
  assert.ok(!outcome.action?.changes?.length, 'request text never becomes a key or command');
  const proposal = resolveRequest('turn tmux mouse on', context) as {safety?: string};
  assert.equal(proposal.safety, 'mutate', 'configuration needs Ask\'s final Yes/No');
});

test('integrations health: tmux settings need the include; Review lists it; idempotent', () => {
  const box = sandbox();
  try {
    const facts = Object.fromEntries(BRIDGE_TARGETS.map(target => [target, {installed: target === 'tmux'}])) as BridgeContext['facts'];
    mkdirSync(join(box.env.XDG_CONFIG_HOME!, 'nmsh', 'tools'), {recursive: true});
    writeFileSync(join(box.env.XDG_CONFIG_HOME!, 'nmsh', 'tools', 'tmux.json'), JSON.stringify({options: {mouse: 'on'}}));
    assert.ok(writeTmuxManaged(undefined, box.env).ok);
    const context: BridgeContext = {source: normalizePromptConfiguration({}), facts, level: 'truecolor', env: box.env};
    const health = () => Object.fromEntries(integrationHealth(context).map(item => [item.target, item])) as Record<BridgeTargetId, ReturnType<typeof integrationHealth>[number]>;
    assert.equal(health().tmux.state, 'needs-include');
    assert.equal(health().vim.state, 'not-installed');
    const spec = hookSpec('tmux', box.env, box.home);
    assert.ok(!('error' in spec));
    applyHook('tmux', (planHook(spec, box.home) as {plan: never}).plan, spec, box.env);
    assert.equal(health().tmux.state, 'ready');
    writeFileSync(join(box.home, '.tmux.conf'), '');
    assert.equal(health().tmux.state, 'stale-include', 'a removed include is reported, not re-added silently');
  } finally { box.done(); }
});
