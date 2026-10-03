import {shellQuote} from '../../host/terminalHost.js';
import {BOOTSTRAP_TERM_COMPATIBILITY} from '../../host/integration.js';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {writeFileSync} from 'node:fs';
import {shellKnowledgeBootstrap} from '../ShellKnowledge.js';
import {resolveZsh} from '../zshExecutable.js';
import {parseZshHistoryInChunks} from '../HistoryService.js';
import {ShellCompletionSource} from '../CompletionService.js';
import type {LaunchContext, ShellAdapter, ShellLaunch} from './ShellAdapter.js';

const ZSH_BUILTINS = new Set(['alias', 'autoload', 'bg', 'bindkey', 'builtin', 'cd', 'command', 'echo', 'emulate', 'eval', 'exec', 'exit', 'export', 'fc', 'fg',
  'functions', 'hash', 'history', 'jobs', 'kill', 'let', 'local', 'print', 'printf', 'pushd', 'popd', 'pwd', 'read', 'return', 'set', 'setopt', 'shift', 'source',
  'test', 'trap', 'type', 'typeset', 'ulimit', 'umask', 'unalias', 'unset', 'unsetopt', 'wait', 'whence', 'which', 'zle', 'zmodload', 'zstyle']);

/**
 * zsh: the original NMSh backend. The bootstrap below is the pre-adapter
 * ShellSession bootstrap, unchanged: a private ZDOTDIR proxies the user's
 * startup files, ZLE stays off, prompts are blanked every cycle, and
 * precmd/preexec hooks are composed with the user's own.
 */
export const zshAdapter: ShellAdapter = {
  id: 'zsh',
  label: 'zsh',
  capabilities: {completion: 'rich', completionDescriptions: true, liveNames: true, historyImport: true,
    privateHistory: 'a leading space, or a match of HISTORY_IGNORE, keeps a command out of history', jobCount: true},
  editorChrome: 'none',
  builtins: ZSH_BUILTINS,
  resolveExecutable(env) {
    try { return resolveZsh(env); } catch { return undefined; }
  },
  unavailableReason(env) {
    try { resolveZsh(env); return undefined; } catch (error) { return error instanceof Error ? error.message : 'zsh was not found'; }
  },
  launch({home, env, token, stateDir, knowledgePath}: LaunchContext): ShellLaunch {
    // Proxy .zshenv
    writeFileSync(join(stateDir, '.zshenv'), `
if [[ -n ${shellQuote(home)} && -f ${shellQuote(join(home, '.zshenv'))} ]]; then
  ZDOTDIR=${shellQuote(home)} source ${shellQuote(join(home, '.zshenv'))}
fi
`);

    // Proxy .zprofile
    writeFileSync(join(stateDir, '.zprofile'), `
if [[ -n ${shellQuote(home)} && -f ${shellQuote(join(home, '.zprofile'))} ]]; then
  ZDOTDIR=${shellQuote(home)} source ${shellQuote(join(home, '.zprofile'))}
fi
`);

    // Proxy .zshrc
    writeFileSync(join(stateDir, '.zshrc'), `
# Prevent UI plugins from fighting during bootstrap
unsetopt zle
export POWERLEVEL9K_DISABLE_PROMPT=true
export XDG_CACHE_HOME="\${XDG_CACHE_HOME:-\$HOME/.cache}/nmsh-disabled"

# Suppress fastfetch via TERM
local nmsh_orig_term=\$TERM
${BOOTSTRAP_TERM_COMPATIBILITY}

if [[ -n ${shellQuote(home)} && -f ${shellQuote(join(home, '.zshrc'))} ]]; then
  ZDOTDIR=${shellQuote(home)} source ${shellQuote(join(home, '.zshrc'))}
fi

export TERM=\$nmsh_orig_term

# NMSh specific setup
export NMSH_ACTIVE=1
unsetopt zle prompt_cr prompt_sp

# Hooks run right after a job stops or ends, sometimes before zsh has taken the
# terminal back. As an ordinary job, stty could then be stopped by SIGTTOU and
# left in the user's job table ("suspended (tty output) stty -echo"). Run it
# outside job control and immune to SIGTTOU so the mode change is simply applied.
function nmsh_tty_echo {
  setopt localoptions localtraps nomonitor
  trap '' TTOU
  stty \$1 2>/dev/null
}

function nmsh_precmd {
  local nmsh_status=$?
  nmsh_capture_knowledge
  # Reblank every cycle: a plugin's own precmd (starship, a prompt theme, ...)
  # may run before us in precmd_functions and repaint PROMPT/RPROMPT. NMSh
  # owns prompt rendering, so it always has the last word here.
  PROMPT=''
  RPROMPT=''
  PS2=''
  # Themes such as Powerlevel10k move their own hook to the end of
  # precmd_functions every cycle; move ours back after it so the next cycle
  # still blanks last. Their prompt-spacing options must not return either.
  precmd_functions=(\${precmd_functions:#nmsh_precmd} nmsh_precmd)
  unsetopt prompt_cr prompt_sp
  nmsh_tty_echo -echo
  printf '\\e]777;nmsh;${token};%d;%s\\a' "\$nmsh_status" "\$PWD"
}

function nmsh_preexec {
  nmsh_tty_echo echo
  local nmsh_history_allowed=1
  [[ \$1 == [[:space:]]* ]] && nmsh_history_allowed=0
  [[ -n \$HISTORY_IGNORE && \$1 == \${~HISTORY_IGNORE} ]] && nmsh_history_allowed=0
  printf '\\e]777;nmsh;${token};exec2;%d;%s\\a' "\$nmsh_history_allowed" "\${1//[[:cntrl:]]/ }"
}

# Compose with whatever the user's config/plugins already installed instead
# of clobbering precmd_functions/preexec_functions: tools like zoxide and
# Atuin register non-UI hooks (directory tracking, history sync) into these
# arrays, and overwriting them silently drops that behavior.
${shellKnowledgeBootstrap(join(stateDir, '.nmsh-knowledge'))}
autoload -Uz add-zsh-hook
add-zsh-hook precmd nmsh_precmd
add-zsh-hook preexec nmsh_preexec

# Background cleanup handled by Node.js
`);

    return {executable: resolveZsh(env), args: ['-i'], env: {ZDOTDIR: stateDir}};
  },
  historyFile(env, home) {
    return env.HISTFILE || join(home || homedir(), '.zsh_history');
  },
  parseHistory(content) { return parseZshHistoryInChunks(content); },
  completionSource() { return new ShellCompletionSource(); },
};
