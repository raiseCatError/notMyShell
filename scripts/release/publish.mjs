#!/usr/bin/env node
// Publishes a verified release: annotated tag at the commit -> DRAFT release -> assets -> re-download and verify -> publish.
// Idempotent: a tag at the same commit with only a draft release is resumed; anything else already published is refused.
// Needs GH_TOKEN (contents: write). Usage: node scripts/release/publish.mjs --version X.Y.Z --commit SHA --dir DIR --confirmation TEXT
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {basename, join, resolve} from 'node:path';
import {parseArgs} from 'node:util';
import {pathToFileURL} from 'node:url';
import {checkApproval, classifyExisting, parseSums, tagFor, validateRefs, verifySums} from './lib.mjs';
import {gh, ghBuffer, getMasterHead, getRemoteState} from './github.mjs';

function fail(message) { throw new Error(message); }

export async function publish(argv) {
  const {values} = parseArgs({args: argv, options: {
    version: {type: 'string'}, commit: {type: 'string'}, dir: {type: 'string'}, confirmation: {type: 'string', default: ''},
    repo: {type: 'string', default: process.env.GITHUB_REPOSITORY ?? 'raiseCatError/notMyShell'},
  }});
  const {version, commit, repo} = values;
  if (!version || !commit || !values.dir) fail('Usage: publish.mjs --version X.Y.Z --commit SHA --dir DIR --confirmation TEXT');
  const tag = tagFor(version), dir = resolve(values.dir);
  const name = `nmsh-${version}-source.tar.gz`;

  const early = [...checkApproval({mode: 'publish', confirmation: values.confirmation, version}),
    ...validateRefs({version, tag, commit, mode: 'publish', masterHead: getMasterHead(repo)})];
  if (early.length) fail(early.map(item => `[${item.code}] ${item.message}`).join('\n'));
  const problems = await verifySums(dir, {required: [name, 'provenance.json']});
  if (problems.length) fail(`Artifacts do not verify:\n${problems.join('\n')}`);
  const provenance = JSON.parse(await readFile(join(dir, 'provenance.json'), 'utf8'));
  if (provenance.commit !== commit || provenance.version !== version || provenance.mode !== 'publish') fail('provenance.json is not a publish-mode record for this version and commit.');

  const verdict = classifyExisting({commit, ...getRemoteState(repo, tag)});
  if (verdict.action === 'refuse') fail(`[${verdict.blocker.code}] ${verdict.blocker.message}`);
  console.log(verdict.reason);

  if (verdict.action === 'create') {
    const object = gh(['api', '-X', 'POST', `repos/${repo}/git/tags`, '-f', `tag=${tag}`, '-f', `message=${tag}`, '-f', `object=${commit}`, '-f', 'type=commit']);
    gh(['api', '-X', 'POST', `repos/${repo}/git/refs`, '-f', `ref=refs/tags/${tag}`, '-f', `sha=${object.sha}`]);
    console.log(`Created annotated tag ${tag} at ${commit}`);
  }

  const notes = await readFile(join(dir, 'release-notes.md'), 'utf8');
  const heading = (await readFile('CHANGELOG.md', 'utf8')).split('\n').find(line => line.startsWith(`## [${version}]`)) ?? '';
  const title = /—\s*(.+)$/u.exec(heading)?.[1]?.trim();
  const releaseName = title ? `${tag} — ${title}` : tag;
  const state = getRemoteState(repo, tag);
  let release = state.release;
  const body = ['-f', `name=${releaseName}`, '-f', `body=${notes}`];
  if (!release) release = gh(['api', '-X', 'POST', `repos/${repo}/releases`, '-f', `tag_name=${tag}`, '-F', 'draft=true', ...body]);
  else release = gh(['api', '-X', 'PATCH', `repos/${repo}/releases/${release.id}`, ...body]);
  console.log(`Draft release ${release.id} ready`);

  const files = parseSums(await readFile(join(dir, 'SHA256SUMS'), 'utf8')).map(entry => entry.name).filter(file => file !== 'release-notes.md');
  gh(['release', 'upload', tag, '--repo', repo, '--clobber', join(dir, 'SHA256SUMS'), ...files.map(file => join(dir, file))], {json: false});

  const check = await mkdtemp(join(tmpdir(), 'nmsh-redownload-'));
  try {
    const assets = gh(['api', `repos/${repo}/releases/${release.id}`]).assets;
    for (const file of [...files, 'SHA256SUMS']) {
      const asset = assets.find(item => item.name === basename(file));
      if (!asset) fail(`Asset ${file} is not on the draft release.`);
      await mkdir(check, {recursive: true});
      await writeFile(join(check, file), ghBuffer(['api', '-H', 'Accept: application/octet-stream', `repos/${repo}/releases/assets/${asset.id}`]));
    }
    // Same SHA256SUMS content, and the downloaded bytes match it.
    if ((await readFile(join(check, 'SHA256SUMS'), 'utf8')) !== (await readFile(join(dir, 'SHA256SUMS'), 'utf8'))) fail('Uploaded SHA256SUMS differs from the local one.');
    const bad = await verifySums(check, {required: [name]});
    if (bad.length) fail(`Re-downloaded assets do not verify; the release stays a draft:\n${bad.join('\n')}`);
  } finally { await rm(check, {recursive: true, force: true}); }

  gh(['api', '-X', 'PATCH', `repos/${repo}/releases/${release.id}`, '-F', 'draft=false', '-f', 'make_latest=true']);
  console.log(`Published ${tag}: https://github.com/${repo}/releases/tag/${tag}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  publish(process.argv.slice(2)).catch(error => { console.error(error.message); process.exit(1); });
}
