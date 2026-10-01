import {resolveCommand, type ProviderDescriptor, type ProviderInstall, type ProviderFamily} from '../providers/providers.js';

export const TOOL_CATEGORIES = ['Search & Files', 'Git & Development', 'Navigation & History',
  'Data / Structured Text', 'Environment & Secrets', 'Shell / Workflow', 'Containers / Infrastructure', 'Project / Language Tooling'] as const;
export interface Tool extends ProviderDescriptor {
  category: typeof TOOL_CATEGORIES[number];
  recommended?: boolean;
  package: string;
  source: string;
  providerFamily?: ProviderFamily;
  configuration?: 'starship';
  language?: string;
}

function tool(id: string, label: string, category: Tool['category'], description: string,
  source: string, options: Partial<Tool> = {}): Tool {
  return {id, label, category, description, source, package: id, kind: 'external', family: 'tool',
    executable: id, versionArgs: ['--version'], ...options};
}

/** Curated offline metadata. No third-party submissions, update checks or marketplace. */
export const TOOLS: readonly Tool[] = [
  tool('rg', 'ripgrep', 'Search & Files', 'Fast recursive text search.', 'https://github.com/BurntSushi/ripgrep', {package: 'ripgrep', recommended: true}),
  tool('fd', 'fd', 'Search & Files', 'Simple file discovery.', 'https://github.com/sharkdp/fd', {recommended: true}),
  tool('fzf', 'fzf', 'Search & Files', 'Optional interactive supplied-candidate picker.', 'https://github.com/junegunn/fzf', {recommended: true, providerFamily: 'picker'}),
  tool('bat', 'bat', 'Search & Files', 'File viewing with syntax colors.', 'https://github.com/sharkdp/bat'),
  tool('eza', 'eza', 'Search & Files', 'Optional directory listing.', 'https://github.com/eza-community/eza'),
  tool('gh', 'GitHub CLI', 'Git & Development', 'GitHub workflows; authentication is managed by gh.', 'https://cli.github.com/'),
  tool('lazygit', 'lazygit', 'Git & Development', 'Interactive Git frontend.', 'https://github.com/jesseduffield/lazygit'),
  tool('delta', 'delta', 'Git & Development', 'Optional Git diff presentation.', 'https://github.com/dandavison/delta', {package: 'git-delta'}),
  tool('zoxide', 'zoxide', 'Navigation & History', 'Optional directory ranking; existing hooks stay unchanged.', 'https://github.com/ajeetdsouza/zoxide', {recommended: true, providerFamily: 'navigation'}),
  tool('atuin', 'Atuin', 'Navigation & History', 'Optional local history provider; no sync or hook setup.', 'https://atuin.sh/', {providerFamily: 'history'}),
  tool('jq', 'jq', 'Data / Structured Text', 'Read and transform JSON.', 'https://jqlang.org/', {recommended: true}),
  tool('yq', 'yq', 'Data / Structured Text', 'Structured text tooling; multiple yq implementations exist.', 'https://github.com/mikefarah/yq'),
  tool('direnv', 'direnv', 'Environment & Secrets', 'Project environment tooling; approval/hooks remain yours.', 'https://direnv.net/'),
  tool('pass', 'pass', 'Environment & Secrets', 'Password tooling; NMSh does not read its secret store.', 'https://www.passwordstore.org/', {versionArgs: undefined}),
  tool('starship', 'Starship', 'Shell / Workflow', 'Optional prompt with supported module configuration.', 'https://starship.rs/', {configuration: 'starship'}),
  tool('fastfetch', 'Fastfetch', 'Shell / Workflow', 'Optional startup welcome capture.', 'https://github.com/fastfetch-cli/fastfetch', {providerFamily: 'welcome'}),
  tool('stow', 'GNU Stow', 'Shell / Workflow', 'Explicitly managed dotfile symlinks.', 'https://www.gnu.org/software/stow/'),
  tool('tmux', 'tmux', 'Shell / Workflow', 'Independent terminal multiplexer.', 'https://github.com/tmux/tmux', {versionArgs: ['-V']}),
  tool('docker', 'Docker CLI', 'Containers / Infrastructure', 'Container client; daemon availability is not inferred.', 'https://docs.docker.com/', {package: 'docker'}),
  tool('kubectl', 'kubectl', 'Containers / Infrastructure', 'Kubernetes client; credentials/cluster are not inspected.', 'https://kubernetes.io/docs/reference/kubectl/', {versionArgs: undefined, package: 'kubernetes-cli'}),
  tool('mise', 'mise', 'Project / Language Tooling', 'Optional project tooling; metadata evaluation needs consent.', 'https://mise.jdx.dev/'),
  tool('node', 'Node.js', 'Project / Language Tooling', 'JavaScript runtime.', 'https://nodejs.org/', {language: 'JavaScript'}),
  tool('go', 'Go', 'Project / Language Tooling', 'Go language toolchain.', 'https://go.dev/', {language: 'Go', versionArgs: ['version']}),
  tool('python3', 'Python', 'Project / Language Tooling', 'Python runtime.', 'https://www.python.org/', {language: 'Python', package: 'python'}),
];

/** No sudo, install scripts, custom taps, interpolation or automatic fallback. */
export function toolInstall(tool: Tool, hasBrew = resolveCommand('brew') !== undefined): ProviderInstall | undefined {
  if (!hasBrew) return undefined;
  return {label: `brew install ${tool.package}`, command: 'brew', args: ['install', tool.package]};
}
