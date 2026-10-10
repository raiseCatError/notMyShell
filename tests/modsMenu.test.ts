import test from 'node:test';
import assert from 'node:assert/strict';
import {ModsController} from '../src/agents/mods/controller.js';
import {claudeInventory} from '../src/agents/mods/claudeDiscovery.js';
import {builtinModInventory, type ModEntry} from '../src/agents/mods/model.js';
import {modExecution, modGroup, modState, renderMods} from '../src/agents/mods/view.js';
import {renderTabStrip} from '../src/ui/PanelShell.js';
import {setIconStyle} from '../src/ui/glyphs.js';
import {displayWidth, stripAnsi} from '../src/util/text.js';

const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u;
const SGR = /\u001b\[[0-9;]*m/gu;

const pack: ModEntry = {key: 'pack:builtin:node', id: 'node', name: 'Node.js', kind: 'Context Packs', provider: 'nmsh', source: 'NMSh bundled Context Pack', scope: 'global', installedBy: 'nmsh',
  enabled: 'unknown', managed: true, executesInside: 'none (declarative)', sandbox: 'Not executable', permissions: ['context.files'], applicability: [], evidence: 'Bundled manifest', version: '1'};
function inventory(): ModEntry[] {
  const native = claudeInventory([
    {id: 'code-review@official', scope: 'user', version: '1.4.0', enabled: true, installPath: '/h/.claude/plugins/code-review'},
    {id: 'commit-commands@official', scope: 'user', version: '1.0.2', enabled: false},
    {id: 'project-lint@team', scope: 'project', projectPath: '/p', projectEnabled: false},
  ], '/p').map(entry => ({...entry, profileId: 'account2'}));
  return [...builtinModInventory(), pack, ...native];
}
function controller(): ModsController {
  const c = new ModsController();
  c.setInventory(inventory());
  return c;
}
const plain = (lines: string[]) => lines.map(line => stripAnsi(line));

test('browse view: native tab strip, search and provider row, grouped rows with factual state words', () => {
  const lines = plain(renderMods(controller(), 100, 30));
  const text = lines.join('\n');
  assert.match(lines[0]!, /^ {2}Mods {2}provider extensions and NMSh packs · discovery runs nothing$/u);
  assert.match(lines[1]!, /^ {3}All {3}Portable {3}Provider-native {3}Context Packs $/u);
  assert.match(lines[2]!, /^ {2}Search {2}\/ to filter {3}Provider {2}All$/u);
  assert.match(text, /^ {2}Portable descriptors$/mu);
  assert.match(text, /^ {2}Context Packs$/mu);
  assert.match(text, /^ {2}Claude Code · account2$/mu);
  assert.match(text, /^ {2}› Context Meter +inert +per target · 1 *$/mu, 'the first entry is selected with a pointer');
  assert.doesNotMatch(text, /\n\n\n/u, 'no doubled blank rows');
  assert.match(text, /^ {4}code-review@official +enabled +global · 1\.4\.0$/mu);
  assert.match(text, /^ {4}commit-commands@official +disabled +global · 1\.0\.2$/mu);
  // projectEnabled only says whether project settings name a plugin (it is false for nearly every installed one in
  // Claude Code 2.1.295), so with no `enabled` the state is unknown, never inferred from it.
  assert.match(text, /^ {4}project-lint@team +state unknown +this project$/mu, 'projectEnabled is not the effective state');
  assert.match(text, /^ {4}Node\.js +state unknown +global · 1$/mu, 'unknown is never shown as enabled');
});

test('selection reads without color: one band, a pointer, and a reverse-video band under NO_COLOR', () => {
  const c = controller();
  c.dispatch({kind: 'Navigate', direction: 2});
  const colored = renderMods(c, 100, 30);
  assert.equal(colored.filter(line => /\u001b\[48;2;/u.test(line) && !/ All /u.test(stripAnsi(line))).length, 1, 'exactly one selected row band');
  assert.match(plain(colored).join('\n'), /^ {2}› code-review@official/mu);
  const before = process.env.NO_COLOR;
  process.env.NO_COLOR = '1';
  try {
    const lines = renderMods(c, 100, 30);
    assert.doesNotMatch(lines.join('\n'), /\u001b\[(?:38|48);/u, 'no color');
    assert.equal(lines.filter(line => line.includes('\u001b[7m')).length, 2, 'active tab and selected row are reverse video');
    const strip = renderTabStrip(['All', 'Portable'], 1, 40);
    assert.match(strip, /\u001b\[7m Portable /u);
    assert.doesNotMatch(strip.replace(/\u001b\[7m Portable /u, ''), /\u001b\[7m/u, 'only the active tab');
  } finally { if (before === undefined) delete process.env.NO_COLOR; else process.env.NO_COLOR = before; }
});

test('the selected entry keeps its execution facts in view while browsing; no sandbox is ever implied', () => {
  const c = controller();
  const browse = (index: number) => { c.selected = index; return stripAnsi(renderMods(c, 80, 30).join('\n')).replace(/\s+/gu, ' '); };
  const rows = c.rows;
  for (const [index, entry] of rows.entries()) {
    const text = browse(index);
    assert.ok(text.includes(modExecution(entry)), `${entry.name}: ${modExecution(entry)}`);
    assert.doesNotMatch(text, /\bsandboxed\b|sandbox: (?:yes|on)|NMSh sandbox(?! ·)/iu);
  }
  assert.equal(modExecution(rows.find(entry => entry.kind === 'Provider-native')!), 'runs inside Claude Code · no NMSh sandbox · not managed by NMSh');
  assert.equal(modExecution(rows.find(entry => entry.kind === 'Portable')!), 'inert descriptor · not executable · no privileges granted');
  assert.equal(modExecution(pack), 'declarative Context Pack · not executable');
  assert.equal(modGroup(rows.find(entry => entry.kind === 'Portable')!), 'Portable descriptors');
  assert.deepEqual(modState({...pack, enabled: 'yes'}), {text: 'enabled', tone: 'on'});
});

test('details: progressive disclosure into execution, then provenance; contextual footer', () => {
  const c = controller();
  c.selected = c.rows.findIndex(entry => entry.id === 'code-review@official');
  c.dispatch({kind: 'ActivateAction'});
  const lines = plain(renderMods(c, 100, 40));
  const text = lines.join('\n');
  assert.match(text, /^ {2}code-review@official {2}enabled {2}Provider-native · Claude Code$/mu);
  const execution = lines.findIndex(line => line === '  Execution');
  const provenance = lines.findIndex(line => line === '  Provenance');
  assert.ok(execution > 0 && provenance > execution, 'execution precedes provenance');
  assert.match(text, /^ {2}Runs +inside Claude Code, under the provider's own controls$/mu);
  assert.match(text, /^ {2}Sandbox +none from NMSh$/mu);
  assert.match(text, /^ {2}Managed +not by NMSh$/mu);
  assert.match(text, /^ {2}Permissions +unknown \(provider-owned\)$/mu);
  assert.match(text, /^ {2}Installed by +unknown$/mu);
  assert.match(text, /^ {2}Scope +global · profile account2$/mu);
  assert.match(text, /^ {2}Trust +unknown: listing or integrity is not trust$/mu);
  assert.match(lines.at(-1)!, /^↑↓ scroll · R refresh · Esc back to list$/u);
  // Portable: denied grants are listed, and nothing claims a sandbox.
  c.dispatch({kind: 'Back'});
  c.selected = 0;
  c.dispatch({kind: 'ActivateAction'});
  const portable = plain(renderMods(c, 100, 40)).join('\n');
  assert.match(portable, /^ {2}Sandbox +not applicable \(not executable\)$/mu);
  assert.match(portable, /^ {2}Grants +none: files, network, processes, secrets, approvals and other targets are all denied$/mu);
});

test('footer follows context: browse, search and empty results', () => {
  const c = controller();
  assert.match(plain(renderMods(c, 120, 30)).at(-1)!, /^↑↓ select · Tab kind · Enter details · \/ search · P provider · R refresh · Esc close$/u);
  c.dispatch({kind: 'Search'});
  c.dispatch({kind: 'TypeSearch', text: 'lint'});
  let lines = plain(renderMods(c, 120, 30));
  assert.match(lines[2]!, /^ {2}Search {2}lint▏/u);
  assert.match(lines.at(-1)!, /^type filter · Enter details · Esc clear search$/u);
  c.dispatch({kind: 'TypeSearch', text: 'zzz'});
  lines = plain(renderMods(c, 120, 30));
  assert.ok(lines.includes('  No matching mods.'));
});

test('every width fits in display cells; narrow rows keep name and state; Safe glyphs stay ASCII', () => {
  for (const columns of [30, 50, 80, 120]) {
    for (const details of [false, true]) {
      const c = controller();
      c.selected = 3;
      if (details) c.dispatch({kind: 'ActivateAction'});
      const lines = renderMods(c, columns, 24);
      assert.ok(lines.length <= 24);
      for (const line of lines) assert.ok(displayWidth(line) <= columns, `${columns}: ${JSON.stringify(stripAnsi(line))}`);
      const text = stripAnsi(lines.join('\n'));
      assert.match(text, /Esc/u, 'the footer survives');
      if (!details) assert.match(text, /commit-command\S*\s+(?:off|disabled)/u, 'state survives narrow rows');
    }
  }
  // The subtitle shortens by clause at 60 columns instead of being cut.
  assert.equal(stripAnsi(renderMods(controller(), 60, 30)[0]!), '  Mods  discovery runs nothing');
  assert.equal(stripAnsi(renderMods(controller(), 24, 30)[0]!), '  Mods');
  setIconStyle('safe');
  try {
    const details = controller(); details.dispatch({kind: 'ActivateAction'});
    assert.match(plain(renderMods(details, 40, 14)).join('\n'), /v more · Up\/Down scroll/u);
    const text = plain(renderMods(controller(), 80, 30)).join('\n');
    assert.match(text, /^ {2}> Context Meter/mu);
    assert.match(text, /Up\/Down select/u);
    for (const line of text.split('\n')) assert.ok(/^[\x20-\x7e·…‹›]*$/u.test(line), JSON.stringify(line));
  } finally { setIconStyle('nerd'); }
});

test('hostile names, versions and evidence render inert; refreshing and stale states are visible', async () => {
  const c = new ModsController();
  c.setInventory(claudeInventory([{id: 'evil\u001b]0;PWNED\u0007\u202egnp', scope: 'user', version: '1\u001b[2J', enabled: true, installPath: '/x\u0007y'}], '/p'));
  for (const details of [false, true]) {
    c.details = details;
    const lines = renderMods(c, 90, 30);
    for (const line of lines) assert.doesNotMatch(line.replace(SGR, ''), CONTROL, JSON.stringify(line));
    assert.doesNotMatch(lines.join(''), /PWNED|\u001b\[2J/u);
  }
  c.details = false;
  c.refreshing = true;
  assert.match(stripAnsi(renderMods(c, 120, 30)[0]!), /refreshing…$/u);
  c.refreshing = false;
  await c.refresh(async () => { throw new Error('provider listing timed out'); });
  const stale = plain(renderMods(c, 120, 30));
  assert.match(stale[0]!, /stale$/u);
  assert.ok(stale.some(line => line.includes('provider listing timed out')));
  assert.ok(stale.some(line => line.includes('evilgnp')), 'the last inventory is kept');
});
