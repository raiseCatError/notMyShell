/**
 * Curated third-party theme families for NMSh-owned UI (prompt fills, syntax,
 * chrome accents). Palette values are copied from each project's canonical
 * upstream source under its license; see docs/design/theme-families.md for
 * sources, versions and attribution. Selecting a family themes NMSh only: it
 * never recolors the terminal window, editor or host configuration.
 */

export const CATPPUCCIN_ACCENTS = ['rosewater', 'flamingo', 'pink', 'mauve', 'red', 'maroon', 'peach', 'yellow', 'green', 'teal',
  'sky', 'sapphire', 'blue', 'lavender'] as const;
export type CatppuccinAccent = typeof CATPPUCCIN_ACCENTS[number];
export const CATPPUCCIN_ACCENT_LABELS: Record<CatppuccinAccent, string> = {
  rosewater: 'Rosewater', flamingo: 'Flamingo', pink: 'Pink', mauve: 'Mauve', red: 'Red', maroon: 'Maroon', peach: 'Peach',
  yellow: 'Yellow', green: 'Green', teal: 'Teal', sky: 'Sky', sapphire: 'Sapphire', blue: 'Blue', lavender: 'Lavender',
};

/** Prompt module fills (hex); text on each fill is chosen for contrast. */
export interface FamilyRoles {
  project: string; cwd: string; gitBranch: string; node: string; go: string; python: string;
  docker: string; kubernetes: string; success: string; failure: string;
}

/**
 * NMSh chrome colors for a variant. Text tiers are given only for dark
 * variants: NMSh cannot read the terminal background, so light variants keep
 * NMSh's own text tiers and recolor accents, rules and status only.
 */
export interface FamilyUi {
  accent: string; separator: string; success: string; failure: string;
  primary?: string; secondary?: string; subtle?: string; selection?: string;
}

export interface ThemeVariant {
  id: string;
  family: ThemeFamilyId;
  /** Variant name within the family, e.g. Mocha. */
  variant: string;
  label: string;
  description: string;
  dark: boolean;
  roles: FamilyRoles;
  ui: FamilyUi;
  /** Catppuccin only: the 14 accents of this flavor. */
  accents?: Record<CatppuccinAccent, string>;
}

export type ThemeFamilyId = 'nmsh' | 'catppuccin' | 'dracula' | 'tokyonight' | 'gruvbox' | 'rosepine' | 'nord' | 'solarized' | 'onedark'
  | 'ayu' | 'kanagawa' | 'everforest' | 'flexoki' | 'nightowl' | 'custom';

export interface ThemeFamily {
  id: ThemeFamilyId;
  label: string;
  /** What the family calls its variants ("Flavor", "Variant"). */
  variantLabel: string;
  source?: string;
  license?: string;
}

export const THEME_FAMILIES: readonly ThemeFamily[] = [
  {id: 'nmsh', label: 'NMSh', variantLabel: 'Theme'},
  {id: 'catppuccin', label: 'Catppuccin', variantLabel: 'Flavor', source: 'https://github.com/catppuccin/palette', license: 'MIT'},
  {id: 'dracula', label: 'Dracula', variantLabel: 'Variant', source: 'https://github.com/dracula/spec', license: 'MIT'},
  {id: 'tokyonight', label: 'Tokyo Night', variantLabel: 'Style', source: 'https://github.com/folke/tokyonight.nvim', license: 'Apache-2.0'},
  {id: 'gruvbox', label: 'Gruvbox', variantLabel: 'Variant', source: 'https://github.com/morhetz/gruvbox', license: 'MIT/X11'},
  {id: 'rosepine', label: 'Rosé Pine', variantLabel: 'Variant', source: 'https://github.com/rose-pine/neovim', license: 'MIT'},
  {id: 'nord', label: 'Nord', variantLabel: 'Variant', source: 'https://github.com/nordtheme/nord', license: 'MIT'},
  {id: 'solarized', label: 'Solarized', variantLabel: 'Variant', source: 'https://github.com/altercation/solarized', license: 'MIT'},
  {id: 'onedark', label: 'One Dark', variantLabel: 'Variant', source: 'https://github.com/atom/one-dark-syntax', license: 'MIT'},
  {id: 'ayu', label: 'Ayu', variantLabel: 'Version', source: 'https://github.com/ayu-theme/ayu-colors', license: 'MIT'},
  {id: 'kanagawa', label: 'Kanagawa', variantLabel: 'Theme', source: 'https://github.com/rebelot/kanagawa.nvim', license: 'MIT'},
  {id: 'everforest', label: 'Everforest', variantLabel: 'Variant', source: 'https://github.com/sainnhe/everforest', license: 'MIT'},
  {id: 'flexoki', label: 'Flexoki', variantLabel: 'Variant', source: 'https://github.com/kepano/flexoki', license: 'MIT'},
  {id: 'nightowl', label: 'Night Owl', variantLabel: 'Variant', source: 'https://github.com/sdras/night-owl-vscode-theme', license: 'MIT'},
  {id: 'custom', label: 'Custom', variantLabel: 'Theme'},
];

interface CatppuccinFlavor {
  accents: Record<CatppuccinAccent, string>;
  text: string; subtext1: string; overlay1: string; overlay0: string; surface1: string; surface2: string;
}

// catppuccin/palette palette.json (07d02aa110ef).
const CTP: Record<'latte' | 'frappe' | 'macchiato' | 'mocha', CatppuccinFlavor> = {
  latte: {accents: {rosewater: '#dc8a78', flamingo: '#dd7878', pink: '#ea76cb', mauve: '#8839ef', red: '#d20f39', maroon: '#e64553',
    peach: '#fe640b', yellow: '#df8e1d', green: '#40a02b', teal: '#179299', sky: '#04a5e5', sapphire: '#209fb5', blue: '#1e66f5', lavender: '#7287fd'},
  text: '#4c4f69', subtext1: '#5c5f77', overlay1: '#8c8fa1', overlay0: '#9ca0b0', surface1: '#bcc0cc', surface2: '#acb0be'},
  frappe: {accents: {rosewater: '#f2d5cf', flamingo: '#eebebe', pink: '#f4b8e4', mauve: '#ca9ee6', red: '#e78284', maroon: '#ea999c',
    peach: '#ef9f76', yellow: '#e5c890', green: '#a6d189', teal: '#81c8be', sky: '#99d1db', sapphire: '#85c1dc', blue: '#8caaee', lavender: '#babbf1'},
  text: '#c6d0f5', subtext1: '#b5bfe2', overlay1: '#838ba7', overlay0: '#737994', surface1: '#51576d', surface2: '#626880'},
  macchiato: {accents: {rosewater: '#f4dbd6', flamingo: '#f0c6c6', pink: '#f5bde6', mauve: '#c6a0f6', red: '#ed8796', maroon: '#ee99a0',
    peach: '#f5a97f', yellow: '#eed49f', green: '#a6da95', teal: '#8bd5ca', sky: '#91d7e3', sapphire: '#7dc4e4', blue: '#8aadf4', lavender: '#b7bdf8'},
  text: '#cad3f5', subtext1: '#b8c0e0', overlay1: '#8087a2', overlay0: '#6e738d', surface1: '#494d64', surface2: '#5b6078'},
  mocha: {accents: {rosewater: '#f5e0dc', flamingo: '#f2cdcd', pink: '#f5c2e7', mauve: '#cba6f7', red: '#f38ba8', maroon: '#eba0ac',
    peach: '#fab387', yellow: '#f9e2af', green: '#a6e3a1', teal: '#94e2d5', sky: '#89dceb', sapphire: '#74c7ec', blue: '#89b4fa', lavender: '#b4befe'},
  text: '#cdd6f4', subtext1: '#bac2de', overlay1: '#7f849c', overlay0: '#6c7086', surface1: '#45475a', surface2: '#585b70'},
};

function catppuccin(id: string, variant: string, flavor: CatppuccinFlavor, dark: boolean): ThemeVariant {
  const a = flavor.accents;
  return {id, family: 'catppuccin', variant, label: `Catppuccin ${variant}`, description: `Catppuccin ${variant} with a selectable accent`, dark,
    accents: a,
    roles: {project: a.mauve, cwd: dark ? flavor.surface1 : flavor.surface2, gitBranch: a.sapphire, node: a.green, go: a.sky, python: a.yellow,
      docker: a.blue, kubernetes: a.lavender, success: a.green, failure: a.red},
    ui: {accent: a.mauve, separator: flavor.overlay0, success: a.green, failure: a.red,
      ...(dark ? {primary: flavor.text, secondary: flavor.subtext1, subtle: flavor.overlay1, selection: flavor.surface1} : {})}};
}

/** Every bundled third-party variant, in family order. */
export const THEME_VARIANTS: readonly ThemeVariant[] = [
  catppuccin('catppuccinLatte', 'Latte', CTP.latte, false),
  catppuccin('catppuccinFrappe', 'Frappé', CTP.frappe, true),
  catppuccin('catppuccinMacchiato', 'Macchiato', CTP.macchiato, true),
  catppuccin('catppuccinMocha', 'Mocha', CTP.mocha, true),
  // dracula/spec dracula-spec.md. Alucard is not part of the MIT spec repository and is not bundled.
  {id: 'dracula', family: 'dracula', variant: 'Dracula', label: 'Dracula', description: 'Dracula purple, pink and green', dark: true,
    roles: {project: '#bd93f9', cwd: '#44475a', gitBranch: '#ff79c6', node: '#50fa7b', go: '#8be9fd', python: '#f1fa8c', docker: '#6272a4',
      kubernetes: '#ffb86c', success: '#50fa7b', failure: '#ff5555'},
    ui: {accent: '#bd93f9', separator: '#6272a4', success: '#50fa7b', failure: '#ff5555', primary: '#f8f8f2', secondary: '#d6d6d0', subtle: '#6272a4', selection: '#44475a'}},
  // folke/tokyonight.nvim lua/tokyonight/colors and generated extras (cdc07ac78467).
  {id: 'tokyonightNight', family: 'tokyonight', variant: 'Night', label: 'Tokyo Night', description: 'Tokyo Night, the darkest style', dark: true,
    roles: {project: '#7aa2f7', cwd: '#3b4261', gitBranch: '#bb9af7', node: '#9ece6a', go: '#7dcfff', python: '#e0af68', docker: '#2ac3de',
      kubernetes: '#3d59a1', success: '#73daca', failure: '#f7768e'},
    ui: {accent: '#7aa2f7', separator: '#565f89', success: '#9ece6a', failure: '#f7768e', primary: '#c0caf5', secondary: '#a9b1d6', subtle: '#565f89', selection: '#292e42'}},
  {id: 'tokyonightStorm', family: 'tokyonight', variant: 'Storm', label: 'Tokyo Night Storm', description: 'Tokyo Night on a lighter storm background', dark: true,
    roles: {project: '#7aa2f7', cwd: '#414868', gitBranch: '#bb9af7', node: '#9ece6a', go: '#7dcfff', python: '#e0af68', docker: '#2ac3de',
      kubernetes: '#3d59a1', success: '#73daca', failure: '#f7768e'},
    ui: {accent: '#7aa2f7', separator: '#565f89', success: '#9ece6a', failure: '#f7768e', primary: '#c0caf5', secondary: '#a9b1d6', subtle: '#565f89', selection: '#292e42'}},
  {id: 'tokyonightMoon', family: 'tokyonight', variant: 'Moon', label: 'Tokyo Night Moon', description: 'Tokyo Night Moon, softer and warmer', dark: true,
    roles: {project: '#82aaff', cwd: '#444a73', gitBranch: '#c099ff', node: '#c3e88d', go: '#86e1fc', python: '#ffc777', docker: '#65bcff',
      kubernetes: '#3e68d7', success: '#4fd6be', failure: '#ff757f'},
    ui: {accent: '#82aaff', separator: '#636da6', success: '#c3e88d', failure: '#ff757f', primary: '#c8d3f5', secondary: '#828bb8', subtle: '#636da6', selection: '#2f334d'}},
  {id: 'tokyonightDay', family: 'tokyonight', variant: 'Day', label: 'Tokyo Night Day', description: 'Tokyo Night light style', dark: false,
    roles: {project: '#2e7de9', cwd: '#a8aecb', gitBranch: '#9854f1', node: '#587539', go: '#007197', python: '#8c6c3e', docker: '#188092',
      kubernetes: '#7890dd', success: '#387068', failure: '#f52a65'},
    ui: {accent: '#2e7de9', separator: '#848cb5', success: '#587539', failure: '#f52a65'}},
  // morhetz/gruvbox (MIT/X11). Contrast variants change only the editor background, which NMSh does not paint.
  {id: 'gruvboxDark', family: 'gruvbox', variant: 'Dark', label: 'Gruvbox Dark', description: 'retro groove, warm and earthy', dark: true,
    roles: {project: '#d79921', cwd: '#504945', gitBranch: '#689d6a', node: '#98971a', go: '#458588', python: '#fabd2f', docker: '#83a598',
      kubernetes: '#b16286', success: '#b8bb26', failure: '#fb4934'},
    ui: {accent: '#fabd2f', separator: '#665c54', success: '#b8bb26', failure: '#fb4934', primary: '#ebdbb2', secondary: '#d5c4a1', subtle: '#928374', selection: '#504945'}},
  {id: 'gruvboxLight', family: 'gruvbox', variant: 'Light', label: 'Gruvbox Light', description: 'retro groove light', dark: false,
    roles: {project: '#b57614', cwd: '#d5c4a1', gitBranch: '#427b58', node: '#79740e', go: '#076678', python: '#d79921', docker: '#458588',
      kubernetes: '#8f3f71', success: '#79740e', failure: '#9d0006'},
    ui: {accent: '#af3a03', separator: '#a89984', success: '#79740e', failure: '#9d0006'}},
  // rose-pine/neovim lua/rose-pine/palette.lua (ff483051a47e).
  {id: 'rosePine', family: 'rosepine', variant: 'Main', label: 'Rosé Pine', description: 'soho vibes: iris, rose and foam', dark: true,
    roles: {project: '#c4a7e7', cwd: '#403d52', gitBranch: '#ebbcba', node: '#31748f', go: '#9ccfd8', python: '#f6c177', docker: '#524f67',
      kubernetes: '#908caa', success: '#31748f', failure: '#eb6f92'},
    ui: {accent: '#c4a7e7', separator: '#6e6a86', success: '#9ccfd8', failure: '#eb6f92', primary: '#e0def4', secondary: '#908caa', subtle: '#6e6a86', selection: '#403d52'}},
  {id: 'rosePineMoon', family: 'rosepine', variant: 'Moon', label: 'Rosé Pine Moon', description: 'Rosé Pine on a lighter moon base', dark: true,
    roles: {project: '#c4a7e7', cwd: '#44415a', gitBranch: '#ea9a97', node: '#3e8fb0', go: '#9ccfd8', python: '#f6c177', docker: '#56526e',
      kubernetes: '#908caa', success: '#3e8fb0', failure: '#eb6f92'},
    ui: {accent: '#c4a7e7', separator: '#6e6a86', success: '#9ccfd8', failure: '#eb6f92', primary: '#e0def4', secondary: '#908caa', subtle: '#6e6a86', selection: '#44415a'}},
  {id: 'rosePineDawn', family: 'rosepine', variant: 'Dawn', label: 'Rosé Pine Dawn', description: 'Rosé Pine light', dark: false,
    roles: {project: '#907aa9', cwd: '#cecacd', gitBranch: '#d7827e', node: '#286983', go: '#56949f', python: '#ea9d34', docker: '#797593',
      kubernetes: '#9893a5', success: '#286983', failure: '#b4637a'},
    ui: {accent: '#907aa9', separator: '#9893a5', success: '#56949f', failure: '#b4637a'}},
  // nordtheme/nord src/nord.css.
  {id: 'nord', family: 'nord', variant: 'Nord', label: 'Nord', description: 'arctic, north-bluish frost and aurora', dark: true,
    roles: {project: '#88c0d0', cwd: '#4c566a', gitBranch: '#5e81ac', node: '#a3be8c', go: '#8fbcbb', python: '#ebcb8b', docker: '#81a1c1',
      kubernetes: '#b48ead', success: '#a3be8c', failure: '#bf616a'},
    ui: {accent: '#88c0d0', separator: '#4c566a', success: '#a3be8c', failure: '#bf616a', primary: '#eceff4', secondary: '#d8dee9', subtle: '#7b88a1', selection: '#434c5e'}},
  // altercation/solarized README.
  {id: 'solarizedDark', family: 'solarized', variant: 'Dark', label: 'Solarized Dark', description: 'precision colors on base03', dark: true,
    roles: {project: '#268bd2', cwd: '#586e75', gitBranch: '#6c71c4', node: '#859900', go: '#2aa198', python: '#b58900', docker: '#d33682',
      kubernetes: '#cb4b16', success: '#859900', failure: '#dc322f'},
    ui: {accent: '#268bd2', separator: '#586e75', success: '#859900', failure: '#dc322f', primary: '#93a1a1', secondary: '#839496', subtle: '#586e75', selection: '#073642'}},
  {id: 'solarizedLight', family: 'solarized', variant: 'Light', label: 'Solarized Light', description: 'precision colors on base3', dark: false,
    roles: {project: '#268bd2', cwd: '#eee8d5', gitBranch: '#6c71c4', node: '#859900', go: '#2aa198', python: '#b58900', docker: '#d33682',
      kubernetes: '#cb4b16', success: '#859900', failure: '#dc322f'},
    ui: {accent: '#268bd2', separator: '#93a1a1', success: '#859900', failure: '#dc322f'}},
  // atom/one-dark-syntax and one-light-syntax styles/colors.less (HSL converted to hex).
  {id: 'oneDark', family: 'onedark', variant: 'Dark', label: 'One Dark', description: 'Atom One Dark', dark: true,
    roles: {project: '#61afef', cwd: '#4b5263', gitBranch: '#c678dd', node: '#98c379', go: '#56b6c2', python: '#e5c07b', docker: '#d19a66',
      kubernetes: '#5c6370', success: '#98c379', failure: '#e06c75'},
    ui: {accent: '#61afef', separator: '#5c6370', success: '#98c379', failure: '#e06c75', primary: '#abb2bf', secondary: '#9da5b4', subtle: '#5c6370', selection: '#3e4451'}},
  {id: 'oneLight', family: 'onedark', variant: 'Light', label: 'One Light', description: 'Atom One Light', dark: false,
    roles: {project: '#4078f2', cwd: '#d4d4d6', gitBranch: '#a626a4', node: '#50a14f', go: '#0184bc', python: '#c18401', docker: '#986801',
      kubernetes: '#a0a1a7', success: '#50a14f', failure: '#e45649'},
    ui: {accent: '#4078f2', separator: '#a0a1a7', success: '#50a14f', failure: '#e45649'}},
  // ayu-theme/ayu-colors themes/{dark,mirage,light}.yaml (d461f029): the palette's base colors, editor and UI
  // foregrounds, panel background and accent tint as written; syntax tones derived from them are not used.
  {id: 'ayuDark', family: 'ayu', variant: 'Dark', label: 'Ayu Dark', description: 'Ayu Dark, warm accents on near black', dark: true,
    roles: {project: '#e6b450', cwd: '#5a6673', gitBranch: '#d2a6ff', node: '#aad94c', go: '#95e6cb', python: '#e6c08a', docker: '#59c2ff',
      kubernetes: '#39bae6', success: '#aad94c', failure: '#f07178'},
    ui: {accent: '#e6b450', separator: '#5a6378', success: '#aad94c', failure: '#d95757', primary: '#bfbdb6', secondary: '#bfbdb6', subtle: '#5a6378', selection: '#141821'}},
  {id: 'ayuMirage', family: 'ayu', variant: 'Mirage', label: 'Ayu Mirage', description: 'Ayu Mirage, softer on blue-gray', dark: true,
    roles: {project: '#ffcc66', cwd: '#6e7c8f', gitBranch: '#dfbfff', node: '#d5ff80', go: '#95e6cb', python: '#d9be98', docker: '#73d0ff',
      kubernetes: '#5ccfe6', success: '#d5ff80', failure: '#f28779'},
    ui: {accent: '#ffcc66', separator: '#707a8c', success: '#d5ff80', failure: '#ff6666', primary: '#cccac2', secondary: '#cccac2', subtle: '#707a8c', selection: '#282e3b'}},
  {id: 'ayuLight', family: 'ayu', variant: 'Light', label: 'Ayu Light', description: 'Ayu Light, bright and clear', dark: false,
    roles: {project: '#f29718', cwd: '#adaeb1', gitBranch: '#a37acc', node: '#86b300', go: '#4cbf99', python: '#eba400', docker: '#22a4e6',
      kubernetes: '#55b4d4', success: '#86b300', failure: '#f07171'},
    ui: {accent: '#f29718', separator: '#828e9f', success: '#86b300', failure: '#e65050'}},
  // rebelot/kanagawa.nvim lua/kanagawa/colors.lua and themes.lua (bb85e4bf): each theme's own role colors
  // (fun, keyword, string, type, identifier, bg_p2, nontext, comment, bg_visual, ok, error).
  {id: 'kanagawaWave', family: 'kanagawa', variant: 'Wave', label: 'Kanagawa Wave', description: 'Kanagawa Wave, ink and wave blue', dark: true,
    roles: {project: '#7e9cd8', cwd: '#363646', gitBranch: '#957fb8', node: '#98bb6c', go: '#7aa89f', python: '#e6c384', docker: '#7fb4ca',
      kubernetes: '#d27e99', success: '#98bb6c', failure: '#e82424'},
    ui: {accent: '#7e9cd8', separator: '#54546d', success: '#98bb6c', failure: '#e82424', primary: '#dcd7ba', secondary: '#c8c093', subtle: '#727169', selection: '#223249'}},
  {id: 'kanagawaDragon', family: 'kanagawa', variant: 'Dragon', label: 'Kanagawa Dragon', description: 'Kanagawa Dragon, dark and muted', dark: true,
    roles: {project: '#8ba4b0', cwd: '#393836', gitBranch: '#8992a7', node: '#8a9a7b', go: '#8ea4a2', python: '#c4b28a', docker: '#658594',
      kubernetes: '#a292a3', success: '#98bb6c', failure: '#e82424'},
    ui: {accent: '#8ba4b0', separator: '#625e5a', success: '#98bb6c', failure: '#e82424', primary: '#c5c9c5', secondary: '#c8c093', subtle: '#737c73', selection: '#223249'}},
  {id: 'kanagawaLotus', family: 'kanagawa', variant: 'Lotus', label: 'Kanagawa Lotus', description: 'Kanagawa Lotus, the light theme', dark: false,
    roles: {project: '#4d699b', cwd: '#e4d794', gitBranch: '#624c83', node: '#6f894e', go: '#597b75', python: '#77713f', docker: '#6693bf',
      kubernetes: '#b35b79', success: '#6f894e', failure: '#e82424'},
    ui: {accent: '#4d699b', separator: '#a09cac', success: '#6f894e', failure: '#e82424'}},
  // sainnhe/everforest palette.md (85a86eb6), medium contrast: backgrounds by position (bg0…bg5), accents, greys.
  // Soft and hard change only the editor background, which NMSh does not paint.
  {id: 'everforestDark', family: 'everforest', variant: 'Dark', label: 'Everforest Dark', description: 'Everforest Dark, green-based and calm', dark: true,
    roles: {project: '#a7c080', cwd: '#475258', gitBranch: '#d699b6', node: '#83c092', go: '#7fbbb3', python: '#dbbc7f', docker: '#7fbbb3',
      kubernetes: '#e69875', success: '#a7c080', failure: '#e67e80'},
    ui: {accent: '#a7c080', separator: '#7a8478', success: '#a7c080', failure: '#e67e80', primary: '#d3c6aa', secondary: '#9da9a0', subtle: '#7a8478', selection: '#3d484d'}},
  {id: 'everforestLight', family: 'everforest', variant: 'Light', label: 'Everforest Light', description: 'Everforest Light, warm paper', dark: false,
    roles: {project: '#8da101', cwd: '#bdc3af', gitBranch: '#df69ba', node: '#35a77c', go: '#3a94c5', python: '#dfa000', docker: '#3a94c5',
      kubernetes: '#f57d26', success: '#8da101', failure: '#f85552'},
    ui: {accent: '#8da101', separator: '#a6b0a0', success: '#8da101', failure: '#f85552'}},
  // kepano/flexoki README (8d723bac): dark uses the 400 accents and base tiers (tx base-200, tx-2 base-500,
  // tx-3 base-700, ui-2 base-850, ui-3 base-800); light uses the 600 accents (ui-3 base-200, tx-3 base-300).
  {id: 'flexokiDark', family: 'flexoki', variant: 'Dark', label: 'Flexoki Dark', description: 'Flexoki Dark, inky and warm', dark: true,
    roles: {project: '#4385be', cwd: '#403e3c', gitBranch: '#8b7ec8', node: '#879a39', go: '#3aa99f', python: '#d0a215', docker: '#da702c',
      kubernetes: '#ce5d97', success: '#879a39', failure: '#d14d41'},
    ui: {accent: '#4385be', separator: '#575653', success: '#879a39', failure: '#d14d41', primary: '#cecdc3', secondary: '#878580', subtle: '#575653', selection: '#343331'}},
  {id: 'flexokiLight', family: 'flexoki', variant: 'Light', label: 'Flexoki Light', description: 'Flexoki Light, paper and ink', dark: false,
    roles: {project: '#205ea6', cwd: '#cecdc3', gitBranch: '#5e409d', node: '#66800b', go: '#24837b', python: '#ad8301', docker: '#bc5215',
      kubernetes: '#a02f6f', success: '#66800b', failure: '#af3029'},
    ui: {accent: '#205ea6', separator: '#b7b5ac', success: '#66800b', failure: '#af3029'}},
  // sdras/night-owl-vscode-theme themes/Night Owl-color-theme.json and Night Owl-Light-color-theme.json (cc291eba):
  // editor, selection, line-number and terminal ANSI colors, and the comment token color.
  {id: 'nightOwl', family: 'nightowl', variant: 'Night Owl', label: 'Night Owl', description: 'Night Owl, for night owls', dark: true,
    roles: {project: '#82aaff', cwd: '#1d3b53', gitBranch: '#c792ea', node: '#22da6e', go: '#7fdbca', python: '#ffeb95', docker: '#21c7a8',
      kubernetes: '#f78c6c', success: '#22da6e', failure: '#ef5350'},
    ui: {accent: '#82aaff', separator: '#4b6479', success: '#22da6e', failure: '#ef5350', primary: '#d6deeb', secondary: '#d6deeb', subtle: '#637777', selection: '#1d3b53'}},
  {id: 'nightOwlLight', family: 'nightowl', variant: 'Light Owl', label: 'Light Owl', description: 'Night Owl\'s light theme', dark: false,
    roles: {project: '#288ed7', cwd: '#e0e0e0', gitBranch: '#d6438a', node: '#08916a', go: '#2aa298', python: '#e0af02', docker: '#288ed7',
      kubernetes: '#d6438a', success: '#08916a', failure: '#de3d3b'},
    ui: {accent: '#288ed7', separator: '#90a7b2', success: '#08916a', failure: '#e64d49'}},
];

export function themeVariant(id: string): ThemeVariant | undefined {
  return THEME_VARIANTS.find(variant => variant.id === id);
}

export function familyVariants(family: ThemeFamilyId): ThemeVariant[] {
  return THEME_VARIANTS.filter(variant => variant.family === family);
}

export function normalizeCatppuccinAccent(value: unknown): CatppuccinAccent {
  return CATPPUCCIN_ACCENTS.includes(value as CatppuccinAccent) ? value as CatppuccinAccent : 'mauve';
}

/** A variant's roles and UI with the chosen accent applied (Catppuccin only; others ignore it). */
export function accentedVariant(variant: ThemeVariant, accent: CatppuccinAccent): ThemeVariant {
  if (!variant.accents || accent === 'mauve') return variant;
  const color = variant.accents[accent];
  // A project fill equal to another module's would hide the boundary; that module keeps mauve.
  const swap = (value: string) => value === color ? variant.accents!.mauve : value;
  // Status fills keep their meaning whatever the accent is.
  const roles = Object.fromEntries(Object.entries(variant.roles).map(([role, value]) => [role,
    role === 'project' ? color : role === 'success' || role === 'failure' ? value : swap(value)])) as unknown as FamilyRoles;
  return {...variant, roles, ui: {...variant.ui, accent: color}};
}
