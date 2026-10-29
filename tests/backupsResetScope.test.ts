import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {Journal} from '../src/backups/journal.js';
import {snapshot, transact} from '../src/appearance/hostFiles.js';
import {applyReset, discoverResetAreas, planReset, type ResetArea} from '../src/backups/reset.js';
import {planSettingsReset} from '../src/backups/settingsReset.js';
import {planRestore, restore} from '../src/backups/restore.js';
import {createResetPanel, renderResetPanel, resetKey} from '../src/backups/ResetPanel.js';
import {createChangesPanel, renderChangesPanel} from '../src/backups/ChangesPanel.js';
import {normalizePromptConfiguration} from '../src/prompt/configuration.js';
import {writeArtifact} from '../src/themeBridge/artifacts.js';
import {stripAnsi} from '../src/util/text.js';

type T = {after(fn: () => void): void};
function box(t: T, settings?: Record<string, unknown> | string) {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'reset-scope-')));
  t.after(() => rmSync(home, {recursive: true, force: true}));
  const env = {HOME: home, XDG_CONFIG_HOME: join(home, '.config')};
  const config = join(home, '.config/nmsh/config.json');
  mkdirSync(dirname(config), {recursive: true});
  if (settings !== undefined) writeFileSync(config, typeof settings === 'string' ? settings : `${JSON.stringify(settings, null, 2)}\n`, {mode: 0o600});
  const journal = new Journal({home, directory: join(home, '.config/nmsh/backups')});
  return {home, env, config, journal, context: {env, platform: 'linux' as const}};
}
const USER = {onboardingComplete: true, introSeen: true, toolsSetupComplete: true, glyphStyle: 'unicode', glyphChoiceComplete: true,
  updateMode: 'notify', updateFrequency: 'weekly', composerPosition: 'top', sessionNotices: false,
  themes: [{id: 'mine', name: 'Mine'}], welcomePresets: [{id: 'p'}], futureField: {kept: 1}};
const enter = {kind: 'enter'} as const;
const text = (lines: string[]) => stripAnsi(lines.join('\n')).replace(/\s+/gu, ' ');
const select = (b: ReturnType<typeof box>, ids: string[]) => planReset(discoverResetAreas(b.context, b.journal), new Set(ids), b.context);

test('D7: resetting preferences keeps first-run state, the update policy, themes and unknown fields, and shows exact values', t => {
  const b = box(t, USER);
  const plan = select(b, ['settings']);
  const preview = plan.preview.join('\n');
  assert.match(preview, /composerPosition: "top" → "bottom"/u);
  assert.match(preview, /sessionNotices: false → true/u);
  assert.match(preview, /Kept: first-run state \(onboardingComplete true, .*glyphStyle "unicode"/u);
  assert.match(preview, /Kept: update policy \(updateMode "notify", updateFrequency "weekly"\)/u);
  assert.match(preview, /Kept: your themes \(1\) and welcome presets \(1\)/u);
  assert.match(preview, /Kept: 1 field this version does not know \(futureField\)/u);
  assert.doesNotMatch(preview, /updateMode: .*→/u);
  applyReset(plan, b.journal);
  const after = JSON.parse(readFileSync(b.config, 'utf8'));
  assert.equal(after.updateMode, 'notify', 'never enables automatic updates as a side effect');
  assert.equal(after.updateFrequency, 'weekly');
  assert.equal(after.onboardingComplete, true); assert.equal(after.glyphStyle, 'unicode');
  assert.deepEqual(after.themes, USER.themes); assert.deepEqual(after.futureField, {kept: 1});
  assert.equal(after.composerPosition, 'bottom');
});

test('D7: update policy and first-run state reset only when chosen, and together form one exact change', t => {
  const b = box(t, USER);
  const plan = select(b, ['settings-updates', 'settings-onboarding']);
  assert.equal(plan.steps.length, 1, 'one change to config.json, no overlap refusal');
  assert.match(plan.preview.join('\n'), /updateMode: "notify" → "automatic"/u);
  applyReset(plan, b.journal);
  const after = JSON.parse(readFileSync(b.config, 'utf8'));
  assert.equal(after.updateMode, 'automatic'); assert.equal(after.onboardingComplete, false);
  assert.equal(after.composerPosition, 'top', 'preferences stay when not chosen');
});

test('D7: legacy settings keep their migrated meaning, repeated resets are no-ops, malformed settings are refused', t => {
  const legacy = box(t, {onboardingComplete: true, provider: 'starship'});
  const once = planSettingsReset(readFileSync(legacy.config, 'utf8'), new Set(['preferences']));
  const normalized = normalizePromptConfiguration(JSON.parse(once.after!));
  assert.equal(normalized.onboardingComplete, true);
  assert.equal(normalized.toolsSetupComplete, true, 'legacy completed onboarding still counts as tools setup done');
  assert.equal(normalized.glyphChoiceComplete, true);
  assert.equal(normalized.provider, 'nmsh');
  writeFileSync(legacy.config, once.after!);
  const twice = planSettingsReset(once.after, new Set(['preferences']));
  assert.equal(twice.changed, 0); assert.equal(twice.after, once.after);
  assert.equal(discoverResetAreas(legacy.context, legacy.journal).find(area => area.id === 'settings')!.status, 'nothing to reset');
  const broken = box(t, '{not json');
  const area = discoverResetAreas(broken.context, broken.journal).find(item => item.id === 'settings')!;
  assert.equal(area.status, 'not set up'); assert.match(area.reason!, /not valid JSON/u);
  const missing = box(t);
  assert.equal(discoverResetAreas(missing.context, missing.journal).find(item => item.id === 'settings')!.status, 'nothing to reset');
});

test('D6/D7: a single-area reset records exactly one journal entry, and restoring it undoes the reset byte for byte', t => {
  const b = box(t, USER);
  const original = readFileSync(b.config, 'utf8');
  const result = applyReset(select(b, ['settings']), b.journal);
  const entries = b.journal.list();
  assert.equal(entries.length, 1, 'no near-duplicate checkpoint');
  assert.equal(entries[0]!.id, result.entry!.id); assert.equal(entries[0]!.outcome, 'applied');
  assert.match(entries[0]!.label, /^Reset NMSh preferences/u);
  restore(b.journal, planRestore(b.journal, result.entry!.id), {reviewed: true, overwrite: false});
  assert.equal(readFileSync(b.config, 'utf8'), original);
});

test('D6: a multi-area reset keeps one checkpoint plus linked, labelled stages', t => {
  const b = box(t);
  const one = join(b.home, 'one'), two = join(b.home, 'two');
  writeFileSync(one, 'a\nowned\n'); writeFileSync(two, 'b\nowned\n');
  const areas: ResetArea[] = [
    {id: 'a', label: 'Area A', status: 'set up', dependencies: [], changes: [{before: snapshot(one, b.home), after: 'a\n'}]},
    {id: 'b', label: 'Area B', status: 'set up', dependencies: [], changes: [{before: snapshot(two, b.home), after: 'b\n'}]},
  ];
  const result = applyReset(planReset(areas, new Set(['a', 'b']), b.context), b.journal);
  const entries = b.journal.list();
  assert.equal(entries.length, 3);
  const checkpoint = entries.find(entry => entry.id === result.entry!.id)!;
  assert.match(checkpoint.label, /^Reset checkpoint: Area A, Area B/u); assert.equal(checkpoint.outcome, 'applied');
  const stages = entries.filter(entry => entry.group === checkpoint.id).map(entry => entry.label).sort();
  assert.deepEqual(stages, ['Reset stage 1/2: Area A', 'Reset stage 2/2: Area B']);
});

test('D6: navigation steps say they only advance; the destructive step still needs the typed word', t => {
  const b = box(t, USER);
  const panel = createResetPanel(b.context, b.journal);
  panel.index = panel.areas.findIndex(area => area.id === 'settings');
  assert.match(text(renderResetPanel(panel, 120, 30)), /Settings that change/u, 'the selected area shows its before → after summary');
  resetKey(panel, {kind: 'text', value: ' '}); resetKey(panel, enter);
  const impact = text(renderResetPanel(panel, 120, 30));
  assert.match(impact, /Enter next: backup/u); assert.doesNotMatch(impact, /confirm write/u);
  resetKey(panel, enter);
  const backup = text(renderResetPanel(panel, 120, 30));
  assert.match(backup, /Enter next: type reset/u); assert.doesNotMatch(backup, /confirm write/u);
  resetKey(panel, enter); renderResetPanel(panel, 120, 30);
  const before = readFileSync(b.config, 'utf8');
  for (const value of 'rest') resetKey(panel, {kind: 'text', value});
  assert.deepEqual(resetKey(panel, enter), {close: true});
  assert.equal(readFileSync(b.config, 'utf8'), before, 'a wrong word writes nothing');
});

test('D5: history names the application, file, action and status instead of vague labels', t => {
  const b = box(t, USER);
  const kitty = join(b.home, '.config/kitty/kitty.conf');
  mkdirSync(dirname(kitty), {recursive: true}); writeFileSync(kitty, 'font_size 12\n');
  transact([{before: snapshot(kitty, b.home), after: 'font_size 12\ninclude nmsh.conf\n'}], [], b.home, {source: 'appearance', label: 'appends 2 lines at the end', directory: b.journal.directory});
  writeArtifact('vim', '" one', () => true, {mode: 'follow', themeRef: 'x', format: 'vim', formatVersion: 1}, b.env);
  writeArtifact('vim', '" two', () => true, {mode: 'follow', themeRef: 'x', format: 'vim', formatVersion: 1}, b.env);
  const panel = createChangesPanel(b.journal, []);
  const rows = text(renderChangesPanel(panel, 160, 40));
  assert.match(rows, /Kitty · kitty\.conf · changed · unchanged since/u);
  assert.match(rows, /Vim colors · nmsh-bridge\.vim \+1 more · created · changed later by/u);
  assert.doesNotMatch(rows, /\d+ files ·/u);
  panel.selected = panel.entries.findIndex(entry => entry.label === 'appends 2 lines at the end');
  assert.match(text(renderChangesPanel(panel, 160, 40)), /Recorded as: appearance · appends 2 lines at the end .*~\/\.config\/kitty\/kitty\.conf · Kitty · changed/u);
});

test('Retention: a burst of hundreds of automatic writes keeps every original; a tiny cap reports any original it removes', t => {
  const b = box(t);
  const kitty = join(b.home, 'kitty.conf'), shader = join(b.home, 'cursor.glsl');
  writeFileSync(kitty, 'k0'); writeFileSync(shader, 's0');
  const write = (journal: Journal, path: string, after: string) => { const entry = journal.record([{before: snapshot(path, journal.options.home), after}], 'cursor', 'auto'); writeFileSync(path, after); journal.complete(entry); };
  write(b.journal, kitty, 'k1'); write(b.journal, kitty, 'k2');
  for (let index = 1; index <= 260; index++) write(b.journal, shader, `s${index}`);
  const entries = b.journal.list();
  assert.ok(entries.length <= 200);
  assert.ok(entries.some(entry => entry.files.some(file => file.path === kitty && file.beforeHash !== file.afterHash && b.journal.content(entry, 0) === 'k0')), 'kitty.conf original kept');
  assert.ok(entries.some(entry => b.journal.content(entry, 0) === 's0'), 'shader original kept');
  assert.deepEqual(b.journal.lostOriginals(), []);
  assert.doesNotMatch(createChangesPanel(b.journal, []).message, /Retention warning/u);
  const tiny = box(t);
  const small = new Journal({home: tiny.home, directory: tiny.journal.directory, maxEntries: 3});
  // The newest backup per file is always kept, so an original can go only once its file has newer backups.
  const [a, c] = ['a', 'c'].map(name => { const path = join(tiny.home, name); writeFileSync(path, `${name}0`); return path; }) as [string, string];
  for (const step of [1, 2, 3]) write(small, a, `a${step}`);
  for (const step of [1, 2, 3]) write(small, c, `c${step}`);
  assert.ok(small.list().length <= 3);
  assert.deepEqual(small.lostOriginals().map(item => item.path), [a]);
  const notice = createChangesPanel(small, []).message;
  assert.match(notice, /Retention warning: .*earliest backup of 1 file was removed: ~\/a \(from /u);
});
