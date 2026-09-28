import {isVersionInvocation, formatBuildIdentity, readBuildIdentity} from './buildInfo.js';
import {NESTED_NMSH_MESSAGE, createOrdinaryZshEnvironment, isManagedNmshEnvironment} from './shell/ShellHandoff.js';
import {spawn} from 'node:child_process';
import {PRODUCT_ABBREVIATION, PRODUCT_NAME} from './config.js';

function startOrdinaryZsh(cwd?: string): Promise<number> {
  return new Promise(resolve => {
    try {
      const shell = spawn('/bin/zsh', ['-i'], {
        ...(cwd ? {cwd} : {}),
        env: createOrdinaryZshEnvironment(),
        stdio: 'inherit',
      });
      shell.once('error', error => {
        process.stderr.write(`NMSh could not start ordinary zsh: ${error.message}\n`);
        resolve(1);
      });
      shell.once('exit', (code, signal) => resolve(code ?? (signal ? 1 : 0)));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`NMSh could not start ordinary zsh: ${message}\n`);
      resolve(1);
    }
  });
}

const args = process.argv.slice(2);
const attachIndex = args.indexOf('--attach');

if (isVersionInvocation(args)) {
  process.stdout.write(`${formatBuildIdentity(readBuildIdentity())}\n`);
} else if (args.includes('--sessions')) {
  const {listLiveSessions} = await import('./session/connectSession.js');
  const {formatSessionList} = await import('./session/sessionList.js');
  try {
    process.stdout.write(formatSessionList(await listLiveSessions(), Date.now()));
  } catch (error) {
    process.stderr.write(`NMSh could not list live sessions: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
} else if (attachIndex !== -1 && !args[attachIndex + 1]) {
  process.stderr.write('Usage: nmsh --attach <session-id>   (see nmsh --sessions)\n');
  process.exitCode = 2;
} else if (isManagedNmshEnvironment()) {
  process.stderr.write(`${NESTED_NMSH_MESSAGE}\n`);
  process.exitCode = 1;
} else if (!process.stdin.isTTY || !process.stdout.isTTY) {
  process.stderr.write(`${PRODUCT_NAME} (${PRODUCT_ABBREVIATION}) requires an interactive terminal.\n`);
  process.exitCode = 1;
} else {
  const {TerminalApp} = await import('./app/TerminalApp.js');
  const {attachSession, connectSession, listLiveSessions, SESSION_SERVICE_ENV} = await import('./session/connectSession.js');
  const {planLaunch} = await import('./session/liveSessions.js');
  const size = () => ({cwd: process.cwd(), columns: process.stdout.columns || 80, rows: Math.max(2, (process.stdout.rows || 24) - 4)});
  const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

  // Which session this launch attaches, if any. --attach is explicit and
  // fails loudly; discovery only ever picks a detached session, and --new
  // skips it.
  let target: string | undefined = attachIndex === -1 ? undefined : args[attachIndex + 1];
  let explicit = target !== undefined;
  let notice: string | undefined;
  if (process.env[SESSION_SERVICE_ENV] !== '0') {
    // Sessions that ended with no window attached become ordinary archives.
    const {recoverEndedSessions} = await import('./session/recovery.js');
    const {defaultRuntimeDir} = await import('./session/runtimeDir.js');
    const {TranscriptStore} = await import('./sessions/TranscriptStore.js');
    try {
      const recovered = await recoverEndedSessions(defaultRuntimeDir(), new TranscriptStore());
      if (recovered.archived.length > 0) {
        notice = `${recovered.archived.length} live session${recovered.archived.length === 1 ? '' : 's'} ended while no NMSh window was attached; see /resume.`;
      } else if (recovered.skipped === 'another NMSh session service version is running') {
        notice = 'A session service from another NMSh version is still running its own live sessions; they continue until they end but cannot be attached from this version.';
      }
    } catch { /* recovery is best effort and never blocks launch */ }
  }
  if (!explicit && !args.includes('--new') && process.env[SESSION_SERVICE_ENV] !== '0') {
    let live: Awaited<ReturnType<typeof listLiveSessions>> = [];
    try { live = await listLiveSessions(); } catch { /* no usable service: start fresh */ }
    const plan = planLaunch(live);
    if (plan.kind === 'attach') target = plan.session.id;
    else if (plan.kind === 'pick') {
      const {runStartupPicker} = await import('./session/StartupPicker.js');
      const choice = await runStartupPicker(plan.sessions);
      if (choice.kind === 'attach') target = choice.sessionId;
    }
  }

  // The loop lets /resume switch this window to another live session.
  for (;;) {
    let connection;
    if (target) {
      try {
        connection = await attachSession(target, size());
      } catch (error) {
        if (explicit) {
          process.stderr.write(`NMSh could not attach: ${errorText(error)}\n`);
          process.exit(1);
        }
        notice = `Could not reattach (${errorText(error)}); started a new session.`;
      }
    }
    connection ??= await connectSession(size());
    if (notice) connection = {...connection, notice: [connection.notice, notice].filter(Boolean).join(' ')};
    const app = new TerminalApp(connection);
    const exitCode = await app.run();
    if (app.lostServiceConnection) {
      process.stderr.write('NMSh lost the connection to its session service; the live session ended and its transcript was archived.\n');
    }
    notice = undefined;
    if (app.switchTarget) {
      target = app.switchTarget;
      explicit = false;
      continue;
    }
    process.exitCode = app.isOrdinaryZshHandoffRequested
      ? await startOrdinaryZsh(app.ordinaryZshHandoffCwd)
      : exitCode;
    break;
  }
}
