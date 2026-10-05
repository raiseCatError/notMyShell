// Maintainer-only: pin the recommended local-understanding model artifact.
// Reads the publisher's metadata (revision, size, sha256 from the LFS pointer)
// and writes assets/understanding/recommended-model.json. Downloads nothing.
//
//   node scripts/local-model/pin-model.mjs <owner/repo> <file.gguf> [revision]
//
// Example: node scripts/local-model/pin-model.mjs Qwen/Qwen3-0.6B-GGUF Qwen3-0.6B-Q8_0.gguf
// Review the license of the chosen repository before committing the result.
import {readFileSync, writeFileSync} from 'node:fs';

const [repo, file, revisionArg] = process.argv.slice(2);
if (!repo || !file) { console.error('usage: pin-model.mjs <owner/repo> <file.gguf> [revision]'); process.exit(2); }
const api = `https://huggingface.co/api/models/${repo}${revisionArg ? `/revision/${revisionArg}` : ''}`;
const info = await (await fetch(api)).json();
const revision = info.sha;
const paths = await (await fetch(`https://huggingface.co/api/models/${repo}/paths-info/${revision}`, {method: 'POST',
  headers: {'content-type': 'application/json'}, body: JSON.stringify({paths: [file]})})).json();
const entry = paths.find(item => item.path === file);
if (!entry?.lfs?.oid || !entry.size) { console.error('file or LFS metadata not found'); process.exit(1); }
const license = info.cardData?.license ?? info.tags?.find(tag => tag.startsWith('license:'))?.slice(8);
const quantization = /(I?Q\d\w*|F16|BF16)/iu.exec(file)?.[1]?.toUpperCase() ?? 'unknown';
const path = new URL('../../assets/understanding/recommended-model.json', import.meta.url);
const manifest = JSON.parse(readFileSync(path, 'utf8'));
manifest.quantization = quantization;
manifest.artifact = {repository: `https://huggingface.co/${repo}`, revision, file, url: `https://huggingface.co/${repo}/resolve/${revision}/${file}`,
  quantization, bytes: entry.size, sha256: entry.lfs.oid, license: license ?? 'unknown'};
delete manifest.note;
writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`pinned ${repo}@${revision} ${file}: ${entry.size} bytes, sha256 ${entry.lfs.oid}, license ${license}`);
