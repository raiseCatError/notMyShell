/**
 * Installed-Kitty check (skipped without Kitty 0.49+): NMSh's composed configuration is loaded by Kitty's
 * OWN config parser and its merged pipeline is compiled by Kitty's bundled slangc, all in a private HOME,
 * config and cache directory. Nothing touches the installed app, a real config or a running Kitty.
 * Headless compilation is not GPU rendering; physical QA remains separate.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {discoverKittyCatalog, kittyBinary, versionAtLeast} from '../src/appearance/kittyShaderCatalog.js';
import {applyKittyShaderPlan, kittyShaderPaths, normalizeHostShaders, planKittyShaders, type KittyShaderContext} from '../src/appearance/kittyShaders.js';

const binary = kittyBinary();
const version = binary ? spawnSync(binary, ['--version'], {encoding: 'utf8', timeout: 10_000}).stdout ?? '' : '';
const supported = versionAtLeast(/kitty (\d+\.\d+(?:\.\d+)?)/u.exec(version)?.[1] ?? '', [0, 49]);

const CHECK = `
import json, os
from kitty.config import load_config
from kitty.constants import config_dir
from kitty.shaders.slang import parse_pipeline, merge_pipelines, build_custom_shader_pipeline_glsl
opts = load_config(os.path.join(config_dir, 'kitty.conf'))
out = {'custom_shaders': list(opts.custom_shaders), 'cursor_trail': opts.cursor_trail, 'config_dir': config_dir}
try:
    merged = merge_pipelines([parse_pipeline(name) for name in opts.custom_shaders])
    out['groups'] = len(merged['groups'])
    vert, frag, meta = build_custom_shader_pipeline_glsl(merged)
    out['compiled'] = True
    out['frag'] = frag
except Exception as e:
    out['compiled'] = False
    out['error'] = str(e)[:4000]
print(json.dumps(out))
`;

test('installed Kitty loads NMSh’s composed custom_shaders exactly and compiles the merged pipeline headlessly', {skip: !supported && 'Kitty 0.49+ is not installed', timeout: 120_000}, async t => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'nmsh-klive-')));
  t.after(() => rmSync(home, {recursive: true, force: true}));
  // No XDG_CONFIG_HOME: on macOS NMSh's folder is "Library/Application Support", so the pipeline path has a space.
  const env = {HOME: home, PATH: process.env.PATH ?? '/usr/bin:/bin'};
  const kittyDir = join(home, '.config/kitty');
  const put = (path: string, content: string) => { mkdirSync(dirname(path), {recursive: true, mode: 0o700}); writeFileSync(path, content, {mode: 0o600}); };
  put(join(kittyDir, 'shaders/my glow.pipeline'), 'startgroup\n    shaders my-glow\nendgroup\n');
  put(join(kittyDir, 'shaders/my-glow.slang'), 'import kitty_custom_shader_types;\npublic float4 fragment_main(float4 color, KittyTextures t, KittyCustomShaderData d) { return color; }\n');
  put(join(kittyDir, 'kitty.conf'), 'cursor_trail 3\ninclude theme.conf\ncustom_shaders crt-blue "my glow"\n');
  put(join(kittyDir, 'theme.conf'), 'custom_shaders spotlight\n');
  const catalog = await discoverKittyCatalog(binary, (bin, args, timeout) => new Promise(resolve => {
    const result = spawnSync(bin, [...args], {encoding: 'utf8', timeout, env: {...env, PYTHONDONTWRITEBYTECODE: '1', KITTY_CACHE_DIRECTORY: join(home, 'cache')}});
    resolve({code: result.status, stdout: result.stdout ?? ''});
  }));
  assert.ok(catalog.supported, catalog.reason);
  for (const id of ['cursor-trail-lightning', 'cursor-trail-blaze', 'northern-lights', 'spotlight', 'crt', 'inside-the-matrix', 'pond-ripple']) {
    assert.ok(catalog.offered.some(preset => preset.definition.id === id), `${id} offered by installed Kitty`);
  }
  const context: KittyShaderContext = {env, platform: process.platform, catalog, gates: {reducedMotion: false, effectsOff: false, cursorRenderer: 'auto'}, launch: {}};
  const settings = normalizeHostShaders({kitty: {effects: [
    {id: 'cursor-trail-lightning', enabled: true, values: {DURATION: 0.2, BOLT_COLOR: [0.4, 0.7, 1]}},
    {id: 'northern-lights', enabled: true, values: {EFFECT_INTENSITY: 0.4}},
    {id: 'crt', enabled: true, values: {WARP: 0.1, TINT: [0.1, 0.5, 0.9, 1]}},
  ]}}).kitty;
  const planned = planKittyShaders(settings, context);
  assert.ok(planned.ok, planned.ok ? '' : planned.error);
  const applied = applyKittyShaderPlan(planned.plan);
  assert.ok(applied.ok, applied.ok ? '' : applied.error);
  const paths = kittyShaderPaths(context);
  const run = spawnSync(binary!, ['+runpy', CHECK], {encoding: 'utf8', timeout: 100_000,
    env: {...env, PYTHONDONTWRITEBYTECODE: '1', KITTY_CACHE_DIRECTORY: join(home, 'cache')}});
  const result = JSON.parse(run.stdout) as {custom_shaders: string[]; cursor_trail: number; config_dir: string; groups?: number; compiled: boolean; error?: string; frag?: string};
  assert.equal(result.config_dir, kittyDir);
  assert.deepEqual(result.custom_shaders, ['crt-blue', 'my glow', paths.pipeline], 'Kitty’s own parser sees the composed list');
  assert.deepEqual(planned.plan.effectiveShaders, result.custom_shaders);
  assert.equal(result.groups, 2 + 5);
  assert.equal(result.compiled, true, result.error);
  assert.match(result.frag ?? '', /0\.2/u);
  if (process.platform === 'darwin') assert.match(paths.pipeline, / /u);
});
