import fs from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
import test from 'node:test';
import assert from 'node:assert/strict';
import {chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {applyHostAppearance, planHostAppearance, planHostRemoval, readHostAppearance, type AppearanceContext} from '../src/appearance/hostAppearance.js';

function fixture(t: {after: (fn: () => void) => void}, platform: NodeJS.Platform = 'linux') {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'nmsh-host-')));
  t.after(() => rmSync(home, {recursive: true, force: true}));
  const context: AppearanceContext = {env: {HOME: home, XDG_CONFIG_HOME: join(home, '.config')}, platform};
  const put = (path: string, content: string) => { mkdirSync(dirname(path), {recursive: true}); writeFileSync(path, content, {mode: 0o600}); };
  return {home, context, put, ghostty: join(home, '.config/ghostty/config'), kitty: join(home, '.config/kitty/kitty.conf'), fragment: join(home, '.config/nmsh/host-appearance/ghostty.conf')};
}
const settings = {opacity: 0.65, blurMode: 'Numeric' as const, blurStrength: 12};

test('Ghostty reads actual included values without writing, in legacy/preferred and XDG/macOS source order', t => {
  const f = fixture(t, 'darwin');
  f.put(f.ghostty, 'background-opacity = 0.2\n');
  f.put(`${f.ghostty}.ghostty`, 'background-opacity = 0.4\nconfig-file = colors\nbackground-opacity = 0.5\n');
  f.put(join(dirname(f.ghostty), 'colors'), 'background-opacity = 0.6\nbackground-blur = 18\n');
  const mac = join(f.home, 'Library/Application Support/com.mitchellh.ghostty/config.ghostty');
  f.put(mac, 'background-opacity = 0.75\n');
  const before = readFileSync(`${f.ghostty}.ghostty`, 'utf8');
  const result = readHostAppearance('ghostty', f.context);
  assert.deepEqual(result.settings, {opacity: 0.6, blurMode: 'Numeric', blurStrength: 18});
  assert.equal(result.origins.opacity?.path, join(dirname(f.ghostty), 'colors')); // recursive includes run after all default roots
  assert.equal(result.origins.blurMode?.path, join(dirname(f.ghostty), 'colors'));
  assert.equal(result.hostPath, mac);
  assert.equal(readFileSync(`${f.ghostty}.ghostty`, 'utf8'), before);
  assert.equal(existsSync(join(f.home, '.config/nmsh')), false);
});

test('Kitty includes execute in place; user shaders/keybindings are preserved by save and removal', t => {
  const f = fixture(t);
  const original = '# personal\r\nbackground_opacity 0.9\r\ninclude colors.conf\r\nbackground_opacity 0.8\r\ncustom_shaders my-own\r\nmap f1 next_window\r\n';
  f.put(f.kitty, original);
  f.put(join(dirname(f.kitty), 'colors.conf'), 'background_opacity 0.4\nbackground_blur 9\n');
  assert.deepEqual(readHostAppearance('kitty', f.context).settings, {opacity: 0.8, blurMode: 'Numeric', blurStrength: 9});
  const planned = planHostAppearance('kitty', settings, f.context);
  assert.equal(planned.ok, true);
  if (!planned.ok) return;
  assert.equal(readFileSync(f.kitty, 'utf8'), original, 'planning never writes');
  assert.match(planned.plan.preview.join('\n'), /background_opacity 0.65/u);
  assert.equal(applyHostAppearance(planned.plan).ok, true);
  assert.ok(readFileSync(f.kitty, 'utf8').startsWith(original));
  assert.equal(readHostAppearance('kitty', f.context).settings?.opacity, 0.65);
  const remove = planHostRemoval('kitty', f.context);
  assert.equal(remove.ok, true);
  if (!remove.ok) return;
  assert.equal(applyHostAppearance(remove.plan).ok, true);
  assert.equal(readFileSync(f.kitty, 'utf8'), original, 'removal restores exact original bytes/newlines');
});

test('save is consent-separated, idempotent, and restore preserves subsequent unrelated edits', t => {
  const f = fixture(t);
  f.put(f.ghostty, 'theme = personal\ncustom-shader = own.glsl\nkeybind = f1=reload_config\n');
  const plan = planHostAppearance('ghostty', settings, f.context);
  assert.ok(plan.ok);
  assert.equal(existsSync(f.fragment), false);
  if (!plan.ok) return;
  assert.equal(applyHostAppearance(plan.plan).ok, true);
  const integrated = readFileSync(f.ghostty, 'utf8');
  const repeat = planHostAppearance('ghostty', settings, f.context);
  assert.ok(repeat.ok);
  if (repeat.ok) assert.equal(applyHostAppearance(repeat.plan).ok, true);
  assert.equal(readFileSync(f.ghostty, 'utf8'), integrated, 'no repeated include');
  writeFileSync(f.ghostty, `${integrated}font-size = 17\n`);
  const remove = planHostRemoval('ghostty', f.context);
  assert.ok(remove.ok);
  if (remove.ok) assert.equal(applyHostAppearance(remove.plan).ok, true);
  assert.equal(readFileSync(f.ghostty, 'utf8'), 'theme = personal\ncustom-shader = own.glsl\nkeybind = f1=reload_config\nfont-size = 17\n');
  assert.equal(existsSync(f.fragment), false);
});

test('removal keeps a line break between a no-final-newline original and later user lines (LF and CRLF)', t => {
  const cases = [
    {host: 'ghostty' as const, original: 'background-opacity = 0.8', added: 'font-size = 17\n', expected: 'background-opacity = 0.8\nfont-size = 17\n'},
    {host: 'kitty' as const, original: '# mine\r\nbackground_opacity 0.8', added: 'font_size 17\r\n', expected: '# mine\r\nbackground_opacity 0.8\r\nfont_size 17\r\n'},
  ];
  for (const {host, original, added, expected} of cases) {
    for (const append of [false, true]) {
      const f = fixture(t);
      const path = host === 'ghostty' ? f.ghostty : f.kitty;
      f.put(path, original);
      const setup = planHostAppearance(host, settings, f.context);
      assert.ok(setup.ok, `${host} setup`);
      if (!setup.ok) return;
      assert.equal(applyHostAppearance(setup.plan).ok, true);
      if (append) writeFileSync(path, `${readFileSync(path, 'utf8')}${added}`);
      const remove = planHostRemoval(host, f.context);
      assert.ok(remove.ok, `${host} removal plan`);
      if (!remove.ok) return;
      assert.equal(applyHostAppearance(remove.plan).ok, true);
      // Without later edits the exact original bytes return, including the missing final newline.
      assert.equal(readFileSync(path, 'utf8'), append ? expected : original, `${host} append=${append}`);
    }
  }
});

test('macOS Kitty uses the first existing kitty.conf (XDG, then Library/Preferences) and never shadows it', t => {
  const f = fixture(t, 'darwin');
  const preferences = join(f.home, 'Library/Preferences/kitty/kitty.conf');
  f.put(preferences, 'background_opacity 0.7\n');
  assert.equal(readHostAppearance('kitty', f.context).settings?.opacity, 0.7);
  const plan = planHostAppearance('kitty', settings, f.context);
  assert.ok(plan.ok);
  if (!plan.ok) return;
  assert.equal(plan.plan.hostPath, preferences);
  assert.equal(applyHostAppearance(plan.plan).ok, true);
  assert.equal(existsSync(f.kitty), false, 'no new XDG kitty.conf that Kitty would load instead');
  assert.equal(readHostAppearance('kitty', f.context).settings?.opacity, 0.65);
  f.put(f.kitty, 'background_opacity 0.3\n');
  const read = readHostAppearance('kitty', f.context);
  assert.equal(read.hostPath, f.kitty, 'an XDG kitty.conf takes over, as in Kitty');
  assert.equal(read.settings?.opacity, 0.3);
});

test('removal recovers when the owned hook is already gone: only NMSh files are removed', t => {
  const f = fixture(t);
  const original = 'background-opacity = 0.8\n';
  f.put(f.ghostty, original);
  const setup = planHostAppearance('ghostty', settings, f.context);
  assert.ok(setup.ok);
  if (!setup.ok) return;
  assert.equal(applyHostAppearance(setup.plan).ok, true);
  writeFileSync(f.ghostty, `${original}font-size = 17\n`); // hook removed (interrupted removal or by hand)
  const remove = planHostRemoval('ghostty', f.context);
  assert.ok(remove.ok);
  if (!remove.ok) return;
  assert.match(remove.plan.preview.join('\n'), /already absent/u);
  assert.equal(applyHostAppearance(remove.plan).ok, true);
  assert.equal(readFileSync(f.ghostty, 'utf8'), `${original}font-size = 17\n`);
  assert.equal(existsSync(f.fragment), false);
  assert.equal(existsSync(join(dirname(f.fragment), 'ghostty.json')), false);
});

test('stale includes and newly appearing default configs invalidate confirmation before any write', t => {
  const f = fixture(t);
  f.put(f.ghostty, 'config-file = included\n');
  const included = join(dirname(f.ghostty), 'included');
  f.put(included, 'background-opacity = 0.9\n');
  const plan = planHostAppearance('ghostty', settings, f.context);
  assert.ok(plan.ok);
  f.put(included, 'background-opacity = 0.8\n');
  if (plan.ok) assert.equal(applyHostAppearance(plan.plan).ok, false);
  assert.equal(existsSync(f.fragment), false);
  const next = planHostAppearance('ghostty', settings, f.context);
  f.put(`${f.ghostty}.ghostty`, 'background-opacity = 0.1\n');
  if (next.ok) assert.equal(applyHostAppearance(next.plan).ok, false);
  assert.equal(existsSync(f.fragment), false);
});

test('read-only configs, symlinks and unowned or externally edited fragments refuse writes', t => {
  const f = fixture(t);
  f.put(f.ghostty, 'background-opacity = 0.9\n');
  chmodSync(f.ghostty, 0o400);
  assert.equal(planHostAppearance('ghostty', settings, f.context).ok, false);
  chmodSync(f.ghostty, 0o600);
  f.put(f.fragment, '# mine, even though in the NMSh directory\n');
  assert.equal(planHostAppearance('ghostty', settings, f.context).ok, false);
  rmSync(f.fragment);
  const plan = planHostAppearance('ghostty', settings, f.context);
  if (plan.ok) assert.equal(applyHostAppearance(plan.plan).ok, true);
  writeFileSync(f.fragment, '# user changed it\n');
  assert.equal(planHostRemoval('ghostty', f.context).ok, false);
  assert.equal(planHostAppearance('ghostty', settings, f.context).ok, false);
});

test('a symlink or writable-directory swap after preview never follows the new target', t => {
  const f = fixture(t);
  f.put(f.ghostty, 'background-opacity = 0.9\n');
  const plan = planHostAppearance('ghostty', settings, f.context);
  assert.ok(plan.ok);
  const elsewhere = join(f.home, 'elsewhere');
  f.put(elsewhere, 'keep me\n');
  rmSync(f.ghostty); symlinkSync(elsewhere, f.ghostty);
  if (plan.ok) assert.equal(applyHostAppearance(plan.plan).ok, false);
  assert.equal(readFileSync(elsewhere, 'utf8'), 'keep me\n');
  assert.equal(existsSync(f.fragment), false);
});

test('missing configs can be created and restored without touching files outside the plan', t => {
  const f = fixture(t);
  const plan = planHostAppearance('ghostty', settings, f.context);
  assert.ok(plan.ok);
  assert.equal(existsSync(f.ghostty), false);
  if (plan.ok) assert.equal(applyHostAppearance(plan.plan).ok, true);
  const remove = planHostRemoval('ghostty', f.context);
  assert.ok(remove.ok);
  if (remove.ok) assert.equal(applyHostAppearance(remove.plan).ok, true);
  assert.equal(existsSync(join(f.home, '.config/ghostty/config.ghostty')), false);
});

test('cyclic, executable and ambiguous includes fail closed; optional missing includes are tracked', t => {
  const f = fixture(t);
  f.put(f.ghostty, 'config-file = config\n');
  assert.equal(readHostAppearance('ghostty', f.context).settings, undefined);
  assert.equal(planHostAppearance('ghostty', settings, f.context).ok, false);
  f.put(f.kitty, 'geninclude echo bad\n');
  assert.equal(readHostAppearance('kitty', f.context).settings, undefined);
  f.put(f.ghostty, 'config-file = ?optional\nbackground-opacity = 0.8\n');
  const plan = planHostAppearance('ghostty', settings, f.context);
  assert.ok(plan.ok);
  f.put(join(dirname(f.ghostty), 'optional'), 'background-opacity = 0.2\n');
  if (plan.ok) assert.equal(applyHostAppearance(plan.plan).ok, false);
});

test('invalid parameters and external XDG paths are rejected without mutation', t => {
  const f = fixture(t);
  for (const bad of [{...settings, opacity: NaN}, {...settings, opacity: -1}, {...settings, blurStrength: 1.5}, {...settings, background: '#123456\ninclude evil'}]) {
    assert.equal(planHostAppearance('ghostty', bad, f.context).ok, false);
  }
  assert.equal(existsSync(join(f.home, '.config')), false);
  const other = fixture(t);
  assert.equal(planHostAppearance('ghostty', settings, {...f.context, env: {...f.context.env, XDG_CONFIG_HOME: other.home}}).ok, false);
  assert.deepEqual(readdirSync(other.home), []);
});


test('unresolved theme-derived values are reported as unknown, never invented as current', t => {
  const f = fixture(t);
  f.put(f.ghostty, 'theme = personal\n');
  const read = readHostAppearance('ghostty', f.context);
  assert.equal(read.settings, undefined);
  assert.match(read.problems.join(' '), /theme/iu);
});

test('removal preview identifies the exact owned include and every affected file', t => {
  const f = fixture(t);
  f.put(f.ghostty, 'background-opacity = 0.85\n');
  const setup = planHostAppearance('ghostty', settings, f.context);
  assert.ok(setup.ok);
  if (!setup.ok) return;
  assert.equal(applyHostAppearance(setup.plan).ok, true);
  const remove = planHostRemoval('ghostty', f.context);
  assert.ok(remove.ok);
  if (!remove.ok) return;
  assert.ok(remove.plan.preview.some(line => line.startsWith('- config-file = ?')));
});


test('Ghostty processes nested include siblings through one appended queue', t => {
  const f = fixture(t);
  f.put(f.ghostty, 'config-file = a\nconfig-file = b\n');
  f.put(join(dirname(f.ghostty), 'a'), 'background-opacity = 0.3\nconfig-file = nested\n');
  f.put(join(dirname(f.ghostty), 'b'), 'background-opacity = 0.4\n');
  f.put(join(dirname(f.ghostty), 'nested'), 'background-opacity = 0.2\n');
  assert.equal(readHostAppearance('ghostty', f.context).settings?.opacity, 0.2);
  const plan = planHostAppearance('ghostty', settings, f.context);
  assert.equal(plan.ok, false, 'do not pretend a new root include wins over a later nested include');
});

test('a concurrent host save during staging is preserved and earlier fragment writes roll back', t => {
  const f = fixture(t);
  f.put(f.ghostty, 'background-opacity = 0.8\n');
  const plan = planHostAppearance('ghostty', settings, f.context);
  assert.ok(plan.ok);
  if (!plan.ok) return;
  const original = fs.fsyncSync;
  let calls = 0;
  const handle = t.mock.method(fs, 'fsyncSync', (fd: number) => {
    original(fd);
    if (++calls === 2) writeFileSync(f.ghostty, 'background-opacity = 0.9\n# concurrent editor\n');
  });
  syncBuiltinESMExports();
  try {
    assert.equal(applyHostAppearance(plan.plan).ok, false);
    assert.equal(readFileSync(f.ghostty, 'utf8'), 'background-opacity = 0.9\n# concurrent editor\n');
    assert.equal(existsSync(f.fragment), false);
  } finally { handle.mock.restore(); syncBuiltinESMExports(); }
});

test('a failed ledger rename rolls back both managed fragment and host include without an ownership claim', t => {
  const f = fixture(t);
  const original = 'background-opacity = 0.8\n';
  f.put(f.ghostty, original);
  const plan = planHostAppearance('ghostty', settings, f.context);
  assert.ok(plan.ok);
  if (!plan.ok) return;
  const rename = fs.renameSync;
  let calls = 0;
  const handle = t.mock.method(fs, 'renameSync', (...args: Parameters<typeof rename>) => {
    if (++calls === 3) throw new Error('controlled ledger-rename failure');
    return rename(...args);
  });
  syncBuiltinESMExports();
  try {
    assert.equal(applyHostAppearance(plan.plan).ok, false);
    assert.equal(readFileSync(f.ghostty, 'utf8'), original);
    assert.equal(existsSync(f.fragment), false);
    assert.equal(existsSync(join(dirname(f.fragment), 'ghostty.json')), false);
  } finally { handle.mock.restore(); syncBuiltinESMExports(); }
});

test('valid named host colors survive an unrelated opacity change', t => {
  const f = fixture(t);
  f.put(f.ghostty, 'background = black\nbackground-opacity = 0.8\n');
  const current = readHostAppearance('ghostty', f.context).settings!;
  const plan = planHostAppearance('ghostty', {...current, opacity: 0.7}, f.context);
  assert.ok(plan.ok);
});


test('control-bearing values and group-writable parent directories fail closed', t => {
  const f = fixture(t);
  f.put(f.ghostty, 'background = black\u001b]52;c;bad\u0007\n');
  assert.equal(readHostAppearance('ghostty', f.context).settings, undefined);
  f.put(f.ghostty, 'background-opacity = 0.8\n');
  chmodSync(dirname(f.ghostty), 0o770);
  assert.equal(planHostAppearance('ghostty', settings, f.context).ok, false);
});


test('changing opacity preserves a valid existing blur strength above the normal UI range', t => {
  const f = fixture(t);
  f.put(f.ghostty, 'background-opacity = 0.8\nbackground-blur = 75\n');
  const current = readHostAppearance('ghostty', f.context).settings!;
  const plan = planHostAppearance('ghostty', {...current, opacity: 0.7}, f.context);
  assert.ok(plan.ok);
  if (plan.ok) assert.equal(applyHostAppearance(plan.plan).ok, true);
  assert.equal(readHostAppearance('ghostty', f.context).settings?.blurStrength, 75);
});
