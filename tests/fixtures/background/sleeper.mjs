// A quiet group member that ignores the hangup its group gets when the task's leader exits.
// Arguments: how long it stays, in milliseconds (default a minute), and optionally a file it creates once the hangup is
// ignored, so a leader can wait for that instead of guessing how long Node takes to start.
import {writeFileSync} from 'node:fs';
process.on('SIGHUP', () => {});
if (process.argv[3]) writeFileSync(process.argv[3], '');
setTimeout(() => {}, Number(process.argv[2] ?? 60_000));
