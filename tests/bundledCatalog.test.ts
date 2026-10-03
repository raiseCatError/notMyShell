import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {deflateRawSync} from 'node:zlib';
import {execFileSync} from 'node:child_process';
import {BUNDLED_CATALOG_DIRECTORY, BundledCatalog, BundledCatalogSource, catalogCandidates, type CatalogNode} from '../src/shell/BundledCatalog.js';
import {CompletionAggregator, DeclarativeSpecSource, MAX_SPEC_TOTAL_BYTES} from '../src/shell/CompletionSources.js';
import {CompletionService, defaultCompletionSources} from '../src/shell/CompletionService.js';
import type {CompletionCandidate, CompletionContext, CompletionSource} from '../src/shell/completion.js';

const context = (buffer: string): CompletionContext => ({buffer, cwd: '/', cursor: buffer.length});
const shipped = new BundledCatalog();
const values = (buffer: string, catalog = shipped) => catalogCandidates(catalog, context(buffer)).map(item => item.value);

/** Write a tiny catalog in the shipped format. */
function fixture(entries: Record<string, CatalogNode>, roots: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'nmsh-catalog-'));
  const chunks: Buffer[] = [];
  const index: Record<string, [number, number]> = {};
  let offset = 0;
  for (const [key, node] of Object.entries(entries)) {
    const packed = deflateRawSync(Buffer.from(JSON.stringify(node)));
    index[key] = [offset, packed.length];
    chunks.push(packed);
    offset += packed.length;
  }
  writeFileSync(join(dir, 'catalog.bin'), Buffer.concat(chunks));
  writeFileSync(join(dir, 'catalog-index.json'), JSON.stringify({version: 1, roots, entries: index}));
  return dir;
}

test('format: lazy index, per-entry inflate, refs resolve only the path being completed', () => {
  const dir = fixture({
    tool: {n: ['tool', 't'], o: [{n: ['--verbose'], p: 1}, {n: ['--mode'], a: [{c: [['fast', 'Quick'], ['slow']]}]}], s: [{n: ['big'], d: 'Large', r: 'tool big'}, {n: ['small'], a: [{c: [['one'], ['two']]}]}]},
    'tool big': {n: ['big'], s: [{n: ['deep']}], o: [{n: ['--size'], a: [{}]}]},
  }, {tool: 'tool', t: 'tool'});
  try {
    const catalog = new BundledCatalog(dir);
    assert.equal(catalog.loads, 0, 'nothing is read before the first lookup');
    assert.deepEqual(values('tool s', catalog), ['small']);
    assert.equal(catalog.loads, 1, 'a sibling ref is not inflated');
    assert.deepEqual(values('t b', catalog), ['big'], 'root aliases resolve through the index');
    assert.deepEqual(values('tool big ', catalog), ['deep', '--size', '--verbose'], 'a ref inflates its entry; persistent options are inherited');
    assert.equal(catalog.loads, 2);
    assert.deepEqual(values('tool --mode ', catalog), ['fast', 'slow'], 'option value choices');
    assert.equal(catalogCandidates(catalog, context('tool --mode f'))[0]!.description, 'Quick');
    assert.deepEqual(values('tool big --size ', catalog), [], 'a free-form value offers nothing instead of guessing');
    assert.deepEqual(values('tool small ', catalog), ['one', 'two', '--verbose'], 'positional choices');
    assert.deepEqual(values('tool small one ', catalog), ['--verbose'], 'a non-variadic argument is consumed');
    assert.deepEqual(values('nope ', catalog), []);
    assert.deepEqual(values('tool', catalog), [], 'command position belongs to the shell');
    assert.equal(catalog.hasRoot('constructor'), false, 'index lookups are own-property only');
  } finally { rmSync(dir, {recursive: true, force: true}); }
});

test('format: a missing or corrupt catalog is absent, never an error', () => {
  const dir = mkdtempSync(join(tmpdir(), 'nmsh-catalog-'));
  try {
    assert.equal(new BundledCatalog(dir).available, false);
    writeFileSync(join(dir, 'catalog-index.json'), '{"version":1,"roots":{"x":"x"},"entries":{"x":[0,50]}}');
    writeFileSync(join(dir, 'catalog.bin'), 'garbage');
    assert.deepEqual(values('x ', new BundledCatalog(dir)), []);
    writeFileSync(join(dir, 'catalog-index.json'), '{"version":2}');
    assert.equal(new BundledCatalog(dir).available, false, 'a newer format is ignored');
  } finally { rmSync(dir, {recursive: true, force: true}); }
});

test('shipped catalog: scale, provenance, licensing', () => {
  const index = JSON.parse(readFileSync(join(BUNDLED_CATALOG_DIRECTORY, 'catalog-index.json'), 'utf8'));
  const provenance = JSON.parse(readFileSync(join(BUNDLED_CATALOG_DIRECTORY, 'provenance.json'), 'utf8'));
  assert.ok(shipped.rootCount > 1000, `catalog roots: ${shipped.rootCount}`);
  assert.ok(provenance.catalog.subcommands + provenance.catalog.options > 10_000, 'well beyond the 2048 custom spec limit');
  for (const source of provenance.sources) {
    assert.equal(source.license, 'MIT');
    assert.match(source.commit, /^[0-9a-f]{40}$/u);
    assert.match(readFileSync(join(BUNDLED_CATALOG_DIRECTORY, '..', '..', source.notice), 'utf8'), /^MIT License/u, 'license notice is preserved');
  }
  const fig = provenance.fig;
  assert.equal(fig.examined, fig.full + fig.partial + fig.skipped);
  assert.ok(provenance.files.fig.some((file: {file: string; outcome: string}) => file.file === 'expo.ts' && file.outcome === 'skipped'), 'unclear-license files are excluded');
  assert.ok(provenance.notIncluded['microsoft/inshellisense'], 'downstream consumers of fig are not double-counted');
  for (const [offset, length] of Object.values(index.entries) as Array<[number, number]>) assert.ok(offset >= 0 && length > 0);
});

test('shipped catalog smoke: common tools resolve subcommands and options', () => {
  const expect = (buffer: string, value: string) => assert.ok(values(buffer).includes(value), `${buffer}| should offer ${value}`);
  expect('git ch', 'checkout');
  expect('git commit --am', '--amend');
  expect('gh pr ', 'create');
  expect('npm ins', 'install');
  expect('pnpm ad', 'add');
  expect('docker ru', 'run');
  expect('docker run --', '--rm');
  expect('kubectl ap', 'apply');
  expect('kubectl get -', '--output');
  expect('cargo bu', 'build');
  expect('go te', 'test');
  expect('python -', '-m');
  expect('pip ins', 'install');
  expect('ssh -', '-i');
  expect('aws s3 ', 'cp');
  expect('az vm ', 'create');
  expect('gcloud comp', 'compute');
});

test('shipped catalog: first load is bounded and large specs stay lazy', () => {
  const catalog = new BundledCatalog();
  const started = performance.now();
  assert.ok(values('aws s3 c', catalog).includes('cp'));
  const elapsed = performance.now() - started;
  assert.ok(catalog.loads <= 3, `aws s3 inflated ${catalog.loads} entries`);
  assert.ok(elapsed < 1000, `first aws lookup took ${elapsed.toFixed(1)} ms`);
});

test('priority: live shell > custom spec > bundled catalog; custom spec replaces a bundled command', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'nmsh-specs-'));
  try {
    writeFileSync(join(dir, 'git.json'), JSON.stringify({name: 'git', subcommands: [{name: 'mine', description: 'custom'}]}));
    const custom = new DeclarativeSpecSource(dir);
    const shell: CompletionSource = {id: 'shell', async query(ctx) {
      return [{value: 'status', display: 'status', name: 'status', description: '', kind: 'argument', source: 'shell', replacement: {start: 4, end: ctx.buffer.length}, context: ctx, insertion: 'git status'}] as CompletionCandidate[];
    }};
    const service = new CompletionService(new CompletionAggregator([
      {source: shell, priority: 0},
      {source: custom, priority: 10},
      {source: new BundledCatalogSource(new BundledCatalog(), root => custom.load().has(root)), priority: 20},
    ]));
    const git = await service.suggest('git ', '/');
    assert.equal(git[0]!.value, 'status', 'the live shell ranks first');
    assert.ok(git.some(item => item.value === 'mine'));
    assert.ok(!git.some(item => item.value === 'checkout'), 'a custom spec for git shadows the bundled git');
    const docker = await service.suggest('docker ru', '/');
    assert.ok(docker.some(item => item.value === 'run' && item.source === 'catalog'), 'the catalog still serves other commands');
    service.dispose();
  } finally { rmSync(dir, {recursive: true, force: true}); }
  const defaults = defaultCompletionSources({id: 'shell', async query() { return []; }});
  assert.deepEqual(defaults.sourceIds, ['shell', 'spec', 'catalog']);
});

test('custom specs: 2048 files and an aggregate byte budget', () => {
  assert.equal(MAX_SPEC_TOTAL_BYTES, 48 * 1024 * 1024);
  const dir = mkdtempSync(join(tmpdir(), 'nmsh-specs-'));
  try {
    for (let index = 0; index < 2100; index += 1) writeFileSync(join(dir, `c${String(index).padStart(4, '0')}.json`), JSON.stringify({name: `c${index}`}));
    assert.equal(new DeclarativeSpecSource(dir).load().size, 2048, 'count limit');
    const budgeted = new DeclarativeSpecSource(dir, 100 * 20);
    assert.ok(budgeted.load().size < 200 && budgeted.skipped > 0, 'files past the aggregate budget are skipped');
  } finally { rmSync(dir, {recursive: true, force: true}); }
});

test('distribution: the npm package ships the catalog, its provenance, the upstream notices and the runtime', () => {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const [pack] = JSON.parse(execFileSync(npm, ['pack', '--dry-run', '--json', '--ignore-scripts'], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']})) as Array<{files: Array<{path: string}>}>;
  const files = new Set(pack!.files.map(file => file.path));
  for (const path of ['assets/completion/catalog.bin', 'assets/completion/catalog-index.json', 'assets/completion/provenance.json',
    'licenses/withfig-autocomplete-MIT.txt', 'licenses/carapace-bin-MIT.txt', 'src/shell/BundledCatalog.ts']) assert.ok(files.has(path), `${path} is packed`);
  // The runtime resolves the catalog relative to its own module, two levels up from dist/shell or src/shell.
  assert.equal(BUNDLED_CATALOG_DIRECTORY, join(import.meta.dirname, '..', 'assets', 'completion'));
});
