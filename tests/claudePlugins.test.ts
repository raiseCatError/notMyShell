import test from 'node:test';
import assert from 'node:assert/strict';
import {chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {claudePluginEntries, drawsOnly, inspectPlugin, managedRuntime, readComponents, setPluginEnabled, standaloneSkills} from '../src/agents/mods/claudePlugins.js';
import {withLoadedIn} from '../src/agents/mods/inventory.js';
import {ModsController, modsKeyAction} from '../src/agents/mods/controller.js';
import {renderMods} from '../src/agents/mods/view.js';
import type {ModEntry} from '../src/agents/mods/model.js';
import type {AgentSession} from '../src/agents/sessions/model.js';
import {emptyTelemetry} from '../src/agents/telemetry.js';
import {setIconStyle} from '../src/ui/glyphs.js';
import {displayWidth, stripAnsi} from '../src/util/text.js';
import type {Key} from '../src/terminal/keys.js';

const root = mkdtempSync(join(tmpdir(), 'nmsh-plugins-'));
test.after(() => rmSync(root, {recursive: true, force: true}));
const write = (path: string, content: string) => { mkdirSync(join(path, '..'), {recursive: true}); writeFileSync(path, content); };

/** Two launch identities, each with its own plugins folder, as separate accounts are usually laid out. */
function plugin(account: string, name: string, files: Record<string, string>): string {
  const dir = join(root, account, 'plugins', 'cache', 'market', name, '1.0.0');
  for (const [file, content] of Object.entries(files)) write(join(dir, file), content);
  return dir;
}
const skins = plugin('account1', 'skins', {'.claude-plugin/plugin.json': JSON.stringify({name: 'skins', version: '1.0.0', description: 'Themed transcript rows'}), 'hooks/hooks.json': '{"modules": ["./register.tsx"]}',
  'hooks/register.tsx': 'throw new Error("discovery must never run plugin code")', 'skills/skin-designer/SKILL.md': '---\ndescription: d\n---'});
const guard = plugin('account1', 'guard', {'.claude-plugin/plugin.json': JSON.stringify({name: 'guard', dependencies: ['base@market']}), 'hooks/hooks.json': JSON.stringify({hooks: {PreToolUse: [], Stop: []}}),
  'agents/reviewer.md': '#', 'commands/check.md': '#', '.mcp.json': '{"mcpServers": {}}'});
const project = join(root, 'project');
write(join(project, '.claude', 'settings.local.json'), JSON.stringify({enabledPlugins: {'guard@market': false}}));
const LISTING = [
  {id: 'skins@market', scope: 'user', version: '1.0.0', enabled: true, installPath: skins, projectEnabled: false},
  {id: 'guard@market', scope: 'user', version: '1.0.0', enabled: true, installPath: guard, projectEnabled: false},
  {id: 'guard@market', scope: 'project', version: '0.9.0', enabled: true, installPath: guard, projectPath: project},
  {id: 'elsewhere@market', scope: 'project', enabled: true, projectPath: '/some/other/project'},
  {id: '../../etc@x', scope: 'user', enabled: true},
];

test('components come from manifest files only; plugin code is never run', async () => {
  const mod = await readComponents(skins);
  assert.deepEqual(mod.components, {mod: true, hookEvents: 0, skills: 1, agents: 0, commands: 0, mcp: false, lsp: false});
  assert.equal(mod.description, 'Themed transcript rows');
  const hooks = await readComponents(guard);
  assert.deepEqual(hooks.components, {mod: false, hookEvents: 2, skills: 0, agents: 1, commands: 1, mcp: true, lsp: false});
  assert.deepEqual(hooks.dependencies, ['base@market']);
  assert.match(managedRuntime(mod.components), /^Mod hooks run in NMSh-managed sessions; panes, bands and restyled rows it draws do not appear there; 1 skill load$/u);
  assert.match(managedRuntime(mod.components, true), /nothing of it appears in NMSh-managed sessions/u);
  assert.ok(drawsOnly(['ui.render{component=Pane}']) && !drawsOnly(['tool.call{tool=Bash}', 'ui.render{component=Pane}']));
});

test('entries: types, this project only, effective state with project overrides, conflicts and dependencies in words', async () => {
  const entries = await claudePluginEntries(LISTING, project, {name: 'account1', configDir: join(root, 'account1')});
  assert.deepEqual(entries.map(entry => [entry.id, entry.nativeType, entry.scope, entry.enabled]),
    [['skins@market', 'Mod', 'global', 'yes'], ['guard@market', 'Plugin', 'global', 'no'], ['guard@market', 'Plugin', 'project', 'yes']],
    'another project\'s installation is not shown; an unsafe id is dropped');
  const user = entries[1]!;
  assert.match(user.notes!.join('\n'), /Disabled for this project by \.claude\/settings\.local\.json \(user setting: enabled\)/u);
  assert.match(user.notes!.join('\n'), /Also installed at project scope \(version 0\.9\.0\)/u);
  assert.match(user.notes!.join('\n'), /Depends on base@market/u);
  assert.deepEqual(user.toggle, {supported: false, reason: 'This project\'s .claude/settings.local.json decides it here; NMSh changes only the scope a plugin is installed at'});
  assert.deepEqual(entries[0]!.toggle, {supported: true});
  assert.deepEqual(entries[0]!.claude, {pluginId: 'skins@market', scope: 'user', configDir: join(root, 'account1')});
  assert.equal(entries[0]!.sandbox, 'No', 'never presented as sandboxed by NMSh');
  await assert.rejects(claudePluginEntries({not: 'a list'}, project), /unsupported shape/u);
});

test('standalone skills are listed with no fake switch', async () => {
  write(join(root, 'account2', 'skills', 'brag', 'SKILL.md'), '---\nname: brag\ndescription: "Turn a project into a launch video"\n---\n');
  write(join(root, 'account2', 'skills', 'synced', 'x', 'SKILL.md'), '---\n---');
  const skills = await standaloneSkills(join(root, 'account2'), 'account2');
  assert.deepEqual(skills.map(entry => [entry.name, entry.nativeType, entry.description, entry.toggle?.supported]), [['brag', 'Skill', 'Turn a project into a launch video', false]]);
});

/* A stand-in for Claude's own plugin command: records argv, CLAUDE_CONFIG_DIR and cwd; answers in the 2.1.295 JSON shape. */
const fake = join(root, 'claude');
const log = join(root, 'calls.jsonl');
writeFileSync(fake, `#!/usr/bin/env node
const fs = require('fs');
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({args, configDir: process.env.CLAUDE_CONFIG_DIR, cwd: process.cwd()}) + '\\n');
if (args[0] === 'plugin' && (args[1] === 'enable' || args[1] === 'disable')) {
  if (args[2] === 'skins@market' && args[1] === 'enable') { console.log(JSON.stringify({command: 'enable', outcome: 'failed', plugin: args[2], scope: 'user', message: 'Plugin "skins@market" is already enabled at user scope', failureCode: 'already_in_goal_state', alreadyInGoalState: true})); process.exit(1); }
  if (args[2] === 'broken@market') { console.log(JSON.stringify({command: args[1], outcome: 'failed', plugin: args[2], scope: 'user', message: 'Plugin not found'})); process.exit(1); }
  console.log(JSON.stringify({command: args[1], outcome: 'ok', plugin: args[2], pluginId: args[2], scope: args[4], message: 'Successfully ' + args[1] + 'd plugin'}));
} else if (args[0] === 'plugin' && args[1] === 'details') {
  console.log('skins 1.0.0\\n  Description: Themed transcript rows\\nComponent inventory\\n  Skills (1)  skin-designer\\nProjected token cost\\n  Always-on:   ~115 tok');
} else if (args[0] === 'plugin' && args[1] === 'validate') {
  console.log('Validating hooks: x\\n  ❯ ./register.tsx hooks: tool.call{tool=Bash}, ui.render{component=Pane}\\n  ❯ ./register.tsx calls: $.ui.open, $.process.run\\n✔ Validation passed');
}
`);
chmodSync(fake, 0o755);
const calls = () => existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').map(line => JSON.parse(line) as {args: string[]; configDir?: string; cwd: string}) : [];

test('toggle: Claude\'s own command at the installed scope and account; unknown ids are never sent', async () => {
  const entries = await claudePluginEntries(LISTING, project, {name: 'account1', configDir: join(root, 'account1')});
  const installed = new Set(entries.map(entry => entry.claude!.pluginId));
  const skinsEntry = entries[0]!;
  assert.deepEqual(await setPluginEnabled(fake, skinsEntry, false, installed), {ok: true, message: 'Successfully disabled plugin'});
  const disable = calls().at(-1)!;
  assert.deepEqual(disable.args, ['plugin', 'disable', 'skins@market', '--scope', 'user', '--json']);
  assert.equal(disable.configDir, join(root, 'account1'), 'the change goes to that account\'s configuration, not the default one');
  assert.deepEqual(await setPluginEnabled(fake, skinsEntry, true, installed), {ok: true, message: 'Plugin "skins@market" is already enabled at user scope', alreadyInGoalState: true});
  const projectEntry = entries[2]!;
  await setPluginEnabled(fake, projectEntry, false, installed);
  assert.deepEqual(calls().at(-1)!.args.slice(3), ['--scope', 'project', '--json']);
  assert.equal(calls().at(-1)!.cwd.replace(/^\/private/u, ''), project.replace(/^\/private/u, ''), 'project scope runs in that project');
  const before = calls().length;
  // Claude's own enable accepts an id that is not installed and writes it into settings; NMSh never sends one.
  const ghost: ModEntry = {...skinsEntry, claude: {...skinsEntry.claude!, pluginId: 'nope@nowhere'}};
  assert.deepEqual(await setPluginEnabled(fake, ghost, true, installed), {ok: false, message: 'Not an installed Claude plugin in the current listing'});
  assert.equal(calls().length, before, 'no command ran');
  const broken: ModEntry = {...skinsEntry, claude: {...skinsEntry.claude!, pluginId: 'broken@market'}};
  assert.deepEqual(await setPluginEnabled(fake, broken, true, new Set(['broken@market'])), {ok: false, message: 'Plugin not found'}, "Claude's refusal is reported as it worded it");
});

test('inspect: Claude\'s own static descriptions; a mod\'s hooks and calls are listed', async () => {
  const [skinsEntry] = await claudePluginEntries(LISTING, project, {name: 'account1', configDir: join(root, 'account1')});
  const inspection = await inspectPlugin(fake, skinsEntry!);
  assert.match(inspection.details ?? '', /Always-on: {3}~115 tok/u);
  assert.deepEqual(inspection.hooks, ['tool.call{tool=Bash}', 'ui.render{component=Pane}']);
  assert.deepEqual(inspection.calls, ['$.ui.open', '$.process.run']);
  assert.deepEqual(calls().at(-1)!.args, ['plugin', 'validate', skins]);
});

test('loaded in: only managed targets of the same account whose own report names the plugin', async () => {
  const entries = await claudePluginEntries(LISTING, project, {name: 'account1', configDir: join(root, 'account1')});
  const target = (title: string, profileId: string | undefined, plugins: string[]): AgentSession => {
    const telemetry = emptyTelemetry();
    telemetry.runtime = {tools: [], mcpServers: [], slashCommands: [], skills: [], plugins: plugins.map(name => ({name})), capabilities: [], at: 1};
    return {id: title, title, harness: 'claude', level: 'managed', ...(profileId ? {profileId} : {}), cwd: '/w', startedAt: 0, state: 'waiting', events: [], attention: false, updatedAt: 0, telemetry};
  };
  const marked = withLoadedIn(entries, [target('Fix login', 'account1', ['skins']), target('Other account', 'account2', ['skins']), target('Without it', 'account1', [])]);
  assert.deepEqual(marked[0]!.loadedIn, ['Fix login']);
  assert.deepEqual(marked[1]!.loadedIn, []);
});

const key = (kind: string, value = ''): Key => ({kind, value} as unknown as Key);

test('keyboard: Space proposes, Enter confirms, any other key cancels; unsupported entries explain instead of toggling', async () => {
  const entries = await claudePluginEntries(LISTING, project, {name: 'account1', configDir: join(root, 'account1')});
  const c = new ModsController();
  c.setInventory(entries);
  c.tab = 'Provider-native';
  const press = (k: Key) => { const action = modsKeyAction(k, c.owner); return action ? c.dispatch(action) : undefined; };
  assert.equal(c.selectedEntry?.id, 'skins@market');
  assert.equal(press(key('text', ' ')), undefined);
  assert.deepEqual(c.confirm, {key: entries[0]!.key, enable: false});
  assert.match(stripAnsi(renderMods(c, 100, 30).join('\n')), /Disable skins for account1 at user scope\? Enter confirms · Esc cancels/u);
  assert.match(stripAnsi(renderMods(c, 100, 30).at(-1)!), /^Enter confirm · Esc cancel$/u);
  assert.equal(press(key('down')), undefined, 'moving cancels');
  assert.equal(c.confirm, undefined);
  assert.equal(c.message, 'Change cancelled.');
  assert.equal(c.selectedEntry?.id, 'skins@market', 'the cancelling key does nothing else');
  press(key('text', ' '));
  assert.equal(press(key('enter')), 'toggle');
  c.confirm = undefined;
  press(key('down'));
  press(key('text', ' '));
  assert.equal(c.confirm, undefined);
  assert.match(c.message ?? '', /^Can't toggle here: This project's \.claude\/settings\.local\.json decides it here/u);
  c.busy = 'Disabling skins…';
  assert.equal(press(key('escape')), undefined, 'keys wait while Claude runs the command');
  c.busy = undefined;
  assert.equal(press(key('text', 'i')), 'inspect');
});

test('rendering: every width fits; NO_COLOR and Safe glyphs keep type, state and the runtime truth in words', async () => {
  const entries = await claudePluginEntries(LISTING, project, {name: 'account1', configDir: join(root, 'account1')});
  const c = new ModsController();
  c.setInventory(entries);
  c.tab = 'Provider-native';
  for (const columns of [30, 44, 60, 100, 160]) for (const details of [false, true]) {
    c.details = details;
    const rows = renderMods(c, columns, 28);
    assert.ok(rows.every(row => displayWidth(stripAnsi(row)) <= columns), `${columns} ${details}`);
    assert.match(stripAnsi(rows.at(-1)!), /Esc/u);
  }
  c.details = false;
  assert.match(stripAnsi(renderMods(c, 100, 28).join('\n')), /skins +enabled +Mod · global · 1\.0\.0/u);
  c.details = true;
  const detail = stripAnsi(renderMods(c, 100, 60).join('\n'));
  assert.match(detail, /Type +Mod: code that runs inside Claude Code/u);
  assert.match(detail, /In sessions +Mod hooks run in NMSh-managed sessions; panes, bands and restyled rows it draws do/u);
  assert.match(detail, /Sandbox +none from NMSh/u);
  assert.match(detail, /Change +Space runs Claude's own claude plugin disable at user scope for account1\./u);
  const before = process.env.NO_COLOR;
  setIconStyle('safe');
  process.env.NO_COLOR = '1';
  try {
    c.details = false;
    const plain = renderMods(c, 80, 28).join('\n');
    assert.doesNotMatch(plain, /\u001b\[(?:38|48);/u);
    assert.doesNotMatch(stripAnsi(plain), /[↑↓›▏]/u);
    assert.match(stripAnsi(plain), /skins +enabled/u);
  } finally { setIconStyle('nerd'); if (before === undefined) delete process.env.NO_COLOR; else process.env.NO_COLOR = before; }
});

test('the real installed Claude, read-only: every listed plugin parses, with a type and a state (skipped without claude)', {skip: spawnSync('sh', ['-c', 'command -v claude'], {encoding: 'utf8'}).status !== 0 || !process.env.NMSH_REAL_CLAUDE ? 'set NMSH_REAL_CLAUDE=1 to read the real accounts' : false}, async () => {
  const {listClaudePlugins} = await import('../src/agents/mods/claudePlugins.js');
  for (const configDir of (process.env.NMSH_REAL_CLAUDE_DIRS ?? '').split(':').filter(Boolean)) {
    const entries = await claudePluginEntries(await listClaudePlugins('claude', process.cwd(), configDir), process.cwd(), {name: configDir, configDir});
    assert.ok(entries.every(entry => entry.nativeType && entry.enabled !== 'unknown'), configDir);
  }
});
