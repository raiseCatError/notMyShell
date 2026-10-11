// A quiet group member that ignores the hangup its group gets when the task's leader exits.
// An optional argument is how long it stays, in milliseconds (default a minute).
process.on('SIGHUP', () => {});
setTimeout(() => {}, Number(process.argv[2] ?? 60_000));
