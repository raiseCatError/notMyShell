/**
 * Installed-Ghostty checks (each skipped when its tool is absent), all in a private HOME and config:
 *  1. NMSh's uniform table matches the shader prefix compiled into each available Ghostty binary
 *     (installed app, plus extra binaries in NMSH_TEST_GHOSTTY_BINARIES, colon-separated).
 *  2. NMSh's composed configuration passes Ghostty's own `+validate-config --config-file` (which loads only
 *     that file and its includes; it never reads the real configuration).
 *  3. Every offered preset compiles with the GLSL front end of Kitty's bundled slangc against an equivalent
 *     prefix; a 1.3 preset fails against the 1.2 prefix (the version gate is real).
 * Nothing launches a Ghostty window or touches an installed app or real config. Compiling is a PROXY: Ghostty
 * itself uses glslang and SPIRV-Cross/Metal on its render thread, and neither proves GPU output.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {buildGhosttyCatalog, generateGhosttyShader, ghosttyCapability, ghosttyPrefix, GHOSTTY_UNIFORMS, presetById} from '../src/appearance/ghosttyShaderCatalog.js';
import {applyGhosttyShaderPlan, ghosttyShaderPaths, planGhosttyShaders, type GhosttyShaderContext} from '../src/appearance/ghosttyShaders.js';
import {normalizeHostShaders} from '../src/appearance/kittyShaderSettings.js';

const binaries = ['/Applications/Ghostty.app/Contents/MacOS/ghostty', ...(process.env.NMSH_TEST_GHOSTTY_BINARIES ?? '').split(':').filter(Boolean)].filter(path => existsSync(path));
const slangc = ['/Applications/kitty.app/Contents/MacOS/slangc'].find(path => existsSync(path));
const colors = {cursorColors: {head: [1, 0.6, 0.2], tail: [0.2, 0.3, 1]}};

function privateHome(t: {after: (fn: () => void) => void}) {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'nmsh-gshader-live-')));
  t.after(() => rmSync(home, {recursive: true, force: true}));
  return home;
}
const versionOf = (binary: string, home: string) => /Ghostty (\d+\.\d+\.\d+)/u.exec(spawnSync(binary, ['+version'], {encoding: 'utf8', timeout: 20_000, env: {...process.env, HOME: home}}).stdout ?? '')?.[1];

/** The uniform names in the binary's compiled-in shadertoy prefix (the `Globals` block). */
function binaryUniforms(binary: string): string[] {
  const text = readFileSync(binary).toString('latin1');
  const start = text.indexOf('uniform Globals {');
  assert.ok(start >= 0, 'shader prefix not found in the binary');
  const end = text.indexOf('};', start);
  assert.ok(end > start && end - start < 4096, 'bounded Globals block');
  const block = text.slice(start, end);
  return [...block.matchAll(/uniform\s+\w+\s+(i[A-Z]\w*)/gu)].map(match => match[1]!);
}

for (const binary of binaries) {
  test(`Ghostty binary ${binary}: its shader uniforms are exactly NMSh's table for its version`, t => {
    const home = privateHome(t);
    const version = versionOf(binary, home);
    assert.ok(version, 'version');
    const capability = ghosttyCapability(version);
    assert.ok(capability.supported && capability.level, `NMSh supports Ghostty ${version}`);
    const expected = GHOSTTY_UNIFORMS.filter(item => capability.level === '1.3' || item.since === '1.2').map(item => item.name);
    assert.deepEqual(binaryUniforms(binary), expected);
  });

  test(`Ghostty binary ${binary}: +validate-config accepts NMSh's composed configuration (private files only)`, t => {
    const home = privateHome(t);
    const version = versionOf(binary, home)!;
    const context: GhosttyShaderContext = {env: {HOME: home, XDG_CONFIG_HOME: join(home, '.config'), NMSH_CONFIG_HOME: join(home, '.config/nmsh')}, platform: process.platform,
      catalog: buildGhosttyCatalog(version), gates: {reducedMotion: false, effectsOff: false, cursorRenderer: 'auto', cursorMotion: 'tail'}, launch: {}, colors};
    const config = join(home, '.config/ghostty/config.ghostty');
    mkdirSync(dirname(config), {recursive: true, mode: 0o700});
    writeFileSync(config, 'font-size = 13\ncustom-shader = mine.glsl\n', {mode: 0o600});
    writeFileSync(join(dirname(config), 'mine.glsl'), 'void mainImage(out vec4 c, in vec2 p) { c = texture(iChannel0, p / iResolution.xy); }\n');
    const effects = buildGhosttyCatalog(version).offered.filter(item => item.definition.id !== 'comet').map(item => ({id: item.definition.id, enabled: true, values: {}}));
    const planned = planGhosttyShaders(normalizeHostShaders({ghostty: {effects}}).ghostty, context);
    assert.ok(planned.ok, planned.ok ? '' : planned.error);
    assert.ok(applyGhosttyShaderPlan(planned.plan).ok);
    const run = spawnSync(binary, ['+validate-config', `--config-file=${config}`], {encoding: 'utf8', timeout: 30_000, env: {...process.env, HOME: home, XDG_CONFIG_HOME: join(home, '.config')}});
    const output = `${run.stdout}${run.stderr}`.split('\n').filter(line => line.trim() && !/sentry/iu.test(line));
    assert.equal(run.status, 0, output.join('\n'));
    assert.deepEqual(output, []);
    assert.ok(existsSync(join(ghosttyShaderPaths(context).shaderDirectory, 'vignette.glsl')));
  });
}

test('every offered preset compiles as GLSL 430 (slangc proxy); a 1.3 preset does not compile against 1.2', {skip: slangc ? false : 'Kitty’s bundled slangc is not installed'}, t => {
  const dir = privateHome(t);
  const compile = (name: string, level: '1.2' | '1.3', source: string) => {
    // slangc's GLSL mode rejects re-declaring the built-in gl_FragCoord; Ghostty's own compiler accepts it. Nothing else changes.
    const file = join(dir, `${name}.glsl`);
    writeFileSync(file, ghosttyPrefix(level).replace('layout(location = 0) in vec4 gl_FragCoord;\n', '') + source);
    return spawnSync(slangc!, ['-lang', 'glsl', '-allow-glsl', '-stage', 'fragment', '-entry', 'main', '-target', 'spirv', '-o', join(dir, `${name}.spv`), file],
      {encoding: 'utf8', timeout: 60_000, env: {...process.env, HOME: dir}});
  };
  for (const preset of buildGhosttyCatalog('1.4.0').offered) {
    for (const values of [{}, ...(preset.params.some(param => param.name === 'COLOR_SOURCE') ? [{COLOR_SOURCE: 2}] : []),
      Object.fromEntries(preset.params.filter(param => param.kind === 'number').map(param => [param.name, param.max!]))]) {
      const shader = generateGhosttyShader(preset.definition, values, colors);
      const result = compile(`${preset.definition.id}-${Object.keys(values).length}`, shader.level, shader.source);
      assert.equal(result.status, 0, `${preset.definition.id} ${JSON.stringify(values)}: ${result.stdout}${result.stderr}`);
    }
  }
  const aurora = generateGhosttyShader(presetById('aurora')!, {}, colors);
  assert.notEqual(compile('aurora-on-1.2', '1.2', aurora.source).status, 0, 'iBackgroundColor does not exist in the 1.2 interface');
});
