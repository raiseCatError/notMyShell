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
  const {attachSession, connectSession} = await import('./session/connectSession.js');
  const size = {cwd: process.cwd(), columns: process.stdout.columns || 80, rows: Math.max(2, (process.stdout.rows || 24) - 4)};
  let connection;
  try {
    connection = attachIndex === -1 ? await connectSession(size) : await attachSession(args[attachIndex + 1]!, size);
  } catch (error) {
    process.stderr.write(`NMSh could not attach: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
  const app = new TerminalApp(connection);
  const exitCode = await app.run();
  process.exitCode = app.isOrdinaryZshHandoffRequested
    ? await startOrdinaryZsh(app.ordinaryZshHandoffCwd)
    : exitCode;
}
