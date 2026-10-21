import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyCommand, splitCommands, writesFiles} from '../src/input/pasteGuard.js';
import {watchSafety} from '../src/tasks/WatchTasks.js';

const kind = (command: string) => watchSafety(command).kind;
const remote = (command: string) => { const safety = watchSafety(command); return safety.kind === 'refused' ? undefined : safety.remote; };

test('a redirect into a file is a write even when /dev/null appears elsewhere (paste review and /track)', () => {
  for (const command of ['echo pwned > ~/.zshrc 2>/dev/null', 'ls 2>/dev/null >out', 'echo x >/dev/null >out', 'ls >| out', 'ls >&out', 'ls <>out', 'ls &>out', 'ls 1>>log']) {
    assert.ok(writesFiles(command), command);
    assert.ok(splitCommands(command).some(part => classifyCommand(part.text, part.pipedFrom).includes('modifies')), `paste review: ${command}`);
    assert.equal(kind(command), 'refused', command);
  }
  for (const command of ['ls >/dev/null', 'ls 2>/dev/null', 'npm test 2>&1', 'ls >&2', 'ls 2>&1 | tail -5', 'echo "a > b"', "echo 'x >y'", 'echo a\\>b', 'ls >&-']) {
    assert.ok(!writesFiles(command), command);
    assert.notEqual(kind(command), 'refused', command);
  }
  assert.deepEqual(splitCommands('ls >| out').map(part => part.text), ['ls >| out'], '>| is a redirection, not a pipe');
  // POSIX sh (dash) reads `cmd &>/dev/null` as a background job: never repeated, even to /dev/null.
  assert.equal(watchSafety('ls &>/dev/null').kind, 'refused');
  assert.equal(watchSafety('ls &>/dev/null').kind === 'refused' && watchSafety('ls &>/dev/null').reason, 'Background operators and heredocs cannot be tracked safely.');
});

test('/track asks before a command that runs another command or changes its environment', () => {
  for (const command of ['env rm -rf /tmp/x', 'env -i rm -rf x', 'env -u HOME rm x', 'env -- rm x', 'env FOO=1 df', 'env -S "rm x"', 'FOO=1 df', 'LD_PRELOAD=/tmp/x.so df',
    'GIT_EXTERNAL_DIFF=/tmp/x git diff', 'git -c core.fsmonitor=/tmp/x status', 'git --config-env=core.pager=X log', 'git --exec-path=/tmp status', 'git diff --ext-diff']) {
    assert.equal(kind(command), 'confirm', command);
  }
  for (const command of ['env', 'env | grep PATH', 'env -0', 'printenv HOME', 'git status', 'git -C sub status', 'git log --oneline -5', 'git log -c -1', 'git diff --stat', 'df -h']) {
    assert.equal(kind(command), 'allowed', command);
  }
});

test('/track refuses options that write files, update what they check, never finish, or power off', () => {
  for (const command of ['git log --output=x', 'git diff --output x.patch', 'git show --output=f HEAD', 'sort -o out in', 'sort -no out in', 'sort --output=out in',
    'find . -fprint out', 'find . -fls out', 'find . -okdir rm {} ;', 'tree -o out', 'yq -i .a=1 f.yaml', 'npx jest -u', 'npx vitest run -u', 'npm test -- -u',
    'npm run lint -- --fix', 'npx prettier --write .', 'pytest --snapshot-update', 'npx jest --watch', 'scp host:a b', 'rsync -a a b',
    'shutdown now', 'reboot', '/sbin/halt', 'poweroff', 'systemctl reboot', 'launchctl reboot', 'init 0']) {
    assert.equal(kind(command), 'refused', command);
  }
  for (const command of ['sort file', 'sort -n -k2 file', 'find . -name x', 'tree -L 2', 'npx jest', 'npm test', 'npm run lint', 'npx eslint --fix-dry-run .', 'rsync -an a b']) {
    assert.notEqual(kind(command), 'refused', command);
  }
});

test('/track starts only read-only network probes at once; sending, saving, signing in or running packages asks first', () => {
  for (const command of ['ping -c1 localhost', 'curl -s http://localhost:3000/health', 'curl -fsSL http://127.0.0.1:8080/', 'curl -s -o /dev/null -w "%{http_code}" http://localhost/',
    'curl -X HEAD http://localhost/', 'wget -qO- http://localhost/x', 'wget -O - http://localhost/x', 'wget --spider http://localhost/', 'nc -z localhost 5432', 'nc -zv localhost 80',
    'dig example.com', 'npm view react version', 'npm outdated', 'npm audit', 'git ls-remote origin']) {
    assert.equal(kind(command), 'allowed', command);
  }
  for (const command of ['curl -X POST http://localhost:3000/x', 'curl -d a=1 http://localhost/x', 'curl --data-binary @f http://localhost/x', 'curl --json {} http://localhost/',
    'curl -o out http://localhost/x', 'curl -sSLo out http://localhost/x', 'curl -O http://localhost/x', 'curl -T f http://localhost/', 'curl -K cfg http://localhost/', 'curl -c jar http://localhost/',
    'curl --request=DELETE http://localhost/x', 'curl gopher://localhost:6379/_FLUSHALL', 'wget http://localhost/x', 'wget -O page http://localhost/x', 'wget -r http://localhost/',
    'http POST localhost:3000', 'ssh host uptime', 'ssh host rm -rf x', 'sftp host', 'telnet host', 'nc localhost 80', 'git fetch',
    'npm publish', 'pnpm publish', 'npm login', 'npm logout', 'npm audit fix', 'npm x cowsay', 'pnpm dlx cowsay', 'bun x cowsay']) {
    assert.equal(kind(command), 'confirm', command);
  }
});

test('/track treats a network target as remote unless it is this computer', () => {
  for (const command of ['ping -c 3 -i 0.2 localhost', 'curl -s http://localhost:3000/health', 'curl localhost:3000/health', 'nc -z 127.0.0.1 5432', 'curl -s http://[::1]:8080/']) {
    assert.equal(remote(command), false, command);
  }
  for (const command of ['ping -c1 8.8.8.8', 'ping nas', 'dig @1.1.1.1 example.com', 'curl -s https://example.com/health', 'ssh host uptime', 'npm outdated', 'git fetch', 'curl -s']) {
    assert.equal(remote(command), true, command);
  }
});
