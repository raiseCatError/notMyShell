import test from 'node:test';
import assert from 'node:assert/strict';
import {chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {detectTool, knownToolForExecutable, suggestibleToolFor, toolInstall, TOOLS} from '../src/tools/catalog.js';
import {detectOhMyZsh, detectPowerlevel10kTool, detectPrezto, detectZim, detectZinit, detectAntidote, OH_MY_ZSH_INSTALL, previousZshrc} from '../src/tools/frameworks.js';
import {ohMyZshKey, openGuidedInstall, openPrevious, renderOhMyZshView, snapshotZshrc, verifyInstall, type OhMyZshView} from '../src/tools/OhMyZshView.js';
import {createToolsPanel, renderTools, toolBadges, toolsKey, toolStatusLine} from '../src/tools/ToolsPanel.js';
import {detectPowerlevel10k, powerlevel10kThemeCandidates} from '../src/prompt/powerlevel10k.js';
import {detectOhMyPosh, ohMyPoshArgs, OH_MY_POSH_OUTPUT_LIMIT, renderOhMyPoshPrompt} from '../src/prompt/ohMyPosh.js';
import {normalizePromptConfiguration} from '../src/prompt/configuration.js';
import {selectProvider} from '../src/providers/families.js';
import {scanDotfiles, type ScanResult} from '../src/dotfiles/scan.js';
import {applyPlan, buildPlan} from '../src/dotfiles/plan.js';
import {readThemeImport} from '../src/appearance/ThemeStudio.js';
import {resolveConfigRequest} from '../src/ask/configActions.js';
import {stripAnsi} from '../src/util/text.js';

const sandbox = () => {
  const root = mkdtempSync(join(tmpdir(), 'nmsh-frameworks-'));
  const home = join(root, 'home');
  mkdirSync(home);
  const put = (path: string, text = '') => { mkdirSync(dirname(path), {recursive: true}); writeFileSync(path, text); return path; };
  return {root, home, put, env: {HOME: home, PATH: '/usr/bin:/bin'} as NodeJS.ProcessEnv, done: () => rmSync(root, {recursive: true, force: true})};
};
const omzTree = (put: (path: string, text?: string) => string, root: string) => {
  put(join(root, 'oh-my-zsh.sh'), '# loader\n');
  put(join(root, 'lib', 'git.zsh'));
  put(join(root, 'themes', 'robbyrussell.zsh-theme'));
};
const tool = (id: string) => TOOLS.find(item => item.id === id)!;
const enter = {kind: 'enter'} as const;

test('Oh My Zsh: default and $ZSH roots need the real layout; a same-named directory is not enough; never a command', async () => {
  const box = sandbox();
  try {
    mkdirSync(join(box.home, '.oh-my-zsh'));
    assert.equal(detectOhMyZsh(box.env), undefined, 'an empty ~/.oh-my-zsh is not an installation');
    omzTree(box.put, join(box.home, '.oh-my-zsh'));
    assert.deepEqual(detectOhMyZsh(box.env), {path: join(box.home, '.oh-my-zsh')});
    const custom = join(box.root, 'frameworks', 'omz');
    omzTree(box.put, custom);
    assert.deepEqual(detectOhMyZsh({...box.env, ZSH: custom}), {path: custom, source: '$ZSH'});
    assert.deepEqual(detectOhMyZsh({...box.env, ZSH: 'relative/omz'}), {path: join(box.home, '.oh-my-zsh')}, 'a relative $ZSH is not trusted');
    assert.equal((await detectTool(tool('oh-my-zsh'), box.env)).state, 'installed');
    assert.equal(knownToolForExecutable('oh-my-zsh'), undefined, 'not a command: no command-not-found identity');
    assert.equal(suggestibleToolFor('oh-my-zsh'), undefined);
    assert.equal(toolInstall(tool('oh-my-zsh'), true, 'darwin'), undefined, 'no package recipe');
  } finally { box.done(); }
});

test('/tools: Zsh frameworks stay visible under Bash/Fish as "Zsh only"; prompt providers show the canonical state', () => {
  const state = createToolsPanel();
  state.statuses['oh-my-zsh'] = {state: 'installed', detail: '/h/.oh-my-zsh'};
  state.statuses.prezto = {state: 'missing'};
  state.statuses['oh-my-posh'] = {state: 'installed', version: '31.4.1'};
  state.shellBackend = 'bash';
  state.prompt = {selected: 'ohMyPosh', effective: 'ohMyPosh'};
  assert.equal(toolStatusLine(state, tool('oh-my-zsh')), 'Installed · Zsh framework · used by Zsh only');
  assert.equal(toolStatusLine(state, tool('prezto')), 'Not installed · Zsh only');
  assert.equal(toolStatusLine(state, tool('oh-my-posh')), 'Installed · Active prompt provider');
  assert.ok(toolBadges(state, tool('oh-my-zsh')).includes('Zsh only'));
  state.prompt = {selected: 'nmsh', effective: 'nmsh'};
  assert.equal(toolStatusLine(state, tool('oh-my-posh')), 'Installed · Prompt provider');
  // No meaningless Configure / Install / Uninstall for a detected-only framework.
  state.detail = tool('prezto');
  const detail = renderTools(state, 120, 40).map(stripAnsi).join('\n');
  assert.doesNotMatch(detail, /C configure|I install|X uninstall/u);
  toolsKey(state, {kind: 'text', value: 'i'});
  assert.match(state.message!, /does not install or remove Prezto; it is detected only/u);
});

test('other frameworks: only documented, structural signals', () => {
  const box = sandbox();
  try {
    assert.equal(detectPrezto(box.env), undefined);
    box.put(join(box.home, '.zprezto', 'init.zsh'));
    mkdirSync(join(box.home, '.zprezto', 'modules'));
    assert.ok(detectPrezto(box.env));
    box.put(join(box.home, '.zim', 'zimfw.zsh'));
    assert.ok(detectZim(box.env));
    mkdirSync(join(box.home, '.local', 'share', 'zinit', 'zinit.git'), {recursive: true});
    assert.equal(detectZinit(box.env), undefined, 'an empty zinit directory is not an installation');
    box.put(join(box.home, '.local', 'share', 'zinit', 'zinit.git', 'zinit.zsh'));
    assert.ok(detectZinit(box.env));
    box.put(join(box.home, '.antidote', 'antidote.zsh'));
    assert.ok(detectAntidote({...box.env, HOMEBREW_PREFIX: join(box.root, 'nobrew')}));
    assert.equal(TOOLS.some(item => item.id === 'antigen'), false, 'Antigen has no stable install location, so it is not listed');
  } finally { box.done(); }
});

test('Powerlevel10k in /tools reuses the existing detector and names an Oh My Zsh custom-theme install', async () => {
  const box = sandbox();
  try {
    const theme = box.put(join(box.home, '.oh-my-zsh', 'custom', 'themes', 'powerlevel10k', 'powerlevel10k.zsh-theme'));
    const env = {...box.env, HOMEBREW_PREFIX: join(box.root, 'nobrew')};
    const existing = detectPowerlevel10k(env, box.home, powerlevel10kThemeCandidates(env, box.home).filter(path => path.startsWith(box.root)));
    assert.equal(existing.themePath, theme);
    const fact = detectPowerlevel10kTool(env, box.home);
    if (fact?.path === theme) assert.equal(fact.source, 'via Oh My Zsh');
    assert.equal(tool('powerlevel10k').promptProvider, 'powerlevel10k');
    assert.equal(knownToolForExecutable('powerlevel10k'), undefined);
    const panel = createToolsPanel();
    panel.statuses.powerlevel10k = {state: 'installed'};
    panel.detail = tool('powerlevel10k');
    assert.equal(toolsKey(panel, {kind: 'text', value: 'a'}), 'usePrompt', 'Use as prompt goes to the canonical provider setting');
    assert.equal(toolsKey(panel, {kind: 'text', value: 'c'}), 'p10kConfigure', 'Configure routes to the existing p10k configurator flow');
    const config = selectProvider(normalizePromptConfiguration({}), 'prompt', 'powerlevel10k');
    assert.equal(config?.provider, 'powerlevel10k');
  } finally { box.done(); }
});

/** A fake oh-my-posh: records argv, cwd and TTY state; behavior switches on NMSH_FAKE_OMP. */
function fakeOmp(root: string): {bin: string; log: string} {
  const bin = join(root, 'bin');
  mkdirSync(bin, {recursive: true});
  const log = join(root, 'omp.log');
  writeFileSync(join(bin, 'oh-my-posh'), `#!/bin/sh
if [ "$1" = version ]; then echo 31.4.1; exit 0; fi
: > '${log}'
for arg in "$@"; do printf 'ARG:%s\\n' "$arg" >> '${log}'; done
printf 'CWD:%s\\n' "$(pwd)" >> '${log}'
if [ -t 0 ]; then echo TTY:yes >> '${log}'; else echo TTY:no >> '${log}'; fi
case "$NMSH_FAKE_OMP" in
  sleep) sleep 10 ;;
  flood) yes xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx ;;
  fail) exit 3 ;;
esac
printf '\\033[38;2;10;20;30m~/repo\\033[0m \\033[48;2;1;2;3mmain\\033[0m\\nsecond'
`);
  chmodSync(join(bin, 'oh-my-posh'), 0o755);
  return {bin, log};
}

test('Oh My Posh provider: documented argv only, cwd and status as flags, config as argv data, no TTY, ANSI parsed', async () => {
  const box = sandbox();
  try {
    const {bin, log} = fakeOmp(box.root);
    const canary = join(box.root, 'PWNED');
    const hostileConfig = box.put(join(box.root, `cfg $(touch ${canary}) ;x`, 'my theme.omp.json'), '{}');
    const env = {...box.env, PATH: `${bin}:/usr/bin:/bin`, POSH_CONFIG: '/ignored/by/argv.json'};
    const status = await detectOhMyPosh(hostileConfig, env);
    assert.deepEqual([status.installed, status.version, status.configSource, status.configExists], [true, '31.4.1', 'nmsh', true]);
    const cwd = join(box.root, 'work dir');
    mkdirSync(cwd);
    const result = await renderOhMyPoshPrompt({cwd, project: 'w', exitStatus: 1}, status, env);
    const lines = readFileSync(log, 'utf8').trim().split('\n');
    assert.deepEqual(lines.filter(line => line.startsWith('ARG:')).map(line => line.slice(4)),
      ['print', 'primary', `--pwd=${cwd}`, '--status=1', '--terminal-width=200', '--escape=false', `--config=${hostileConfig}`]);
    assert.ok(lines.includes(`CWD:${realpathSync(cwd)}`) || lines.includes(`CWD:${cwd}`), lines.join('\n'));
    assert.ok(lines.includes('TTY:no'), 'never given a TTY');
    assert.equal(existsSync(canary), false, 'the config path is data, never shell text');
    assert.equal(result.text, '~/repo main second');
    assert.equal(result.normalizedMultiline, true);
    assert.deepEqual(result.segments[0]?.foreground, {red: 10, green: 20, blue: 30});
    assert.deepEqual(ohMyPoshArgs({cwd: '/x'}, {}), ['print', 'primary', '--pwd=/x', '--no-status', '--terminal-width=200', '--escape=false'], 'no status yet → --no-status; no config → built-in default');
    assert.deepEqual(readdirSync(box.home), [], 'no rc file or config was created');
  } finally { box.done(); }
});

test('Oh My Posh provider: timeout, output bound, cancellation and failure all reject truthfully', async () => {
  const box = sandbox();
  try {
    const {bin} = fakeOmp(box.root);
    const env = {...box.env, PATH: `${bin}:/usr/bin:/bin`};
    const status = await detectOhMyPosh(undefined, env);
    assert.equal(status.configSource, 'default');
    const context = {cwd: box.root, project: 'r', exitStatus: 0};
    const started = Date.now();
    await assert.rejects(renderOhMyPoshPrompt(context, status, {...env, NMSH_FAKE_OMP: 'sleep'}, {timeoutMs: 300}), /timed out/u);
    assert.ok(Date.now() - started < 3000);
    await assert.rejects(renderOhMyPoshPrompt(context, status, {...env, NMSH_FAKE_OMP: 'flood'}), new RegExp(`exceeded its limit`, 'u'));
    assert.ok(OH_MY_POSH_OUTPUT_LIMIT <= 256 * 1024);
    const controller = new AbortController();
    const pending = renderOhMyPoshPrompt(context, status, {...env, NMSH_FAKE_OMP: 'sleep'}, {signal: controller.signal});
    controller.abort();
    await assert.rejects(pending, /cancelled/u);
    await assert.rejects(renderOhMyPoshPrompt(context, status, {...env, NMSH_FAKE_OMP: 'fail'}), /exited with 3/u);
    await assert.rejects(renderOhMyPoshPrompt(context, {...status, installed: false, binary: undefined}, env), /not installed/u);
    await assert.rejects(renderOhMyPoshPrompt(context, {...status, configPath: join(box.root, 'missing.json'), configExists: false}, env), /config not found/u);
  } finally { box.done(); }
});

test('Oh My Posh: one canonical provider id; config path persists; curated core-formula install only', () => {
  const config = normalizePromptConfiguration({provider: 'ohMyPosh', ohMyPosh: {configPath: '/c/theme.omp.json'}});
  assert.equal(config.provider, 'ohMyPosh');
  assert.equal(config.ohMyPosh.configPath, '/c/theme.omp.json');
  assert.equal(normalizePromptConfiguration({}).ohMyPosh.configPath, null);
  assert.equal(selectProvider(normalizePromptConfiguration({}), 'prompt', 'ohMyPosh')?.provider, 'ohMyPosh');
  assert.equal(toolInstall(tool('oh-my-posh'), true, 'darwin')?.label, 'brew install oh-my-posh', 'homebrew/core formula; no custom tap');
  assert.equal(knownToolForExecutable('oh-my-posh')?.id, 'oh-my-posh');
});

test('Oh My Posh selected but missing: NMSh Native is effective and the history snapshot says so; Prompt None unaffected', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'nmsh-omp-app-'));
  const previous = {XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME, PATH: process.env.PATH};
  process.env.XDG_CONFIG_HOME = directory;
  const {TerminalApp} = await import('../src/app/TerminalApp.js');
  const app = new TerminalApp();
  try {
    app['context'] = {cwd: directory, project: 'p'};
    process.env.PATH = '/nonexistent-nmsh';
    app['promptConfiguration'].provider = 'ohMyPosh';
    await app['refreshProviderPrompt']();
    assert.equal(app['effectivePromptProvider'], 'nmsh');
    assert.match(app['externalPromptError'] ?? '', /not installed/u);
    assert.equal(app['currentPromptSnapshot']('ls')?.provider, 'nmsh');
    const {bin} = fakeOmp(directory);
    process.env.PATH = `${bin}:/usr/bin:/bin`;
    app['promptConfiguration'].provider = 'ohMyPosh';
    await app['refreshProviderPrompt']();
    assert.equal(app['effectivePromptProvider'], 'ohMyPosh');
    assert.equal(app['currentPromptSnapshot']('ls')?.provider, 'ohMyPosh', 'history records the effective provider');
    app['promptConfiguration'].provider = 'none';
    await app['refreshProviderPrompt']();
    assert.equal(app['currentPromptSnapshot']('ls'), undefined, 'Prompt None stores no prompt');
  } finally {
    process.env.PATH = previous.PATH;
    if (previous.XDG_CONFIG_HOME === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = previous.XDG_CONFIG_HOME;
    app['stop'](0);
    app['session'].kill();
    rmSync(directory, {recursive: true, force: true});
  }
});

test('Oh My Zsh guided install: NMSh never downloads or runs it; the safe settings are exact; snapshot and verify report changes', () => {
  const box = sandbox();
  try {
    for (const file of ['src/tools/frameworks.ts', 'src/tools/OhMyZshView.ts']) {
      assert.doesNotMatch(readFileSync(file, 'utf8'), /child_process|fetch\(|https\.get|spawn|exec\(/u, `${file} cannot run or fetch anything`);
    }
    const steps = OH_MY_ZSH_INSTALL.steps({HOME: '/home/me', TMPDIR: '/tmp'}).join('\n');
    assert.doesNotMatch(steps, /\/tmp\//u, 'never a predictable file in a shared temp directory');
    assert.doesNotMatch(steps, /\|\s*(?:ba|z)?sh\b|sh -c "\$\(curl/u, 'no curl | sh');
    assert.match(steps, /^curl -fsSL -o '\/home\/me\/ohmyzsh-install\.sh' https:\/\/raw\.githubusercontent\.com\/ohmyzsh\/ohmyzsh\/master\/tools\/install\.sh$/mu, 'download to a file first');
    assert.match(steps, /^less /mu, 'inspect before running');
    assert.match(steps, /KEEP_ZSHRC=yes CHSH=no RUNZSH=no REPO=ohmyzsh\/ohmyzsh REMOTE=https:\/\/github\.com\/ohmyzsh\/ohmyzsh\.git BRANCH=master sh '\/home\/me\/ohmyzsh-install\.sh' --unattended --keep-zshrc/u);

    const zshrc = box.put(join(box.home, '.zshrc'), 'export EDITOR=vim\n');
    const view = openGuidedInstall(box.env) as Extract<OhMyZshView, {kind: 'guided'}>;
    assert.match(renderOhMyZshView(view).rows.join('\n'), /will not run it for you/u);
    ohMyZshKey(view, {kind: 'text', value: 'b'});
    assert.ok(view.snapshot?.sha256 && view.snapshot.backup && existsSync(view.snapshot.backup));
    assert.equal(readFileSync(view.snapshot.backup, 'utf8'), 'export EDITOR=vim\n');
    assert.equal(readFileSync(zshrc, 'utf8'), 'export EDITOR=vim\n', 'the original is not renamed or edited');

    // The person runs a (fixture) installer that honours KEEP_ZSHRC.
    omzTree(box.put, join(box.home, '.oh-my-zsh'));
    ohMyZshKey(view, {kind: 'text', value: 'v'});
    assert.equal(view.unexpected, false);
    assert.match(view.verified!.join('\n'), /Oh My Zsh found at .*\.oh-my-zsh\.[\s\S]*\.zshrc is unchanged/u);

    // A misbehaving installer rewrites .zshrc anyway: reported, never restored silently.
    writeFileSync(zshrc, 'source $ZSH/oh-my-zsh.sh\n');
    writeFileSync(join(box.home, '.zshrc.pre-oh-my-zsh'), 'export EDITOR=vim\n');
    ohMyZshKey(view, {kind: 'text', value: 'v'});
    assert.equal(view.unexpected, true);
    assert.match(renderOhMyZshView(view).rows.join('\n'), /! UNEXPECTED: .*\.zshrc changed although KEEP_ZSHRC=yes was requested\. Your backup is .*NMSh did not restore anything/u);
    assert.match(view.verified!.join('\n'), /\.zshrc\.pre-oh-my-zsh exists/u);
    assert.equal(readFileSync(zshrc, 'utf8'), 'source $ZSH/oh-my-zsh.sh\n');
  } finally { box.done(); }
});

test('previous zshrc: compare, default No changes nothing, restore backs up and replaces atomically, never merges', () => {
  const box = sandbox();
  try {
    assert.equal(previousZshrc(box.env), undefined);
    const current = box.put(join(box.home, '.zshrc'), 'export ZSH=~/.oh-my-zsh\nsource $ZSH/oh-my-zsh.sh\n');
    const previous = box.put(join(box.home, '.zshrc.pre-oh-my-zsh'), 'alias ll="ls -l"\n');
    const view = openPrevious(box.env) as Extract<OhMyZshView, {kind: 'previous'}>;
    const text = renderOhMyZshView(view).rows.join('\n');
    assert.match(text, /does not mean anything is wrong/u);
    assert.match(text, /sha256 [0-9a-f]{16}…/u);
    assert.match(text, /\+ alias ll="ls -l"/u);
    assert.deepEqual(ohMyZshKey(view, {kind: 'text', value: 'e'}), {open: [current, previous]});
    ohMyZshKey(view, {kind: 'text', value: 'r'});
    assert.equal(view.confirm?.choice, 'no', 'restore starts on No');
    ohMyZshKey(view, enter);
    assert.match(view.result!, /Cancelled\. Nothing was changed/u);
    assert.equal(readFileSync(current, 'utf8'), 'export ZSH=~/.oh-my-zsh\nsource $ZSH/oh-my-zsh.sh\n');

    ohMyZshKey(view, {kind: 'text', value: 'r'});
    ohMyZshKey(view, {kind: 'right'});
    ohMyZshKey(view, enter);
    assert.match(view.result!, /Restored .* backed up at .*\.zshrc\.nmsh-backup-/u);
    assert.equal(readFileSync(current, 'utf8'), 'alias ll="ls -l"\n', 'the previous file exactly; nothing merged');
    assert.ok(existsSync(previous), 'the previous file stays');
    const backup = readdirSync(box.home).find(name => name.startsWith('.zshrc.nmsh-backup-'))!;
    assert.equal(readFileSync(join(box.home, backup), 'utf8'), 'export ZSH=~/.oh-my-zsh\nsource $ZSH/oh-my-zsh.sh\n');

    // Changed since review: refused.
    const again = openPrevious(box.env) as Extract<OhMyZshView, {kind: 'previous'}>;
    writeFileSync(current, 'edited meanwhile\n');
    ohMyZshKey(again, {kind: 'text', value: 'r'});
    ohMyZshKey(again, {kind: 'right'});
    ohMyZshKey(again, enter);
    assert.match(again.result!, /changed since review; nothing was written/u);
    assert.equal(readFileSync(current, 'utf8'), 'edited meanwhile\n');
  } finally { box.done(); }
});

test('dotfiles: OMZ, p10k and Oh My Posh files are inspect-only; OMP gets no exact copy; Theme Studio import stays static', () => {
  const box = sandbox();
  try {
    const repo = join(box.root, 'repo');
    const canary = join(box.root, 'PWNED');
    box.put(join(repo, '.zshrc'), `export ZSH=$HOME/.oh-my-zsh\nZSH_THEME=agnoster\nplugins=(git)\nsource $ZSH/oh-my-zsh.sh\ntouch ${canary}\n`);
    box.put(join(repo, '.zshrc.pre-oh-my-zsh'), `touch ${canary}\n`);
    box.put(join(repo, '.oh-my-zsh', 'custom', 'themes', 'mine.zsh-theme'), `PROMPT='$(touch ${canary})%~ '\n`);
    box.put(join(repo, '.p10k.zsh'), `typeset -g POWERLEVEL9K_MODE=nerdfont-v3\ntouch ${canary}\n`);
    box.put(join(repo, 'posh', 'a.omp.json'), JSON.stringify({extends: 'https://example.invalid/remote.omp.json', palette: {accent: '#ff0000'},
      blocks: [{type: 'prompt', segments: [{type: 'path', background: '#224466', foreground: '#ffffff', template: '{{ .Path }}'}, {type: 'command', properties: {command: `touch ${canary}`}, template: '{{ .Env.HOME }}', background: 'p:accent', foreground: '#ffffff'}]}]}));
    box.put(join(repo, 'posh', 'b.omp.yaml'), 'blocks:\n  - type: prompt\n    segments:\n      - type: path\n        background: "#112233"\n        foreground: "#ffffff"\n');
    box.put(join(repo, 'posh', 'c.omp.toml'), `[[blocks]]\ntype = "prompt"\n[[blocks.segments]]\ntype = "command"\nbackground = "#334455"\nforeground = "#ffffff"\ntemplate = "{{ .Shell }}"\n[blocks.segments.properties]\ncommand = "touch ${canary}"\n`);
    const scan = scanDotfiles(repo) as ScanResult;
    const by = (path: string) => scan.found.find(file => file.repoPath === path)?.tool.id;
    assert.equal(by('.zshrc'), 'zsh');
    assert.equal(by('.zshrc.pre-oh-my-zsh'), 'oh-my-zsh');
    assert.equal(by('.oh-my-zsh/custom/themes/mine.zsh-theme'), 'oh-my-zsh');
    assert.equal(by('.p10k.zsh'), 'powerlevel10k');
    for (const path of ['posh/a.omp.json', 'posh/b.omp.yaml', 'posh/c.omp.toml']) assert.equal(by(path), 'oh-my-posh', path);
    const items = buildPlan(scan, box.env);
    for (const item of items) {
      assert.deepEqual(item.modes, ['skip'], `${item.file.repoPath}: ${item.note}`);
      assert.notEqual(item.kind, 'copy');
      item.mode = 'copy';
    }
    assert.match(items.find(item => item.file.repoPath === 'posh/a.omp.json')!.note, /Inspect only: .*never copied\. Import its static colors/u);
    assert.ok(applyPlan(items, box.env).every(line => /no exact-copy authority/u.test(line)));
    assert.deepEqual(readdirSync(box.home), [], 'nothing was written');

    const imported = readThemeImport(join(repo, 'posh', 'a.omp.json'), repo, 'auto');
    assert.ok(!('errors' in imported), JSON.stringify(imported));
    if (!('errors' in imported)) {
      assert.ok(imported.warnings.some(warning => /never fetched or merged/u.test(warning)), 'remote extends are not followed');
      assert.ok(imported.warnings.some(warning => /templates are not imported/u.test(warning)));
    }
    readThemeImport(join(repo, 'posh', 'c.omp.toml'), repo, 'auto');
    assert.equal(existsSync(canary), false, 'nothing ran during scan, plan, apply or import');
  } finally { box.done(); }
});

test('Ask: framework requests map onto facts, /tools views or a typed provider switch; never a shell command', () => {
  const box = sandbox();
  try {
    const ask = (text: string) => resolveConfigRequest(text, box.env) as {kind: string; text: string; action?: {kind: string; tool?: string; view?: string; setting?: string; value?: string}} | undefined;
    assert.match(ask('is oh my zsh installed')!.text, /^No\./u);
    omzTree(box.put, join(box.home, '.oh-my-zsh'));
    assert.match(ask('is oh my zsh installed')!.text, /^Yes\. Oh My Zsh is installed at .*Zsh only/u);
    assert.deepEqual([ask('install oh my zsh safely')!.action?.kind, ask('install oh my zsh safely')!.action?.view], ['toolView', 'guided']);
    assert.match(ask('what happened to my old zshrc')!.text, /no \.zshrc\.pre-oh-my-zsh/u);
    box.put(join(box.home, '.zshrc.pre-oh-my-zsh'), 'x\n');
    for (const request of ['what happened to my old zshrc', 'show my pre oh my zsh config', 'restore my previous zshrc']) {
      assert.deepEqual([ask(request)!.action?.kind, ask(request)!.action?.view], ['toolView', 'previous'], request);
    }
    assert.deepEqual([ask('use oh my posh as my prompt')!.action?.setting, ask('use oh my posh as my prompt')!.action?.value], ['prompt', 'ohMyPosh']);
    assert.equal(ask('import my oh my posh theme into nmsh')!.action?.view, 'importAppearance');
    assert.equal(ask('configure powerlevel10k')!.action?.view, 'p10kConfigure');
    assert.deepEqual([ask('use powerlevel10k')!.action?.setting, ask('use powerlevel10k')!.action?.value], ['prompt', 'powerlevel10k']);
    const install = ask('install oh my posh');
    assert.ok(install?.action?.kind === 'installTool' || install?.action?.kind === 'toolView', JSON.stringify(install));
    for (const request of ['install oh my zsh safely', 'restore my previous zshrc', 'use oh my posh as my prompt']) {
      assert.doesNotMatch(JSON.stringify(ask(request)), /curl|\| ?sh|chsh|argv/u, request);
    }
  } finally { box.done(); }
});
