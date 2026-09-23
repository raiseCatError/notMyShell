import {PresentationMode} from './PresentationMode.js';

export class CommandClassifier {
  public mode: PresentationMode = 'INLINE';

  private lines = 0;
  private firstOutputTime = 0;
  private lastOutputTime = 0;
  private hasAltScreen = false;
  private hasCursorMovement = false;
  private hasProgressRewrites = false;

  private burstLines = 0;
  private burstStart = 0;
  private sustainedStreamingScore = 0;

  private onModeChange?: (mode: PresentationMode) => void;

  constructor(private readonly startTime: number = Date.now(), onModeChange?: (mode: PresentationMode) => void) {
    this.onModeChange = onModeChange;
  }

  pushChunk(chunk: string): void {
    const now = Date.now();
    if (this.firstOutputTime === 0) {
      this.firstOutputTime = now;
      this.burstStart = now;
    }

    if (this.lastOutputTime > 0 && now - this.lastOutputTime > 500) {
      if (this.lines > 0) {
        this.sustainedStreamingScore++;
      }
      this.burstLines = 0;
      this.burstStart = now;
    }
    this.lastOutputTime = now;

    if (chunk.includes('\u001B[?1049h') || chunk.includes('\u001B[?47h')) {
      this.hasAltScreen = true;
    }
    if (chunk.includes('\u001B[A') || chunk.includes('\u001B[H') || /\u001B\[[0-9;]*[HfA-D]/.test(chunk)) {
      this.hasCursorMovement = true;
    }
    if (chunk.includes('\r') && !chunk.includes('\r\n')) {
      this.hasProgressRewrites = true;
    }

    let chunkLines = 0;
    for (let i = 0; i < chunk.length; i++) {
      if (chunk[i] === '\n') chunkLines++;
    }
    this.lines += chunkLines;
    this.burstLines += chunkLines;

    this.recalculate(now);
  }

  tick(): void {
    this.recalculate(Date.now());
  }

  finalize(exitCode: number): void {
    const now = Date.now();
    this.recalculate(now);

    let nextMode: PresentationMode = this.mode;

    if (nextMode === 'LIVE' && this.lines > 20 && this.sustainedStreamingScore < 2 && (now - this.startTime) < 5000) {
      nextMode = 'FOLDED';
    }

    if (nextMode === 'INLINE' && this.lines > 10) {
      nextMode = 'FOLDED';
    }

    if (this.mode !== nextMode) {
      this.mode = nextMode;
      this.onModeChange?.(this.mode);
    }
  }

  private recalculate(now: number): void {
    if (this.mode === 'PASSTHROUGH') return;

    let nextMode: PresentationMode = this.mode;

    if (this.hasAltScreen) {
      nextMode = 'PASSTHROUGH';
    } else if (this.mode !== 'LIVE') {
      if (this.sustainedStreamingScore >= 2 && now - this.startTime >= 2000) {
        nextMode = 'LIVE';
      } else if (this.hasCursorMovement && now - this.startTime >= 2000) {
        nextMode = 'LIVE';
      } else if (this.lines > 10) {
        nextMode = 'FOLDED';
      }
    }

    if (this.mode !== nextMode) {
      this.mode = nextMode;
      this.onModeChange?.(this.mode);
    }
  }
}
