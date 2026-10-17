import path from 'node:path/posix';
import { createHash } from 'node:crypto';

export function normalizeMarkdown(markdown) {
  let fence;
  return markdown.split('\n').map(line => {
    const delimiter = line.match(/^\s*(`{3,}|~{3,})/);
    if (delimiter) {
      if (!fence) fence = delimiter[1][0];
      else if (delimiter[1][0] === fence) fence = undefined;
    }
    const preserved = !fence && !delimiter ? line.replace(/ {2,}$/, '<br />') : line;
    return preserved.replace(/[ \t]+$/, '');
  }).join('\n').trimEnd() + '\n';
}

export function renderReleaseMarkdown(release) {
  return `---\ntitle: ${JSON.stringify(release.name || release.tag_name)}\ntag: ${release.tag_name}\ndate: ${release.published_at.slice(0, 10)}\nurl: ${release.html_url}\n---\n${normalizeMarkdown(release.body || '')}`;
}

export function assertFileMembership(actual, expected, label) {
  if (JSON.stringify([...actual].sort()) !== JSON.stringify([...expected].sort())) throw new Error(`${label} files do not match the provenance manifest. Refresh or review orphan generated files.`);
}

export function planOwnedRemovals(contents, expected, proofs) {
  const removed = Object.keys(contents).filter(name => !expected.includes(name));
  for (const name of removed) {
    const hash = createHash('sha256').update(contents[name]).digest('hex');
    if (!proofs[name] || hash !== proofs[name]) throw new Error(`Refusing to remove unverified or edited generated file: ${name}`);
  }
  return removed;
}

export function assertReleaseCache(releases, cached, contents) {
  const history = releases.filter(release => !release.draft && !release.prerelease && /^v\d+\.\d+\.\d+$/.test(release.tag_name));
  const metadata = history.map(release => ({ tag: release.tag_name, date: release.published_at.slice(0, 10), url: release.html_url }));
  const previousMetadata = cached.history.map(({ tag, date, url }) => ({ tag, date, url }));
  const latest = selectStable(releases);
  if (cached.latest.tag !== latest.tag_name || cached.latest.date !== latest.published_at.slice(0, 10) || cached.latest.url !== latest.html_url || JSON.stringify(metadata) !== JSON.stringify(previousMetadata)) throw new Error('Public release metadata/history changed. Refresh and review the snapshot.');
  assertFileMembership(Object.keys(contents), history.map(release => `${release.tag_name}.md`), 'Release');
  for (const release of history) if (contents[`${release.tag_name}.md`] !== renderReleaseMarkdown(release)) throw new Error(`Published release notes changed: ${release.tag_name}. Refresh and review the snapshot.`);
}

export function selectStable(releases) {
  const stable = releases.filter(release => !release.draft && !release.prerelease && /^v\d+\.\d+\.\d+$/.test(release.tag_name));
  stable.sort((left, right) => {
    const leftParts = left.tag_name.slice(1).split('.').map(Number);
    const rightParts = right.tag_name.slice(1).split('.').map(Number);
    return rightParts[0] - leftParts[0] || rightParts[1] - leftParts[1] || rightParts[2] - leftParts[2];
  });
  if (!stable.length) throw new Error('No verified public stable release found.');
  return stable[0];
}

export function resolveSourceLink(href, sourcePath, { commit, routes }) {
  if (!href || href.startsWith('#') || href.startsWith('/') || /^[a-z][a-z\d+.-]*:/i.test(href)) return href;
  const [pathname, fragment] = href.split('#');
  const resolved = path.normalize(path.join(path.dirname(sourcePath), pathname));
  const anchor = fragment === undefined ? '' : `#${fragment}`;
  if (routes[resolved]) return `/docs/reference/${routes[resolved]}/${anchor}`;
  return `https://github.com/raiseCatError/notMyShell/blob/${commit}/${resolved}${anchor}`;
}

export function validateMedia(slot) {
  if (!/^[a-z][a-z\d-]+$/.test(slot.id) || !(slot.width > 0 && slot.height > 0) || !slot.caption || !slot.altRequirement) throw new Error(`Invalid media slot: ${slot.id}`);
  if (slot.src && (!slot.src.startsWith('/media/') || !['image', 'video'].includes(slot.kind) || !slot.alt)) throw new Error(`Media ${slot.id} needs a local asset, kind and specific alt text.`);
  if (slot.kind === 'video' && slot.src && !slot.poster) throw new Error(`Video ${slot.id} needs a poster.`);
  return true;
}
