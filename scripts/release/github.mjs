// Thin wrappers over the gh CLI. Tokens come from the environment (GH_TOKEN); nothing is ever printed from it.
import {execFileSync} from 'node:child_process';

export function gh(args, {input, json = true} = {}) {
  const out = execFileSync('gh', args, {encoding: 'utf8', input, stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024});
  return json ? (out.trim() === '' ? undefined : JSON.parse(out)) : out;
}

function notFound(error) {
  return /HTTP 404|Not Found/iu.test(`${error.stderr ?? ''}${error.message ?? ''}`);
}

export function getMasterHead(repo) {
  return gh(['api', `repos/${repo}/git/ref/heads/master`]).object.sha;
}

// {tag: {exists, commit} , release: {id, draft, tag_name, assets} | undefined}. Reads only.
export function getRemoteState(repo, tag) {
  let tagState = {exists: false};
  try {
    let object = gh(['api', `repos/${repo}/git/ref/tags/${tag}`]).object;
    while (object.type === 'tag') object = gh(['api', `repos/${repo}/git/tags/${object.sha}`]).object;
    tagState = {exists: true, commit: object.sha};
  } catch (error) { if (!notFound(error)) throw error; }
  const releases = gh(['api', '--paginate', '--slurp', `repos/${repo}/releases?per_page=100`]).flat();
  const release = releases.find(item => item.tag_name === tag);
  return {tag: tagState, release};
}

export function ghBuffer(args) {
  return execFileSync('gh', args, {stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 512 * 1024 * 1024});
}
