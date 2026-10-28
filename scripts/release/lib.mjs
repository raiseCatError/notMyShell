// Pure release rules shared by the release scripts and tested in tests/releaseWorkflow.test.ts.
// Nothing here touches the network or the repository; callers pass in what they read.
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {basename, join} from 'node:path';

export const MODES = ['dry-run', 'candidate', 'publish'];
export const REQUIRED_CI_CHECKS = ['Verify (22.x)', 'Verify (26.x)'];
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;

// A blocker is {code, message, soft?}. Soft blockers (a candidate's "Unreleased" heading, pending QA rows) are
// reported in every mode, but only stop a publish.
const blocker = (code, message, soft = false) => ({code, message, ...(soft ? {soft: true} : {})});

export function parseSemver(text) {
  const match = SEMVER.exec(String(text));
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : undefined;
}

export function compareSemver(a, b) {
  const left = parseSemver(a), right = parseSemver(b);
  if (!left || !right) throw new Error(`Not a plain X.Y.Z version: ${!left ? a : b}`);
  for (let index = 0; index < 3; index += 1) if (left[index] !== right[index]) return left[index] < right[index] ? -1 : 1;
  return 0;
}

export const tagFor = version => `v${version}`;

export function checkVersionConsistency({version, packageJson, lock, changelog, mode}) {
  const blockers = [];
  if (!parseSemver(version)) return [blocker('version-invalid', `"${version}" is not a plain X.Y.Z version.`)];
  if (packageJson?.version !== version) blockers.push(blocker('version-mismatch', `package.json is ${packageJson?.version ?? 'missing'}, not ${version}.`));
  if (lock?.version !== version) blockers.push(blocker('version-mismatch', `package-lock.json root is ${lock?.version ?? 'missing'}, not ${version}.`));
  if (lock?.packages?.['']?.version !== version) blockers.push(blocker('version-mismatch', `package-lock.json packages[""] is ${lock?.packages?.['']?.version ?? 'missing'}, not ${version}.`));
  const section = findChangelogHeading(changelog, version);
  if (!section) blockers.push(blocker('changelog-missing', `CHANGELOG.md has no "## [${version}]" section.`));
  else if (/unreleased|candidate/iu.test(section.title)) blockers.push(blocker('changelog-unreleased', `The ${version} changelog heading is still "${section.title.trim()}"; give it the publication date.`, mode !== 'publish'));
  return blockers;
}

function findChangelogHeading(changelog, version) {
  const lines = String(changelog ?? '').split('\n');
  const prefix = `## [${version}]`;
  const index = lines.findIndex(line => line.startsWith(prefix));
  return index < 0 ? undefined : {index, lines, title: lines[index].slice(prefix.length)};
}

export function extractChangelogSection(changelog, version) {
  const found = findChangelogHeading(changelog, version);
  if (!found) return undefined;
  let end = found.lines.length;
  for (let index = found.index + 1; index < found.lines.length; index += 1) {
    if (found.lines[index].startsWith('## ') || /^\[[^\]]+\]:\s/u.test(found.lines[index])) { end = index; break; }
  }
  return found.lines.slice(found.index + 1, end).join('\n').trim();
}

export function validateRefs({version, tag, commit, mode, masterHead, headCommit}) {
  const blockers = [];
  if (!MODES.includes(mode)) blockers.push(blocker('mode-invalid', `Unknown mode "${mode}".`));
  if (parseSemver(version) && tag !== tagFor(version)) blockers.push(blocker('tag-invalid', `The tag must be ${tagFor(version)}, not "${tag}".`));
  if (!parseSemver(version)) blockers.push(blocker('tag-invalid', `No valid version for a tag (got "${version}").`));
  if (!/^[0-9a-f]{40}$/u.test(String(commit))) blockers.push(blocker('commit-invalid', `The commit must be a full 40-character hex SHA, not "${commit}".`));
  else {
    if (headCommit && headCommit !== commit) blockers.push(blocker('commit-not-checked-out', `The checkout is ${headCommit}, not ${commit}.`));
    if (mode === 'publish') {
      if (!/^[0-9a-f]{40}$/u.test(String(masterHead))) blockers.push(blocker('master-unknown', 'master\'s head could not be determined; publishing needs it.'));
      else if (masterHead !== commit) blockers.push(blocker('commit-not-master', `Publishing is only allowed from master's head (${masterHead}), not ${commit}.`));
    }
  }
  return blockers;
}

export function checkApproval({mode, confirmation, version}) {
  if (mode !== 'publish') return [];
  const expected = `publish ${tagFor(version)}`;
  return confirmation === expected ? [] : [blocker('approval-missing', `Publishing needs the confirmation "${expected}".`)];
}

export function evaluateQaGate(qa, version) {
  if (!qa) return [blocker('qa-missing', `No physical QA record (docs/releases/${tagFor(version)}-qa.json); a release needs one.`)];
  const blockers = [];
  if (qa.version !== version) blockers.push(blocker('qa-version', `The QA record is for ${qa.version ?? 'no version'}, not ${version}.`));
  if (!Array.isArray(qa.rows) || qa.rows.length === 0) return [...blockers, blocker('qa-empty', 'The QA record has no rows.')];
  for (const row of qa.rows) {
    const id = row?.id ?? '(no id)';
    if (row?.status === 'pass') continue;
    if (row?.status === 'waived') {
      if (typeof row.reason !== 'string' || row.reason.trim() === '') blockers.push(blocker('qa-waiver-reason', `QA row ${id} is waived without a reason.`));
    } else blockers.push(blocker('qa-row-open', `QA row ${id} is "${row?.status ?? 'unset'}"; it must pass or be waived with a reason.`, row?.status === 'pending'));
  }
  return blockers;
}

export function qaSummary(qa) {
  if (!qa || !Array.isArray(qa.rows)) return 'No physical QA record exists for this release.';
  const count = status => qa.rows.filter(row => row?.status === status).length;
  const waived = qa.rows.filter(row => row?.status === 'waived');
  const lines = [`Physical QA: ${count('pass')} of ${qa.rows.length} rows passed, ${waived.length} waived, ${qa.rows.length - count('pass') - waived.length} open.`];
  for (const row of waived) lines.push(`- Waived: ${row.id}${row.reason ? ` - ${row.reason}` : ''}`);
  return lines.join('\n');
}

export function sha256(data) {
  return createHash('sha256').update(data).digest('hex');
}

export function formatSums(entries) {
  return entries.map(({name, sha256: digest}) => `${digest}  ${name}\n`).join('');
}

export function parseSums(text) {
  const entries = [];
  for (const line of String(text).split('\n')) {
    if (line === '') continue;
    const match = /^([0-9a-f]{64}) [ *]([^/\\\0]+)$/u.exec(line);
    if (!match) throw new Error(`Malformed SHA256SUMS line: ${line}`);
    entries.push({name: match[2], sha256: match[1]});
  }
  if (entries.length === 0) throw new Error('SHA256SUMS lists no files.');
  return entries;
}

// Returns problems (empty when every listed file exists and matches). `required` names must be listed.
export async function verifySums(dir, {required = []} = {}) {
  const problems = [];
  let entries;
  try { entries = parseSums(await readFile(join(dir, 'SHA256SUMS'), 'utf8')); } catch (error) {
    return [`SHA256SUMS: ${error.code === 'ENOENT' ? 'missing' : error.message}`];
  }
  for (const name of required) if (!entries.some(entry => entry.name === name)) problems.push(`${name}: not listed in SHA256SUMS`);
  for (const {name, sha256: expected} of entries) {
    let data;
    try { data = await readFile(join(dir, basename(name))); } catch { problems.push(`${name}: missing artifact`); continue; }
    const actual = sha256(data);
    if (actual !== expected) problems.push(`${name}: checksum mismatch (expected ${expected}, got ${actual})`);
  }
  return problems;
}

// remote = {tag: {exists, commit} | undefined, release: {draft} | undefined}. Never moves a pushed tag.
export function classifyExisting({commit, tag, release}) {
  const tagCommit = tag?.exists ? tag.commit : undefined;
  if (release && !release.draft) return {action: 'refuse', blocker: blocker('release-exists', `A published GitHub release for this tag already exists.`)};
  if (tag?.exists && tagCommit !== commit) return {action: 'refuse', blocker: blocker('tag-exists', `The tag exists at ${tagCommit}, not ${commit}. A pushed tag is never moved.`)};
  // Without the tag, a draft would make GitHub create a lightweight tag at the default branch on publish: create ours first.
  if (!tag?.exists) return {action: 'create', reason: release ? 'Only an untagged draft release exists; creating the annotated tag, then reusing the draft.' : 'Neither the tag nor a release exists.'};
  if (release) return {action: 'resume', reason: 'The tag is at this commit and only a draft release exists; resuming it.'};
  if (tag?.exists) return {action: 'resume', reason: 'The tag exists at this commit without a release; creating the draft release.'};
  return {action: 'create', reason: 'Neither the tag nor a release exists.'};
}

// checkRuns: [{name, conclusion}], dispatchRuns: [{conclusion, event}] for the exact commit.
export function evaluateCiGate({checkRuns, dispatchRuns}) {
  const blockers = [];
  for (const name of REQUIRED_CI_CHECKS) {
    const runs = (checkRuns ?? []).filter(run => run.name === name);
    if (!runs.some(run => run.conclusion === 'success')) blockers.push(blocker('ci-check', `No successful "${name}" check run on this commit.`));
    else if (runs.some(run => run.conclusion && run.conclusion !== 'success' && run.conclusion !== 'skipped' && run.conclusion !== 'cancelled')) blockers.push(blocker('ci-check', `"${name}" also has a failing run on this commit.`));
  }
  if (!(dispatchRuns ?? []).some(run => run.event === 'workflow_dispatch' && run.conclusion === 'success')) blockers.push(blocker('ci-dispatch', 'No successful workflow_dispatch CI run on this commit (Fedora and timing smokes run only on dispatch).'));
  return blockers;
}

export function buildReleaseNotes({version, changelog, qa, commit}) {
  const section = extractChangelogSection(changelog, version);
  const tag = tagFor(version);
  return `${section ?? `(No changelog section for ${version}.)`}

## Install and upgrade

- Homebrew: \`brew update && brew upgrade raiseCatError/tap/nmsh\` (once the tap has ${version}).
- From source: download the \`${tag}\` source archive, or in an existing source checkout use \`/update\`. NMSh is a Node.js application; \`npm ci && npm run build\` builds it.
- The attached \`nmsh-${version}-source.tar.gz\` is the exact tree of commit \`${commit}\`; verify it with \`SHA256SUMS\`.

## Limitations

- This is a source release. There are no standalone or portable binaries: node-pty is a native addon built on your machine.
- A build from a source archive reports "build unknown" (no Git history).

## Physical QA

${qaSummary(qa)}

The full changelog is in [CHANGELOG.md](https://github.com/raiseCatError/notMyShell/blob/${tag}/CHANGELOG.md).
`;
}

export function summarizeBlockers(blockers, mode) {
  const failing = mode === 'publish' ? blockers : blockers.filter(item => !item.soft);
  return {failing, soft: blockers.filter(item => !failing.includes(item))};
}

/** Why a prepared provenance record may not be published (undefined when it may). */
export function provenanceRefusal(provenance, {version, commit}) {
  if (!provenance || provenance.commit !== commit || provenance.version !== version || provenance.mode !== 'publish') return 'provenance.json is not a publish-mode record for this version and commit.';
  if (!Array.isArray(provenance.blockers)) return 'provenance.json does not record its release blockers.';
  if (provenance.blockers.length) return `provenance.json records release blockers: ${provenance.blockers.join(', ')}.`;
  return undefined;
}
