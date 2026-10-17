import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { selectStable } from './content.mjs';
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
  console.log(`Upstream agrees: ${latest.tag_name}, ${commit.sha}, Homebrew ${tapVersion}.`);
  process.exit(0);
}
const sha256 = text => createHash('sha256').update(text).digest('hex');
const files = [];
for (const source of sources) {
  const original = await fetchText(`https://raw.githubusercontent.com/${repository}/${commit.sha}/${source.path}`);
  const body = original.replace(/^# .+\r?\n/, '').replace(/ {2,}$/gm, '<br />').replace(/[ \t]+$/gm, '').trimEnd() + '\n';
  const markdown = `---\ntitle: ${JSON.stringify(source.title)}\ndescription: ${JSON.stringify(`Canonical ${source.title.toLowerCase()} from ${latest.tag_name}.`)}\ngroup: Technical reference\norder: ${sources.indexOf(source) + 100}\nsource: ${JSON.stringify(source.path)}\n---\n${body}`;
  files.push({ source, original, markdown });
}
const history = releases.filter(release => !release.draft && !release.prerelease && /^v\d+\.\d+\.\d+$/.test(release.tag_name));
await mkdir(new URL('src/content/reference/', root), { recursive: true });
await mkdir(new URL('src/content/releases/', root), { recursive: true });
await mkdir(new URL('src/data/', root), { recursive: true });
for (const file of files) await writeFile(new URL(`src/content/reference/${file.source.slug}.md`, root), file.markdown);
for (const release of history) {
  const markdown = `---\ntitle: ${JSON.stringify(release.name || release.tag_name)}\ntag: ${release.tag_name}\ndate: ${release.published_at.slice(0, 10)}\nurl: ${release.html_url}\n---\n${release.body.replace(/ {2,}$/gm, '<br />').replace(/[ \t]+$/gm, '').trimEnd()}\n`;
  await writeFile(new URL(`src/content/releases/${release.tag_name}.md`, root), markdown);
}
const snapshot = {
  verifiedAt: new Date().toISOString().slice(0, 10), sourceCommit: commit.sha, tapVersion,
  latest: { tag: latest.tag_name, version: latest.tag_name.slice(1), date: latest.published_at.slice(0, 10), url: latest.html_url },
  requirements: { node: '22+', shells: ['zsh', 'Bash 4.4+', 'Fish'] },
  history: history.map(release => ({ tag: release.tag_name, date: release.published_at.slice(0, 10), url: release.html_url })),
};
const manifest = {
  commit: commit.sha, tag: latest.tag_name,
  routes: Object.fromEntries(sources.map(source => [source.path, source.slug])),
  files: files.map(file => ({ ...file.source, sourceSha256: sha256(file.original), generatedSha256: sha256(file.markdown) })),
};
await writeFile(new URL('src/data/release.json', root), JSON.stringify(snapshot, null, 2) + '\n');
await writeFile(new URL('src/data/upstream.json', root), JSON.stringify(manifest, null, 2) + '\n');
await mkdir(new URL('public/brand/', root), { recursive: true });
for (const asset of ['nmsh-lockup.svg', 'nmsh-logo.png']) {
  const response = await fetch(`https://raw.githubusercontent.com/${repository}/${commit.sha}/assets/brand/${asset}`, { headers, signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`Cannot read genuine brand asset: ${asset}`);
  await writeFile(new URL(`public/brand/${asset}`, root), Buffer.from(await response.arrayBuffer()));
}
console.log(`Synced ${files.length} canonical documents and ${history.length} public releases at ${latest.tag_name}. Review before publishing.`);
