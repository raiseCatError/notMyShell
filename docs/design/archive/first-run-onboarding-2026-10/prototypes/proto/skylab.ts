/** Scratch: the real Aurora engine in bands of different heights and moods, for comparison. */
import {BOLD, Canvas, drawCat, drawHorizon, fg, moodPalette, Sky, skyTime, tokens, type Concept, type Env, type Mood, type State} from './kit.js';

const sky = new Sky();
const STARTED = Date.now();

export const skylab: Concept = {
  name: 'Sky lab',
  navigate: () => false,
  frameMs: (_state: State, _now: number, env: Env) => env.reduced ? 0 : 200,
  render(_state: State, width: number, height: number, now: number, env: Env): string[] {
    const canvas = new Canvas(width, height);
    const t = tokens();
    const moods: Mood[] = ['aurora', 'subtle', 'calm'];
    const band = Math.floor((height - moods.length) / moods.length);
    moods.forEach((mood, i) => {
      const top = i * (band + 1);
      const grid = sky.draw(width, band, skyTime(now, STARTED, env), moodPalette(mood, env.config), g => {
        drawCat(g, 4, band - 4, 'idle', true);
        drawHorizon(g, t.accent);
      });
      canvas.grid(0, top, grid);
      canvas.text(22, top + band - 2, ` ${mood} `, `${BOLD}${fg(t.primary)}`);
    });
    return canvas.rows();
  },
};
