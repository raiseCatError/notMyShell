// #443 diagnostic (not part of the product or the canonical suite): loop Fish live tests on Fish 3.7 and count failed
// iterations. Usage: node --import=tsx scripts/diag/443-stable-loop.mjs <iterations> <outDir> <baseline|fix>
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {runTestFiles} from '../test.mjs';

const iterations = Number(process.argv[2] ?? 10);
const out = process.argv[3] ?? 'diag-out';
const build = process.argv[4] ?? 'fix';
// The baseline has none of the new behavior: only the output-integrity test applies to both builds.
const files = build === 'baseline' ? ['tests/fishOutputIntegrityLive.test.ts']
  : ['tests/fishOutputIntegrityLive.test.ts', 'tests/ptyResizeLive.test.ts', 'tests/unreadInputLive.test.ts', 'tests/fishMarkerWrite.test.ts',
    'tests/typingAfterRead.test.ts', 'tests/absolutePathLive.test.ts', 'tests/inputOwnershipLive.test.ts', 'tests/commandQueueLive.test.ts'];
mkdirSync(out, {recursive: true});
const summary = [];
for (let iteration = 1; iteration <= iterations; iteration += 1) {
  const started = Date.now();
  const log = join(out, `iteration-${iteration}.log`);
  const {code} = await runTestFiles(files, ['--test-name-pattern=fish', '--test-reporter=spec', `--test-reporter-destination=${log}`], {stdio: 'inherit'});
  // Counts from the spec report, so a run where tests were skipped is never read as a pass.
  const report = readFileSync(log, 'utf8');
  const count = name => Number(new RegExp(`^ℹ ${name} (\\d+)`, 'mu').exec(report)?.[1] ?? NaN);
  const totals = {tests: count('tests'), pass: count('pass'), fail: count('fail'), skipped: count('skipped')};
  const failed = [...report.matchAll(/^✖ (.+?) \(\d/gmu)].map(match => match[1]).filter((name, index, all) => all.indexOf(name) === index && name !== 'failing tests:');
  summary.push({iteration, code, ms: Date.now() - started, ...totals, failed});
  console.log(`iteration ${iteration}: exit ${code} · ${JSON.stringify(totals)}${failed.length ? ` · failed: ${failed.join(' | ')}` : ''}`);
}
writeFileSync(join(out, 'summary.json'), JSON.stringify({build, files, summary}, null, 2));
console.log(`${build}: ${summary.filter(item => item.code !== 0).length} of ${iterations} iterations failed`);
