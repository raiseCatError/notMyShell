import {readdirSync} from 'node:fs';
import {join} from 'node:path';

// Explicit reviewed subsets, never inferred from file names or execution time.
// Fast: pure editor/protocol/presentation/platform logic; no real PTY fixtures.
const suites = {
  fast: ['testSharding', 'input', 'keys', 'highlighter', 'shellProtocol', 'sessionProtocol', 'completionModel', 'pathDisplay', 'linuxPlatform'],
  // Minimum-runtime gate: actual launcher, persistent shell backends, protocol,
  // platform discovery and build/version behavior without long detach scenarios.
  node22: ['testSharding', 'buildInfo', 'startupLaunch', 'shellAdapters', 'sessionProtocol', 'shellProtocol', 'linuxPlatform', 'hostProfiles', 'serviceCompat'],
  fedora: ['linuxPlatform', 'tools', 'update', 'hostProfiles', 'portabilityUninstall'],
};

// Rounded seconds from the macOS Node 26 canonical baseline (2026-10-04).
// Only slow files need weights; new/ordinary files default to one. Greedy
// whole-file scheduling avoids clustering the costly PTY files in one shard.
const runtimeWeights = {
  "bundledCatalog.test.ts": 5,
  "compatibilityHarness.test.ts": 28,
  "configuredCompletion.test.ts": 6,
  "ctrlZJobControl.test.ts": 12,
  "detachedOutput.test.ts": 22,
  "fullChromaQa.test.ts": 5,
  "hostProfiles.test.ts": 10,
  "interactiveCli.test.ts": 14,
  "liveHardening.test.ts": 45,
  "liveStatus.test.ts": 5,
  "muxInterop.test.ts": 31,
  "nativeCaptureLifecycle.test.ts": 6,
  "sessionLifecycle.test.ts": 28,
  "sessionPresets.test.ts": 20,
  "shellAdapters.test.ts": 35,
  "shellSwitchApp.test.ts": 23,
  "startupBlocked.test.ts": 29,
  "startupDiscovery.test.ts": 22,
  "startupLaunch.test.ts": 8
};

export function discoverTestFiles() {
  return readdirSync('tests', {recursive: true}).filter(name => name.endsWith('.test.ts')).map(name => join('tests', name)).sort();
}

export function parseTestOptions(argv) {
  const options = {args: []};
  for (const arg of argv) {
    if (arg.startsWith('--shard=')) {
      if (options.shard) throw new Error('Specify --shard only once');
      const match = /^--shard=([1-9]\d*)\/([1-9]\d*)$/u.exec(arg);
      if (!match) throw new Error('Expected --shard=index/count (1-based)');
      const index = Number(match[1]), count = Number(match[2]);
      if (!Number.isSafeInteger(count) || !Number.isSafeInteger(index) || index > count) throw new Error('Invalid shard range');
      options.shard = {index, count};
    } else if (arg.startsWith('--suite=')) {
      const suite = arg.slice('--suite='.length);
      if (options.suite || !Object.hasOwn(suites, suite)) throw new Error('Unknown or repeated test suite');
      options.suite = suite;
    } else options.args.push(arg);
  }
  if (options.shard && options.suite) throw new Error('Curated suites cannot be sharded');
  return options;
}

export function selectTestGroups(files, {shard, suite} = {}) {
  let selected = [...files].sort();
  if (suite) {
    selected = suites[suite].map(name => `tests/${name}.test.ts`).sort();
    for (const file of selected) if (!files.includes(file)) throw new Error(`Missing curated test: ${file}`);
  }
  const ranking = selected.filter(file => file.endsWith('/suggestionRanking.test.ts'));
  let runtime = selected.filter(file => !ranking.includes(file));
  if (shard) {
    const weight = file => runtimeWeights[file.slice(file.lastIndexOf('/') + 1)] ?? 1;
    const buckets = Array.from({length: shard.count}, () => ({files: [], weight: 0}));
    for (const file of [...runtime].sort((a, b) => weight(b) - weight(a) || (a < b ? -1 : a > b ? 1 : 0))) {
      const bucket = buckets.reduce((best, candidate) => candidate.weight < best.weight ? candidate : best);
      bucket.files.push(file);
      bucket.weight += weight(file);
    }
    runtime = buckets[shard.index - 1].files.sort();
  }
  return [runtime, !shard || shard.index === 1 ? ranking : []];
}
