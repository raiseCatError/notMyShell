import {safeWelcomeArt} from '../welcome/assets.js';
import {truncateAnsi, stripAnsi} from '../util/text.js';
import {homedir} from 'node:os';
import {getCurrentGlyphMode} from '../ui/glyphs.js';
import {composeWelcome} from '../welcome/compose.js';
import {normalizeWelcomeStudio} from '../welcome/model.js';
import {colorLevel} from '../presentation/capabilities.js';
import type {WelcomeFacts} from '../welcome/compose.js';
import {renderLegacyWelcome, type WelcomeSnapshot, type WelcomeCatFrame} from '../welcome/legacy.js';
export * from '../welcome/legacy.js';
export function renderWelcome(snapshot: WelcomeSnapshot, width: number, frame: WelcomeCatFrame = 'open') {
  if (snapshot.still && !snapshot.studio) return safeWelcomeArt(snapshot.still.slice(0, 40).join('\n')).map(row => {
    const ansi = truncateAnsi(colorLevel() === 'none' ? stripAnsi(row) : row, width);
    return {ansi, plain: stripAnsi(ansi)};
  });
  if (snapshot.captured) return renderLegacyWelcome(snapshot, width, frame);
  return composeWelcome(normalizeWelcomeStudio(snapshot.studio ?? {customized: false}), snapshot.facts ?? {shell: snapshot.shell, version: snapshot.identity.version},
    {columns: width, rows: 40}, {color: colorLevel() !== 'none', level: colorLevel(), home: homedir(), safeGlyphs: getCurrentGlyphMode() === 'safe', legacy: snapshot, catFrame: frame}, 0).rows;
}
