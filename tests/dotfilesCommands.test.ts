import test from 'node:test';
import assert from 'node:assert/strict';
import {chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {chezmoiTarget, isRemoteSource, scanDotfiles, type ScanResult} from '../src/dotfiles/scan.js';
import {applyPlan, buildPlan, reviewLines} from '../src/dotfiles/plan.js';
import {createDotfilesPanel, dotfilesKey} from '../src/dotfiles/DotfilesPanel.js';
import {parseSlashCommand, slashCommands} from '../src/commands/slashCommands.js';
import {paletteItems} from '../src/ui/CommandPalette.js';
import {helpMarkdown} from '../src/help/helpContent.js';

const sandbox = () => {
  const root = mkdtempSync(join(tmpdir(), 'nmsh-dotfiles-'));
  const home = join(root, 'home');
  const repo = join(root, 'repo');
  mkdirSync(home);
  mkdirSync(repo);
  const put = (path: string, text: string) => { mkdirSync(dirname(join(repo, path)), {recursive: true}); writeFileSync(join(repo, path), text); };
  return {root, home, repo, put, env: {HOME: home, XDG_CONFIG_HOME: join(home, '.config')} as NodeJS.ProcessEnv, done: () => rmSync(root, {recursive: true, force: true})};
};
const snapshot = (dir: string): string => readdirSync(dir, {recursive: true}).map(String).sort().map(name => {
  const info = statSync(join(dir, name), {throwIfNoEntry: false});
  return `${name}:${info?.isFile() ? readFileSync(join(dir, name), 'utf8') : ''}`;
}).join('\n');
const scan = (dir: string) => { const result = scanDotfiles(dir); assert.ok(!('error' in result)); return result as ScanResult; };

test('dotfiles: plain, Stow and chezmoi layouts are recognized; scripts are listed and never run', () => {
  const box = sandbox();
  try {
    const marker = join(box.root, 'ran');
    box.put('install.sh', `#!/bin/sh\ntouch '${marker}'\n`);
    chmodSync(join(box.repo, 'install.sh'), 0o755);
    box.put('.tmux.conf', 'set -g mouse on\n');
    box.put('.zshrc', 'echo hi\n');
    const plain = scan(box.repo);
    assert.equal(plain.type, 'plain');
    assert.deepEqual(plain.found.map(file => file.tool.id).sort(), ['tmux', 'zsh']);
    assert.deepEqual(plain.scripts, ['install.sh']);
    const items = buildPlan(plain, box.env);
    assert.equal(items.find(item => item.file.tool.id === 'zsh')!.kind, 'inspect', 'shell rc is executable config: inspect only');
    assert.equal(readdirSync(box.root).includes('ran'), false);
  } finally { box.done(); }
  const stow = sandbox();
  try {
    stow.put('tmux/.tmux.conf', 'set -g mouse on\n');
    stow.put('starship/.config/starship.toml', 'add_newline = false\n');
    const result = scan(stow.repo);
    assert.equal(result.type, 'stow');
    assert.deepEqual(result.packages.sort(), ['starship', 'tmux']);
    assert.ok(result.found.some(file => file.package === 'starship' && file.target === '.config/starship.toml'));
  } finally { stow.done(); }
  const chezmoi = sandbox();
  try {
    chezmoi.put('dot_tmux.conf', 'set -g mouse on\n');
    chezmoi.put('private_dot_config/starship.toml.tmpl', 'format = "{{ .chezmoi.hostname }}"\n');
    chezmoi.put('run_once_install.sh', 'exit 1\n');
    const result = scan(chezmoi.repo);
    assert.equal(result.type, 'chezmoi');
    assert.deepEqual(chezmoiTarget('private_dot_config/executable_x.tmpl'), {target: '.config/x', templated: true});
    const items = buildPlan(result, chezmoi.env);
    assert.equal(items.find(item => item.file.tool.id === 'starship')!.kind, 'templated', 'templates are never rendered');
    assert.ok(result.scripts.includes('run_once_install.sh'));
  } finally { chezmoi.done(); }
});

test('dotfiles: symlinks, oversized, malformed and binary files are skipped with a reason', () => {
  const box = sandbox();
  try {
    writeFileSync(join(box.root, 'secret'), 'set -g mouse on\n');
    symlinkSync(join(box.root, 'secret'), join(box.repo, '.tmux.conf'));
    box.put('.config/starship.toml', 'this is = = not toml');
    box.put('.config/helix/config.toml', 'x'.repeat(600 * 1024));
    box.put('.config/bat/config', 'a\u0000b');
    const items = buildPlan(scan(box.repo), box.env);
    const by = (id: string) => items.find(item => item.file.tool.id === id)!;
    assert.match(by('tmux').note, /Symlink/u);
    assert.match(by('starship').note, /Not valid TOML/u);
    assert.match(by('helix').note, /512 KiB/u);
    assert.match(by('bat').note, /Binary/u);
    assert.ok(items.every(item => item.mode === 'skip'));
  } finally { box.done(); }
});

test('dotfiles: field-level choices keep current values on conflict; review defaults to No; apply backs up and leaves the repository unchanged', () => {
  const box = sandbox();
  try {
    writeFileSync(join(box.home, '.tmux.conf'), 'set -g mouse off\n');
    box.put('.tmux.conf', 'set -g mouse on\nset -g escape-time 10\nrun-shell ~/x.sh\n');
    box.put('.config/starship.toml', 'add_newline = false\n');
    mkdirSync(join(box.home, '.config'), {recursive: true});
    writeFileSync(join(box.home, '.config', 'starship.toml'), 'add_newline = true\n');
    const before = snapshot(box.repo);
    const items = buildPlan(scan(box.repo), box.env);
    const tmux = items.find(item => item.file.tool.id === 'tmux')!;
    const mouse = tmux.fields!.find(field => field.label === 'Mouse')!;
    assert.deepEqual([mouse.conflict, mouse.use, mouse.current], [true, false, 'off'], 'a conflict keeps your value unless chosen');
    assert.equal(tmux.fields!.find(field => field.repo === '10')!.use, true);
    assert.match(tmux.note, /1 dynamic lines never run/u);
    const starship = items.find(item => item.file.tool.id === 'starship')!;
    assert.equal(starship.mode, 'skip', 'copying a whole file is opt-in');
    starship.mode = 'copy';

    const panel = createDotfilesPanel(box.repo);
    panel.step = 'review';
    panel.review = {lines: reviewLines(items, []), yes: false};
    assert.equal(dotfilesKey(panel, {kind: 'enter'}), undefined, 'Enter on the default No applies nothing');
    assert.match(panel.message!, /Nothing was changed/u);
    assert.match(reviewLines(items, []).join('\n'), /0 scripts run · the repository is not changed/u);

    const results = applyPlan(items, box.env, new Date('2026-01-02T03:04:05Z'));
    assert.equal(results.length, 2, results.join('\n'));
    assert.equal(readFileSync(join(box.home, '.config', 'starship.toml'), 'utf8'), 'add_newline = false\n');
    assert.ok(readdirSync(join(box.home, '.config')).some(name => name.startsWith('starship.toml.nmsh-backup-')));
    assert.equal(readFileSync(join(box.home, '.tmux.conf'), 'utf8'), 'set -g mouse off\n', 'your tmux.conf is untouched (include is a separate reviewed step)');
    assert.equal(snapshot(box.repo), before, 'the repository is never modified');
  } finally { box.done(); }
});

test('dotfiles: copy refuses when the destination changed since review; remote sources need a confirmed clone', () => {
  const box = sandbox();
  try {
    box.put('.config/starship.toml', 'add_newline = false\n');
    const items = buildPlan(scan(box.repo), box.env);
    items[0]!.mode = 'copy';
    mkdirSync(join(box.home, '.config'), {recursive: true});
    writeFileSync(join(box.home, '.config', 'starship.toml'), 'appeared later\n');
    assert.match(applyPlan(items, box.env)[0]!, /disappeared|changed since review/u);
    assert.equal(readFileSync(join(box.home, '.config', 'starship.toml'), 'utf8'), 'appeared later\n');
  } finally { box.done(); }
  assert.equal(isRemoteSource('https://github.com/me/dotfiles'), true);
  assert.equal(isRemoteSource('~/dotfiles'), false);
  assert.equal(isRemoteSource('https://x/y; rm -rf ~'), false);
  const panel = createDotfilesPanel();
  panel.step = 'clone';
  panel.clone = {url: 'https://github.com/me/dotfiles', target: '/tmp/x', yes: false};
  assert.equal(dotfilesKey(panel, {kind: 'enter'}), undefined);
  assert.match(panel.message!, /Nothing was downloaded/u);
});

test('commands: aliases normalize to one action; provider shortcuts; leaf settings are not commands', () => {
  const same = (a: string, b: string) => assert.deepEqual(parseSlashCommand(a), parseSlashCommand(b), `${a} = ${b}`);
  same('/composer', '/layout');
  same('/glyph', '/glyphs');
  same('/strip', '/status-strip');
  same('/pickers', '/picker');
  same('/picker', '/providers picker');
  same('/tmux', '/configure tmux');
  assert.deepEqual(parseSlashCommand('/history-provider'), {kind: 'providers', family: 'history'});
  assert.deepEqual(parseSlashCommand('/history'), {kind: 'history', query: ''}, '/history stays the history picker');
  for (const [command, kind] of [['/motion', 'motion'], ['/chrome', 'chrome'], ['/integrations', 'integrations'], ['/dotfiles', 'dotfiles'], ['/configure', 'configure']] as const) assert.equal(parseSlashCommand(command)!.kind, kind);
  assert.deepEqual(parseSlashCommand('/dotfiles ~/dots'), {kind: 'dotfiles', source: '~/dots'});
  for (const leaf of ['/shimmer', '/folding', '/mouse', '/prefix']) assert.equal(parseSlashCommand(leaf)!.kind, 'unknown', `${leaf} is a setting, not a command`);
  const names = new Set(slashCommands.map(command => command.name));
  for (const alias of slashCommands.filter(command => command.alias)) assert.ok(names.has(alias.alias!), `${alias.name} points at a real command`);
});

test('palette and help list each new surface once, with human labels and grouped help', () => {
  const items = paletteItems();
  const commandIds = items.map(item => item.id);
  assert.equal(new Set(commandIds).size, commandIds.length, 'no duplicate palette entries');
  for (const alias of ['/composer', '/glyph', '/status-strip', '/pickers']) assert.ok(!items.some(item => item.detail.startsWith(alias) || item.label === alias), `${alias} not listed twice`);
  const help = String(helpMarkdown());
  for (const group of ['Appearance', 'Composer & transcript', 'Providers', 'Tools & integration']) assert.match(help, new RegExp(`### ${group}`, 'u'));
  for (const command of ['/motion', '/chrome', '/glyphs', '/strip', '/tmux', '/configure', '/integrations', '/dotfiles', '/history-provider']) assert.ok(help.includes(`\`${command}\``), command);
  assert.match(help, /`\/layout` \(also `\/composer`\)/u);
});
