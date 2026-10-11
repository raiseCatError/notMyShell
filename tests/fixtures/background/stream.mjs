// A stand-in for `adb logcat` / `tail -f` / `scrcpy`: streams lines until stopped.
// Flags: --ignore-int, --ignore-term, --ignore-hup, --gui (announces a window and closes it on stop), --daemon=<pidfile> (starts a detached helper first, like adb's server).
import {spawn} from 'node:child_process';
import {writeFileSync} from 'node:fs';
const flags = new Set(process.argv.slice(2));
const daemon = process.argv.slice(2).find(arg => arg.startsWith('--daemon='))?.slice(9);
if (daemon) {
  const child = spawn(process.execPath, ['-e', 'process.on("SIGHUP",()=>{});setTimeout(()=>{},60000)'], {detached: true, stdio: 'ignore'});
  writeFileSync(daemon, String(child.pid));
  child.unref();
}
if (flags.has('--gui')) console.log('window opened');
const stop = name => () => { console.log(flags.has('--gui') ? `closing window (${name})` : `interrupted (${name})`); process.exit(name === 'SIGINT' ? 130 : 143); };
process.on('SIGINT', flags.has('--ignore-int') ? () => console.log('ignoring SIGINT') : stop('SIGINT'));
process.on('SIGTERM', flags.has('--ignore-term') ? () => console.log('ignoring SIGTERM') : stop('SIGTERM'));
if (flags.has('--ignore-hup')) process.on('SIGHUP', () => {});
let n = 0;
setInterval(() => console.log(`I/ActivityManager( ${process.pid}): line ${++n}`), 20);
