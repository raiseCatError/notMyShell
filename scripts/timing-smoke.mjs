import {spawnSync} from 'node:child_process';

for (const args of [
  ['--import=tsx', 'scripts/platform-benchmarks.ts'],
  ['--import=tsx', 'scripts/benchmarks.ts', 'completion/configured-cold', 'completion/configured-warm', 'composer/screen-plan', 'transcript/wrap-present-10000'],
]) {
  const result = spawnSync(process.execPath, args, {
    stdio: 'inherit', timeout: 120000,
    env: {...process.env, NMSH_BENCH_SAMPLES: '5', NMSH_BENCH_WARMUP: '1'},
  });
  if (result.error) console.error(result.error);
  if (result.status !== 0) { process.exitCode = result.status ?? 1; break; }
}
