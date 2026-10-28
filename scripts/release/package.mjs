#!/usr/bin/env node
// Packages the exact commit: git archive -> nmsh-X.Y.Z-source.tar.gz, then SHA256SUMS over the release files.
// Usage: node scripts/release/package.mjs --version X.Y.Z --out DIR [--commit SHA]
import {execFileSync} from 'node:child_process';
import {mkdir, readFile, stat, writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {parseArgs} from 'node:util';
import {pathToFileURL} from 'node:url';
import {formatSums, parseSemver, sha256} from './lib.mjs';

export const artifactName = version => `nmsh-${version}-source.tar.gz`;

export async function packageRelease(argv) {
  const {values} = parseArgs({args: argv, options: {version: {type: 'string'}, commit: {type: 'string'}, out: {type: 'string'}}});
  if (!values.version || !values.out || !parseSemver(values.version)) throw new Error('Usage: package.mjs --version X.Y.Z --out DIR [--commit SHA]');
  const out = resolve(values.out);
  const commit = execFileSync('git', ['rev-parse', '--verify', `${values.commit ?? 'HEAD'}^{commit}`], {encoding: 'utf8'}).trim();
  await mkdir(out, {recursive: true});
  const tarball = join(out, artifactName(values.version));
  // git archive stamps entries with the commit time and gzips with -n, so the same commit gives the same bytes.
  execFileSync('git', ['archive', '--format=tar.gz', `--prefix=notMyShell-${values.version}/`, '-o', tarball, commit]);
  const data = await readFile(tarball);
  const provenancePath = join(out, 'provenance.json');
  if (existsSync(provenancePath)) {
    const provenance = JSON.parse(await readFile(provenancePath, 'utf8'));
    if (provenance.commit !== commit) throw new Error(`provenance.json is for ${provenance.commit}, not ${commit}; run prepare.mjs for this commit first.`);
    provenance.artifact = {name: artifactName(values.version), sha256: sha256(data), bytes: (await stat(tarball)).size};
    await writeFile(provenancePath, `${JSON.stringify(provenance, null, 2)}\n`);
  }
  const names = [artifactName(values.version), 'provenance.json'].filter(name => existsSync(join(out, name)));
  const entries = [];
  for (const name of names) entries.push({name, sha256: sha256(await readFile(join(out, name)))});
  await writeFile(join(out, 'SHA256SUMS'), formatSums(entries));
  console.log(`Packaged ${commit} as ${tarball}`);
  for (const entry of entries) console.log(`${entry.sha256}  ${entry.name}`);
  return {tarball, commit, entries};
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  packageRelease(process.argv.slice(2)).catch(error => { console.error(error.message); process.exit(1); });
}
