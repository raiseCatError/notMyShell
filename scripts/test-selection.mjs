import {readdirSync} from 'node:fs';
import {join} from 'node:path';

/** Optional resource limit for npm verification scripts; CLI Node flags still win. */
export function testConcurrency(value, parallelism) {
  if (value === undefined) return Math.max(1, Math.min(4, parallelism - 1));
  if (!/^[1-4]$/u.test(value)) throw new Error('NMSH_TEST_CONCURRENCY must be an integer from 1 to 4');
  return Number(value);
}

// Explicit reviewed subsets, never inferred from file names or execution time.
// Fast: pure editor/protocol/presentation/platform logic; no real PTY fixtures.
const suites = {
  fast: ['testSharding', 'input', 'keys', 'highlighter', 'shellProtocol', 'sessionProtocol', 'completionModel', 'pathDisplay', 'linuxPlatform'],
  // Minimum-runtime gate: actual launcher, persistent shell backends, protocol,
  // platform discovery and build/version behavior without long detach scenarios.
  node22: ['testSharding', 'buildInfo', 'startupLaunch', 'shellAdapters', 'sessionProtocol', 'shellProtocol', 'linuxPlatform', 'hostProfiles', 'serviceCompat', 'socketClientLifecycle', 'sessionViewRefresh', 'stoppedSessionPrompt', 'sessionReattachGeometry', 'startupSignalLifecycle'],
  fedora: ['linuxPlatform', 'tools', 'update', 'hostProfiles', 'portabilityUninstall'],
};

// Rounded seconds: the slower of the macOS and Ubuntu Node 26 CI shards (run 39756506927, 2026-10-22); files not
// measured there keep their 2026-10-04 macOS baseline. The two Chrome files are estimates after they began sharing one
// browser per file.
// Only slow files need weights; new/ordinary files default to one. Greedy
// whole-file scheduling avoids clustering the costly PTY files in one shard.
const runtimeWeights = {
  "activityStyleLive.test.ts": 16,
  "ansiLiveRegion.test.ts": 15,
  "arcadeAll.test.ts": 8,
  "arcadeBackgroundLive.test.ts": 52,
  "arcadeDashGame.test.ts": 26,
  "arcadeDashPhysics.test.ts": 26,
  "arcadePinball.test.ts": 20,
  "arcadeQueensLogic.test.ts": 15,
  "arcadeSudokuLogic.test.ts": 6,
  "backgroundSupervisor.test.ts": 11,
  "browserEngineChrome.test.ts": 50,
  "browserPanel.test.ts": 6,
  "bundledCatalog.test.ts": 11,
  "chromaV2.test.ts": 6,
  "clipsLive.test.ts": 6,
  "commandQueueLive.test.ts": 97,
  "compareOutputLive.test.ts": 10,
  "compatibilityHarness.test.ts": 47,
  "configuredCompletion.test.ts": 13,
  "contextEngine.test.ts": 13,
  "contextHostileWorkspace.test.ts": 9,
  "copyExactLive.test.ts": 7,
  "copyPayload.test.ts": 5,
  "copyReportLive.test.ts": 5,
  "copySelectionLive.test.ts": 51,
  "ctrlZJobControl.test.ts": 24,
  "detachedOutput.test.ts": 38,
  "diagramsChrome.test.ts": 25,
  "flowComposer.test.ts": 8,
  "fullChromaQa.test.ts": 5,
  "fullscreenFailure.test.ts": 8,
  "fullscreenResizeSampling.test.ts": 10,
  "historyReuseLive.test.ts": 11,
  "hostProfiles.test.ts": 18,
  "hybrid.test.ts": 6,
  "inputAwarenessLive.test.ts": 52,
  "inputOwnershipLive.test.ts": 46,
  "interactiveCli.test.ts": 37,
  "keepAwakeForeground.test.ts": 8,
  "liveHardening.test.ts": 88,
  "liveStatus.test.ts": 10,
  "moduleDiagnosticsLive.test.ts": 7,
  "muxInterop.test.ts": 47,
  "nativeCaptureLifecycle.test.ts": 8,
  "outputReferencesLive.test.ts": 7,
  "pasteBatchLive.test.ts": 21,
  "pinsLive.test.ts": 7,
  "queueConditionsLive.test.ts": 24,
  "queuePreviewLive.test.ts": 33,
  "queueSummaryLive.test.ts": 23,
  "sessionLifecycle.test.ts": 78,
  "sessionPresets.test.ts": 45,
  "shellAdapters.test.ts": 35,
  "shellIntelligence.test.ts": 22,
  "shellSwitchApp.test.ts": 23,
  "startupBlocked.test.ts": 64,
  "startupDiscovery.test.ts": 87,
  "startupLaunch.test.ts": 10,
  "startupLifecycle.test.ts": 7,
  "terminalBaseline.test.ts": 9,
  "terminalModeReconciliation.test.ts": 8,
  "themeBridgeLive.test.ts": 5,
  "tmpdirHygiene.test.ts": 9,
  "toolConfig.test.ts": 6,
  "trackLive.test.ts": 13,
  "typingAfterRead.test.ts": 17,
  "viewerLive.test.ts": 13,
  "worktreeMutations.test.ts": 11
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
