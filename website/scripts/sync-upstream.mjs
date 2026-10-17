import { mkdir, writeFile, readFile, readdir, unlink } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { selectStable, normalizeMarkdown, renderReleaseMarkdown, assertReleaseCache, planOwnedRemovals } from './content.mjs';
import { sources } from './upstream-sources.mjs';

const repository = 'raiseCatError/notMyShell';
const root = new URL('../', import.meta.url);
const writing = process.argv.includes('--write');
if (!writing && !process.argv.includes('--check')) throw new Error('Choose --check or --write explicitly.');
const headers = { 'User-Agent': 'NMSh-website-source-sync', Accept: 'application/vnd.github+json' };
if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
async function fetchText(url) {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`${response.status} fetching ${url}. Existing snapshots remain buildable.`);
  return response.text();
}
async function api(route) { return JSON.parse(await fetchText(`https://api.github.com/${route}`)); }
const releases = await api(`repos/${repository}/releases?per_page=100`);
const latest = selectStable(releases);
const commit = await api(`repos/${repository}/commits/${latest.tag_name}`);
const tap = await fetchText('https://raw.githubusercontent.com/raiseCatError/homebrew-tap/HEAD/Formula/nmsh.rb');
const tapVersion = tap.match(/refs\/tags\/(v\d+\.\d+\.\d+)\.tar\.gz/)?.[1];
if (!tapVersion) throw new Error('Homebrew formula version could not be verified.');
if (!writing) {
  const cached = JSON.parse(await readFile(new URL('src/data/release.json', root), 'utf8'));
  if (cached.latest.tag !== latest.tag_name || cached.sourceCommit !== commit.sha || cached.tapVersion !== tapVersion) throw new Error('Upstream release or tap changed. Run sync:upstream and review all content before committing.');
  const names = (await readdir(new URL('src/content/releases/', root))).filter(name => name.endsWith('.md'));
  const contents = Object.fromEntries(await Promise.all(names.map(async name => [name, await readFile(new URL(`src/content/releases/${name}`, root), 'utf8')])));
  assertReleaseCache(releases, cached, contents);
  console.log(`Upstream agrees: ${latest.tag_name}, ${commit.sha}, Homebrew ${tapVersion}.`);
  process.exit(0);
}
const sha256 = text => createHash('sha256').update(text).digest('hex');
const files = [];
for (const source of sources) {
  const original = await fetchText(`https://raw.githubusercontent.com/${repository}/${commit.sha}/${source.path}`);
  const body = normalizeMarkdown(original.replace(/^# .+\r?\n/, ''));
  const markdown = `---\ntitle: ${JSON.stringify(source.title)}\ndescription: ${JSON.stringify(`Canonical ${source.title.toLowerCase()} from ${latest.tag_name}.`)}\ngroup: Technical reference\norder: ${sources.indexOf(source) + 100}\nsource: ${JSON.stringify(source.path)}\n---\n${body}`;
  files.push({ source, original, markdown });
}
const history = releases.filter(release => !release.draft && !release.prerelease && /^v\d+\.\d+\.\d+$/.test(release.tag_name));
const releaseFiles = history.map(release => ({ name: `${release.tag_name}.md`, markdown: renderReleaseMarkdown(release) }));
const assets = [];
for (const name of ['nmsh-lockup.svg', 'nmsh-logo.png']) {
  const response = await fetch(`https://raw.githubusercontent.com/${repository}/${commit.sha}/assets/brand/${name}`, { headers, signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`Cannot read genuine brand asset: ${name}`);
  assets.push({ name, data: Buffer.from(await response.arrayBuffer()) });
}
async function readPrevious(path) {
  try { return JSON.parse(await readFile(new URL(path, root), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return undefined; throw error; }
}
async function orphanFiles(directory, expected, proofs) {
  let names;
  try { names = await readdir(new URL(directory, root)); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  const entries = await Promise.all(names.filter(name => name.endsWith('.md')).map(async name => [name, await readFile(new URL(directory + name, root), 'utf8')]));
  const orphans = planOwnedRemovals(Object.fromEntries(entries), expected, proofs);
  return orphans.map(name => new URL(directory + name, root));
}
const previousManifest = await readPrevious('src/data/upstream.json');
const previousSnapshot = await readPrevious('src/data/release.json');
const removals = [
  ...await orphanFiles('src/content/reference/', sources.map(source => `${source.slug}.md`), Object.fromEntries((previousManifest?.files || []).map(file => [`${file.slug}.md`, file.generatedSha256]))),
  ...await orphanFiles('src/content/releases/', releaseFiles.map(file => file.name), Object.fromEntries((previousSnapshot?.history || []).map(release => [`${release.tag}.md`, release.generatedSha256]))),
];
await mkdir(new URL('src/content/reference/', root), { recursive: true });
await mkdir(new URL('src/content/releases/', root), { recursive: true });
await mkdir(new URL('src/data/', root), { recursive: true });
for (const file of files) await writeFile(new URL(`src/content/reference/${file.source.slug}.md`, root), file.markdown);
for (const file of releaseFiles) await writeFile(new URL(`src/content/releases/${file.name}`, root), file.markdown);
for (const file of removals) await unlink(file);
const snapshot = {
  verifiedAt: new Date().toISOString().slice(0, 10), sourceCommit: commit.sha, tapVersion,
  latest: { tag: latest.tag_name, version: latest.tag_name.slice(1), date: latest.published_at.slice(0, 10), url: latest.html_url },
  requirements: { node: '22+', shells: ['zsh', 'Bash 4.4+', 'Fish'] },
  history: history.map(release => ({ tag: release.tag_name, date: release.published_at.slice(0, 10), url: release.html_url, generatedSha256: sha256(renderReleaseMarkdown(release)) })),
};
const manifest = {
  commit: commit.sha, tag: latest.tag_name,
  routes: Object.fromEntries(sources.map(source => [source.path, source.slug])),
  files: files.map(file => ({ ...file.source, sourceSha256: sha256(file.original), generatedSha256: sha256(file.markdown) })),
};
await writeFile(new URL('src/data/release.json', root), JSON.stringify(snapshot, null, 2) + '\n');
await writeFile(new URL('src/data/upstream.json', root), JSON.stringify(manifest, null, 2) + '\n');
await mkdir(new URL('public/brand/', root), { recursive: true });
for (const asset of assets) await writeFile(new URL(`public/brand/${asset.name}`, root), asset.data);
console.log(`Synced ${files.length} canonical documents and ${history.length} public releases at ${latest.tag_name}. Review before publishing.`);
