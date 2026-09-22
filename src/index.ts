import {TerminalApp} from './app/TerminalApp.js';
import {PRODUCT_ABBREVIATION, PRODUCT_NAME} from './config.js';

if (!process.stdin.isTTY || !process.stdout.isTTY) {
  process.stderr.write(`${PRODUCT_NAME} (${PRODUCT_ABBREVIATION}) requires an interactive terminal.\n`);
  process.exitCode = 1;
} else {
  const app = new TerminalApp();
  const exitCode = await app.run();
  process.exitCode = exitCode;
}
