// Real-terminal captures of the managed agent view (VHS), with a fixture provider and a disposable home.
// usage: node capture.mjs <repo> <outdir> [width height label ENV=value,... '{"configKey":value}']
import {execFileSync, spawnSync} from 'node:child_process';
import {readdirSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const [repo, outdir, width = '1440', height = '960', label = 'wide', extraEnv = '', extraConfig = '{}'] = process.argv.slice(2);
const root = realpathSync(mkdtempSync(join(tmpdir(), 'nmsh-cap-')));
const home = join(root, 'home');
const dirs = {home, config: join(home, '.config'), data: join(home, '.local/share'), state: join(home, '.local/state'), cache: join(home, '.cache'), runtime: join(root, 'run'), temp: join(root, 'tmp'), bin: join(root, 'bin')};
for (const dir of Object.values(dirs)) mkdirSync(dir, {recursive: true, mode: 0o700});
symlinkSync(join(repo, 'bin', 'nmsh'), join(dirs.bin, 'nmsh'));
copyFileSync(join(here, 'fake-claude.cjs'), join(dirs.bin, 'claude'));
execFileSync('chmod', ['+x', join(dirs.bin, 'claude')]);
writeFileSync(join(home, '.zshrc'), '# capture home\n');
writeFileSync(join(home, '.zshenv'), '');
writeFileSync(join(home, '.gitconfig'), '[user]\n\tname = Demo\n\temail = demo@example.com\n[init]\n\tdefaultBranch = main\n');
mkdirSync(join(dirs.config, 'nmsh'), {recursive: true});
writeFileSync(join(dirs.config, 'nmsh', 'config.json'), JSON.stringify({onboardingComplete: true, toolsSetupComplete: true, glyphChoiceComplete: true, glyphStyle: 'nerd', updateMode: 'off', toolUpdateChecks: 'off', installSuggestions: false, liveSessionStartup: 'ask', ...JSON.parse(extraConfig)}));
const project = join(home, 'Projects', 'demo');
mkdirSync(join(project, 'src'), {recursive: true});
writeFileSync(join(project, 'src', 'sum.js'), 'export const sum = (a, b) => a + b;\n');
const git = (...args) => execFileSync('git', args, {cwd: project, env: {...process.env, HOME: home, GIT_CONFIG_GLOBAL: join(home, '.gitconfig'), GIT_CONFIG_NOSYSTEM: '1'}, stdio: 'ignore'});
git('init', '-q'); git('add', '.'); git('commit', '-q', '-m', 'init'); git('switch', '-q', '-c', 'feature/theme-preview');
const env = {HOME: home, USER: 'demo', SHELL: '/bin/zsh', PATH: [dirs.bin, dirname(process.execPath), '/opt/homebrew/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin'].join(':'),
  XDG_CONFIG_HOME: dirs.config, XDG_DATA_HOME: dirs.data, XDG_STATE_HOME: dirs.state, XDG_CACHE_HOME: dirs.cache, NMSH_RUNTIME_DIR: dirs.runtime, TMPDIR: dirs.temp,
  GIT_CONFIG_GLOBAL: join(home, '.gitconfig'), GIT_CONFIG_NOSYSTEM: '1', NMSH_DEMO: '1', NMSH_DISABLE_UPDATES: '1', TERM: 'xterm-256color', COLORTERM: 'truecolor', LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8',
  TERM_PROGRAM: '', HISTFILE: join(home, '.h'), NMSH_SESSION_SERVICE: '0'};
for (const pair of extraEnv.split(',').filter(Boolean)) { const [k, v] = pair.split('='); env[k] = v; }
const quote = v => `"${String(v).replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
mkdirSync(outdir, {recursive: true});
const shot = name => resolve(outdir, `${label}-${name}.png`);
const settings = readFileSync(join(repo, 'scripts/demos/settings.tape'), 'utf8').replace(/Set Width \d+/u, `Set Width ${width}`).replace(/Set Height \d+/u, `Set Height ${height}`);
const tape = `${settings}
${Object.entries(env).map(([k, v]) => `Env ${k} ${quote(v)}`).join('\n')}
Output ${quote(join(root, 'frames') + '/')}
Hide
Type "cd ~/Projects/demo && clear && nmsh"
Enter
Sleep 6s
Show
Type "/claude"
Sleep 0.5s
Enter
Sleep 2s
Enter
Sleep 2s
Type "How is the sum helper tested, and what is missing?"
Sleep 0.3s
Enter
Sleep 4s
Sleep 1s
`;
writeFileSync(join(root, 'run.tape'), tape);
const run = spawnSync('vhs', [join(root, 'run.tape')], {cwd: root, encoding: 'utf8', env: Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(CLAUDE|ANTHROPIC|NMSH_|CODEX)/u.test(k)))});
if (run.status !== 0) console.error(run.stdout, run.stderr);
// Stills: the frame just before each next action (seconds after Show; TypingSpeed 70ms).
const stills = {'1-launcher': 3.0, '2-welcome': 5.0, '3-typing': 8.85, '4-conversation': 13.4};
for (const [name, seconds] of Object.entries(stills)) {
  const last = readdirSync(join(root, 'frames')).filter(f => f.startsWith('frame-text-')).length;
  const index = String(Math.min(last, Math.round(seconds * 24))).padStart(5, '0');
  const text = join(root, 'frames', `frame-text-${index}.png`), cursor = join(root, 'frames', `frame-cursor-${index}.png`);
  const r = spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', text, '-i', cursor, '-filter_complex', '[0][1]overlay', '-frames:v', '1', shot(name)], {encoding: 'utf8'});
  if (r.status !== 0) console.error(name, r.stderr);
}
for (let i = 0; i < 2; i += 1) {
  const pids = (spawnSync('lsof', ['-t', '+D', root], {encoding: 'utf8'}).stdout || '').split('\n').map(Number).filter(Boolean);
  for (const pid of pids) try { process.kill(pid, 'SIGKILL'); } catch {}
}
rmSync(root, {recursive: true, force: true});
console.log('captured', label, run.status);
