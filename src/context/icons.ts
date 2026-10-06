/**
 * Module icons by stable id. NMSh ships no font: it emits code points that a
 * Nerd Font (or, for the two Unicode entries, any common font) draws. In Safe
 * glyph mode and with module icons Off, modules show their text label instead,
 * so meaning never depends on an icon. Packs may reference these ids only.
 *
 * Provenance: code points are those assigned by the Nerd Fonts project
 * (https://www.nerdfonts.com, MIT-licensed patcher) to glyphs from the named
 * icon sets: Octicons (MIT), Devicons (MIT), Seti UI (MIT), Font Awesome 4
 * (SIL OFL 1.1 font, CC BY 4.0 icons), Material Design Icons (Apache 2.0),
 * Font Logos (Unlicense). Product logos (Node.js, Go, Python, Docker,
 * Kubernetes, Rust, Java, Apple, Linux) identify the tool they describe and
 * remain trademarks of their owners; cloud providers use a generic cloud glyph.
 */
export interface ModuleIcon {
  nerd: string;
  source: string;
}

export const MODULE_ICONS = {
  gitBranch: {nerd: '', source: 'Octicons git-branch (nf-oct-git_branch)'},
  node: {nerd: '', source: 'Devicons nodejs_small (nf-dev-nodejs_small)'},
  go: {nerd: '', source: 'Seti go (nf-seti-go)'},
  python: {nerd: '', source: 'Seti python (nf-seti-python)'},
  docker: {nerd: '', source: 'Font Logos docker (nf-linux-docker)'},
  kubernetes: {nerd: '\u{f10fe}', source: 'Material Design kubernetes (nf-md-kubernetes)'},
  shell: {nerd: '', source: 'Octicons terminal (nf-oct-terminal)'},
  package: {nerd: '', source: 'Octicons package (nf-oct-package)'},
  rust: {nerd: '', source: 'Devicons rust (nf-dev-rust)'},
  java: {nerd: '', source: 'Devicons java (nf-dev-java)'},
  code: {nerd: '', source: 'Font Awesome code (nf-fa-code)'},
  tools: {nerd: '', source: 'Octicons tools (nf-oct-tools)'},
  folder: {nerd: '', source: 'Font Awesome folder (nf-fa-folder)'},
  cubes: {nerd: '', source: 'Font Awesome cubes (nf-fa-cubes)'},
  helm: {nerd: '⎈', source: 'Unicode U+2388 HELM SYMBOL'},
  cloud: {nerd: '', source: 'Font Awesome cloud (nf-fa-cloud)'},
  apple: {nerd: '', source: 'Font Awesome apple (nf-fa-apple)'},
  linux: {nerd: '', source: 'Font Awesome linux (nf-fa-linux)'},
  user: {nerd: '', source: 'Font Awesome user (nf-fa-user)'},
  remote: {nerd: '', source: 'Font Awesome globe (nf-fa-globe)'},
  settings: {nerd: '', source: 'Font Awesome cog (nf-fa-cog)'},
  clock: {nerd: '', source: 'Font Awesome clock (nf-fa-clock_o)'},
  hourglass: {nerd: '', source: 'Font Awesome hourglass (nf-fa-hourglass)'},
  battery: {nerd: '', source: 'Font Awesome battery (nf-fa-battery_full)'},
  charging: {nerd: '', source: 'Font Awesome bolt (nf-fa-bolt)'},
  memory: {nerd: '', source: 'Codicons/Nerd memory (as used by the Status Strip)'},
  archive: {nerd: '', source: 'Octicons archive (nf-oct-archive)'},
  upstream: {nerd: '', source: 'Font Awesome arrow-circle-up (nf-fa-arrow_circle_up)'},
  agent: {nerd: '✻', source: 'Unicode U+273B TEARDROP-SPOKED ASTERISK'},
} as const satisfies Record<string, ModuleIcon>;

export type ModuleIconName = keyof typeof MODULE_ICONS;

export function isModuleIcon(id: string): id is ModuleIconName {
  return Object.hasOwn(MODULE_ICONS, id);
}
