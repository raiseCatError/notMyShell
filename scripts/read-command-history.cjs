// Reads authoritative journals off the editor thread; sends only eligible command metadata.
const {parentPort, workerData} = require('node:worker_threads');
const {readdir, readFile} = require('node:fs/promises');
const {join} = require('node:path');

(async () => {
  let files;
  try { files = await readdir(workerData.directory); }
  catch (error) { if (error.code === 'ENOENT') return; throw error; }
  for (const file of files) {
    if (!file.endsWith('.json') || file.endsWith('.meta.json')) continue;
    let session;
    try { session = JSON.parse(await readFile(join(workerData.directory, file), 'utf8')); }
    catch { continue; }
    if (session.schemaVersion !== 1 || session.id !== file.slice(0, -5) || !Array.isArray(session.transcript?.records)) continue;
    let records = [];
    for (const record of session.transcript.records) {
      if (record.historyEligible !== true || typeof record.command !== 'string' || /^\s/.test(record.command)
        || !record.command.trim() || !Number.isSafeInteger(record.startId) || !Number.isInteger(record.exitCode)) continue;
      const context = record.historicalContext;
      records.push({command: record.command, historyEligible: true, startId: record.startId, exitCode: record.exitCode,
        ...(Number.isFinite(record.startedAt) ? {startedAt: record.startedAt} : {}),
        ...(Number.isFinite(record.durationMs) && record.durationMs >= 0 ? {durationMs: record.durationMs} : {}),
        historicalContext: {cwd: typeof context?.cwd === 'string' ? context.cwd : undefined,
          project: typeof context?.project === 'string' ? context.project : undefined}});
      if (records.length === 1024) { parentPort.postMessage({session: session.id, records}); records = []; }
    }
    if (records.length) parentPort.postMessage({session: session.id, records});
  }
})().catch(error => { throw error; });
