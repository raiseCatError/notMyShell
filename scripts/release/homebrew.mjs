#!/usr/bin/env node
// Produces the tap formula for a release: only `url` and `sha256` change. Never merges and never builds bottles.
// Usage: node scripts/release/homebrew.mjs --version X.Y.Z --sha256 HEX --formula current.rb --out new.rb
//        [--open-pr --tap raiseCatError/homebrew-tap]   (needs GH_TOKEN with write access to the tap)
import {readFile, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {parseArgs} from 'node:util';
import {pathToFileURL} from 'node:url';
import {compareSemver, parseSemver} from './lib.mjs';

const URL_LINE = /^(\s*url\s+")(https:\/\/github\.com\/raiseCatError\/notMyShell\/archive\/refs\/tags\/v)(\d+\.\d+\.\d+)(\.tar\.gz")\s*$/mu;
const SHA_LINE = /^(\s*sha256\s+")([0-9a-f]{64})(")\s*$/mu;

export function updateFormula(text, version, sha) {
  if (!parseSemver(version)) throw new Error(`"${version}" is not a plain X.Y.Z version.`);
  if (!/^[0-9a-f]{64}$/u.test(sha)) throw new Error('The sha256 must be 64 lowercase hex characters.');
  const url = URL_LINE.exec(text), digest = SHA_LINE.exec(text);
  if (!url || !digest) throw new Error('The formula has no recognizable source `url` and `sha256` lines.');
  if ((text.match(/^\s*url\s/gmu) ?? []).length !== 1 || (text.match(/^\s*sha256\s/gmu) ?? []).length !== 1) throw new Error('The formula has more than one url or sha256 line (bottles or resources?); update it by hand.');
  if (compareSemver(version, url[3]) < 0) throw new Error(`The formula is already at ${url[3]}, newer than ${version}.`);
  return text.replace(URL_LINE, `$1$2${version}$4`).replace(SHA_LINE, `$1${sha}$3`);
}

async function openPr({tap, version, content}) {
  const {gh} = await import('./github.mjs');
  const branch = `nmsh-${version}`, title = `nmsh ${version}`;
  const base = gh(['api', `repos/${tap}`]).default_branch;
  const open = gh(['api', `repos/${tap}/pulls?state=open&head=${tap.split('/')[0]}:${branch}`]);
  if (open.length) { console.log(`Tap PR already open: ${open[0].html_url}`); return open[0].html_url; }
  const baseSha = gh(['api', `repos/${tap}/git/ref/heads/${base}`]).object.sha;
  gh(['api', '-X', 'POST', `repos/${tap}/git/refs`, '-f', `ref=refs/heads/${branch}`, '-f', `sha=${baseSha}`]);
  const file = gh(['api', `repos/${tap}/contents/Formula/nmsh.rb?ref=${base}`]);
  gh(['api', '-X', 'PUT', `repos/${tap}/contents/Formula/nmsh.rb`, '-f', `message=${title}`, '-f', `branch=${branch}`, '-f', `sha=${file.sha}`, '-f', `content=${Buffer.from(content).toString('base64')}`]);
  const pr = gh(['api', '-X', 'POST', `repos/${tap}/pulls`, '-f', `title=${title}`, '-f', `head=${branch}`, '-f', `base=${base}`, '-f', `body=Source formula update for the nmsh v${version} release: url and sha256 only.`]);
  console.log(`Opened ${pr.html_url}`);
  return pr.html_url;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const {values} = parseArgs({options: {version: {type: 'string'}, sha256: {type: 'string'}, formula: {type: 'string'}, out: {type: 'string'}, 'open-pr': {type: 'boolean', default: false}, tap: {type: 'string', default: 'raiseCatError/homebrew-tap'}}});
    if (!values.version || !values.sha256 || !values.formula || !values.out) throw new Error('Usage: homebrew.mjs --version X.Y.Z --sha256 HEX --formula FILE --out FILE [--open-pr]');
    const content = updateFormula(await readFile(resolve(values.formula), 'utf8'), values.version, values.sha256);
    await writeFile(resolve(values.out), content);
    console.log(`Wrote ${values.out}`);
    if (values['open-pr']) await openPr({tap: values.tap, version: values.version, content});
  } catch (error) { console.error(error.message); process.exit(1); }
}
