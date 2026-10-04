import test from 'node:test';
import assert from 'node:assert/strict';
import {detectShellEnvironment, shellEnvironmentRows, type EnvironmentProbe} from '../src/shell/ShellEnvironment.js';

function probe(files: Record<string, string>, env: NodeJS.ProcessEnv = {SHELL: '/bin/zsh'}): EnvironmentProbe & {reads: string[]} {
  const reads: string[] = [];
  return {home: '/h', env, reads, exists: path => path in files || Object.keys(files).some(key => key.startsWith(`${path}/`)), read: path => { reads.push(path); return files[path]; }};
}
const rows = (files: Record<string, string>, active: 'zsh' | 'bash' | 'fish', path?: string, env?: NodeJS.ProcessEnv) =>
  Object.fromEntries(shellEnvironmentRows(detectShellEnvironment(probe(files, env)), {id: active, ...(path ? {path} : {})}));
const ZSH = {'/h/.zshrc': 'source $ZSH/oh-my-zsh.sh\nplugins=(zsh-autosuggestions)\n', '/h/.zsh_plugins.txt': 'zsh-users/zsh-completions\n'};

test('the active shell is the first row, factual, with its path when known', () => {
  const first = (path?: string) => shellEnvironmentRows(detectShellEnvironment(probe({})), {id: 'zsh', ...(path ? {path} : {})})[0];
  assert.deepEqual(first('/bin/zsh'), ['Shell', 'zsh · /bin/zsh']);
  assert.deepEqual(first(), ['Shell', 'zsh']);
  for (const id of ['zsh', 'bash', 'fish'] as const) assert.equal(shellEnvironmentRows(detectShellEnvironment(probe({})), {id})[0]![1], id);
});

test('no framework reads as plain <shell>, never "none detected"', () => {
  for (const id of ['zsh', 'bash', 'fish'] as const) {
    const r = rows({}, id);
    assert.equal(r['Shell framework'], `none · plain ${id}`);
    assert.equal(r['Plugin manager'], 'none detected');
  }
});

test('zsh: framework, plugin manager and plugin relationship rows are unchanged and scoped to zsh', () => {
  const r = rows({'/h/.zshrc': 'source $ZSH/oh-my-zsh.sh\nplugins=(zsh-autosuggestions)\nantidote load\n', '/h/.zsh_plugins.txt': 'zsh-users/zsh-completions\n'}, 'zsh', '/bin/zsh');
  assert.match(r['Shell framework']!, /Oh My Zsh/u);
  assert.match(r['Plugin manager']!, /Antidote/u);
  assert.equal(r['zsh-autosuggestions'], 'detected · NMSh owns this surface');
  assert.equal(r['zsh-completions'], 'detected · compatible');
});

test('Bash: Oh My Bash and Bash-it from bounded startup files; zsh/fish environments do not appear as Bash\'s', () => {
  const omb = rows({'/h/.bashrc': 'source "$OSH/oh-my-bash.sh"\n', ...ZSH, '/h/.config/fish/functions/fisher.fish': ''}, 'bash', '/bin/bash');
  assert.match(omb['Shell framework']!, /Oh My Bash \(~\/\.bashrc sources oh-my-bash\.sh\)/u);
  assert.equal(omb['Plugin manager'], 'none detected');
  assert.ok(!('zsh-autosuggestions' in omb));
  assert.match(omb['Other shell environments']!, /Zsh: Oh My Zsh/u);
  assert.match(omb['Other shell environments']!, /Fish: Fisher/u);
  assert.match(rows({'/h/.bash_profile': 'source ~/.bash_it/bash_it.sh\n'}, 'bash')['Shell framework']!, /Bash-it \(~\/\.bash_profile sources bash_it\.sh\)/u);
  assert.equal(rows({'/h/.bashrc': '# source oh-my-bash.sh\n'}, 'bash')['Shell framework'], 'none · plain bash', 'commented-out setup is not configuration');
});

test('Fish: Fisher and Oh My Fish; zsh/bash environments do not appear as Fish\'s', () => {
  const r = rows({'/h/.config/fish/functions/fisher.fish': '', '/h/.local/share/omf/init.fish': '', '/h/.config/fish/fish_plugins': 'jorgebucaran/autopair.fish\n', ...ZSH, '/h/.bashrc': 'source bash_it.sh\n'}, 'fish', '/opt/homebrew/bin/fish');
  assert.equal(r.Shell, 'fish · /opt/homebrew/bin/fish');
  assert.match(r['Shell framework']!, /Oh My Fish/u);
  assert.match(r['Plugin manager']!, /Fisher/u);
  assert.equal(r['autopair (fish)'], 'detected · NMSh owns this surface');
  assert.ok(!('zsh-autosuggestions' in r));
  assert.match(r['Other shell environments']!, /Zsh: Oh My Zsh · Bash: Bash-it|Bash: Bash-it · Zsh: Oh My Zsh/u);
});

test('the session shell wins over login $SHELL; switching backend changes the presentation; nothing is sourced', () => {
  const files = {...ZSH, '/h/.bashrc': 'source bash_it.sh\n'};
  const env = {SHELL: '/bin/zsh'};
  assert.equal(rows(files, 'bash', '/bin/bash', env).Shell, 'bash · /bin/bash');
  assert.match(rows(files, 'bash', undefined, env)['Shell framework']!, /Bash-it/u);
  assert.match(rows(files, 'zsh', undefined, env)['Shell framework']!, /Oh My Zsh/u);
  assert.ok(!/Oh My Zsh/u.test(rows(files, 'bash')['Shell framework']!), 'inactive-shell config does not masquerade as active');
  const p = probe(files, env);
  detectShellEnvironment(p);
  assert.ok(p.reads.every(path => path.startsWith('/h/')), 'only declared config files are read (as text), none executed');
});
