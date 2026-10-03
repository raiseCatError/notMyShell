import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {ShellSession} from '../src/shell/ShellSession.js';
import {ConfiguredCompletionSource} from '../src/shell/ConfiguredCompletion.js';
import {SemanticService} from '../src/shell/SemanticService.js';

test('real PTY and detached semantic helper source HOME literally with Unicode and shell metacharacters', async () => {
  const home = mkdtempSync(join(tmpdir(), `nmsh-home-λ $literal " ' `));
  writeFileSync(join(home, '.zshrc'), 'alias nmsh_path_fixture="echo loaded"\n');
  const previous = process.env.HOME;
  process.env.HOME = home;
  let session: ShellSession | undefined;
  let semantic: SemanticService | undefined;
  try {
    session = new ShellSession(home, 80, 24, home, {...process.env, HOME: home});
    const [marker] = await once(session, 'prompt', {signal: AbortSignal.timeout(5000)});
    assert.match(marker.knowledge ?? '', /alias nmsh_path_fixture/u);
    semantic = new SemanticService(home);
    assert.equal(await semantic.classifyCommand('nmsh_path_fixture'), 'alias');
  } finally {
    session?.kill(); semantic?.kill();
    if (previous === undefined) delete process.env.HOME; else process.env.HOME = previous;
    rmSync(home, {recursive: true, force: true});
  }
});

// A missing HOME must not turn relative startup paths into a cwd trust boundary.
test('configured helper with missing HOME never sources cwd startup files', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'nmsh-no-home-'));
  const marker = join(cwd, 'sourced');
  writeFileSync(join(cwd, '.zshenv'), `print sourced > '${marker}'\n`);
  writeFileSync(join(cwd, '.zshrc'), `print sourced > '${marker}'\n`);
  const env = {...process.env}; delete env.HOME;
  const source = new ConfiguredCompletionSource({env, startupMs: 4000, queryMs: 1000});
  try {
    await source.query({buffer: 'echo ', cwd}, new AbortController().signal);
    assert.equal(existsSync(marker), false);
  } finally { source.dispose(); rmSync(cwd, {recursive: true, force: true}); }
});
