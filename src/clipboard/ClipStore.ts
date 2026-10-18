/** Deliberately kept text, owned by this frontend only. Never persisted or executed. */
export interface Clip {
  readonly id: number;
  readonly text: string;
  readonly source: 'composer' | 'history' | 'command' | 'output' | 'paste';
  readonly cwd?: string;
  readonly session?: string;
}

export const CLIP_LIMIT = 12;
export const CLIP_MAX_BYTES = 1024 * 1024;
type ClipContext = Omit<Clip, 'id' | 'text'>;

export class ClipStore {
  private clips: Clip[] = [];
  private nextId = 1;

  list(): readonly Clip[] { return this.clips.map(clip => ({...clip})); }
  get(id: number): Clip | undefined { const clip = this.clips.find(clip => clip.id === id); return clip ? {...clip} : undefined; }
  remove(id: number): boolean {
    const before = this.clips.length;
    this.clips = this.clips.filter(clip => clip.id !== id);
    return this.clips.length !== before;
  }
  clear(): void { this.clips = []; }

  add(text: string, context: ClipContext): {ok: true; clip: Clip; dropped: number} | {ok: false; reason: string} {
    if (!text.trim()) return {ok: false, reason: 'There is no text to keep.'};
    const bytes = Buffer.byteLength(text, 'utf8');
    if (bytes > CLIP_MAX_BYTES) return {ok: false, reason: 'A clip cannot exceed 1 MiB.'};
    const clip: Clip = {...context, id: this.nextId++, text};
    this.clips.unshift(clip);
    let total = this.clips.reduce((sum, item) => sum + Buffer.byteLength(item.text, 'utf8'), 0);
    let dropped = 0;
    while (this.clips.length > CLIP_LIMIT || total > CLIP_MAX_BYTES) {
      total -= Buffer.byteLength(this.clips.pop()!.text, 'utf8');
      dropped++;
    }
    return {ok: true, clip: {...clip}, dropped};
  }
}
