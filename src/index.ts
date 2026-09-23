import {TerminalApp} from './app/TerminalApp.js';
import {spawn} from 'node:child_process';
import {PRODUCT_ABBREVIATION, PRODUCT_NAME} from './config.js';
import {NESTED_NMSH_MESSAGE, createOrdinaryZshEnvironment, isManagedNmshEnvironment} from './shell/ShellHandoff.js';

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

if (isManagedNmshEnvironment()) {
  process.stderr.write(`${NESTED_NMSH_MESSAGE}\n`);
  process.exitCode = 1;
} else if (!process.stdin.isTTY || !process.stdout.isTTY) {
  process.stderr.write(`${PRODUCT_NAME} (${PRODUCT_ABBREVIATION}) requires an interactive terminal.\n`);
  process.exitCode = 1;
} else {
  const app = new TerminalApp();
  const exitCode = await app.run();
  process.exitCode = app.isOrdinaryZshHandoffRequested
    ? await startOrdinaryZsh(app.ordinaryZshHandoffCwd)
    : exitCode;
}
