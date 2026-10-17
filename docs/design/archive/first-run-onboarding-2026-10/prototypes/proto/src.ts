/**
 * Real NMSh modules for the archived prototypes, loaded from the checkout named
 * by NMSH_SRC (pinned to 13a47f8 by tools/prepare-pinned-checkout.sh). The
 * original working copy imported the same modules from absolute worktree paths;
 * that is the only functional difference. Prototype code, never part of the product.
 */
const root = process.env.NMSH_SRC?.replace(/\/+$/u, '');
if (!root) throw new Error('Set NMSH_SRC to a notMyShell checkout at 13a47f8 (see the archive README).');
const load = (path: string) => import(`${root}/src/${path}`);

export const {CellGrid, mixPacked, pack, unpack, luminance: packedLuminance, NO_COLOR_VALUE} = await load('idle/CellGrid.js');
export const {renderScene, idlePalette} = await load('idle/scenes.js');
export const {IDLE_SEED, idleStops} = await load('idle/IdleVisuals.js');
export const {catCells, CAT_CELL_WIDTH, CAT_CELL_HEIGHT} = await load('idle/catSprite.js');
export const {renderWelcome} = await load('output/Welcome.js');
export const {buildContextLine, buildInlineContextPrefix, buildThemePreviewLine, themePreviewContext, themeChromaStops, setThemeContext} = await load('prompt/prompt.js');
export const {DEFAULT_PROMPT_CONFIGURATION, minimalPromptConfiguration} = await load('prompt/configuration.js');
export const {UI_COLORS} = await load('ui/palette.js');
export const {applyUiTheme, uiColorsFor} = await load('appearance/uiTheme.js');
export const {resolveChrome} = await load('appearance/uiChrome.js');
export const {GLYPHS, setIconStyle, powerlineShapeGlyphs, getCurrentGlyphMode} = await load('ui/glyphs.js');
export const {displayWidth, stripAnsi} = await load('util/text.js');
export const {graphemes} = await load('input/inputLayout.js');
export const {AnsiOutputParser} = await load('output/AnsiOutputParser.js');
export const {currentBackground} = await load('presentation/cellOverlay.js');
export const {colorEscape} = await load('chroma/escape.js');
export const {mixRgb} = await load('chroma/chroma.js');
export const {fromOklch, toOklch, mixOklch, contrastRatio} = await load('chroma/color.js');
export const {colorLevel} = await load('presentation/capabilities.js');
export const {setActiveThemeStops, PRESET_STOPS} = await load('chroma/treatment.js');
export const {TerminalRenderer} = await load('terminal/TerminalRenderer.js');
export const {KeyDecoder} = await load('terminal/keys.js');
export const {resolveHostCapabilities} = await load('host/capabilities.js');
export const {presentationClock} = await load('motion/PresentationClock.js');
export const {sweepAnsiRow} = await load('motion/lightSweep.js');
export const {SETUP_SECTIONS} = await load('setup/SetupCat.js');

/* The prototypes import these names as types only; tsx erases them, the aliases keep editors quiet. */
/* eslint-disable @typescript-eslint/no-explicit-any */
export type IdlePalette = any; export type CatPose = any; export type PromptConfiguration = any; export type NativePaletteId = any;
export type Rgb = any; export type ColorLevel = any; export type Key = any; export type SweepStyle = any;
