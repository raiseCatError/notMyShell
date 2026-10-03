import test from 'node:test';
import assert from 'node:assert/strict';
import {createOrdinaryZshEnvironment, isManagedNmshEnvironment, chooseShellHandoff} from '../src/shell/ShellHandoff.js';
import {parseSlashCommand} from '../src/commands/slashCommands.js';

test('managed-shell marker rejects nested NMSh while ordinary shells may launch it', () => {
  assert.equal(isManagedNmshEnvironment({NMSH_ACTIVE: '1'}), true);
  assert.equal(isManagedNmshEnvironment({NMSH_ACTIVE: undefined}), false);
  assert.equal(isManagedNmshEnvironment({}), false);
});

test('ordinary zsh handoff removes only NMSh managed-shell state', () => {
  assert.deepEqual(createOrdinaryZshEnvironment({NMSH_ACTIVE: '1', PATH: '/bin', ZDOTDIR: '/custom/zsh'}), {
    PATH: '/bin',
    ZDOTDIR: '/custom/zsh',
  });
});

test('idle /zsh handoff preserves a valid managed cwd and refuses an active foreground command', () => {
  assert.deepEqual(chooseShellHandoff(false, '/work/project', '/start', path => path === '/work/project'), {
    kind: 'handoff',
    cwd: '/work/project',
  });
  assert.deepEqual(chooseShellHandoff(true, '/work/project', '/start', () => true), {kind: 'busy'});
  assert.deepEqual(chooseShellHandoff(false, '/removed', '/start', path => path === '/start'), {
    kind: 'handoff',
    cwd: '/start',
  });
});

test('/zsh, /fish, /bash and /exit parse as one handoff command', () => {
  assert.deepEqual(parseSlashCommand('/zsh'), {kind: 'handoff', shell: 'zsh'});
  assert.deepEqual(parseSlashCommand('/zsh  '), {kind: 'handoff', shell: 'zsh'});
  assert.deepEqual(parseSlashCommand('/fish'), {kind: 'handoff', shell: 'fish'});
  assert.deepEqual(parseSlashCommand('/bash'), {kind: 'handoff', shell: 'bash'});
  assert.deepEqual(parseSlashCommand('/exit'), {kind: 'handoff'}, '/exit uses the configured default');
  assert.deepEqual(parseSlashCommand('/shell fish'), {kind: 'shell', shell: 'fish'}, 'switching is a different command');
});

test('handoff-return contract: private markers, explicit flags win, exact session only, no nesting', async () => {
  const {createOrdinaryShellEnvironment, decideHandoffReturn, handoffReturnSession, returnsToWaitingShell, RETURN_SESSION_ENV, HANDOFF_SHELL_ENV} = await import('../src/shell/ShellHandoff.js');
  const env = createOrdinaryShellEnvironment({NMSH_ACTIVE: '1', PATH: '/bin'}, {sessionId: 'abc-123', shell: 'zsh'});
  assert.deepEqual(env, {PATH: '/bin', [RETURN_SESSION_ENV]: 'abc-123', [HANDOFF_SHELL_ENV]: 'zsh'});
  assert.deepEqual(createOrdinaryShellEnvironment({[RETURN_SESSION_ENV]: 'old', [HANDOFF_SHELL_ENV]: 'zsh', PATH: '/bin'}), {PATH: '/bin'}, 'an in-process exit never forwards a stale marker');
  assert.equal(createOrdinaryShellEnvironment({}, {sessionId: 'bad id;rm', shell: 'zsh'})[RETURN_SESSION_ENV], undefined);
  assert.equal(handoffReturnSession(env, []), 'abc-123');
  for (const flag of [['--new'], ['--attach', 'x'], ['--preset', 'p']]) assert.equal(handoffReturnSession(env, flag), undefined, flag[0]);
  assert.deepEqual(decideHandoffReturn('abc-123', [{id: 'other', state: 'detached'}, {id: 'abc-123', state: 'detached'}]), {kind: 'attach', sessionId: 'abc-123'});
  const gone = decideHandoffReturn('abc-123', [{id: 'other', state: 'detached'}]);
  assert.equal(gone.kind, 'unavailable', 'an unrelated detached session is never substituted');
  assert.match(gone.kind === 'unavailable' ? gone.notice : '', /has ended/u);
  assert.equal(decideHandoffReturn('abc-123', [{id: 'abc-123', state: 'attached'}]).kind, 'unavailable');
  assert.equal(returnsToWaitingShell(env, 'zsh', 'abc-123'), true);
  assert.equal(returnsToWaitingShell(env, 'fish', 'abc-123'), false, 'a different ordinary shell is started, not assumed');
  assert.equal(returnsToWaitingShell(env, 'zsh', 'other'), false, 'after switching sessions the waiting shell would return to the wrong one');
  assert.equal(returnsToWaitingShell({}, 'zsh', 'abc-123'), false);
});

test('app: a service session is detached (not killed) by /zsh /fish /bash /exit; in-process ends it', async () => {
  const {TerminalApp} = await import('../src/app/TerminalApp.js');
  const {shellAdapter} = await import('../src/shell/adapters/registry.js');
  for (const [shell, command] of [['zsh', '/zsh'], ['fish', '/fish'], ['bash', '/bash'], ['zsh', '/exit']] as const) {
    if (!shellAdapter(shell).resolveExecutable(process.env)) continue;
    for (const mode of ['service', 'in-process'] as const) {
      const app = new TerminalApp();
      Object.defineProperty(app, 'render', {value: () => {}});
      app['sessionMode'] = mode;
      if (mode === 'service') app['sessionId'] = 'sess-1';
      app['startupPending'] = false;
      let detached = 0; let killed = 0;
      const realKill = app['session'].kill.bind(app['session']);
      app['session'].detach = () => { detached += 1; };
      app['session'].kill = () => { killed += 1; };
      try {
        app['leaveForOrdinaryShell'](shell, command);
        assert.equal(app.shellHandoff?.shell, shell);
        if (mode === 'service') {
          assert.equal(detached, 1, `${command} detaches`);
          assert.equal(killed, 0, `${command} never ends a service session`);
          assert.equal(app.shellHandoff?.returnSession, 'sess-1');
        } else {
          assert.equal(killed, 1);
          assert.equal(app.shellHandoff?.returnSession, undefined, 'nothing to return to in-process');
        }
      } finally { app['stop'](0); realKill(); }
    }
  }
});
