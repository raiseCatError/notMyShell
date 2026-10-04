import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync, mkdtempSync, realpathSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {TerminalApp} from '../src/app/TerminalApp.js';
import {InProcessSessionClient} from '../src/session/InProcessSessionClient.js';
import {loadPromptConfiguration} from '../src/prompt/configuration.js';
import {shellAdapter} from '../src/shell/adapters/registry.js';
import {PathClassifier} from '../src/shell/PathClassifier.js';
import {SemanticService} from '../src/shell/SemanticService.js';

const available = ['fish', 'bash'].every(id => shellAdapter(id as 'fish' | 'bash').resolveExecutable(process.env));
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };

async function until(check: () => boolean, timeoutMs = 15000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) { if (Date.now() > deadline) throw new Error('condition not reached'); await new Promise(resolve => setTimeout(resolve, 25)); }
}

function transcript(app: TerminalApp): string {
  return app['output'].wrapped(200).map((row: {plain: string}) => row.plain).join('\n');
}

test('app hot swap: zsh → fish → bash → zsh keeps draft, transcript and cwd; rebinds completion, classification and history; temporary unless saved',
  {skip: !available && 'fish and bash are both needed', timeout: 120_000}, async () => {
    const cwd = realpathSync(mkdtempSync(join(tmpdir(), 'nmsh-appswap-')));
    mkdirSync(join(cwd, 'inner'));
    const client = new InProcessSessionClient({cwd, columns: 100, rows: 30});
    const app = new TerminalApp({client, mode: 'in-process', shell: 'zsh'});
    Object.defineProperty(app, 'render', {value: () => {}});
    Object.defineProperty(app, 'dimensions', {value: () => ({columns: 100, rows: 30})});
    try {
      client.start();
      await until(() => app['shellCwd'] === cwd && !app['running']);
      await until(() => !app['startupPending']);
      const pids: number[] = [];
      const shellPid = () => (client as unknown as {shell: {pid: number}}).shell.pid;
      pids.push(shellPid());

      app['editor'].insert('git status --short');
      const before = app['completionService'];
      // A second switch issued while the first is still in flight is refused, not raced.
      const refusals: string[] = [];
      const record = app['output'].addFrontendInteraction.bind(app['output']);
      app['output'].addFrontendInteraction = ((command: string, message: string, ...rest: unknown[]) => { refusals.push(message); return (record as (...args: unknown[]) => unknown)(command, message, ...rest); }) as typeof record;
      const first = app['switchShell']('fish', '/shell fish');
      await app['switchShell']('bash', '/shell bash');
      await first;
      assert.equal(app['shellId'], 'fish');
      assert.ok(refusals.some(message => /already in progress|still starting/u.test(message)), refusals.join(' | '));
      // And until the new shell's first prompt, switching again is refused.
      if (app['switchedShellStarting']) assert.match(app['switchBlocker']() ?? '', /still starting/u);
      await until(() => (client as unknown as {shell: {isReady: boolean}}).shell.isReady && !app['switchedShellStarting']);
      pids.push(shellPid());
      await app['switchShell']('zsh', '/shell zsh');
      await until(() => (client as unknown as {shell: {isReady: boolean}}).shell.isReady && !app['switchedShellStarting'] && shellPid() !== pids.at(-1));
      pids.push(shellPid());
      for (const target of ['fish', 'bash', 'zsh'] as const) {
        await app['switchShell'](target, `/shell ${target}`);
        assert.equal(app['shellId'], target);
        await until(() => alive(shellPid()) && shellPid() !== pids.at(-1));
        await until(() => (client as unknown as {shell: {isReady: boolean}}).shell.isReady && !app['switchedShellStarting']);
        await until(() => !alive(pids.at(-1)!), 5000);
        pids.push(shellPid());
        assert.equal(app['editor'].text, 'git status --short', 'the unsent draft survives every switch');
        assert.match(transcript(app), new RegExp(`Same session, now ${shellAdapter(target).label}, in ${cwd.replace(/[/.]/gu, '\\$&')}`, 'u'));
        assert.equal(app['output']['welcome']?.shell, target, 'the fresh presentation welcomes the new backend');
        assert.match(transcript(app), /aliases, functions, variables and jobs stayed with/u, 'shell-local state is never claimed to carry over');
        assert.ok(app['semanticService'] instanceof (target === 'zsh' ? SemanticService : PathClassifier));
        assert.equal(app['historyService'].shellHistory?.id, target === 'zsh' ? undefined : target);
      }
      assert.notEqual(app['completionService'], before, 'completion was rebound');

      // The new shell really runs commands in the preserved cwd.
      app['editor'].clear();
      app['editor'].insert('cd inner');
      await app['submit']();
      await until(() => app['shellCwd'] === join(cwd, 'inner'));

      // Temporary: the saved default did not change.
      assert.equal(loadPromptConfiguration().shellBackend, 'zsh');
      // A running command blocks switching, with a factual reason.
      app['editor'].clear();
      app['editor'].insert('sleep 3');
      await app['submit']();
      await until(() => Boolean(app['running']) && !app['running'].awaitingExec);
      await app['switchShell']('fish', '/shell fish');
      assert.equal(app['shellId'], 'zsh');
      assert.match(transcript(app), /"sleep 3" is still running; switching would end it/u);
      client.interrupt();
      await until(() => !app['running']);
      // An unavailable shell is refused without touching the session.
      const saved = process.env.PATH;
      process.env.PATH = '/nonexistent-nmsh-path';
      try { await app['switchShell']('fish', '/shell fish'); } finally { process.env.PATH = saved; }
      assert.equal(app['shellId'], 'zsh');
      assert.match(transcript(app), /Fish is not installed/u);
      for (const pid of pids.slice(0, -1)) assert.equal(alive(pid), false, 'old shells are gone');
    } finally {
      app['stop'](0);
      app['session'].kill();
      rmSync(cwd, {recursive: true, force: true});
    }
  });
