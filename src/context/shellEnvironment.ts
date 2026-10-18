/**
 * The live shell's context-relevant environment, reported through the existing
 * private knowledge snapshot each prompt cycle.
 *
 * NMSh's frontend process environment is not the shell's: `export AWS_PROFILE=dev`
 * or activating a virtualenv happens inside the persistent shell. Context facts
 * must describe that shell, so each adapter's prompt hook writes a narrow,
 * allowlisted set of variables next to its alias/function names:
 *
 *   envsnapshot 1           the shell supports the snapshot (absence now means unset)
 *   env NAME=VALUE          an allowlisted, non-secret value (bounded, no controls)
 *   envset NAME             presence only; the value is never read or written
 *
 * Nothing else from the environment leaves the shell. Secret-bearing variables
 * are presence-only, so NMSh can say "credentials in environment" without ever
 * seeing them. Names are fixed constants (never user data), so generating the
 * shell code below interpolates no untrusted text.
 */

/** Values the shell may report, each with its maximum length in characters. */
export const CONTEXT_ENV_VALUES: Readonly<Record<string, number>> = {
  // Executable identity resolution (inspected, never executed blindly).
  PATH: 8192,
  // AWS: selection and expiry metadata only.
  AWS_PROFILE: 128, AWS_DEFAULT_PROFILE: 128, AWS_REGION: 64, AWS_DEFAULT_REGION: 64,
  AWS_CONFIG_FILE: 1024, AWS_SHARED_CREDENTIALS_FILE: 1024, AWS_VAULT: 128,
  AWS_CREDENTIAL_EXPIRATION: 64, AWS_SESSION_EXPIRATION: 64,
  // Google Cloud and Azure CLI configuration selection.
  CLOUDSDK_CONFIG: 1024, CLOUDSDK_ACTIVE_CONFIG_NAME: 128, CLOUDSDK_CORE_PROJECT: 128, CLOUDSDK_COMPUTE_REGION: 64,
  AZURE_CONFIG_DIR: 1024,
  // Kubernetes and containers.
  KUBECONFIG: 4096, DOCKER_CONTEXT: 128, DOCKER_HOST: 256, DOCKER_CONFIG: 1024,
  // Infrastructure as code.
  TF_WORKSPACE: 128, TF_DATA_DIR: 1024, PULUMI_HOME: 1024,
  // Language environments and version managers.
  VIRTUAL_ENV: 1024, VIRTUAL_ENV_PROMPT: 128, CONDA_DEFAULT_ENV: 128, CONDA_PREFIX: 1024,
  PYENV_VERSION: 64, POETRY_ACTIVE: 8, PIPENV_ACTIVE: 8,
  RUSTUP_TOOLCHAIN: 128, RUSTUP_HOME: 1024, JAVA_HOME: 1024, RBENV_VERSION: 64, NODENV_VERSION: 64,
  MISE_ENV: 64, MISE_DATA_DIR: 1024, ASDF_DATA_DIR: 1024,
  // direnv's own bookkeeping says what it loaded; NMSh never runs direnv.
  DIRENV_DIR: 1024, DIRENV_FILE: 1024,
};

/** Reported as present or absent only; values are never read by the snapshot code. */
export const CONTEXT_ENV_PRESENCE: readonly string[] = [
  'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN', 'AWS_WEB_IDENTITY_TOKEN_FILE',
  'GOOGLE_APPLICATION_CREDENTIALS', 'AZURE_CLIENT_SECRET', 'MISE_SHELL', 'DIRENV_DIFF',
  // Remote session evidence: whether, never from where.
  'SSH_CONNECTION', 'SSH_CLIENT', 'SSH_TTY',
];

export const CONTEXT_ENV_NAMES: readonly string[] = [...Object.keys(CONTEXT_ENV_VALUES), ...CONTEXT_ENV_PRESENCE];

export interface ShellEnvironment {
  readonly values: Readonly<Record<string, string>>;
  readonly present: ReadonlySet<string>;
  /** `shell`: the live shell reported it; `frontend`: an older shell bootstrap, so NMSh's own launch environment stands in. */
  readonly source: 'shell' | 'frontend' | 'none';
}

export const EMPTY_SHELL_ENVIRONMENT: ShellEnvironment = {values: {}, present: new Set(), source: 'none'};

const CONTROL = /[\u0000-\u001f\u007f-\u009f]/u;

/** Bounded, allowlisted, control-free: anything else in the knowledge text is ignored. */
export function parseShellEnvironment(knowledge: string | undefined): ShellEnvironment | undefined {
  if (!knowledge || !/^envsnapshot 1$/mu.test(knowledge)) return undefined;
  const values: Record<string, string> = {};
  const present = new Set<string>();
  for (const line of knowledge.split('\n').slice(0, 512)) {
    const set = /^envset ([A-Z_][A-Z0-9_]{0,63})$/u.exec(line);
    if (set) {
      if (CONTEXT_ENV_PRESENCE.includes(set[1]!)) present.add(set[1]!);
      continue;
    }
    const match = /^env ([A-Z_][A-Z0-9_]{0,63})=(.*)$/u.exec(line);
    if (!match) continue;
    const [, name, value] = match as unknown as [string, string, string];
    const limit = CONTEXT_ENV_VALUES[name];
    if (limit === undefined || !value || value.length > limit || CONTROL.test(value)) continue;
    values[name] = value;
    present.add(name);
  }
  return {values, present, source: 'shell'};
}

/** The documented fallback when the shell cannot report: NMSh's own launch environment, through the same allowlist. */
export function frontendEnvironment(env: NodeJS.ProcessEnv = process.env): ShellEnvironment {
  const values: Record<string, string> = {};
  const present = new Set<string>();
  for (const [name, limit] of Object.entries(CONTEXT_ENV_VALUES)) {
    const value = env[name];
    if (value && value.length <= limit && !CONTROL.test(value)) { values[name] = value; present.add(name); }
  }
  for (const name of CONTEXT_ENV_PRESENCE) if (env[name]) present.add(name);
  return {values, present, source: 'frontend'};
}

/** Restrict a snapshot to declared names: a capability can only see what it declared. */
export function restrictEnvironment(environment: ShellEnvironment, names: readonly string[]): ShellEnvironment {
  const values: Record<string, string> = {};
  const present = new Set<string>();
  for (const name of names) {
    if (environment.values[name] !== undefined) values[name] = environment.values[name]!;
    if (environment.present.has(name)) present.add(name);
  }
  return {values, present, source: environment.source};
}

/** Stable cache-key fragment for the declared names. */
export function environmentKey(environment: ShellEnvironment, names: readonly string[]): string {
  return names.map(name => `${name}=${environment.values[name] ?? ''}${environment.present.has(name) ? '+' : '-'}`).join('\u0001');
}

export function sameEnvironment(a: ShellEnvironment, b: ShellEnvironment): boolean {
  return a.source === b.source && environmentKey(a, CONTEXT_ENV_NAMES) === environmentKey(b, CONTEXT_ENV_NAMES);
}

const VALUE_NAMES = Object.keys(CONTEXT_ENV_VALUES).join(' ');
const PRESENCE_NAMES = CONTEXT_ENV_PRESENCE.join(' ');
const LIMITS = Object.entries(CONTEXT_ENV_VALUES);

/** zsh: inside the knowledge function's output block. */
export function zshEnvironmentSnapshot(): string {
  const cases = LIMITS.map(([name, limit]) => `${name}) nmsh_limit=${limit} ;;`).join(' ');
  return `
    builtin printf 'envsnapshot 1\\n'
    local nmsh_env nmsh_value nmsh_limit
    for nmsh_env in ${VALUE_NAMES}; do
      [[ -n \${(P)nmsh_env-} ]] || continue
      nmsh_value=\${(P)nmsh_env}
      case $nmsh_env in ${cases} *) nmsh_limit=0 ;; esac
      (( \${#nmsh_value} <= nmsh_limit )) || continue
      [[ $nmsh_value == *[[:cntrl:]]* ]] && continue
      builtin printf 'env %s=%s\\n' "$nmsh_env" "$nmsh_value"
    done
    for nmsh_env in ${PRESENCE_NAMES}; do
      [[ -n \${(P)nmsh_env-} ]] && builtin printf 'envset %s\\n' "$nmsh_env"
    done`;
}

/** Bash 4.4+: indirect expansion never evaluates the value. */
export function bashEnvironmentSnapshot(): string {
  const cases = LIMITS.map(([name, limit]) => `${name}) nmsh_limit=${limit} ;;`).join(' ');
  return `
    builtin printf 'envsnapshot 1\\n'
    local nmsh_env nmsh_value nmsh_limit
    for nmsh_env in ${VALUE_NAMES}; do
      [[ -n \${!nmsh_env-} ]] || continue
      nmsh_value=\${!nmsh_env}
      case $nmsh_env in ${cases} *) nmsh_limit=0 ;; esac
      (( \${#nmsh_value} <= nmsh_limit )) || continue
      [[ $nmsh_value == *[[:cntrl:]]* ]] && continue
      builtin printf 'env %s=%s\\n' "$nmsh_env" "$nmsh_value"
    done
    for nmsh_env in ${PRESENCE_NAMES}; do
      [[ -n \${!nmsh_env-} ]] && builtin printf 'envset %s\\n' "$nmsh_env"
    done`;
}

/** Fish: variables are lists; PATH-like ones join with ':' as Fish exports them, others with spaces. */
export function fishEnvironmentSnapshot(): string {
  const limits = LIMITS.map(([name, limit]) => `case ${name}\n          set nmsh_limit ${limit}`).join('\n        ');
  return `
    printf 'envsnapshot 1\\n'
    for nmsh_env in ${VALUE_NAMES}
      set -q $nmsh_env; or continue
      set -l nmsh_value
      if string match -q -- '*PATH' $nmsh_env
        set nmsh_value (string join : -- $$nmsh_env)
      else
        set nmsh_value (string join ' ' -- $$nmsh_env)
      end
      test -n "$nmsh_value"; or continue
      set -l nmsh_limit 0
      switch $nmsh_env
        ${limits}
      end
      test (string length -- "$nmsh_value") -le $nmsh_limit; or continue
      string match -qr '[[:cntrl:]]' -- "$nmsh_value"; and continue
      printf 'env %s=%s\\n' $nmsh_env "$nmsh_value"
    end
    for nmsh_env in ${PRESENCE_NAMES}
      set -q $nmsh_env; and test -n "$$nmsh_env"; and printf 'envset %s\\n' $nmsh_env
    end`;
}
