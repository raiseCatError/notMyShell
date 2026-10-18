import { readFile, access, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { validateMedia, assertFileMembership } from './content.mjs';
import { assertLaunch } from './launch.mjs';

const root = new URL('../', import.meta.url);
const read = async path => JSON.parse(await readFile(new URL(path, root), 'utf8'));
const release = await read('src/data/release.json');
const manifest = await read('src/data/upstream.json');
const launch = await read('src/data/launch.json');
assertLaunch(launch, release, process.argv.includes('--require-published'));
if (launch.version !== manifest.version || launch.commit !== manifest.commit || launch.state !== manifest.state) throw new Error('Launch and canonical source snapshots disagree.');
assertFileMembership((await readdir(new URL('src/content/reference/', root))).filter(name => name.endsWith('.md')), manifest.files.map(file => `${file.slug}.md`), 'Reference');
assertFileMembership((await readdir(new URL('src/content/releases/', root))).filter(name => name.endsWith('.md')), release.history.map(item => `${item.tag}.md`), 'Release');
for (const file of manifest.files) {
  const markdown = await readFile(new URL(`src/content/reference/${file.slug}.md`, root));
  const hash = createHash('sha256').update(markdown).digest('hex');
  if (hash !== file.generatedSha256) throw new Error(`Generated reference changed: ${file.slug}. Edit upstream, not the snapshot.`);
}
for (const item of release.history) {
  const markdown = await readFile(new URL(`src/content/releases/${item.tag}.md`, root));
  if (createHash('sha256').update(markdown).digest('hex') !== item.generatedSha256) throw new Error(`Generated release notes changed: ${item.tag}. Refresh from the public release, not a hand-edited snapshot.`);
}
const slots = await read('src/data/media.json');
if (new Set(slots.map(slot => slot.id)).size !== slots.length) throw new Error('Duplicate media IDs.');
for (const slot of slots) {
  validateMedia(slot);
  if (slot.src) await access(new URL(`public${slot.src}`, root));
  if (slot.poster) await access(new URL(`public${slot.poster}`, root));
}
const guides = await readdir(new URL('src/content/guides/', root));
if (guides.filter(file => file.endsWith('.md')).length < 18) throw new Error('The complete curated guide set is missing.');
console.log(`Content valid: ${manifest.files.length} pinned sources, ${guides.length} guides, ${slots.length} media slots; launch v${launch.version} ${launch.state}, public stable ${release.latest.tag}.`);
