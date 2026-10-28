import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {buildGhosttyCatalog, generateGhosttyShader, ghosttyCapability, ghosttyPrefix, GHOSTTY_PRESETS, GHOSTTY_UNIFORMS, paramError, presetById, requiredLevel, uniformsUsed} from '../src/appearance/ghosttyShaderCatalog.js';
import {applyGhosttyShaderPlan, effectiveShaderList, gatedGhosttyEffects, ghosttyLaunchOverride, ghosttyReloadPending, ghosttyShaderPaths, inspectGhosttyLaunch, inspectGhosttyShaders,
  noteGhosttyTrailChange, parseElapsed, planGhosttyShaderRemoval, planGhosttyShaders, setGhosttyReloadPending, syncGhosttyShaders, validateGhosttyEffects, writtenGhosttyTrail,
  type GhosttyShaderContext, type GhosttyShaderGates} from '../src/appearance/ghosttyShaders.js';
import {normalizeHostShaders, type GhosttyShaderSettings} from '../src/appearance/kittyShaderSettings.js';
import {readHostConfiguration} from '../src/appearance/hostConfiguration.js';
import {chooseBackend, hostCursorFacts, type HostCursorFacts} from '../src/cursor/backends.js';
import {fragmentContent, fragmentPath as cursorFragmentPath, ghosttyCursorFragment, shaderPath as cursorShaderPath} from '../src/cursor/native.js';
import {DEFAULT_CURSOR, type CursorSettings} from '../src/prompt/configuration.js';

const openGates: GhosttyShaderGates = {reducedMotion: false, effectsOff: false, cursorRenderer: 'auto', cursorMotion: 'tail'};
const colors = {cursorColors: {head: [1, 0.5, 0], tail: [0, 0, 1]}};

function fixture(t: {after: (fn: () => void) => void}, options: {version?: string; gates?: GhosttyShaderGates; launch?: GhosttyShaderContext['launch']} = {}) {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'nmsh-gshader-')));
  t.after(() => rmSync(home, {recursive: true, force: true}));
  const context: GhosttyShaderContext = {env: {HOME: home, XDG_CONFIG_HOME: join(home, '.config'), NMSH_CONFIG_HOME: join(home, '.config/nmsh')}, platform: 'linux',
    catalog: buildGhosttyCatalog(options.version ?? '1.3.1'), gates: options.gates ?? openGates, launch: options.launch ?? {}, colors};
  const put = (path: string, content: string) => { mkdirSync(dirname(path), {recursive: true, mode: 0o700}); writeFileSync(path, content, {mode: 0o600}); };
  const legacy = join(home, '.config/ghostty/config');
  const preferred = join(home, '.config/ghostty/config.ghostty');
  return {home, context, put, legacy, preferred, paths: ghosttyShaderPaths(context)};
}
const settingsOf = (...effects: Array<[string, Record<string, unknown>?, boolean?]>): GhosttyShaderSettings =>
  normalizeHostShaders({ghostty: {effects: effects.map(([id, values, enabled]) => ({id, enabled: enabled ?? true, values: values ?? {}}))}}).ghostty;
const effective = (context: GhosttyShaderContext) => effectiveShaderList(readHostConfiguration('ghostty', context), context.env.HOME!).entries.map(entry => entry.path);
const apply = (result: ReturnType<typeof planGhosttyShaders>) => { assert.ok(result.ok, result.ok ? '' : result.error); const applied = applyGhosttyShaderPlan(result.plan); assert.ok(applied.ok, applied.ok ? '' : applied.error); return result.plan; };

// ---- Version gates and uniforms ------------------------------------------------------------------------------------

test('version gates: unknown, too old and any unverified newer version fail closed; 1.2 offers trails only; 1.3 and 1.4 share one interface', () => {
  assert.equal(ghosttyCapability(undefined).supported, false);
  assert.match(ghosttyCapability(undefined).reason!, /did not report its version/u);
  assert.equal(ghosttyCapability('1.1.3').supported, false);
  assert.equal(ghosttyCapability('2.0.0').supported, false);
  assert.deepEqual([ghosttyCapability('1.2.3').level, ghosttyCapability('1.3.1').level, ghosttyCapability('1.4.0').level], ['1.2', '1.3', '1.3']);
  assert.equal(ghosttyCapability(undefined).hidden, true, 'no reported version is hidden, not known to be unsupported');
  assert.ok(ghosttyCapability('1.4.7').supported, 'a 1.4 patch release shares the verified interface');
  for (const newer of ['1.5.0', '2.0.0']) {
    assert.equal(ghosttyCapability(newer).supported, false);
    assert.equal(ghosttyCapability(newer).hidden, undefined);
    assert.match(ghosttyCapability(newer).reason!, /newer than NMSh has verified \(through 1\.4\.x\)/u);
  }
  const old = buildGhosttyCatalog('1.2.0');
  assert.deepEqual(old.offered.map(item => item.definition.id).sort(), ['comet', 'glow', 'scanlines', 'smear', 'vignette']);
  assert.deepEqual(old.notOffered, ['Aurora (Ghostty 1.3+)', 'Dim when unfocused (Ghostty 1.3+)']);
  assert.deepEqual(buildGhosttyCatalog('1.3.1').offered.map(item => item.definition.id), buildGhosttyCatalog('1.4.0').offered.map(item => item.definition.id));
  assert.equal(buildGhosttyCatalog('1.3.1').offered.length, GHOSTTY_PRESETS.length);
  assert.equal(buildGhosttyCatalog(undefined).offered.length, 0);
});

test('uniforms: the 1.2 interface lacks focus and terminal colors; comments never count; unprovided uniforms are refused', () => {
  assert.ok(!ghosttyPrefix('1.2').includes('iFocus') && ghosttyPrefix('1.3').includes('uniform int iFocus;'));
  assert.ok(ghosttyPrefix('1.3').includes('uniform vec3 iPalette[256];') && ghosttyPrefix('1.3').includes('#define CURSORSTYLE_BAR'));
  assert.equal(GHOSTTY_UNIFORMS.filter(item => item.since === '1.3').length, 12);
  assert.deepEqual(uniformsUsed('// iFocus\n/* iBackgroundColor */ float x = iTime;'), ['iTime']);
  assert.deepEqual(requiredLevel('void f() { float a = iTime + float(iFocus); }'), {level: '1.3'});
  assert.deepEqual(requiredLevel('vec4 m = iMouse;'), {error: 'uses iMouse, which Ghostty does not provide'});
});

// ---- Generation ------------------------------------------------------------------------------------------------------

test('every parameter really changes the generated GLSL; invalid values are refused, never clamped', () => {
  for (const preset of GHOSTTY_PRESETS) {
    const base = generateGhosttyShader(preset, {}, colors).source;
    assert.match(base, /void mainImage\(out vec4 fragColor, in vec2 fragCoord\)/u);
    assert.match(base, /GPL-3\.0-only/u);
    for (const param of preset.params) {
      const current = preset.defaults[param.name]!;
      const other = param.kind === 'bool' ? !current : param.kind === 'color' ? [0.123, 0.456, 0.789]
        : param.kind === 'choice' ? (current === 1 ? 2 : 1) : current === param.max ? param.min! : param.max!;
      const changed = generateGhosttyShader(preset, {[param.name]: other}, colors).source;
      // /cursor-sourced colors ignore the custom color constants' use but still emit them; the source still differs.
      assert.notEqual(changed, base, `${preset.id}.${param.name} has no effect`);
      if (param.kind === 'number') {
        assert.throws(() => generateGhosttyShader(preset, {[param.name]: param.max! + 1}, colors), /must be between/u);
        assert.throws(() => generateGhosttyShader(preset, {[param.name]: Number.NaN}, colors), /expects a number/u);
      }
      if (param.kind === 'color') assert.throws(() => generateGhosttyShader(preset, {[param.name]: [2, 0, 0]}, colors), /between 0 and 1/u);
    }
  }
  assert.equal(paramError({name: 'S', label: 'S', kind: 'number', type: 'int', min: 2, max: 8, step: 1}, 2.5), 'expects a whole number');
  const smear = presetById('smear')!;
  assert.match(generateGhosttyShader(smear, {COLOR_SOURCE: 0}, colors).source, /headColor\(\) \{ return vec3\(1\.0, 0\.5, 0\.0\); \}/u, '/cursor colors are compiled in');
  assert.match(generateGhosttyShader(smear, {COLOR_SOURCE: 1, HEAD: [0, 1, 0]}, colors).source, /headColor\(\) \{ return vec3\(0\.0, 1\.0, 0\.0\); \}/u);
  assert.match(generateGhosttyShader(smear, {COLOR_SOURCE: 2}, colors).source, /return iCurrentCursorColor\.rgb;/u, 'Ghostty’s live cursor color');
  assert.throws(() => generateGhosttyShader(smear, {}, {cursorColors: {head: [1, 1], tail: [0, 0, 0]}}), /not valid RGB/u);
});

test('settings: unknown presets, foreign parameters, two trails and too many passes are reported', () => {
  const catalog = buildGhosttyCatalog('1.2.0');
  const errors = validateGhosttyEffects(settingsOf(['smear'], ['comet'], ['aurora'], ['vignette', {NOPE: 1}], ['glow', {INTENSITY: 9}]), catalog);
  assert.ok(errors.some(error => /cannot run together/u.test(error)));
  assert.ok(errors.some(error => /aurora is not offered for Ghostty 1\.2\.0/u.test(error)));
  assert.ok(errors.some(error => /NOPE is not a setting/u.test(error)));
  assert.ok(errors.some(error => /Text glow: Intensity must be between/u.test(error)));
  assert.ok(validateGhosttyEffects(settingsOf(['smear'], ['vignette'], ['scanlines'], ['glow'], ['aurora'], ['focus-dim'], ['comet', {}, false]), buildGhosttyCatalog('1.3.1')).length === 0);
  const normalized = normalizeHostShaders({ghostty: {effects: [{id: 'BAD ID', enabled: true}, {id: 'smear', enabled: 'yes', values: {INTENSITY: '1'}}]}});
  assert.deepEqual(normalized.ghostty.effects, [{id: 'smear', enabled: false, values: {}}]);
  assert.deepEqual(normalized.kitty, {effects: [], placement: 'after'}, 'Kitty settings are untouched');
});

// ---- Ghostty's list rules -------------------------------------------------------------------------------------------

test('effective custom-shader list follows Ghostty: roots then includes, relative to each file, empty value clears, ? and "" handled', t => {
  const {context, put, legacy, preferred, home} = fixture(t);
  put(legacy, 'custom-shader = early.glsl\nconfig-file = inc/more.conf\n');
  put(preferred, 'custom-shader = ?"~/shaders/quoted.glsl"\ncustom-shader = ?\ncustom-shader = ""\n');
  put(join(home, '.config/ghostty/inc/more.conf'), 'custom-shader = rel.glsl\n');
  assert.deepEqual(effective(context), [join(home, '.config/ghostty/early.glsl'), join(home, 'shaders/quoted.glsl'), join(home, '.config/ghostty/inc/rel.glsl')]);
  put(join(home, '.config/ghostty/inc/more.conf'), 'custom-shader =\ncustom-shader = /abs/after.glsl\n');
  const list = effectiveShaderList(readHostConfiguration('ghostty', context), home);
  assert.deepEqual(list.entries.map(entry => entry.path), ['/abs/after.glsl'], 'an empty value clears everything before it');
  assert.equal(list.resets.length, 1);
});

// ---- Setup, preservation, removal ----------------------------------------------------------------------------------

test('setup keeps the person’s passes in order and adds NMSh’s after them; review is exact; re-planning is idempotent', t => {
  const {context, put, preferred, home, paths} = fixture(t);
  const original = 'font-size = 13\ncustom-shader = mine.glsl\ncustom-shader-animation = always';
  put(preferred, original); // no final newline on purpose
  put(join(home, '.config/ghostty/mine.glsl'), 'void mainImage(out vec4 c, in vec2 p) { c = texture(iChannel0, p / iResolution.xy); }\n');
  const plan = apply(planGhosttyShaders(settingsOf(['vignette'], ['comet']), context));
  assert.deepEqual(plan.shaders.map(shader => shader.id), ['vignette', 'comet'], 'NMSh order is the studio order');
  assert.deepEqual(effective(context), [join(home, '.config/ghostty/mine.glsl'), join(paths.shaderDirectory, 'vignette.glsl'), join(paths.shaderDirectory, 'comet.glsl')]);
  assert.match(plan.preview.join('\n'), /Kept, in order: mine\.glsl[\s\S]*Effective after this change: mine\.glsl · vignette\.glsl · comet\.glsl/u);
  assert.match(plan.preview.join('\n'), /\+ config-file = \?.*ghostty-shaders\.conf/u);
  assert.ok(readFileSync(preferred, 'utf8').startsWith(`${original}\n\n# NMSh Ghostty shaders`), 'only an append');
  assert.ok(!readFileSync(join(paths.directory, 'ghostty-shaders.conf'), 'utf8').includes('custom-shader-animation'), 'NMSh never sets the animation mode');
  assert.equal(readFileSync(join(paths.shaderDirectory, 'comet.glsl'), 'utf8'), plan.shaders[1]!.source);
  const again = planGhosttyShaders(settingsOf(['vignette'], ['comet']), context);
  assert.ok(again.ok);
  assert.ok(again.plan.changes.every(change => change.after === change.before.content || change.before.path === paths.ledger), 'nothing new to write');
  const inspection = inspectGhosttyShaders(context);
  assert.deepEqual([inspection.configured, inspection.activePresets, inspection.trail, inspection.animation], [true, ['vignette', 'comet'], 'comet', {value: 'always', source: 'person'}]);
  assert.equal(writtenGhosttyTrail(context), 'comet');
  // Removal restores the exact original bytes (no final newline) and is not repeatable.
  const removal = planGhosttyShaderRemoval(context);
  assert.ok(removal.ok);
  assert.ok(applyGhosttyShaderPlan(removal.plan).ok);
  assert.equal(readFileSync(preferred, 'utf8'), original);
  assert.ok(!existsSync(paths.ledger) && !existsSync(join(paths.shaderDirectory, 'comet.glsl')) && !existsSync(join(paths.directory, 'ghostty-shaders.conf')));
  assert.equal(planGhosttyShaderRemoval(context).ok, false);
  assert.equal(writtenGhosttyTrail(context), undefined);
});

test('a created config is deleted again on removal; CRLF configs keep CRLF; a user line appended later survives removal', t => {
  const {context, put, preferred} = fixture(t);
  apply(planGhosttyShaders(settingsOf(['scanlines']), context));
  assert.ok(existsSync(preferred));
  assert.ok(applyGhosttyShaderPlan((planGhosttyShaderRemoval(context) as {ok: true; plan: never}).plan).ok);
  assert.ok(!existsSync(preferred), 'NMSh created it, so removal deletes it');
  put(preferred, 'font-size = 12\r\n');
  apply(planGhosttyShaders(settingsOf(['scanlines']), context));
  assert.match(readFileSync(preferred, 'utf8'), /\r\n# NMSh Ghostty shaders \(remove using \/appearance\)\r\nconfig-file = \?/u);
  writeFileSync(preferred, `${readFileSync(preferred, 'utf8')}theme = dark\r\n`);
  assert.ok(applyGhosttyShaderPlan((planGhosttyShaderRemoval(context) as {ok: true; plan: never}).plan).ok);
  assert.equal(readFileSync(preferred, 'utf8'), 'font-size = 12\r\ntheme = dark\r\n');
});

test('refusals: a later clearing line, a person’s cursor shader, an unreadable shader for a trail, unowned and edited NMSh files', t => {
  const {context, put, preferred, home, paths} = fixture(t);
  put(preferred, 'config-file = later.conf\n');
  put(join(home, '.config/ghostty/later.conf'), 'custom-shader =\n');
  // NMSh's include is queued after later.conf, so its passes survive; a clear in an include queued AFTER NMSh's would not.
  const fine = planGhosttyShaders(settingsOf(['vignette']), context);
  assert.ok(fine.ok, fine.ok ? '' : fine.error);
  assert.match(fine.plan.preview.join('\n'), /custom-shader =` line at .*later\.conf:1 clears earlier passes/u);
  apply(fine);
  writeFileSync(preferred, `${readFileSync(preferred, 'utf8')}config-file = last.conf\n`);
  put(join(home, '.config/ghostty/last.conf'), 'custom-shader =\n');
  const dropped = planGhosttyShaders(settingsOf(['vignette', {INTENSITY: 0.5}]), context);
  assert.ok(!dropped.ok && /clears the list/u.test(dropped.error));
  assert.equal(syncGhosttyShaders(settingsOf(['vignette', {INTENSITY: 0.5}]), context).kind, 'review', 'sync refuses too');

  const second = fixture(t);
  second.put(second.preferred, 'custom-shader = trail.glsl\n');
  second.put(join(second.home, '.config/ghostty/trail.glsl'), '// a cursor trail\nvoid mainImage(out vec4 c, in vec2 p) { c = vec4(iCurrentCursor.x); }\n');
  const twoTrails = planGhosttyShaders(settingsOf(['smear']), second.context);
  assert.ok(!twoTrails.ok && /reads Ghostty’s cursor uniforms/u.test(twoTrails.error));
  assert.ok(planGhosttyShaders(settingsOf(['glow']), second.context).ok, 'non-trail effects are fine');

  const third = fixture(t);
  const outside = realpathSync(mkdtempSync(join(tmpdir(), 'nmsh-gshader-out-')));
  t.after(() => rmSync(outside, {recursive: true, force: true}));
  writeFileSync(join(outside, 'x.glsl'), 'void mainImage(out vec4 c, in vec2 p) { c = vec4(0.0); }\n');
  mkdirSync(join(third.home, '.config/ghostty'), {recursive: true});
  symlinkSync(join(outside, 'x.glsl'), join(third.home, '.config/ghostty/link.glsl'));
  third.put(third.preferred, 'custom-shader = link.glsl\n');
  const unknown = planGhosttyShaders(settingsOf(['comet']), third.context);
  assert.ok(!unknown.ok && /cannot rule out a second cursor trail/u.test(unknown.error));
  assert.ok(planGhosttyShaders(settingsOf(['vignette']), third.context).ok);

  const fourth = fixture(t);
  fourth.put(join(fourth.paths.shaderDirectory, 'glow.glsl'), '// someone else\n');
  const unowned = planGhosttyShaders(settingsOf(['glow']), fourth.context);
  assert.ok(!unowned.ok && /not recorded as NMSh’s/u.test(unowned.error));
  void paths;

  const fifth = fixture(t);
  apply(planGhosttyShaders(settingsOf(['glow']), fifth.context));
  writeFileSync(join(fifth.paths.shaderDirectory, 'glow.glsl'), '// edited by hand\n');
  const edited = planGhosttyShaders(settingsOf(['glow', {RADIUS: 3}]), fifth.context);
  assert.ok(!edited.ok && /edited outside NMSh; it was preserved/u.test(edited.error));
  // Removal still works and keeps the hand-edited file.
  const removal = planGhosttyShaderRemoval(fifth.context);
  assert.ok(removal.ok && removal.plan.notes.some(note => /edited outside NMSh; it is kept/u.test(note)));
  assert.ok(applyGhosttyShaderPlan(removal.plan).ok);
  assert.equal(readFileSync(join(fifth.paths.shaderDirectory, 'glow.glsl'), 'utf8'), '// edited by hand\n');
});

test('a configuration edited between review and confirmation is not overwritten; nothing is half-written', t => {
  const {context, put, preferred, paths} = fixture(t);
  put(preferred, 'font-size = 12\n');
  const plan = planGhosttyShaders(settingsOf(['vignette']), context);
  assert.ok(plan.ok);
  writeFileSync(preferred, 'font-size = 14\n');
  const applied = applyGhosttyShaderPlan(plan.plan);
  assert.ok(!applied.ok && /changed since the preview/u.test(applied.error));
  assert.equal(readFileSync(preferred, 'utf8'), 'font-size = 14\n');
  assert.ok(!existsSync(paths.ledger) && !existsSync(join(paths.shaderDirectory, 'vignette.glsl')));
});

test('launch options that change shaders or config refuse; Ghostty is found among parents; elapsed time parses', t => {
  assert.equal(parseElapsed('05:07'), 307);
  assert.equal(parseElapsed('2-01:00:01'), 2 * 86400 + 3601);
  assert.equal(parseElapsed('bad'), undefined);
  assert.match(ghosttyLaunchOverride(' --custom-shader=/x.glsl')!, /--custom-shader/u);
  assert.match(ghosttyLaunchOverride(' --config-default-files=false')!, /config-default-files/u);
  assert.equal(ghosttyLaunchOverride(' --font-size=13'), undefined);
  const rows = [{pid: 50, ppid: 40, elapsedSeconds: 5, command: 'node nmsh'}, {pid: 40, ppid: 30, elapsedSeconds: 6, command: '/usr/bin/login -flp me /bin/zsh'},
    {pid: 30, ppid: 1, elapsedSeconds: 100, command: '/Applications/Ghostty.app/Contents/MacOS/ghostty --custom-shader=/tmp/x.glsl'}];
  const found = inspectGhosttyLaunch(rows, 50, 1_000_000);
  assert.equal(found.startedAt, 900_000);
  assert.match(found.refusal!, /--custom-shader/u);
  assert.equal(inspectGhosttyLaunch([{...rows[2]!, command: '/Applications/Ghostty.app/Contents/MacOS/ghostty'}, rows[1]!, rows[0]!], 50).refusal, undefined);
  assert.match(inspectGhosttyLaunch(rows.slice(0, 2), 50).note!, /could not find Ghostty/u);
  const {context, put, preferred} = fixture(t, {launch: found});
  put(preferred, '');
  const refused = planGhosttyShaders(settingsOf(['vignette']), context);
  assert.ok(!refused.ok && /--custom-shader/u.test(refused.error));
});

// ---- Gates, Portable, reload --------------------------------------------------------------------------------------

test('Reduced Motion, Effects Off, a Portable cursor and Smooth motion: nothing new is written and sync removes only NMSh passes', t => {
  const {context, put, preferred, paths, home} = fixture(t);
  const mine = join(home, 'mine.glsl');
  put(mine, 'void mainImage(out vec4 c, in vec2 p) { c = texture(iChannel0, p / iResolution.xy); }\n');
  put(preferred, `custom-shader = ${mine}\n`);
  for (const gates of [{...openGates, reducedMotion: true}, {...openGates, effectsOff: true}]) {
    const refused = planGhosttyShaders(settingsOf(['vignette']), {...context, gates});
    assert.ok(!refused.ok && /writes no Ghostty effects/u.test(refused.error));
  }
  const portable = planGhosttyShaders(settingsOf(['smear']), {...context, gates: {...openGates, cursorRenderer: 'portable'}});
  assert.ok(!portable.ok && /Portable, so NMSh draws the trail itself/u.test(portable.error));
  assert.equal(gatedGhosttyEffects(settingsOf(['smear']), context.catalog, {...openGates, cursorMotion: 'smooth'}).length, 0);
  // A shader outside the home is not read, so a trail beside it fails closed; other effects are fine.
  const outside = fixture(t);
  outside.put(outside.preferred, 'custom-shader = /abs/elsewhere.glsl\n');
  const blocked = planGhosttyShaders(settingsOf(['smear']), outside.context);
  assert.ok(!blocked.ok && /outside your home[\s\S]*cannot rule out a second cursor trail/u.test(blocked.error));
  assert.ok(planGhosttyShaders(settingsOf(['vignette']), outside.context).ok);
  apply(planGhosttyShaders(settingsOf(['vignette'], ['smear']), context));
  // Portable: the trail pass goes, the vignette stays.
  const toPortable = syncGhosttyShaders(settingsOf(['vignette'], ['smear']), {...context, gates: {...openGates, cursorRenderer: 'portable'}});
  assert.ok(toPortable.kind === 'written' && toPortable.trailBefore === 'smear' && toPortable.trailAfter === undefined);
  assert.deepEqual(effective(context), [mine, join(paths.shaderDirectory, 'vignette.glsl')]);
  assert.ok(!existsSync(join(paths.shaderDirectory, 'smear.glsl')), 'the stopped pass file is removed');
  assert.equal(writtenGhosttyTrail(context), undefined);
  // Reduced Motion: every NMSh pass goes; the person's stays.
  const reduced = syncGhosttyShaders(settingsOf(['vignette'], ['smear']), {...context, gates: {...openGates, reducedMotion: true}});
  assert.equal(reduced.kind, 'written');
  assert.deepEqual(effective(context), [mine]);
  assert.equal(syncGhosttyShaders(settingsOf(['vignette'], ['smear']), {...context, gates: {...openGates, reducedMotion: true}}).kind, 'unchanged', 'idempotent');
  // Back on: the reviewed passes return; inside tmux (unknown version) the recorded version is used rather than stripping.
  const back = syncGhosttyShaders(settingsOf(['vignette'], ['smear']), {...context, catalog: buildGhosttyCatalog(undefined)});
  assert.ok(back.kind === 'written' && back.trailAfter === 'smear', JSON.stringify(back));
  assert.equal(writtenGhosttyTrail(context), 'smear');
  // A running Ghostty KNOWN to be unsupported is not overridden by the recorded version: NMSh's passes come out, saying why.
  const newer = syncGhosttyShaders(settingsOf(['vignette'], ['smear']), {...context, catalog: buildGhosttyCatalog('1.5.0')});
  assert.ok(newer.kind === 'written' && newer.trailBefore === 'smear' && /effects are off \(Ghostty 1\.5\.0 is newer than NMSh has verified/u.test(newer.message), JSON.stringify(newer));
  assert.deepEqual(effective(context), [mine]);
});

test('reload: a trail Ghostty may still draw stays pending until confirmed or Ghostty restarts; Portable never draws a second trail', t => {
  const {context} = fixture(t);
  assert.equal(noteGhosttyTrailChange(context, 'smear', 'smear'), undefined, 'unchanged trail');
  assert.equal(noteGhosttyTrailChange(context, undefined, 'comet'), undefined, 'adding a trail: Ghostty draws none yet, Portable already stopped');
  assert.equal(noteGhosttyTrailChange(context, 'smear', undefined, 1000), 'smear');
  assert.equal(ghosttyReloadPending(context), 'smear');
  assert.equal(ghosttyReloadPending(context, {startedAt: 500}), 'smear', 'Ghostty started before the change');
  assert.equal(ghosttyReloadPending(context, {startedAt: 2000}), undefined, 'a Ghostty started after the change loaded it');
  const facts: HostCursorFacts = {host: 'ghostty', hostName: 'Ghostty', caretColor: 'host-controlled', version: '1.3.1', integrated: false, ghosttyTrailPending: 'smear'};
  const settings = (value: Partial<CursorSettings>): CursorSettings => ({...structuredClone(DEFAULT_CURSOR), ...value});
  const portable = chooseBackend(settings({renderer: 'portable', motion: 'tail', effect: 'fire'}), facts);
  assert.deepEqual([portable.portableDraws.motion, portable.portableDraws.effect], [false, true], 'a studio trail drew no effects, so Fire still draws');
  assert.match(portable.reason, /waits for a Ghostty config reload/u);
  const legacy = chooseBackend(settings({renderer: 'portable', motion: 'tail', effect: 'fire'}), {...facts, ghosttyTrailPending: 'nmsh-cursor'});
  assert.equal(legacy.portableDraws.effect, false, 'the older /cursor shader drew Fire');
  setGhosttyReloadPending(context, undefined);
  assert.equal(ghosttyReloadPending(context), undefined);
  assert.equal(chooseBackend(settings({renderer: 'portable', motion: 'tail'}), {...facts, ghosttyTrailPending: undefined}).portableDraws.motion, true);
  // Successive changes before a reload accumulate: legacy → Smear → Comet keeps the older /cursor shader (and its effects) pending.
  assert.equal(noteGhosttyTrailChange(context, 'nmsh-cursor', 'smear', 3000), 'nmsh-cursor');
  assert.equal(noteGhosttyTrailChange(context, 'smear', 'comet', 4000), 'nmsh-cursor');
  assert.equal(ghosttyReloadPending(context), 'nmsh-cursor');
  assert.deepEqual(JSON.parse(readFileSync(ghosttyShaderPaths(context).reload, 'utf8')).previous, ['nmsh-cursor', 'smear']);
  assert.equal(noteGhosttyTrailChange(context, 'comet', 'smear', 5000), 'nmsh-cursor', 'the trail now written is not itself pending');
  assert.deepEqual(JSON.parse(readFileSync(ghosttyShaderPaths(context).reload, 'utf8')).previous, ['nmsh-cursor', 'comet']);
  setGhosttyReloadPending(context, undefined);
  // A trail still written although Portable was chosen (its sync was refused): Portable still draws no second trail.
  const stale = chooseBackend(settings({renderer: 'portable', motion: 'tail', effect: 'fire'}), {...facts, ghosttyTrailPending: undefined, ghosttyTrail: 'smear'});
  assert.deepEqual([stale.portableDraws.motion, stale.portableDraws.effect], [false, true]);
  assert.match(stale.reason, /still lists NMSh’s trail/u);
});

test('cursor: a written studio trail makes Ghostty native draw the trail and Portable the effects; facts come from the files', t => {
  const {context, put, preferred} = fixture(t);
  put(preferred, '');
  apply(planGhosttyShaders(settingsOf(['comet']), context));
  const facts = hostCursorFacts({TERM_PROGRAM: 'ghostty', TERM_PROGRAM_VERSION: '1.3.1'}, () => false, () => undefined, () => ({trail: writtenGhosttyTrail(context)}));
  assert.equal(facts.ghosttyTrail, 'comet');
  const choice = chooseBackend({...structuredClone(DEFAULT_CURSOR), renderer: 'auto', motion: 'tail', effect: 'ripple'}, facts);
  assert.deepEqual([choice.nativeHandles.motion, choice.portableDraws.motion, choice.portableDraws.effect], [true, false, true]);
  assert.match(choice.reason, /Comet trail shader with Portable fallback/u);
  // A hand-removed hook means Ghostty no longer loads the trail: Portable draws it again.
  writeFileSync(preferred, '');
  assert.equal(writtenGhosttyTrail(context), undefined);
});

test('NMSh’s older /cursor Ghostty shader pauses while a studio trail is written and never stacks a second trail', t => {
  const {context, put, preferred, home} = fixture(t);
  const legacyFragment = cursorFragmentPath('ghostty', context.env);
  put(legacyFragment, ghosttyCursorFragment(true, context.env));
  put(cursorShaderPath(context.env), 'void mainImage(out vec4 c, in vec2 p) { c = vec4(iCurrentCursor.x); }\n');
  put(preferred, `config-file = ?${legacyFragment}\n`);
  assert.equal(inspectGhosttyShaders(context).cursorShaderActive, true);
  const plan = apply(planGhosttyShaders(settingsOf(['smear']), context));
  assert.equal(plan.trailBefore, 'nmsh-cursor');
  assert.equal(plan.trailAfter, 'smear');
  assert.match(plan.preview.join('\n'), /older \/cursor Ghostty shader pauses/u);
  assert.equal(readFileSync(legacyFragment, 'utf8'), ghosttyCursorFragment(false, context.env));
  assert.deepEqual(effective(context), [join(ghosttyShaderPaths(context).shaderDirectory, 'smear.glsl')], 'exactly one trail pass');
  // /cursor's writer keeps it paused while the studio trail is written.
  const cursor = {...structuredClone(DEFAULT_CURSOR), renderer: 'auto' as const, motion: 'tail' as const};
  assert.equal(fragmentContent('ghostty', cursor, context.env, true), ghosttyCursorFragment(false, context.env));
  assert.equal(fragmentContent('ghostty', cursor, context.env, false), ghosttyCursorFragment(true, context.env));
  // An edited /cursor file is not overwritten.
  const other = fixture(t);
  const otherFragment = cursorFragmentPath('ghostty', other.context.env);
  other.put(otherFragment, `${ghosttyCursorFragment(true, other.context.env)}# mine\n`);
  other.put(other.preferred, `config-file = ?${otherFragment}\n`);
  const refused = planGhosttyShaders(settingsOf(['smear']), other.context);
  assert.ok(!refused.ok && /\/cursor Ghostty file was edited/u.test(refused.error));
  // Removal resumes the paused /cursor shader inside the same reviewed transaction, only when /cursor still wants it.
  assert.equal(JSON.parse(readFileSync(ghosttyShaderPaths(context).ledger, 'utf8')).legacyPaused, true);
  const keepPaused = planGhosttyShaderRemoval(context, {legacyActive: false});
  assert.ok(keepPaused.ok && !keepPaused.plan.preview.join('\n').includes('resumes'));
  const removal = planGhosttyShaderRemoval(context, {legacyActive: true});
  assert.ok(removal.ok && /older \/cursor shader resumes/u.test(removal.plan.preview.join('\n')), removal.ok ? removal.plan.preview.join('\n') : removal.error);
  assert.ok(applyGhosttyShaderPlan(removal.plan).ok);
  assert.equal(readFileSync(legacyFragment, 'utf8'), ghosttyCursorFragment(true, context.env));
  assert.deepEqual(effective(context), [cursorShaderPath(context.env)], 'the one trail is the older /cursor shader again');
  // A paused file the person edited is left alone and the review says so.
  const edited = fixture(t);
  const editedFragment = cursorFragmentPath('ghostty', edited.context.env);
  edited.put(editedFragment, ghosttyCursorFragment(true, edited.context.env));
  edited.put(cursorShaderPath(edited.context.env), 'void mainImage(out vec4 c, in vec2 p) { c = vec4(iCurrentCursor.x); }\n');
  edited.put(edited.preferred, `config-file = ?${editedFragment}\n`);
  apply(planGhosttyShaders(settingsOf(['smear']), edited.context));
  writeFileSync(editedFragment, `${ghosttyCursorFragment(false, edited.context.env)}# mine\n`);
  const careful = planGhosttyShaderRemoval(edited.context, {legacyActive: true});
  assert.ok(careful.ok && /changed while paused; it is left as it is/u.test(careful.plan.preview.join('\n')));
  assert.ok(applyGhosttyShaderPlan(careful.plan).ok);
  assert.equal(readFileSync(editedFragment, 'utf8'), `${ghosttyCursorFragment(false, edited.context.env)}# mine\n`);
  void home;
});

test('animation: the person’s custom-shader-animation is read, never written; false is disclosed for animated effects', t => {
  const {context, put, preferred} = fixture(t);
  put(preferred, 'custom-shader-animation = false\n');
  const plan = planGhosttyShaders(settingsOf(['aurora'], ['smear']), context);
  assert.ok(plan.ok);
  assert.ok(plan.plan.notes.some(note => /yours is false, so it only moves when the terminal redraws/u.test(note)));
  assert.ok(plan.plan.notes.some(note => /may not fade smoothly/u.test(note)));
  assert.ok(!plan.plan.shaders.some(shader => shader.source.includes('custom-shader-animation')));
  assert.ok(plan.plan.notes.some(note => /redraws only when the terminal updates \(your custom-shader-animation is false\)/u.test(note)));
  // Ghostty runs its animation loop whenever any custom shader is listed, even a still effect: disclosed for every preset.
  const still = fixture(t);
  still.put(still.preferred, '');
  const vignette = planGhosttyShaders(settingsOf(['vignette']), still.context);
  assert.ok(vignette.ok && vignette.plan.notes.some(note => /runs its animation loop on the focused surface \(custom-shader-animation true, the default\)/u.test(note)));
  assert.ok(!presetById('smear')!.note!.includes('Redraws only'));
});
