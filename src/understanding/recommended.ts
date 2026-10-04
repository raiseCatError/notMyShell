import {createHash} from 'node:crypto';
import {createWriteStream, mkdirSync, readFileSync, renameSync, rmSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

/**
 * The recommended model for local understanding. Its artifact (revision,
 * file, bytes, sha256) is pinned by a maintainer from the publisher's own
 * metadata; a filename alone is never trusted. Without a pin, nothing is
 * downloaded. Weights are never part of the NMSh package.
 */
export interface PinnedArtifact {
  publisher?: string;
  repository: string;
  source?: string;
  revision: string;
  file: string;
  url: string;
  quantization: string;
  bytes: number;
  sha256: string;
  license: string;
}
export interface RecommendedModel {
  model: string;
  upstream: {repository: string; license: string};
  quantization: string;
  artifact: PinnedArtifact | null;
}

export const RECOMMENDED_MODEL_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'assets', 'understanding', 'recommended-model.json');

export function loadRecommendedModel(path = RECOMMENDED_MODEL_PATH): RecommendedModel | undefined {
  try {
    const value = JSON.parse(readFileSync(path, 'utf8')) as RecommendedModel & {version?: number};
    if (value.version !== 1 || typeof value.model !== 'string') return undefined;
    const artifact = value.artifact;
    const pinned = artifact && officialArtifact(artifact) ? artifact : null;
    return {model: value.model, upstream: value.upstream, quantization: value.quantization, artifact: pinned};
  } catch { return undefined; }
}

/**
 * NMSh downloads only the official Qwen artifact, at a pinned commit: the
 * official repository, a 40-hex revision (never `main` or another ref) in the
 * URL, an exact size and sha256. Mirrors, other publishers and third-party
 * quantizations are rejected, so there is no fallback download.
 */
export const OFFICIAL_REPOSITORY = 'https://huggingface.co/Qwen/Qwen3-0.6B-GGUF';
export function officialArtifact(artifact: PinnedArtifact): boolean {
  return artifact.repository === OFFICIAL_REPOSITORY && /^[0-9a-f]{40}$/u.test(artifact.revision)
    && artifact.url === `${OFFICIAL_REPOSITORY}/resolve/${artifact.revision}/${artifact.file}` && /^[\w.-]+\.gguf$/u.test(artifact.file)
    && /^[0-9a-f]{64}$/u.test(artifact.sha256) && Number.isSafeInteger(artifact.bytes) && artifact.bytes > 0;
}

export function formatBytes(bytes: number): string {
  return bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.round(bytes / 1e6)} MB`;
}

/**
 * Download a pinned artifact after explicit consent: streamed to a temporary
 * file, exact size and sha256 verified, then renamed into place. Any mismatch
 * deletes the partial file and fails; nothing unverified is ever used.
 */
export async function downloadPinned(artifact: PinnedArtifact, directory: string, onProgress: (received: number) => void,
  fetcher: typeof fetch = fetch, signal?: AbortSignal): Promise<string> {
  mkdirSync(directory, {recursive: true, mode: 0o700});
  if (!officialArtifact(artifact)) throw new Error('not the official pinned Qwen artifact; NMSh downloads nothing else');
  const target = join(directory, artifact.file.replace(/[^\w.-]+/gu, '_'));
  const temporary = `${target}.${process.pid}.partial`;
  const response = await fetcher(artifact.url, signal ? {signal} : {});
  if (!response.ok || !response.body) throw new Error(`download failed (${response.status})`);
  const hash = createHash('sha256');
  const output = createWriteStream(temporary, {mode: 0o600});
  let received = 0;
  try {
    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      received += chunk.length;
      if (received > artifact.bytes) throw new Error('download is larger than the pinned size');
      hash.update(chunk);
      if (!output.write(chunk)) await new Promise(resolve => output.once('drain', resolve));
      onProgress(received);
    }
    await new Promise<void>((resolve, reject) => output.end((error?: Error | null) => error ? reject(error) : resolve()));
    if (received !== artifact.bytes) throw new Error(`size mismatch: ${received} of ${artifact.bytes} bytes`);
    const digest = hash.digest('hex');
    if (digest !== artifact.sha256) throw new Error('sha256 does not match the pinned artifact');
    renameSync(temporary, target);
    return target;
  } catch (error) {
    output.destroy();
    rmSync(temporary, {force: true});
    throw error;
  }
}
