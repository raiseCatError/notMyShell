import type {Key} from '../../terminal/keys.js';
import type {Canvas} from '../Canvas.js';
import type {ArcadePalette} from '../palette.js';
import type {ControlHint, GameDefinition, GameInstance, GameKeyResult, GameKind} from '../types.js';

/** A minimal game for the hub and tests: shows its title and exits on Esc. Real games replace it. */
export function placeholderGame(meta: {id: string; aliases: readonly string[]; title: string; tagline: string; description: string; kind: GameKind}): GameDefinition {
  return {
    ...meta,
    controls: [{keys: 'Esc', action: 'back'}],
    summary: () => 'Not played yet',
    preview: (canvas: Canvas, frame: number, palette: ArcadePalette) => {
      canvas.center(Math.floor(canvas.height / 2), frame % 10 < 5 ? '·  ·  ·' : ' · · · ', {fg: palette.accent});
    },
    create: () => {
      const instance: GameInstance = {
        status: 'ready', result: undefined, stepsPerSecond: 0, refreshMs: 0,
        step() {}, animate() {},
        key(key: Key): GameKeyResult { return key.kind === 'escape' ? 'back' : 'ignored'; },
        render(canvas: Canvas, _alpha: number, palette: ArcadePalette) {
          canvas.clear();
          canvas.center(Math.floor(canvas.height / 2), meta.title, {fg: palette.ink, bold: true});
          canvas.center(Math.floor(canvas.height / 2) + 1, 'Coming together…', {fg: palette.muted});
        },
        resize() {}, pause() {}, hints: (): readonly ControlHint[] => [{keys: 'Esc', action: 'back'}], persist() {}, dispose() {},
      };
      return instance;
    },
  };
}
