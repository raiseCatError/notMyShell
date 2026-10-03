// Build the bundled completion catalog (assets/completion/) from local
// checkouts of withfig/autocomplete (primary) and carapace-sh/carapace-bin
// (secondary). Both are MIT. Upstream code is parsed, never executed.
//
//   node build.mjs --fig <withfig/autocomplete checkout> --carapace <carapace-bin checkout> [--out <dir>]
//
// Output:
//   catalog.bin          concatenated deflateRaw'd JSON entries
//   catalog-index.json   {version, roots: {name: key}, entries: {key: [offset, length]}}
//   provenance.json      sources, commits, licenses, per-file outcomes and counts
//
// Entries are keyed by command path ("aws", "aws s3"). A large subcommand is
// stored as its own entry and referenced from its parent as {n, d, r: key},
// so `aws s3 cp` inflates only the aws and aws-s3 entries.

import {execFileSync} from 'node:child_process';
import {existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync} from 'node:fs';
import {basename, join, resolve} from 'node:path';
import {deflateRawSync} from 'node:zlib';
import {FigExtractor, convertSpec} from './fig.mjs';
import {extractCompleter} from './carapace.mjs';

const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, item, index, all) => (item.startsWith('--') ? [...pairs, [item.slice(2), all[index + 1]]] : pairs), []));
if (!args.fig || !args.carapace) { console.error('usage: node build.mjs --fig <dir> --carapace <dir> [--out <dir>]'); process.exit(2); }
const out = resolve(args.out ?? new URL('../../assets/completion', import.meta.url).pathname);

const SPLIT_BYTES = 16 * 1024; // a subcommand larger than this becomes its own entry
// Files whose headers claim third-party copyright without a license grant.
const LICENSE_EXCLUDED = new Map([['expo.ts', 'third-party copyright header without license grant'], ['expo-cli.ts', 'third-party copyright header without license grant']]);
const CARAPACE_PLATFORMS = ['common', 'unix', 'linux', 'darwin', 'bsd'];
const CARAPACE_SKIPPED_DIRS = new Map([
  ['windows', 'Windows-only commands; NMSh has no native Windows backend'],
  ['android', 'Android-only commands'],
  ['bash', 'shell builtins of another shell'], ['fish', 'shell builtins of another shell'], ['zsh', 'shell builtins of another shell'],
  ['elvish', 'shell builtins of another shell'], ['cmd', 'Windows cmd builtins'],
]);

const commit = dir => execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], {encoding: 'utf8'}).trim();
const licenseText = dir => readFileSync(join(dir, 'LICENSE'), 'utf8');
const assertMit = (dir, name) => { if (!/^MIT License/u.test(licenseText(dir))) throw new Error(`${name}: LICENSE is not MIT; refusing to import`); };
assertMit(args.fig, 'withfig/autocomplete');
assertMit(args.carapace, 'carapace-bin');

// ---------------------------------------------------------------- fig
const figSrc = join(args.fig, 'src');
const figFiles = [];
for (const name of readdirSync(figSrc).sort()) {
  const path = join(figSrc, name);
  if (name.endsWith('.ts') && !name.endsWith('.d.ts')) figFiles.push(name);
  else if (statSync(path).isDirectory() && existsSync(join(path, 'index.ts')) && !existsSync(`${path}.ts`)) figFiles.push(`${name}/index.ts`);
}
const figStats = {examined: 0, full: 0, partial: 0, skipped: 0, reasons: {}, subcommands: 0, options: 0, dynamic: 0, loadSpecs: 0};
const figFilesOut = [];
const roots = new Map(); // name -> {node, sources:Set}
const skip = (stats, list, file, reason) => { stats.skipped += 1; stats.reasons[reason] = (stats.reasons[reason] ?? 0) + 1; list.push({file, outcome: 'skipped', reason}); };
const extractor = new FigExtractor(figSrc);
for (const file of figFiles) {
  figStats.examined += 1;
  if (LICENSE_EXCLUDED.has(file)) { skip(figStats, figFilesOut, file, LICENSE_EXCLUDED.get(file)); continue; }
  const stats = {subcommands: 0, options: 0, dynamic: 0, loadSpecs: 0};
  const before = extractor.degraded;
  let node;
  try {
    const value = extractor.exportValue(join(figSrc, file), 'default');
    node = convertSpec(value, extractor, stats);
  } catch (error) { skip(figStats, figFilesOut, file, 'parse error'); continue; }
  if (!node) { skip(figStats, figFilesOut, file, 'no static spec (computed or generated)'); continue; }
  const degraded = extractor.degraded - before + stats.dynamic;
  for (const key of ['subcommands', 'options', 'dynamic', 'loadSpecs']) figStats[key] += stats[key];
  if (roots.has(node.n[0])) { skip(figStats, figFilesOut, file, 'duplicate root name'); continue; }
  const outcome = degraded ? 'partial' : 'full';
  figStats[outcome] += 1;
  figFilesOut.push({file, outcome, root: node.n[0], ...(degraded ? {dropped: degraded} : {})});
  roots.set(node.n[0], {node, sources: new Set(['fig'])});
}

// ---------------------------------------------------------------- carapace
const carapaceStats = {examined: 0, unique: 0, enriched: 0, unchanged: 0, skipped: 0, reasons: {}, subcommandsAdded: 0, optionsAdded: 0, descriptionsAdded: 0, dynamicFlags: 0, skippedDirectories: {}};
const carapaceFilesOut = [];
const completers = join(args.carapace, 'completers');
for (const dir of readdirSync(completers).sort()) {
  if (CARAPACE_SKIPPED_DIRS.has(dir)) { carapaceStats.skippedDirectories[dir] = {count: readdirSync(join(completers, dir)).length, reason: CARAPACE_SKIPPED_DIRS.get(dir)}; continue; }
  if (!CARAPACE_PLATFORMS.includes(dir)) carapaceStats.skippedDirectories[dir] = {count: readdirSync(join(completers, dir)).length, reason: 'unrecognized platform directory'};
}
const seenCarapace = new Set();
for (const platform of CARAPACE_PLATFORMS) {
  const base = join(completers, platform);
  if (!existsSync(base)) continue;
  for (const dir of readdirSync(base).sort()) {
    if (!dir.endsWith('_completer')) continue;
    const file = `${platform}/${dir}`;
    carapaceStats.examined += 1;
    const stats = {skipped: 0, dynamicFlags: 0, subcommands: 0, options: 0};
    let node;
    try { node = extractCompleter(join(base, dir), stats); } catch { skip(carapaceStats, carapaceFilesOut, file, 'parse error'); continue; }
    carapaceStats.dynamicFlags += stats.dynamicFlags;
    if (!node) { skip(carapaceStats, carapaceFilesOut, file, 'no static rootCmd'); continue; }
    const name = node.n[0];
    if (seenCarapace.has(name)) { skip(carapaceStats, carapaceFilesOut, file, 'same command on an earlier platform'); continue; }
    seenCarapace.add(name);
    const existing = roots.get(name);
    if (!existing) {
      carapaceStats.unique += 1;
      roots.set(name, {node, sources: new Set(['carapace'])});
      carapaceFilesOut.push({file, outcome: 'unique', root: name});
      continue;
    }
    const added = {subcommands: 0, options: 0, descriptions: 0};
    enrich(existing.node, node, added);
    if (added.subcommands + added.options + added.descriptions) {
      carapaceStats.enriched += 1;
      existing.sources.add('carapace');
      carapaceStats.subcommandsAdded += added.subcommands;
      carapaceStats.optionsAdded += added.options;
      carapaceStats.descriptionsAdded += added.descriptions;
      carapaceFilesOut.push({file, outcome: 'enriched', root: name, ...added});
    } else { carapaceStats.unchanged += 1; carapaceFilesOut.push({file, outcome: 'unchanged (fig already covers it)', root: name}); }
  }
}

/** Fill gaps in `target` (fig) from `extra` (carapace): never replace, only add. */
function enrich(target, extra, added) {
  if (!target.d && extra.d) { target.d = extra.d; added.descriptions += 1; }
  if (extra.s) {
    const byName = new Map();
    for (const sub of target.s ?? []) for (const name of sub.n) byName.set(name, sub);
    for (const sub of extra.s) {
      const match = sub.n.map(name => byName.get(name)).find(Boolean);
      if (match) enrich(match, sub, added);
      else { (target.s ??= []).push(sub); added.subcommands += 1; for (const name of sub.n) byName.set(name, sub); }
    }
  }
  if (extra.o) {
    const byName = new Map();
    for (const option of target.o ?? []) for (const name of option.n) byName.set(name, option);
    for (const option of extra.o) {
      const match = option.n.map(name => byName.get(name)).find(Boolean);
      if (match) { if (!match.d && option.d) { match.d = option.d; added.descriptions += 1; } }
      else { (target.o ??= []).push(option); added.options += 1; for (const name of option.n) byName.set(name, option); }
    }
  }
}

// ---------------------------------------------------------------- pack
const totals = {roots: 0, rootNames: 0, subcommands: 0, options: 0, choices: 0};
const count = node => {
  for (const sub of node.s ?? []) { totals.subcommands += 1; count(sub); }
  for (const option of node.o ?? []) { totals.options += 1; for (const arg of option.a ?? []) totals.choices += arg.c?.length ?? 0; }
  for (const arg of node.a ?? []) totals.choices += arg.c?.length ?? 0;
};
const entries = new Map(); // key -> JSON
const split = (node, path) => {
  if (node.s) {
    node.s = node.s.map(sub => {
      const subPath = `${path} ${sub.n[0]}`;
      split(sub, subPath);
      const json = JSON.stringify(sub);
      if (json.length <= SPLIT_BYTES || entries.has(subPath)) return sub;
      entries.set(subPath, json);
      return {n: sub.n, ...(sub.d ? {d: sub.d} : {}), r: subPath};
    });
  }
};
const rootIndex = {};
for (const name of [...roots.keys()].sort()) {
  const {node} = roots.get(name);
  sortNode(node);
  count(node);
  totals.roots += 1;
  split(node, name);
  entries.set(name, JSON.stringify(node));
  for (const alias of node.n) if (!(alias in rootIndex)) { rootIndex[alias] = name; totals.rootNames += 1; }
}
function sortNode(node) {
  if (node.s) { node.s.sort((a, b) => (a.n[0] < b.n[0] ? -1 : a.n[0] > b.n[0] ? 1 : 0)); node.s.forEach(sortNode); }
}

mkdirSync(out, {recursive: true});
const chunks = [];
const entryIndex = {};
let offset = 0;
let rawBytes = 0;
let largestEntry = ['', 0];
for (const key of [...entries.keys()].sort()) {
  const raw = Buffer.from(entries.get(key));
  rawBytes += raw.length;
  if (raw.length > largestEntry[1]) largestEntry = [key, raw.length];
  const packed = deflateRawSync(raw, {level: 9});
  entryIndex[key] = [offset, packed.length];
  chunks.push(packed);
  offset += packed.length;
}
writeFileSync(join(out, 'catalog.bin'), Buffer.concat(chunks));
writeFileSync(join(out, 'catalog-index.json'), `${JSON.stringify({version: 1, roots: rootIndex, entries: entryIndex})}\n`);

const sourcesPerRoot = {fig: 0, carapace: 0, both: 0};
for (const {sources} of roots.values()) sourcesPerRoot[sources.size === 2 ? 'both' : [...sources][0]] += 1;
const provenance = {
  version: 1,
  generator: 'scripts/completion-catalog/build.mjs',
  policy: 'Upstream sources are parsed as data only; no upstream JavaScript, TypeScript, Go or generator is executed. Dynamic completions (generators, callbacks, custom actions) are dropped and counted.',
  sources: [
    {name: 'withfig/autocomplete', repository: 'https://github.com/withfig/autocomplete', commit: commit(args.fig), license: 'MIT', notice: 'licenses/withfig-autocomplete-MIT.txt', role: 'primary'},
    {name: 'carapace-sh/carapace-bin', repository: 'https://github.com/carapace-sh/carapace-bin', commit: commit(args.carapace), license: 'MIT', notice: 'licenses/carapace-bin-MIT.txt', role: 'secondary (static cobra declarations only)'},
  ],
  notIncluded: {
    'microsoft/inshellisense': 'consumes withfig/autocomplete; counting it would double-count the same specs',
    'aws/amazon-q-developer-cli': 'Fig lineage; its specs are withfig/autocomplete',
  },
  fig: figStats,
  carapace: carapaceStats,
  catalog: {...totals, rootsBySource: sourcesPerRoot, entries: entries.size, rawBytes, packedBytes: offset, largestEntry: {key: largestEntry[0], rawBytes: largestEntry[1]}},
  files: {fig: figFilesOut, carapace: carapaceFilesOut},
};
writeFileSync(join(out, 'provenance.json'), `${JSON.stringify(provenance, null, 1)}\n`);
const licenses = resolve(out, '../../licenses');
writeFileSync(join(licenses, 'withfig-autocomplete-MIT.txt'), licenseText(args.fig));
writeFileSync(join(licenses, 'carapace-bin-MIT.txt'), licenseText(args.carapace));
console.log(JSON.stringify({fig: {...figStats}, carapace: {...carapaceStats, skippedDirectories: undefined}, catalog: provenance.catalog}, null, 1));
console.log(`wrote ${basename(out)}: ${entries.size} entries, ${(offset / 1048576).toFixed(2)} MiB packed`);
