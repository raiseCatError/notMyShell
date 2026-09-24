export type GlyphMode = 'nerd' | 'safe';
export type IconStylePref = 'auto' | 'nerd' | 'safe';

let userPref: IconStylePref = 'nerd';

export function setIconStyle(pref: IconStylePref): void {
  userPref = pref;
}

export function getIconStyle(): IconStylePref {
  return userPref;
}

export function getCurrentGlyphMode(): GlyphMode {
  const envPref = process.env.NMSH_ICONS;
  if (envPref === 'nerd' || envPref === 'safe') return envPref;
  if (userPref === 'nerd' || userPref === 'safe') return userPref;
  return 'nerd'; // auto defaults to fancy
}

export const GLYPHS = {
  get branch() { return getCurrentGlyphMode() === 'nerd' ? '' : 'git:'; },
  get success() { return getCurrentGlyphMode() === 'nerd' ? '✔' : '+'; },
  get failure() { return getCurrentGlyphMode() === 'nerd' ? '✘' : 'x'; },
  get info() { return getCurrentGlyphMode() === 'nerd' ? '⎿' : '>'; },
  get selection() { return getCurrentGlyphMode() === 'nerd' ? '›' : '>'; },
  get jumpDown() { return getCurrentGlyphMode() === 'nerd' ? '↓' : 'v'; },
  get separator() { return getCurrentGlyphMode() === 'nerd' ? '─' : '-'; },
  /** A tiny wedge after the branch when the working tree is clean. */
  get gitClean() { return getCurrentGlyphMode() === 'nerd' ? '\uF054' : '>'; },
  get search() { return getCurrentGlyphMode() === 'nerd' ? '\uF002' : '/'; },
  get prompt() { return getCurrentGlyphMode() === 'nerd' ? '❯' : '>'; },
  // U+E0D7 starts independent segments; U+E0B0 is the only transition/end wedge.
  get powerlineLeading() { return getCurrentGlyphMode() === 'nerd' ? '' : '<'; },
  get powerlineTrailing() { return getCurrentGlyphMode() === 'nerd' ? '' : '>'; },
  /** Outer-left fade: the end fade mirrored so it brightens into the prompt. */
  get powerlineFadeIn() { return getCurrentGlyphMode() === 'nerd' ? '░▒▓' : '==='; },
  get powerlineFade() { return getCurrentGlyphMode() === 'nerd' ? '▓▒░' : '==='; },
};

export const SPINNER_FRAMES = {
  get frames() {
    return getCurrentGlyphMode() === 'nerd' 
      ? ['·', '✢', '✳', '✶', '✻', '*', '✻', '✶', '✳', '✢']
      : ['·', '*', '+', '*', '·', '*', '+', '*'];
  }
};

export type PowerlineShape = 'flat' | 'wedge' | 'rounded' | 'slash' | 'backslash';

/**
 * Cell glyphs per shape: `open` starts a segment over neutral background,
 * `close` ends one, and `join` is a single transition cell (old segment in
 * the foreground, next segment in the background). Slants use the Powerline
 * Extra triangles: U+E0BC/U+E0BA draw `/`, U+E0B8/U+E0BE draw `\`.
 */
export function powerlineShapeGlyphs(shape: PowerlineShape): {open: string; close: string; join: string} {
  const nerd = getCurrentGlyphMode() === 'nerd';
  switch (shape) {
    case 'flat': return {open: '', close: '', join: ''};
    case 'wedge': return nerd ? {open: '\ue0d7', close: '\ue0b0', join: '\ue0b0'} : {open: '<', close: '>', join: '>'};
    case 'rounded': return nerd ? {open: '\ue0b6', close: '\ue0b4', join: '\ue0b4'} : {open: '(', close: ')', join: ')'};
    case 'slash': return nerd ? {open: '\ue0ba', close: '\ue0bc', join: '\ue0bc'} : {open: '/', close: '/', join: '/'};
    case 'backslash': return nerd ? {open: '\ue0be', close: '\ue0b8', join: '\ue0b8'} : {open: '\\', close: '\\', join: '\\'};
  }
}

export type ModuleIconId = 'gitBranch' | 'node' | 'go' | 'python' | 'docker';

/** Nerd Font module icons; empty in safe glyph mode so text stays self-describing. */
export function moduleIcon(id: ModuleIconId): string {
  if (getCurrentGlyphMode() !== 'nerd') return '';
  switch (id) {
    case 'gitBranch': return '\uf418';
    case 'node': return '\ue718';
    case 'go': return '\ue627';
    case 'python': return '\ue606';
    case 'docker': return '\uf308';
  }
}
