import test from 'node:test';
import assert from 'node:assert/strict';
import {chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {buildKittyCatalog, discoverKittyCatalog, emitKittyPipeline, formatShaderValue, parseKittyPipeline, parseShaderConstants, type KittyCatalog} from '../src/appearance/kittyShaderCatalog.js';
import {applyKittyShaderPlan, inspectKittyLaunch, inspectKittyShaders, kittyShaderPaths, launchOverrideReason, normalizeHostShaders, planKittyShaderRemoval, planKittyShaders,
  shellWords, syncKittyShaders, validateEffects, type KittyShaderContext, type KittyShaderSettings, type ShaderGates} from '../src/appearance/kittyShaders.js';
import {readHostConfiguration} from '../src/appearance/hostConfiguration.js';

// Synthetic stand-ins with the SAME structure as Kitty 0.49.2's shipped resources (not copies of them).
const RESOURCES: Record<string, string> = {
  'types.slang': '// types\n',
  'cursor-trail-blaze.pipeline': 'startgroup\n    animation_start cursor-trail-move\n    animation_stop cursor-trail-stop\n    shaders cursor-trail-blaze\nendgroup\n',
  'cursor-trail-blaze.slang': 'import kitty_custom_shader_types;\nstatic const float4 TRAIL_COLOR = float4(1.0, 0.725, 0.161, 1.0);\nstatic const float4 TRAIL_COLOR_ACCENT = float4(1.0, 0.0, 0.0, 1.0);\n// Trail lifetime in seconds.\nstatic const float DURATION = 0.5;\n',
  'cursor-trail-default.pipeline': 'startgroup\n    animation_start cursor-trail-move\n    animation_stop cursor-trail-stop\n    shaders cursor-trail-default\nendgroup\n',
  'cursor-trail-default.slang': 'import kitty_custom_shader_types;\n',
  'cursor-trail-lightning.pipeline': 'startgroup\n    animation_start cursor-trail-move\n    animation_stop cursor-trail-stop\n    shaders cursor-trail-lightning\nendgroup\n',
  // DURATION declared as int here: a mismatch with NMSh's expected float means it is not offered.
  'cursor-trail-lightning.slang': 'static const float3 BOLT_COLOR = float3(1.00, 0.82, 0.72);\nstatic const int DURATION = 1;\nstatic const float JAGGEDNESS = 0.085;\n',
  'northern-lights.pipeline': 'textures a persist\n\nstartgroup\n    animation_start os-window-focus-in | user-activity\n    animation_stop os-window-focus-out | user-idle\n    var int STAGE = 0\n    shaders northern-lights\n    output_texture a\nendgroup\n\nstartgroup\n    attach\n    var int STAGE = 1\n    shaders northern-lights\n    output_texture persist\nendgroup\n\nstartgroup\n    attach\n    var int STAGE = 2\n    shaders northern-lights\nendgroup\n',
  'northern-lights.slang': 'static const float PI = 3.14159265359f;\nstatic const float EFFECT_INTENSITY = 0.25f;\nstatic const float TIME_SCALE = 0.25f;\nstatic const float STAR_ROT = (2 * PI) / (86400 * TIME_SCALE);\nstatic const int STAGE = 0; // internal use only\nstatic const float LAYERS[4] = { 0.1f, 0.2f, 0.3f, 0.4f };\n',
  'dim-inactive-windows.pipeline': 'startgroup\n    animation_step 0\n    var float HIGHLIGHT_INTENSITY = 0\n    var bool DIM_CENTRAL_AREA_ONLY = true\n    shaders focus-highlight\nendgroup\n',
  'focus-highlight.pipeline': 'startgroup\n    animation_start window-focus-in\n    animation_stop 750\n    animation_curve ease-in\n    animation_step 16\n    shaders focus-highlight\nendgroup\n',
  'focus-highlight.slang': 'static const float HIGHLIGHT_INTENSITY = 0.30;\nstatic const float BORDER_WIDTH = 0.04;\nstatic const float INACTIVE_DIM = 0.3;\nstatic const float3 INACTIVE_DIM_COLOR = float3(0.0);\n',
  'crt-blue.pipeline': 'var float4 TINT = float4(0, 0.8, 0.6, 1)\n\nstartgroup\n    shaders crt\nendgroup\n',
  'crt.slang': 'static const float WARP = 0.25f;                   // curvature\nstatic const float SCAN = 0.50f;\nstatic const float4 TINT = float4(0, 0.8, 0.6, 0); // tint\n',
  'spotlight.pipeline': 'startgroup\n    animation_start os-window-focus-in | user-activity\n    animation_stop os-window-focus-out | user-idle\n    shaders spotlight\nendgroup\n',
  'spotlight.slang': 'static const float SPOTLIGHT_RADIUS = 0.25;\nstatic const float AMBIENT_LIGHT = 0.5;\n',
};
const catalog = (version = '0.49.2', resources = RESOURCES) => buildKittyCatalog(version, resources);
const openGates: ShaderGates = {reducedMotion: false, effectsOff: false, cursorRenderer: 'auto'};

function fixture(t: {after: (fn: () => void) => void}, options: {catalog?: KittyCatalog; gates?: ShaderGates; launch?: KittyShaderContext['launch']} = {}) {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'nmsh-kshader-')));
  t.after(() => rmSync(home, {recursive: true, force: true}));
  const context: KittyShaderContext = {env: {HOME: home, XDG_CONFIG_HOME: join(home, '.config')}, platform: 'linux', catalog: options.catalog ?? catalog(),
    gates: options.gates ?? openGates, launch: options.launch ?? {}};
  const put = (path: string, content: string) => { mkdirSync(dirname(path), {recursive: true, mode: 0o700}); writeFileSync(path, content, {mode: 0o600}); };
  const kitty = join(home, '.config/kitty/kitty.conf');
  return {home, context, put, kitty, paths: kittyShaderPaths(context)};
}
const settingsOf = (...effects: Array<[string, Record<string, unknown>?, boolean?]>): KittyShaderSettings =>
  normalizeHostShaders({kitty: {effects: effects.map(([id, values, enabled]) => ({id, enabled: enabled ?? true, values: values ?? {}}))}}).kitty;
const effective = (context: KittyShaderContext) => shellWords(readHostConfiguration('kitty', context).values.get('custom_shaders')?.raw ?? '');
const apply = (result: ReturnType<typeof planKittyShaders>) => { assert.ok(result.ok, result.ok ? '' : result.error); const applied = applyKittyShaderPlan(result.plan); assert.ok(applied.ok, applied.ok ? '' : applied.error); return result.plan; };

// ---- Grammar ---------------------------------------------------------------------------------------------------

test('pipeline parser accepts Kitty 0.49 shapes and rejects what Kitty rejects', () => {
  const ok = parseKittyPipeline(RESOURCES['northern-lights.pipeline']!, 'northern-lights');
  assert.ok(ok.ok);
  assert.deepEqual(ok.value.textures, ['a', 'persist']);
  assert.equal(ok.value.groups.length, 3);
  assert.equal(ok.value.groups[0]!.animationStart, 'os-window-focus-in|user-activity');
  assert.equal(ok.value.groups[1]!.attach, true);
  assert.deepEqual(parseKittyPipeline('var float4 TINT float4(0, 1, 0, 1);\nstartgroup\nshaders crt\nendgroup', 'x').ok && 'ok', 'ok'); // "=" is optional
  const bad: Array<[string, RegExp]> = [
    ['startgroup\nshaders x\nfrobnicate 1\nendgroup', /Unknown key frobnicate/u],
    ['startgroup\nanimation_start key-press\nshaders x\nendgroup', /not a Kitty shader animation event/u],
    ['startgroup\nshaders x', /Unclosed group/u],
    ['startgroup\nattach\nshaders x\nendgroup', /first group/u],
    ['textures a\nstartgroup\nshaders x\noutput_texture a\nendgroup', /final group cannot output/u],
    ['startgroup\nviewport_size 0.5 0.5\nshaders x\nendgroup', /must not specify a viewport/u],
    ['startgroup\nvar vec3 X = 1\nshaders x\nendgroup', /not supported by Kitty/u],
    ['startgroup\nvar float 9X = 1\nshaders x\nendgroup', /not a valid identifier/u],
    ['startgroup\nanimation_step -1\nshaders x\nendgroup', /non-negative/u],
    ['startgroup\nanimation_curve wobble\nshaders x\nendgroup', /not a recognized animation curve/u],
    ['textures q\nstartgroup\nshaders x\nendgroup', /not a Kitty texture/u],
    [Array.from({length: 17}, () => 'startgroup\nshaders x\nendgroup').join('\n'), /Kitty allows 16/u],
  ];
  for (const [text, error] of bad) { const result = parseKittyPipeline(text, 'x'); assert.equal(result.ok, false, text); assert.match((result as {error: string}).error, error); }
  // A file with no groups is Kitty's default pipeline for that name.
  const bare = parseKittyPipeline('# only a comment\n', 'mine');
  assert.ok(bare.ok && bare.value.groups[0]!.shaders[0] === 'mine');
});

test('shader constants: literals are tunable, expressions and arrays are not; emitted values keep Kitty-compilable form', () => {
  const constants = parseShaderConstants(RESOURCES['northern-lights.slang']!);
  assert.equal(constants.get('EFFECT_INTENSITY')?.value, 0.25);
  assert.equal(constants.get('STAR_ROT')?.value, undefined);
  assert.equal(constants.get('STAR_ROT')?.raw, '(2 * PI) / (86400 * TIME_SCALE)');
  assert.equal(constants.has('LAYERS'), false);
  assert.deepEqual(parseShaderConstants(RESOURCES['focus-highlight.slang']!).get('INACTIVE_DIM_COLOR')?.value, [0, 0, 0]);
  assert.equal(formatShaderValue('float', 1), '1.0');
  assert.equal(formatShaderValue('float', 0.3), '0.3');
  assert.equal(formatShaderValue('float4', [0.2, 0.6, 1, 1]), 'float4(0.2, 0.6, 1.0, 1.0)');
  assert.equal(formatShaderValue('int', 3), '3');
  assert.throws(() => formatShaderValue('int', 2.5));
  assert.throws(() => formatShaderValue('float3', [1, 2]));
});

// ---- Catalog ---------------------------------------------------------------------------------------------------

test('catalog: Kitty below 0.49 is unsupported; 0.49+ offers only installed presets and verified parameters', () => {
  assert.equal(catalog('0.48.1').supported, false);
  assert.match(catalog('0.48.1').reason!, /0\.49 or newer/u);
  assert.equal(catalog('').supported, false);
  const c = catalog();
  assert.ok(c.supported);
  const ids = c.offered.map(preset => preset.definition.id);
  assert.ok(ids.includes('cursor-trail-blaze') && ids.includes('northern-lights') && ids.includes('crt'));
  assert.equal(ids.includes('inside-the-matrix'), false); // not installed in this catalog → never advertised
  const blaze = c.offered.find(preset => preset.definition.id === 'cursor-trail-blaze')!;
  assert.deepEqual(blaze.params.map(param => [param.name, param.default]), [['DURATION', 0.5], ['TRAIL_COLOR', [1, 0.725, 0.161, 1]], ['TRAIL_COLOR_ACCENT', [1, 0, 0, 1]]]);
  assert.equal(blaze.origin.kittyVersion, '0.49.2');
  assert.deepEqual(blaze.origin.resources.map(item => item.name), ['cursor-trail-blaze.pipeline', 'cursor-trail-blaze.slang']);
  const lightning = c.offered.find(preset => preset.definition.id === 'cursor-trail-lightning')!;
  assert.ok(lightning.missing.includes('DURATION')); // declared int, expected float: not offered
  assert.ok(lightning.missing.includes('CORE_WIDTH')); // not declared at all
  assert.deepEqual(lightning.params.map(param => param.name), ['JAGGEDNESS', 'BOLT_COLOR']);
  // The shipped pipeline's own value is the starting value; pipeline-level vars move into groups.
  assert.equal(c.offered.find(preset => preset.definition.id === 'dim-inactive-windows')!.params.find(param => param.name === 'INACTIVE_DIM')!.default, 0.3);
  assert.deepEqual(c.offered.find(preset => preset.definition.id === 'cursor-trail-default')!.params, []);
  assert.ok(!c.notOffered.includes('crt-blue') && ids.includes('crt-blue'), 'CRT (blue) is now a curated preset');
});

test('discovery reads Kitty’s packaged resources through a bounded helper and never guesses', async () => {
  const calls: string[][] = [];
  const ok = await discoverKittyCatalog('/opt/kitty', async (binary, args) => { calls.push([binary, ...args]); return {code: 0, stdout: JSON.stringify({version: '0.49.2', resources: RESOURCES})}; });
  assert.ok(ok.supported);
  assert.equal(calls[0]![1], '+runpy');
  assert.match(calls[0]![2]!, /read_kitty_resource/u);
  assert.doesNotMatch(calls[0]![2]!, /open\(|load_config|subprocess|import os|exec\(/u);
  assert.equal((await discoverKittyCatalog(undefined)).supported, false);
  assert.match((await discoverKittyCatalog('/k', async () => ({code: null, stdout: ''}))).reason!, /did not report/u);
  assert.match((await discoverKittyCatalog('/k', async () => ({code: 0, stdout: JSON.stringify({version: '0.47.0', resources: {}})}))).reason!, /0\.49/u);
  assert.match((await discoverKittyCatalog('/k', async () => ({code: 0, stdout: JSON.stringify({version: '0.49.2', error: 'ImportError'})}))).reason!, /could not be listed/u);
});

// ---- Settings ----------------------------------------------------------------------------------------------------

test('settings: shape is normalized; values are checked against the installed shader, never clamped', () => {
  const normalized = normalizeHostShaders({kitty: {placement: 'sideways', effects: [{id: 'crt', enabled: true, values: {WARP: 0.4, 'bad name': 1, SCAN: 'x'}}, {id: 'crt'}, {id: '../x'}]}});
  assert.deepEqual(normalized.kitty, {placement: 'after', effects: [{id: 'crt', enabled: true, values: {WARP: 0.4}}]});
  const c = catalog();
  assert.deepEqual(validateEffects(settingsOf(['crt', {WARP: 0.4}]), c), []);
  assert.match(validateEffects(settingsOf(['crt', {WARP: 7}]), c).join(), /Curvature must be between 0 and 1/u);
  assert.match(validateEffects(settingsOf(['crt', {MADE_UP: 1}]), c).join(), /MADE_UP is not an adjustable setting/u);
  assert.match(validateEffects(settingsOf(['crt', {TINT: [1, 1, 1]}]), c).join(), /4 components/u);
  assert.match(validateEffects(settingsOf(['inside-the-matrix']), c).join(), /not offered for Kitty 0\.49\.2/u);
  assert.match(validateEffects(settingsOf(['cursor-trail-blaze'], ['cursor-trail-default']), c).join(), /cannot run together/u);
  assert.deepEqual(validateEffects(settingsOf(['cursor-trail-blaze'], ['cursor-trail-default', {}, false]), c), []);
});

// ---- Composition and ownership -----------------------------------------------------------------------------------

test('setup without user shaders: one owned list, group-scoped values, exact preview; re-planning is idempotent', t => {
  const f = fixture(t);
  f.put(f.kitty, 'font_size 13\ncursor_trail 3\n');
  const settings = settingsOf(['cursor-trail-blaze', {DURATION: 0.3, TRAIL_COLOR: [0.2, 0.6, 1, 1]}]);
  const plan = apply(planKittyShaders(settings, f.context));
  assert.deepEqual(effective(f.context), [f.paths.pipeline]);
  assert.deepEqual(plan.effectiveShaders, [f.paths.pipeline]);
  const pipeline = readFileSync(f.paths.pipeline, 'utf8');
  assert.match(pipeline, /animation_start cursor-trail-move/u);
  assert.match(pipeline, /var float DURATION = 0\.3\n/u);
  assert.match(pipeline, /var float4 TRAIL_COLOR = float4\(0\.2, 0\.6, 1\.0, 1\.0\)/u);
  assert.match(pipeline, /cursor-trail-blaze\.slang sha256:[0-9a-f]{12}/u);
  assert.doesNotMatch(pipeline, /^var /mu); // never pipeline-level
  assert.ok(parseKittyPipeline(pipeline, 'nmsh').ok);
  assert.ok(plan.preview.some(line => line === `+ include ${f.paths.fragment}`));
  assert.equal(readFileSync(f.kitty, 'utf8'), `font_size 13\ncursor_trail 3\n\n# NMSh Kitty shaders (remove using /appearance)\ninclude ${f.paths.fragment}\n`);
  const again = planKittyShaders(settings, f.context);
  assert.ok(again.ok);
  assert.ok(again.plan.changes.every(change => change.after === change.before.content), 'second plan changes nothing');
});

test('the person’s effective custom_shaders is kept verbatim, in order, from includes, with quoting, before or after', t => {
  const f = fixture(t);
  const shadersDir = join(dirname(f.kitty), 'shaders');
  f.put(join(shadersDir, 'my glow.pipeline'), 'startgroup\n    shaders my-glow\nendgroup\n');
  f.put(join(dirname(f.kitty), 'theme.conf'), 'custom_shaders spotlight\n');
  const original = 'include theme.conf\ncustom_shaders crt-blue "my glow"\nmap f1 next_window\n';
  f.put(f.kitty, original);
  const theme = readFileSync(join(dirname(f.kitty), 'theme.conf'), 'utf8');
  const plan = apply(planKittyShaders(settingsOf(['northern-lights', {EFFECT_INTENSITY: 0.5}]), f.context));
  assert.deepEqual(effective(f.context), ['crt-blue', 'my glow', f.paths.pipeline]);
  assert.match(readFileSync(f.paths.fragment, 'utf8'), new RegExp(`custom_shaders crt-blue "my glow" '?${f.paths.pipeline.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}'?\n`, 'u'));
  assert.ok(plan.preview[0]!.includes('Kept, in order: crt-blue · my glow'));
  assert.ok(plan.preview.some(line => /already ignores earlier custom_shaders lines at .*theme\.conf:1/u.test(line)));
  assert.equal(readFileSync(join(dirname(f.kitty), 'theme.conf'), 'utf8'), theme);
  assert.ok(readFileSync(f.kitty, 'utf8').startsWith(original));
  // User pipeline-level vars (crt-blue's TINT) would leak into every chained group; NMSh's groups are unaffected (no TINT there),
  // and its three northern-lights groups each carry the chosen value next to their shipped STAGE.
  const pipeline = readFileSync(f.paths.pipeline, 'utf8');
  assert.equal(pipeline.match(/var float EFFECT_INTENSITY = 0\.5/gu)?.length, 3);
  assert.match(pipeline, /textures a persist/u);
  const before = planKittyShaders({...settingsOf(['northern-lights']), placement: 'before'}, f.context);
  assert.ok(before.ok);
  assert.deepEqual(before.plan.effectiveShaders, [f.paths.pipeline, 'crt-blue', 'my glow']);
});

test('leaked pipeline-level vars from the person’s shaders are pinned to the shipped source inside NMSh’s groups', t => {
  const f = fixture(t);
  f.put(f.kitty, 'custom_shaders crt-blue\n');
  apply(planKittyShaders(settingsOf(['crt', {WARP: 0.5}]), f.context));
  const pipeline = readFileSync(f.paths.pipeline, 'utf8');
  assert.match(pipeline, /var float4 TINT = float4\(0, 0\.8, 0\.6, 0\)/u); // shipped crt default, not crt-blue's leaked value
  assert.match(pipeline, /var float WARP = 0\.5/u);
});

test('refusals: unsafe or unknowable compositions change nothing and say why', t => {
  const cases: Array<{name: string; setup: (f: ReturnType<typeof fixture>) => void; settings: KittyShaderSettings; error: RegExp; launch?: KittyShaderContext['launch']}> = [
    {name: 'dynamic include', setup: f => f.put(f.kitty, 'geninclude gen.py\n'), settings: settingsOf(['crt']), error: /Dynamic Kitty includes/u},
    {name: 'launch override', setup: f => f.put(f.kitty, ''), settings: settingsOf(['crt']), launch: {refusal: 'Kitty was started with an override (custom_shaders)'}, error: /override/u},
    {name: 'unreadable user pipeline', setup: f => { f.put(join(dirname(f.kitty), 'shaders/mine.pipeline'), 'startgroup\nshaders x\n'); f.put(f.kitty, 'custom_shaders mine\n'); }, settings: settingsOf(['crt']), error: /cannot read|Unclosed group/u},
    {name: 'pipeline outside home', setup: f => f.put(f.kitty, 'custom_shaders /etc/kitty/elsewhere\n'), settings: settingsOf(['crt']), error: /cannot be inspected safely/u},
    {name: 'unbalanced quoting', setup: f => f.put(f.kitty, 'custom_shaders "oops\n'), settings: settingsOf(['crt']), error: /unbalanced quoting/u},
    {name: 'shadowed shipped shader', setup: f => { f.put(f.kitty, ''); f.put(join(dirname(f.kitty), 'crt.slang'), '// mine\n'); }, settings: settingsOf(['crt']), error: /would replace Kitty's shipped crt/u},
    {name: 'second cursor trail', setup: f => f.put(f.kitty, 'custom_shaders cursor-trail-default\n'), settings: settingsOf(['cursor-trail-blaze']), error: /already draws a cursor trail/u},
    {name: 'shared texture', setup: f => { f.put(join(dirname(f.kitty), 'shaders/keep.pipeline'), 'textures persist\nstartgroup\nshaders k\noutput_texture persist\nendgroup\nstartgroup\nattach\nshaders k\nendgroup\n'); f.put(f.kitty, 'custom_shaders keep\n'); },
      settings: settingsOf(['northern-lights']), error: /shared texture “persist”/u},
    {name: 'too many groups', setup: f => { f.put(join(dirname(f.kitty), 'shaders/big.pipeline'), Array.from({length: 14}, () => 'startgroup\nshaders b\nendgroup').join('\n')); f.put(f.kitty, 'custom_shaders big\n'); },
      settings: settingsOf(['northern-lights']), error: /16 shader groups in total; your shaders use 14 and these effects need 3/u},
    {name: 'unrecorded hook', setup: f => f.put(f.kitty, `include ${kittyShaderPaths(f.context).fragment}\n`), settings: settingsOf(['crt']), error: /unrecorded NMSh Kitty shader include/u},
    {name: 'nothing enabled', setup: f => f.put(f.kitty, ''), settings: settingsOf(['crt', {}, false]), error: /No Kitty effect is enabled/u},
  ];
  for (const item of cases) {
    const f = fixture(t, item.launch ? {launch: item.launch} : {});
    item.setup(f);
    const before = existsSync(f.kitty) ? readFileSync(f.kitty, 'utf8') : undefined;
    const result = planKittyShaders(item.settings, f.context);
    assert.equal(result.ok, false, item.name);
    assert.match((result as {error: string}).error, item.error, item.name);
    assert.equal(existsSync(f.kitty) ? readFileSync(f.kitty, 'utf8') : undefined, before, item.name);
    assert.equal(existsSync(f.paths.pipeline), false, item.name);
  }
});

test('symlinked, group-writable and other-owner paths are refused before any write', t => {
  const f = fixture(t);
  const real = join(f.home, 'dotfiles/kitty.conf');
  f.put(real, 'font_size 12\n');
  mkdirSync(dirname(f.kitty), {recursive: true});
  symlinkSync(real, f.kitty);
  const linked = planKittyShaders(settingsOf(['crt']), f.context);
  assert.equal(linked.ok, false);
  assert.match((linked as {error: string}).error, /symbolic link/u);
  const g = fixture(t);
  g.put(g.kitty, 'font_size 12\n');
  chmodSync(dirname(g.kitty), 0o775);
  const writable = planKittyShaders(settingsOf(['crt']), g.context);
  assert.equal(writable.ok, false);
  assert.match((writable as {error: string}).error, /writable by a group/u);
});

test('a later custom_shaders line after setup is detected: drift is reported and sync refuses to overwrite it', t => {
  const f = fixture(t);
  f.put(f.kitty, 'custom_shaders spotlight\n');
  apply(planKittyShaders(settingsOf(['crt']), f.context));
  // The person edits their own line (above NMSh's hook): Kitty still loads NMSh's reviewed copy until a new review.
  writeFileSync(f.kitty, readFileSync(f.kitty, 'utf8').replace('custom_shaders spotlight', 'custom_shaders spotlight cursor-trail-default'));
  const inspection = inspectKittyShaders(f.context);
  assert.equal(inspection.drifted, true);
  // Adding or keeping effects on a drifted value needs a review…
  assert.equal(syncKittyShaders(settingsOf(['crt']), {...f.context, gates: {...openGates, cursorRenderer: 'portable'}}).kind, 'review');
  // …but taking every NMSh effect out never waits: the person's own (new) value applies at once.
  assert.equal(syncKittyShaders(settingsOf(['crt']), {...f.context, gates: {...openGates, reducedMotion: true}, launch: {refusal: 'no KITTY_PID'}}).kind, 'written');
  assert.deepEqual(effective(f.context), ['spotlight', 'cursor-trail-default']);
  // A new reviewed plan composes the new value.
  const plan = apply(planKittyShaders(settingsOf(['crt']), f.context));
  assert.deepEqual(plan.effectiveShaders, ['spotlight', 'cursor-trail-default', f.paths.pipeline]);
  // A competing line AFTER the hook would override NMSh: refused.
  writeFileSync(f.kitty, `${readFileSync(f.kitty, 'utf8')}custom_shaders spotlight\n`);
  const overridden = planKittyShaders(settingsOf(['crt']), f.context);
  assert.equal(overridden.ok, false);
  assert.match((overridden as {error: string}).error, /later or unresolved custom_shaders line/u);
});

test('Reduced Motion, Effects Off and a Portable cursor: nothing new is written; sync drops NMSh groups only', t => {
  const f = fixture(t);
  f.put(f.kitty, 'cursor_trail 3\ncustom_shaders spotlight\n');
  const reduced = planKittyShaders(settingsOf(['crt']), {...f.context, gates: {...openGates, reducedMotion: true}});
  assert.match((reduced as {error: string}).error, /Reduced Motion is on/u);
  const off = planKittyShaders(settingsOf(['crt']), {...f.context, gates: {...openGates, effectsOff: true}});
  assert.match((off as {error: string}).error, /Decorative effects Off/u);
  const portable = planKittyShaders(settingsOf(['cursor-trail-blaze']), {...f.context, gates: {...openGates, cursorRenderer: 'portable'}});
  assert.match((portable as {error: string}).error, /Portable/u);
  const settings = settingsOf(['cursor-trail-blaze'], ['crt']);
  apply(planKittyShaders(settings, f.context));
  assert.match(readFileSync(f.paths.pipeline, 'utf8'), /cursor-trail-blaze/u);
  // Portable cursor: NMSh draws the trail, so Kitty's trail group goes; CRT stays.
  assert.equal(syncKittyShaders(settings, {...f.context, gates: {...openGates, cursorRenderer: 'portable'}}).kind, 'written');
  assert.doesNotMatch(readFileSync(f.paths.pipeline, 'utf8'), /cursor-trail-blaze/u);
  assert.match(readFileSync(f.paths.pipeline, 'utf8'), /shaders crt/u);
  // Reduced Motion: no NMSh line at all, so the person's own value applies unchanged.
  assert.equal(syncKittyShaders(settings, {...f.context, gates: {...openGates, reducedMotion: true}}).kind, 'written');
  assert.doesNotMatch(readFileSync(f.paths.fragment, 'utf8'), /^custom_shaders/mu);
  assert.deepEqual(effective(f.context), ['spotlight']);
  assert.equal(syncKittyShaders(settings, {...f.context, gates: {...openGates, reducedMotion: true}}).kind, 'unchanged');
  // Motion back on: restored from the reviewed settings.
  assert.equal(syncKittyShaders(settings, f.context).kind, 'written');
  assert.deepEqual(effective(f.context), ['spotlight', f.paths.pipeline]);
  assert.equal(syncKittyShaders(settings, fixture(t).context).kind, 'none');
});

test('removal restores the exact original bytes and is not repeatable; interrupted removal recovers', t => {
  const f = fixture(t);
  const original = 'font_size 13\r\ncustom_shaders spotlight';
  f.put(f.kitty, original);
  apply(planKittyShaders(settingsOf(['crt']), f.context));
  const removal = planKittyShaderRemoval(f.context);
  assert.ok(removal.ok);
  assert.ok(removal.plan.preview.some(line => line.includes('Your own custom_shaders applies again: spotlight')));
  assert.ok(applyKittyShaderPlan(removal.plan).ok);
  assert.equal(readFileSync(f.kitty, 'utf8'), original);
  for (const path of [f.paths.fragment, f.paths.pipeline, f.paths.ledger]) assert.equal(existsSync(path), false);
  assert.equal(planKittyShaderRemoval(f.context).ok, false);
  // Created config file: removal deletes the file NMSh created.
  const g = fixture(t);
  apply(planKittyShaders(settingsOf(['crt']), g.context));
  assert.ok(applyKittyShaderPlan((planKittyShaderRemoval(g.context) as {ok: true; plan: never}).plan).ok);
  assert.equal(existsSync(g.kitty), false);
  // Hook already removed by hand (or an interrupted removal): only NMSh's own files go.
  const h = fixture(t);
  h.put(h.kitty, 'font_size 9\n');
  apply(planKittyShaders(settingsOf(['crt']), h.context));
  writeFileSync(h.kitty, 'font_size 9\n');
  const recover = planKittyShaderRemoval(h.context);
  assert.ok(recover.ok && recover.plan.preview[0]!.includes('already absent'));
  assert.ok(applyKittyShaderPlan(recover.plan).ok);
  assert.equal(readFileSync(h.kitty, 'utf8'), 'font_size 9\n');
  assert.equal(existsSync(h.paths.ledger), false);
});

test('stale files and interrupted writes: edited or unowned NMSh files and changed configs refuse; failures roll back', t => {
  const f = fixture(t);
  f.put(f.kitty, 'font_size 13\n');
  apply(planKittyShaders(settingsOf(['crt']), f.context));
  writeFileSync(f.paths.pipeline, `${readFileSync(f.paths.pipeline, 'utf8')}# hand edit\n`);
  assert.match((planKittyShaders(settingsOf(['crt']), f.context) as {error: string}).error, /pipeline is unowned or was edited outside NMSh/u);
  // Removal still works: the edited file is kept (no longer included), the hook and ledger go.
  const removal = planKittyShaderRemoval(f.context);
  assert.ok(removal.ok && removal.plan.preview.some(line => /pipeline was edited outside NMSh; it is kept/u.test(line)));
  assert.ok(applyKittyShaderPlan(removal.plan).ok);
  assert.equal(readFileSync(f.kitty, 'utf8'), 'font_size 13\n');
  assert.match(readFileSync(f.paths.pipeline, 'utf8'), /# hand edit/u);
  assert.equal(existsSync(f.paths.ledger), false);
  // A deleted owned file does not block removal either.
  const d = fixture(t);
  d.put(d.kitty, 'font_size 13\n');
  apply(planKittyShaders(settingsOf(['crt']), d.context));
  rmSync(d.paths.pipeline);
  assert.match((planKittyShaders(settingsOf(['crt']), d.context) as {error: string}).error, /missing; R .* removes the integration/u);
  const missing = planKittyShaderRemoval(d.context);
  assert.ok(missing.ok && applyKittyShaderPlan(missing.plan).ok);
  assert.equal(readFileSync(d.kitty, 'utf8'), 'font_size 13\n');
  assert.equal(existsSync(d.paths.fragment), false);
  const g = fixture(t);
  g.put(g.kitty, 'font_size 13\n');
  apply(planKittyShaders(settingsOf(['crt']), g.context));
  writeFileSync(g.paths.ledger, '{not json');
  assert.match((planKittyShaders(settingsOf(['crt']), g.context) as {error: string}).error, /malformed/u);
  // Unowned leftovers from an interrupted first setup (files without a ledger) are preserved, not overwritten.
  const h = fixture(t);
  h.put(h.kitty, '');
  h.put(h.paths.pipeline, '# someone else\n');
  assert.match((planKittyShaders(settingsOf(['crt']), h.context) as {error: string}).error, /unowned/u);
  // The config changes between preview and confirmation: nothing is written.
  const k = fixture(t);
  k.put(k.kitty, 'font_size 13\n');
  const planned = planKittyShaders(settingsOf(['crt']), k.context);
  assert.ok(planned.ok);
  writeFileSync(k.kitty, 'font_size 14\n');
  const applied = applyKittyShaderPlan(planned.plan);
  assert.equal(applied.ok, false);
  assert.equal(readFileSync(k.kitty, 'utf8'), 'font_size 14\n');
  assert.equal(existsSync(k.paths.pipeline), false);
  // A dependency (the person's own pipeline) changes after preview: refused too.
  const m = fixture(t);
  m.put(join(dirname(m.kitty), 'shaders/mine.pipeline'), 'startgroup\nshaders m\nendgroup\n');
  m.put(m.kitty, 'custom_shaders mine\n');
  const mine = planKittyShaders(settingsOf(['crt']), m.context);
  assert.ok(mine.ok);
  writeFileSync(join(dirname(m.kitty), 'shaders/mine.pipeline'), 'textures persist\nstartgroup\nshaders m\nendgroup\n');
  assert.equal(applyKittyShaderPlan(mine.plan).ok, false);
  assert.equal(existsSync(m.paths.pipeline), false);
});

test('notes: a trail turns cursor_trail on, CRT needs an opaque background, missing user shaders are kept as written', t => {
  const f = fixture(t);
  f.put(f.kitty, 'background_opacity 0.8\ncustom_shaders not-installed\n');
  const plan = planKittyShaders(settingsOf(['cursor-trail-blaze'], ['crt']), f.context);
  assert.ok(plan.ok);
  assert.ok(plan.plan.notes.some(note => /Turns Kitty's cursor_trail on \(3; it would be 0\)/u.test(note)));
  assert.ok(plan.plan.notes.some(note => /background_opacity 0\.8/u.test(note)));
  assert.ok(plan.plan.notes.some(note => /cannot find your shader “not-installed”; it is kept exactly as written/u.test(note)));
  assert.deepEqual(plan.plan.effectiveShaders, ['not-installed', kittyShaderPaths(f.context).pipeline]);
});

test('launch options: overrides and foreign config files refuse; unreadable launch state refuses', t => {
  assert.match(launchOverrideReason('/Applications/kitty.app/Contents/MacOS/kitty -o custom_shaders=crt')!, /override \(custom_shaders\)/u);
  assert.match(launchOverrideReason('kitty --override=cursor_trail=1')!, /cursor_trail/u);
  assert.match(launchOverrideReason('kitty -c /tmp/other.conf')!, /--config/u);
  assert.match(launchOverrideReason('kitty --config=/x')!, /--config/u);
  assert.equal(launchOverrideReason('kitty -o font_size=14 --single-instance'), undefined);
  const f = fixture(t);
  assert.match(inspectKittyLaunch(f.context, () => 'kitty').refusal!, /KITTY_PID/u);
  const env = {...f.context.env, KITTY_PID: '4242'};
  assert.deepEqual(inspectKittyLaunch({...f.context, env}, () => '/usr/bin/kitty'), {});
  assert.match(inspectKittyLaunch({...f.context, env}, () => undefined).refusal!, /could not be read/u);
  f.put(join(f.home, '.config/kitty/macos-launch-services-cmdline'), '-o custom_shaders=fireworks\n');
  assert.match(inspectKittyLaunch({...f.context, env}, () => '/usr/bin/kitty').refusal!, /macos-launch-services-cmdline/u);
});

test('emitted pipelines round-trip through the parser and never carry pipeline-level vars', () => {
  const parsed = parseKittyPipeline(RESOURCES['northern-lights.pipeline']!, 'n');
  assert.ok(parsed.ok);
  const text = emitKittyPipeline(parsed.value, ['header']);
  const again = parseKittyPipeline(text, 'n');
  assert.ok(again.ok);
  assert.deepEqual(again.value, parsed.value);
  assert.throws(() => emitKittyPipeline({textures: [], vars: [{type: 'float', name: 'X', value: '1.0'}], groups: []}), /pipeline-level vars/u);
  assert.deepEqual(shellWords(`a 'b c' "d \\"e\\"" f\\ g`), ['a', 'b c', 'd "e"', 'f g']);
  assert.equal(shellWords('"open'), undefined);
});

// ---- One cursor engine: Kitty trail shader vs Portable -------------------------------------------------------------

test('cursor: a Portable renderer turns Kitty’s own trail off; a written Kitty trail shader means Portable never draws a second trail', async t => {
  const {fragmentContent} = await import('../src/cursor/native.js');
  const {chooseBackend, hostCursorFacts, availabilityOf} = await import('../src/cursor/backends.js');
  const {DEFAULT_CURSOR} = await import('../src/prompt/configuration.js');
  const cursor = (extra: Record<string, unknown>) => ({...structuredClone(DEFAULT_CURSOR), ...extra}) as typeof DEFAULT_CURSOR;
  const env = {XDG_CONFIG_HOME: '/x'} as NodeJS.ProcessEnv;
  assert.match(fragmentContent('kitty', cursor({motion: 'tail', renderer: 'portable'}), env), /^cursor_trail 0$/mu, 'Portable draws the trail itself');
  assert.match(fragmentContent('kitty', cursor({motion: 'tail', renderer: 'auto'}), env), /^cursor_trail 3$/mu);
  const kittyEnv = {KITTY_WINDOW_ID: '1'} as NodeJS.ProcessEnv;
  // Not set up through /cursor, but NMSh's reviewed Kitty pipeline has a Blaze trail: Kitty owns the trail.
  const blaze = hostCursorFacts(kittyEnv, () => false, () => 'cursor-trail-blaze');
  const tail = chooseBackend(cursor({motion: 'tail', renderer: 'auto'}), blaze);
  assert.equal(tail.backend.id, 'kitty');
  assert.equal(tail.portableDraws.motion, false);
  assert.match(tail.reason, /Blaze trail shader/u);
  // Blaze is a trail look; a Portable Lightning bolt is a different effect and still draws.
  assert.equal(chooseBackend(cursor({motion: 'tail', effect: 'lightning'}), blaze).portableDraws.effect, true);
  // The Lightning trail shader draws the bolt: Portable must not draw its own Lightning too.
  const lightning = hostCursorFacts(kittyEnv, () => true, () => 'cursor-trail-lightning');
  const both = chooseBackend(cursor({motion: 'tail', effect: 'lightning'}), lightning);
  assert.deepEqual([both.portableDraws.motion, both.portableDraws.effect], [false, false]);
  assert.equal(availabilityOf('effect', 'lightning', 'auto', lightning).available && (availabilityOf('effect', 'lightning', 'auto', lightning) as {via: string}).via, 'native');
  // Motion Off means Kitty's cursor_trail is 0, so its shader draws nothing: Portable keeps its Lightning.
  assert.equal(chooseBackend(cursor({motion: 'off', effect: 'lightning'}), lightning).portableDraws.effect, true);
  // Without any NMSh Kitty trail, Kitty's built-in trail still has no effects.
  assert.equal(chooseBackend(cursor({motion: 'tail', effect: 'lightning'}), hostCursorFacts(kittyEnv, () => true)).portableDraws.effect, true);
});

test('cursor: the written trail is read from NMSh’s files, not from settings', t => {
  const f = fixture(t);
  f.put(f.kitty, 'cursor_trail 3\n');
  return import('../src/appearance/kittyShaders.js').then(({writtenKittyTrail}) => {
    assert.equal(writtenKittyTrail(f.context), undefined);
    const settings = settingsOf(['cursor-trail-blaze']);
    apply(planKittyShaders(settings, f.context));
    assert.equal(writtenKittyTrail(f.context), 'cursor-trail-blaze');
    // cursor_trail 0 means Kitty draws no shader trail at all: Portable must not be told Kitty has it.
    writeFileSync(f.kitty, readFileSync(f.kitty, 'utf8').replace('cursor_trail 3', 'cursor_trail 0'));
    assert.equal(writtenKittyTrail(f.context), undefined);
    writeFileSync(f.kitty, readFileSync(f.kitty, 'utf8').replace('cursor_trail 0', 'cursor_trail 3'));
    assert.equal(writtenKittyTrail(f.context), 'cursor-trail-blaze');
    syncKittyShaders(settings, {...f.context, gates: {...openGates, cursorRenderer: 'portable'}});
    assert.equal(writtenKittyTrail(f.context), undefined);
  });
});

test('a leaked user var that NMSh cannot pin (multi-line or repeated declaration) refuses; ~user entries are not guessed', t => {
  const resources = {...RESOURCES, 'crt.slang': 'static const float WARP = 0.25f;\nstatic const float4 TINT =\n    float4(0, 0.8, 0.6, 0);\n'};
  const f = fixture(t, {catalog: catalog('0.49.2', resources)});
  f.put(f.kitty, 'custom_shaders crt-blue\n');
  const refused = planKittyShaders(settingsOf(['crt']), f.context);
  assert.equal(refused.ok, false);
  assert.match((refused as {error: string}).error, /set TINT for every chained shader.*cannot pin safely/u);
  assert.equal(parseShaderConstants('static const float A = 1.0;\nstatic const float A = 2.0;\n').get('A')?.raw, '');
  const g = fixture(t);
  g.put(g.kitty, 'custom_shaders ~other/shaders/x\n');
  assert.match((planKittyShaders(settingsOf(['crt']), g.context) as {error: string}).error, /~user/u);
});

test('a trail with cursor_trail at 0 is turned on by NMSh’s own fragment, kept by sync, refused when a later line forces 0', async t => {
  const {writtenKittyTrail} = await import('../src/appearance/kittyShaders.js');
  // Kitty's default (no cursor_trail line), which is also what /cursor's file says with Motion off: the shader would never draw.
  const f = fixture(t);
  f.put(f.kitty, 'font_size 12\n');
  const settings = settingsOf(['cursor-trail-lightning']);
  const plan = apply(planKittyShaders(settings, f.context));
  assert.ok(plan.notes.some(note => /Turns Kitty's cursor_trail on \(3; it would be 0\)/u.test(note)), plan.notes.join('\n'));
  assert.match(readFileSync(f.paths.fragment, 'utf8'), /^cursor_trail 3$/mu);
  assert.equal(Number(readHostConfiguration('kitty', f.context).values.get('cursor_trail')?.value), 3);
  assert.equal(writtenKittyTrail(f.context), 'cursor-trail-lightning', 'Kitty owns the trail, so Portable draws no second one');
  // Sync judges without NMSh's own line, so it keeps that line instead of dropping it and refusing.
  assert.equal(syncKittyShaders(settings, f.context).kind, 'unchanged');
  // /cursor Motion Off removes NMSh's trail (like a Portable renderer) and its cursor_trail line with it.
  assert.equal(syncKittyShaders(settings, {...f.context, gates: {...openGates, cursorMotion: 'off'}}).kind, 'written');
  assert.doesNotMatch(readFileSync(f.paths.fragment, 'utf8'), /cursor_trail/u);
  assert.equal(writtenKittyTrail(f.context), undefined);
  // Back on: the trail and its line return. A later line forcing 0 after NMSh's include refuses with the reason.
  assert.equal(syncKittyShaders(settings, f.context).kind, 'written');
  assert.match(readFileSync(f.paths.fragment, 'utf8'), /^cursor_trail 3$/mu);
  writeFileSync(f.kitty, `${readFileSync(f.kitty, 'utf8')}cursor_trail 0\n`);
  const refused = planKittyShaders(settings, f.context);
  assert.ok(!refused.ok && /cursor_trail would still be 0 \(set later in .*kitty\.conf\)/u.test(refused.error), refused.ok ? 'planned' : refused.error);
  // The person's own positive value is kept as it is: no second cursor_trail line.
  const g = fixture(t);
  g.put(g.kitty, 'cursor_trail 10\n');
  apply(planKittyShaders(settingsOf(['cursor-trail-blaze']), g.context));
  assert.doesNotMatch(readFileSync(g.paths.fragment, 'utf8'), /cursor_trail/u);
  // A non-trail effect never touches cursor_trail.
  const h = fixture(t);
  h.put(h.kitty, '');
  apply(planKittyShaders(settingsOf(['northern-lights']), h.context));
  assert.doesNotMatch(readFileSync(h.paths.fragment, 'utf8'), /cursor_trail/u);
});

test('switching trail styles replaces the one trail group; Lightning and Blaze reference different shipped shaders', t => {
  const f = fixture(t);
  f.put(f.kitty, 'cursor_trail 3\n');
  apply(planKittyShaders(settingsOf(['cursor-trail-lightning']), f.context));
  const lightning = readFileSync(f.paths.pipeline, 'utf8');
  apply(planKittyShaders(settingsOf(['cursor-trail-blaze']), f.context));
  const blaze = readFileSync(f.paths.pipeline, 'utf8');
  assert.deepEqual([...lightning.matchAll(/^\s*shaders (.+)$/gmu)].map(match => match[1]), ['cursor-trail-lightning']);
  assert.deepEqual([...blaze.matchAll(/^\s*shaders (.+)$/gmu)].map(match => match[1]), ['cursor-trail-blaze'], 'one trail, never both');
  assert.equal((blaze.match(/animation_start cursor-trail-move/gu) ?? []).length, 1);
});
