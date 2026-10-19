// #443 diagnostic (not part of the product or the canonical suite): loop the live tests whose Fish cases lost Fish
// output or NMSh markers on Ubuntu with Fish 3.7, and keep each failing iteration's report (and strace traces, when the
// workflow wraps fish in strace). Usage: node --import=tsx scripts/diag/443-loop.mjs <iterations> <outDir>
import {cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {runTestFiles} from '../test.mjs';

const iterations = Number(process.argv[2] ?? 10);
const out = process.argv[3] ?? 'diag-out';
const traces = process.env.DIAG_TRACE_DIR;
const files = ['tests/absolutePathLive.test.ts', 'tests/inputOwnershipLive.test.ts', 'tests/commandQueueLive.test.ts', 'tests/typingAfterRead.test.ts'];
mkdirSync(out, {recursive: true});
const summary = [];
for (let iteration = 1; iteration <= iterations; iteration += 1) {
  if (traces) { rmSync(traces, {recursive: true, force: true}); mkdirSync(traces, {recursive: true}); }
  const lines = [];
  const started = Date.now();
  const {code} = await runTestFiles(files, ['--test-name-pattern=fish', '--test-reporter=spec', `--test-reporter-destination=${join(out, `iteration-${iteration}.log`)}`],
    {stdio: 'inherit', report: message => lines.push(message)});
  const ms = Date.now() - started;
  summary.push({iteration, code, ms});
  console.log(`iteration ${iteration}: exit ${code} in ${ms} ms`);
  if (code === 0) rmSync(join(out, `iteration-${iteration}.log`), {force: true});
  else if (traces && existsSync(traces)) cpSync(traces, join(out, `traces-${iteration}`), {recursive: true});
  if (lines.length) writeFileSync(join(out, `iteration-${iteration}.runner.txt`), lines.join('\n'));
}
writeFileSync(join(out, 'summary.json'), JSON.stringify(summary, null, 2));
const failed = summary.filter(item => item.code !== 0).length;
console.log(`${failed} of ${iterations} iterations failed; logs: ${readdirSync(out).join(', ')}`);
