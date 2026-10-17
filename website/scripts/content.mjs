import path from 'node:path/posix';

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
