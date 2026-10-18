import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {detectEnvironment, scanStartupFiles, STARTUP_READ_CAP, type EnvironmentEvidence} from '../src/setup/environment/detect.js';
import {parseStarshipPrompt, renderStarshipPrompt, withoutTrailingPromptCharacter} from '../src/prompt/starship.js';

/** Read-only environment detection over fixture homes: files are read as text, nothing is executed but `--version`. */
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'nmsh-keep-detect-'));
  const home = join(root, 'home'), bin = join(root, 'bin'), log = join(root, 'calls.log');
  mkdirSync(home); mkdirSync(bin);
  const tool = (name: string, version = `${name} 1.0.0`) =>
    writeFileSync(join(bin, name), `#!/bin/sh\nprintf '%s\\n' "$*" >> '${log}'\necho '${version}'\n`, {mode: 0o755});
  const put = (path: string, text: string) => { mkdirSync(dirname(join(home, path)), {recursive: true}); writeFileSync(join(home, path), text); };
  const env = (shell = '/bin/zsh', extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv =>
    ({HOME: home, PATH: bin, SHELL: shell, XDG_CONFIG_HOME: join(home, '.config'), TERM_PROGRAM: 'ghostty', ...extra});
  const detect = (environment = env()) => detectEnvironment({env: environment, home, probe: {fallbacks: [], powerlevel10kCandidates: [], shellVersion: () => 'zsh 5.9'}});
  const calls = () => existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').filter(Boolean) : [];
  return {root, home, bin, tool, put, env, detect, calls, done: () => rmSync(root, {recursive: true, force: true})};
}

const prompt = (evidence: EnvironmentEvidence, id: string) => evidence.prompts.find(item => item.id === id);

test('one Starship started by .zshrc and installed is active, with its config path', async () => {
  const f = fixture();
  try {
    f.tool('starship', 'starship 1.21.1');
    f.put('.zshrc', '# prompt\nexport EDITOR=vim\neval "$(starship init zsh)"\n');
    f.put('.config/starship.toml', 'add_newline = false\n');
    const evidence = await f.detect();
    assert.equal(evidence.shell.id, 'zsh');
    assert.equal(evidence.shell.label, 'zsh 5.9');
    assert.equal(evidence.host, 'Ghostty');
    const starship = prompt(evidence, 'starship');
    assert.equal(starship?.state, 'active');
    assert.equal(starship?.startedBy, '~/.zshrc');
    assert.equal(starship?.configPath, join(f.home, '.config/starship.toml'));
    assert.match(starship?.version ?? '', /1\.21\.1/u);
    assert.deepEqual(evidence.files, ['~/.zshrc']);
    // Only `--version` ran; startup files were never executed.
    assert.deepEqual(f.calls(), ['--version']);
  } finally { f.done(); }
});

test('Starship and Powerlevel10k both started are both active', async () => {
  const f = fixture();
  try {
    f.tool('starship');
    f.put('powerlevel10k/powerlevel10k.zsh-theme', '# theme\n');
    f.put('.p10k.zsh', 'typeset -g POWERLEVEL9K_MODE=nerdfont-complete\n');
    f.put('.zshrc', 'source ~/powerlevel10k/powerlevel10k.zsh-theme\n[[ ! -f ~/.p10k.zsh ]] || source ~/.p10k.zsh\neval "$(starship init zsh)"\n');
    const evidence = await f.detect();
    assert.equal(prompt(evidence, 'starship')?.state, 'active');
    const p10k = prompt(evidence, 'powerlevel10k');
    assert.equal(p10k?.state, 'active');
    assert.equal(p10k?.themePath, join(f.home, 'powerlevel10k/powerlevel10k.zsh-theme'));
    assert.equal(p10k?.configPath, join(f.home, '.p10k.zsh'));
  } finally { f.done(); }
});

test('a custom PROMPT, an Oh My Zsh theme and promptinit themes are custom prompts, not providers', async () => {
  const f = fixture();
  try {
    f.put('.zshrc', 'export ZSH="$HOME/.oh-my-zsh"\nZSH_THEME="robbyrussell"\nsource $ZSH/oh-my-zsh.sh\nPROMPT=\'%~ %# \'\nautoload -U promptinit; promptinit\nprompt pure\n');
    const evidence = await f.detect();
    assert.equal(evidence.prompts.filter(item => item.state === 'active').length, 0);
    const kinds = evidence.custom.map(item => item.label);
    assert.ok(kinds.some(label => /PROMPT/u.test(label)), kinds.join());
    assert.ok(kinds.some(label => /robbyrussell/u.test(label)), kinds.join());
    assert.ok(kinds.some(label => /pure/u.test(label)), kinds.join());
    assert.ok(evidence.custom.every(item => item.where === '~/.zshrc'));
  } finally { f.done(); }
});

test('configured but not started, installed only, and started but missing are told apart', async () => {
  const f = fixture();
  try {
    f.tool('starship');
    f.put('.config/starship.toml', 'format = "$all"\n');
    f.put('.zshrc', 'eval "$(zoxide init zsh)"\nexport PATH="$HOME/bin:$PATH"\n');
    f.tool('atuin');
    const evidence = await f.detect();
    assert.equal(prompt(evidence, 'starship')?.state, 'configured', 'a config file and a binary, but not started');
    assert.equal(evidence.tools.find(tool => tool.id === 'zoxide')?.state, 'broken', 'started by .zshrc but not on PATH');
    assert.equal(evidence.tools.find(tool => tool.id === 'atuin')?.state, 'installed', 'on PATH but never started');
    f.put('.zshrc', 'eval "$(starship init zsh)"\n');
    rmSync(join(f.bin, 'starship'));
    assert.equal(prompt(await f.detect(), 'starship')?.state, 'broken');
  } finally { f.done(); }
});

test('Oh My Posh started with a local config is active; a remote config is never fetched', async () => {
  const f = fixture();
  try {
    f.tool('oh-my-posh', '19.0.0');
    f.put('.poshthemes/night.omp.json', '{}');
    f.put('.zshrc', 'eval "$(oh-my-posh init zsh --config ~/.poshthemes/night.omp.json)"\n');
    const evidence = await f.detect();
    const posh = prompt(evidence, 'ohMyPosh');
    assert.equal(posh?.state, 'active');
    assert.equal(posh?.configPath, join(f.home, '.poshthemes/night.omp.json'));
    f.put('.zshrc', 'eval "$(oh-my-posh init zsh --config https://example.com/theme.omp.json)"\n');
    const remote = prompt(await f.detect(), 'ohMyPosh');
    assert.equal(remote?.state, 'active');
    assert.equal(remote?.configPath, undefined, 'a URL is never treated as a file');
    assert.ok(!f.calls().some(call => /https?:/u.test(call)), 'nothing fetched the remote theme');
  } finally { f.done(); }
});

test('Fish: functions/fish_prompt.fish is a custom prompt; Tide is named; tools started in config.fish count', async () => {
  const f = fixture();
  try {
    f.tool('zoxide');
    f.put('.config/fish/config.fish', 'zoxide init fish | source\n');
    f.put('.config/fish/functions/fish_prompt.fish', 'function fish_prompt\n  echo "> "\nend\n');
    const evidence = await f.detect(f.env('/opt/homebrew/bin/fish'));
    assert.equal(evidence.shell.id, 'fish');
    assert.ok(evidence.custom.some(item => item.kind === 'fishPrompt' && item.where === '~/.config/fish/functions/fish_prompt.fish'));
    assert.equal(evidence.tools.find(tool => tool.id === 'zoxide')?.state, 'active');
    f.put('.config/fish/conf.d/_tide_init.fish', '# tide\n');
    const tide = await f.detect(f.env('/opt/homebrew/bin/fish'));
    assert.ok(tide.custom.some(item => item.kind === 'tide' && item.label === 'Tide'));
    assert.ok(!tide.custom.some(item => item.kind === 'fishPrompt'), 'Tide\'s own fish_prompt is not a second custom prompt');
  } finally { f.done(); }
});

test('Bash: PS1 is custom and Starship started by .bashrc is active; an unsupported shell is named', async () => {
  const f = fixture();
  try {
    f.tool('starship');
    f.put('.bashrc', 'PS1="\\u@\\h \\w \\$ "\neval "$(starship init bash)"\n');
    const bash = await f.detect(f.env('/bin/bash'));
    assert.equal(bash.shell.id, 'bash');
    assert.equal(prompt(bash, 'starship')?.state, 'active');
    assert.equal(prompt(bash, 'starship')?.startedBy, '~/.bashrc');
    const nu = await f.detect(f.env('/opt/homebrew/bin/nu'));
    assert.equal(nu.shell.id, undefined);
    assert.equal(nu.shell.label, 'nu');
  } finally { f.done(); }
});

test('source lines are followed one level, only inside $HOME, with loops and size bounded', async () => {
  const f = fixture();
  try {
    f.tool('starship');
    f.tool('atuin');
    const outside = join(f.root, 'outside');
    mkdirSync(outside);
    writeFileSync(join(outside, 'prompt.zsh'), 'eval "$(atuin init zsh)"\n');
    symlinkSync(join(outside, 'prompt.zsh'), join(f.home, '.linked.zsh'));
    f.put('.zsh/loop.zsh', 'source ~/.zshrc\nsource ~/.zsh/deeper.zsh\n');
    f.put('.zsh/deeper.zsh', 'eval "$(starship init zsh)"\n');
    f.put('.zshrc', `source ~/.zsh/loop.zsh\nsource "$HOME/.zshrc"\nsource ${outside}/prompt.zsh\nsource ~/.linked.zsh\n. ~/.missing.zsh\n`);
    const evidence = await f.detect();
    assert.equal(prompt(evidence, 'starship')?.state, 'installed', 'one level only: deeper.zsh is never read, so Starship is not started');
    assert.equal(evidence.tools.find(tool => tool.id === 'atuin')?.state, 'installed', 'files outside $HOME (even through a link) are not followed');
    assert.deepEqual(evidence.files, ['~/.zshrc', '~/.zsh/loop.zsh']);
    assert.ok(evidence.notes.some(note => /outside your home/u.test(note)), evidence.notes.join('\n'));
    // A huge file is read only up to the cap.
    f.put('.zshrc', `${'# padding\n'.repeat(Math.ceil(STARTUP_READ_CAP / 10) + 10)}eval "$(starship init zsh)"\n`);
    const huge = await f.detect();
    assert.equal(prompt(huge, 'starship')?.state, 'installed', 'the line past the cap is not seen');
    assert.ok(huge.notes.some(note => /first 512 KiB/u.test(note)), huge.notes.join('\n'));
  } finally { f.done(); }
});

test('at most 16 startup files are read, and unreadable or special files never hang detection', async () => {
  const f = fixture();
  try {
    const sources = Array.from({length: 30}, (_, i) => `source ~/.zsh/part-${i}.zsh`);
    for (let i = 0; i < 30; i++) f.put(`.zsh/part-${i}.zsh`, `# part ${i}\n`);
    f.put('.zshrc', `${sources.join('\n')}\n`);
    f.put('.zprofile', '# profile\n');
    chmodSync(join(f.home, '.zprofile'), 0o000);
    const evidence = await f.detect();
    assert.equal(evidence.files.length, 16);
    assert.ok(evidence.notes.some(note => /16 startup files/u.test(note)));
    // A named pipe in place of a startup file is skipped, not opened.
    const {execFileSync} = await import('node:child_process');
    rmSync(join(f.home, '.zprofile'), {force: true});
    execFileSync('mkfifo', [join(f.home, '.zlogin')]);
    const started = Date.now();
    await f.detect();
    assert.ok(Date.now() - started < 5000, 'no hang on a FIFO');
  } finally { f.done(); }
});

test('detection never writes: the home directory is byte-for-byte the same afterwards', async () => {
  const f = fixture();
  try {
    f.tool('starship'); f.tool('zoxide'); f.tool('atuin'); f.tool('oh-my-posh');
    f.put('.zshrc', 'eval "$(starship init zsh)"\neval "$(zoxide init zsh)"\neval "$(atuin init zsh)"\n');
    f.put('.config/starship.toml', 'x = 1\n');
    f.put('.config/fish/config.fish', 'starship init fish | source\n');
    const snapshot = (directory: string): string[] => readdirSync(directory, {recursive: true}).map(String).sort().map(name => {
      const path = join(directory, name), stat = lstatSync(path);
      return `${name}|${stat.mode}|${stat.size}|${stat.mtimeMs}|${stat.isFile() ? createHash('sha256').update(readFileSync(path)).digest('hex') : ''}`;
    });
    const before = snapshot(f.home);
    await f.detect();
    await f.detect(f.env('/bin/bash'));
    await f.detect(f.env('/opt/homebrew/bin/fish'));
    assert.deepEqual(snapshot(f.home), before);
  } finally { f.done(); }
});

test('scanStartupFiles is a pure reader: comments are ignored and nothing outside the given files is touched', () => {
  const files: Record<string, string> = {
    '/h/.zshrc': '# eval "$(starship init zsh)"\n  #source ~/.x\neval "$(zoxide init zsh)" # jump\n',
  };
  const read: string[] = [];
  const scan = scanStartupFiles('zsh', '/h', {HOME: '/h'}, path => { read.push(path); return files[path]; });
  assert.ok(!scan.hits.some(hit => hit.kind === 'starship'), 'a commented line is ignored');
  assert.ok(scan.hits.some(hit => hit.kind === 'zoxide' && hit.file === '~/.zshrc'), 'hits name the file as shown');
  assert.ok(scan.files.includes('/h/.zshrc'));
  assert.ok(read.every(path => path.startsWith('/h/')), read.join());
  // Only whole variable names expand: $HOMEBREW_PREFIX is not $HOME, and an unknown variable is never followed.
  const sourced: string[] = [];
  scanStartupFiles('zsh', '/h', {HOME: '/h'}, path => {
    sourced.push(path);
    return path === '/h/.zshrc' ? 'source $HOMEBREW_PREFIX/share/x.zsh\nsource ${HOME}/.a.zsh\nsource $HOME/.b.zsh\nsource $UNKNOWN/c.zsh\n' : path.endsWith('.zsh') ? '' : undefined;
  });
  assert.ok(sourced.includes('/h/.a.zsh') && sourced.includes('/h/.b.zsh'), sourced.join());
  assert.ok(!sourced.some(path => /BREW_PREFIX|UNKNOWN|c\.zsh|x\.zsh/u.test(path)), sourced.join());
});

test('Starship two-line output drops a trailing lone prompt character; single-line output is unchanged', async () => {
  const twoLine = '\u001b[1;36m~/Projects/notMyShell\u001b[0m on \u001b[1;35m main\u001b[0m\n\u001b[1;32m❯\u001b[0m ';
  const parsed = parseStarshipPrompt(withoutTrailingPromptCharacter(twoLine));
  assert.equal(parsed.text.trim(), '~/Projects/notMyShell on  main');
  assert.ok(!parsed.text.includes('❯'));
  const single = '\u001b[1;36m~/src\u001b[0m \u001b[1;32m❯\u001b[0m ';
  assert.equal(withoutTrailingPromptCharacter(single), single, 'one line: nothing is dropped');
  assert.equal(parseStarshipPrompt(withoutTrailingPromptCharacter('repo\nnext')).text, 'repo next', 'a real second line stays');
  assert.equal(withoutTrailingPromptCharacter('path\n$ '), 'path\u001b[0m');
  // Through the real adapter: the flattened prompt keeps everything but the lone character.
  const f = fixture();
  try {
    writeFileSync(join(f.bin, 'starship'), `#!/bin/sh\nif [ "$1" = "--version" ]; then echo starship 1.21.1; else printf '\\033[1;36m~/src\\033[0m on main\\n\\033[1;32m❯\\033[0m '; fi\n`, {mode: 0o755});
    const {detectStarship} = await import('../src/prompt/starship.js');
    const status = await detectStarship({HOME: f.home, PATH: f.bin}, join(f.bin, 'starship'));
    const result = await renderStarshipPrompt({cwd: f.home, exitStatus: 0}, status, {HOME: f.home, PATH: f.bin});
    assert.equal(result.text.trim(), '~/src on main');
    assert.equal(result.normalizedMultiline, true, 'still reported as a flattened multi-line prompt');
  } finally { f.done(); }
});
