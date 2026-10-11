// A quiet group member that ignores the hangup its group gets when the task's leader exits.
process.on('SIGHUP', () => {});
setTimeout(() => {}, 60_000);
