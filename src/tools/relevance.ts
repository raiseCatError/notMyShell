import {existsSync, readdirSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {homedir} from 'node:os';

/**
 * Cheap, safe facts about the current directory for "Relevant here" in /tools.
 * Only existence checks of well-known names and one bounded top-level listing:
 * no recursion, no file contents, no project code, no network, no model.
 * Context names match `Tool.relevantTo` in the catalog.
 */
export type ToolContext = 'git' | 'shell-scripts' | 'javascript' | 'kubernetes' | 'python' | 'go' | 'rust' | 'containers' | 'project';

export interface RelevanceProbe {
  exists(path: string): boolean;
  /** Names directly inside one directory, bounded; never recursive. */
  list(path: string): string[];
  env: NodeJS.ProcessEnv;
  home: string;
}

export function systemRelevanceProbe(env: NodeJS.ProcessEnv = process.env): RelevanceProbe {
  return {exists: existsSync, env, home: homedir(),
    list: path => { try { return readdirSync(path).slice(0, 400); } catch { return []; } }};
}

const GIT_PARENT_LIMIT = 8;
const KUBERNETES_FILES = ['Chart.yaml', 'kustomization.yaml', 'kustomization.yml', 'skaffold.yaml', 'k8s', 'kubernetes'];
const CONTAINER_FILES = ['Dockerfile', 'Containerfile', 'compose.yaml', 'compose.yml', 'docker-compose.yml', 'docker-compose.yaml'];

export function detectToolContexts(cwd: string, probe: RelevanceProbe = systemRelevanceProbe()): ToolContext[] {
  const found = new Set<ToolContext>();
  const has = (name: string) => probe.exists(join(cwd, name));
  // A Git work tree: .git here or in a bounded number of parents.
  for (let dir = cwd, depth = 0; depth <= GIT_PARENT_LIMIT; depth += 1) {
    if (probe.exists(join(dir, '.git'))) { found.add('git'); break; }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  const names = probe.list(cwd);
  if (names.some(name => /\.(?:sh|bash|zsh)$/u.test(name))) found.add('shell-scripts');
  if (has('package.json')) { found.add('javascript'); found.add('project'); }
  if (has('pyproject.toml') || has('requirements.txt')) { found.add('python'); found.add('project'); }
  if (has('go.mod')) { found.add('go'); found.add('project'); }
  if (has('Cargo.toml')) { found.add('rust'); found.add('project'); }
  if (has('Makefile') || has('justfile') || has('Justfile')) found.add('project');
  if (CONTAINER_FILES.some(has)) found.add('containers');
  // Kubernetes: manifest-ish project files, or an explicit kubeconfig the user already set up. No cluster contact.
  if (KUBERNETES_FILES.some(has) || probe.env.KUBECONFIG || probe.exists(join(probe.home, '.kube', 'config'))) found.add('kubernetes');
  return [...found];
}

export const CONTEXT_LABELS: Record<ToolContext, string> = {
  git: 'Git repository', 'shell-scripts': 'shell scripts', javascript: 'JavaScript / Node project', kubernetes: 'Kubernetes files or kubeconfig',
  python: 'Python project', go: 'Go module', rust: 'Rust crate', containers: 'container files', project: 'project'};

interface RelevantCandidate {id: string; relevantTo?: readonly string[]; tier?: string; legacy?: boolean; integration?: string; providerFamily?: string; language?: string}

/**
 * Curated, conservative: a tool qualifies only through its own declared
 * `relevantTo`. The broad 'project' context alone never qualifies a tool, so
 * generic helpers don't appear in every directory. Missing tools in the
 * Recommended/Enhanced tiers rank first; installed and environment tools are
 * excluded because there is nothing to discover.
 */
export function relevantTools<T extends RelevantCandidate>(tools: readonly T[], contexts: readonly ToolContext[],
  isMissing: (tool: T) => boolean, limit = 6): Array<{tool: T; because: ToolContext}> {
  const specific = contexts.filter(context => context !== 'project');
  const rank = (tool: T) => tool.tier === 'recommended' ? 0 : tool.tier === 'enhanced' ? 1 : 2;
  return tools
    .filter(tool => !tool.legacy && !tool.integration && !tool.providerFamily && !tool.language && isMissing(tool))
    .flatMap(tool => {
      const because = specific.find(context => tool.relevantTo?.includes(context));
      return because ? [{tool, because}] : [];
    })
    .sort((a, b) => rank(a.tool) - rank(b.tool))
    .slice(0, limit);
}
