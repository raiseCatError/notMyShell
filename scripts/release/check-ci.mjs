#!/usr/bin/env node
// Publish gate: the exact commit has successful Verify (22.x) / Verify (26.x) checks and a successful dispatched CI run.
// Usage: node scripts/release/check-ci.mjs --commit SHA [--repo owner/name]   (reads GitHub with GH_TOKEN)
import {parseArgs} from 'node:util';
import {pathToFileURL} from 'node:url';
import {evaluateCiGate} from './lib.mjs';
import {gh} from './github.mjs';

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const {values} = parseArgs({options: {commit: {type: 'string'}, repo: {type: 'string', default: 'raiseCatError/notMyShell'}}});
    if (!/^[0-9a-f]{40}$/u.test(values.commit ?? '')) throw new Error('--commit must be a 40-character SHA');
    const checkRuns = gh(['api', '--paginate', '--slurp', `repos/${values.repo}/commits/${values.commit}/check-runs?per_page=100`]).flatMap(page => page.check_runs)
      // Only GitHub Actions' own check runs count: another app with checks:write could post a look-alike name.
      .filter(run => run.app?.slug === 'github-actions');
    const dispatchRuns = gh(['api', '--paginate', '--slurp', `repos/${values.repo}/actions/workflows/ci.yml/runs?head_sha=${values.commit}&event=workflow_dispatch&per_page=100`]).flatMap(page => page.workflow_runs);
    const blockers = evaluateCiGate({checkRuns, dispatchRuns});
    if (blockers.length) { for (const item of blockers) console.error(`- [${item.code}] ${item.message}`); process.exit(1); }
    console.log(`CI is green on ${values.commit}`);
  } catch (error) { console.error(error.message); process.exit(2); }
}
