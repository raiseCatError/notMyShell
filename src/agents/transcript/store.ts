import {closeSync, constants, fstatSync, lstatSync, mkdtempSync, openSync, readSync, rmSync, writeSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {AgentEvent} from '../sessions/model.js';

export interface SourceLimits {memoryBytes: number; sourceBytes: number; eventBytes: number}
const DEFAULTS: SourceLimits = {memoryBytes: 1024 * 1024, sourceBytes: 64 * 1024 * 1024, eventBytes: 8 * 1024 * 1024};
/** Target lifetime source; bounded hot cache, private offset-indexed spool. */
export class AgentSourceStore {
  readonly directory: string;
  readonly path: string;
  incomplete?: string;
  private fd: number;
  private offsets: Array<{offset: number; bytes: number}> = [];
  private cache = new Map<number, Buffer>();
  private cacheBytes = 0;
  private bytes = 0;
  private closed = false;
  private limits: SourceLimits;

  constructor(limits: Partial<SourceLimits> = {}) {
    this.limits = {...DEFAULTS, ...limits};
    this.directory = mkdtempSync(join(tmpdir(), 'nmsh-agent-source-'));
    const directory = lstatSync(this.directory);
    if (directory.isSymbolicLink() || (directory.mode & 0o077) !== 0) throw new Error('Agent source directory is not private');
    this.path = join(this.directory, 'source.jsonl');
    this.fd = openSync(this.path, constants.O_RDWR | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    if (!fstatSync(this.fd).isFile()) throw new Error('Agent source is not a regular file');
  }

  get length(): number {return this.offsets.length;}
  markIncomplete(reason: string): void {this.incomplete ??= reason;}

  append(event: AgentEvent): number | undefined {
    if (this.closed) {this.markIncomplete('Source store closed'); return undefined;}
    const bytes = Buffer.from(JSON.stringify(event) + '\n');
    if (bytes.length > this.limits.eventBytes) {this.markIncomplete('Individual event safety limit reached'); return undefined;}
    if (this.bytes + bytes.length > this.limits.sourceBytes) {this.markIncomplete('Target source budget reached'); return undefined;}
    try {
      let written = 0;
      while (written < bytes.length) written += writeSync(this.fd, bytes, written, bytes.length - written, this.bytes + written);
    } catch {this.markIncomplete('Source storage write failed'); return undefined;}
    const id = this.offsets.length;
    this.offsets.push({offset: this.bytes, bytes: bytes.length}); this.bytes += bytes.length;
    this.cache.set(id, bytes); this.cacheBytes += bytes.length;
    while (this.cacheBytes > this.limits.memoryBytes && this.cache.size) {
      const oldest = this.cache.keys().next().value!;
      this.cacheBytes -= this.cache.get(oldest)!.length; this.cache.delete(oldest);
    }
    return id;
  }

  read(id: number): AgentEvent | undefined {
    const location = this.offsets[id];
    if (!location || this.closed) return undefined;
    try {
      let bytes = this.cache.get(id);
      if (!bytes) {
        bytes = Buffer.alloc(location.bytes); let read = 0;
        while (read < bytes.length) {const count = readSync(this.fd, bytes, read, bytes.length - read, location.offset + read); if (!count) throw new Error('Incomplete source'); read += count;}
      }
      return JSON.parse(bytes.toString('utf8')) as AgentEvent;
    } catch {this.markIncomplete('Source storage read failed'); return undefined;}
  }

  dispose(): void {
    if (this.closed) return;
    this.closed = true; closeSync(this.fd); this.cache.clear(); this.offsets = [];
    rmSync(this.directory, {recursive: true, force: true});
  }
}
