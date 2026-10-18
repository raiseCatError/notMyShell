// Audited corrections to release-pinned references. The tagged source is immutable, so a wrong or
// stale sentence in it is corrected here, shown on the page as an editorial update and recorded in
// the provenance manifest. Each correction applies only to the commit it was written against and
// must match exactly once; remove it once the corrected text ships in a tagged release.
export const corrections = [
  {
    id: 'context-modules-release-status',
    commit: '65e4de55b2d8f1ad3a734a9d415a353b56b81e2c',
    slug: 'context-modules',
    note: 'The release-status paragraph said the module platform was still pending acceptance. It shipped in v0.18.0 and is part of v0.20.0.',
    from: 'Packs, Status Strip routing and Status Strip 2.0, `/modules` and Claude Code agent context — is in\n> the v0.18 development stack, pending acceptance and release.',
    to: 'Packs, Status Strip routing and Status Strip 2.0, `/modules` and Claude Code agent context — shipped\n> in v0.18.0 and is part of every later release, including the current v0.20.0.',
  },
  {
    id: 'contributing-public-link',
    commit: '65e4de55b2d8f1ad3a734a9d415a353b56b81e2c',
    slug: 'contributing',
    note: 'The tagged document linked to a private GitHub Project. The link now points to the public issue tracker.',
    from: '- **GitHub Project** — [NMSh Development](https://github.com/users/raiseCatError/projects/1) — live development status board',
    to: '- **GitHub Issues** — [raiseCatError/notMyShell issues](https://github.com/raiseCatError/notMyShell/issues) — public bug reports, proposals and development status',
  },
];

export function applyEditorial(slug, commit, body) {
  const applied = [];
  let text = body;
  for (const correction of corrections.filter(item => item.slug === slug && item.commit === commit)) {
    if (text.split(correction.from).length !== 2) throw new Error(`Editorial correction ${correction.id} no longer matches exactly once; review or remove it.`);
    text = text.replace(correction.from, () => correction.to);
    applied.push(correction);
  }
  return { body: text, applied };
}
