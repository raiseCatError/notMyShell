# Installed after trusted configuration, only in the detached helper PTY.
emulate -LR zsh
unset HISTFILE
SAVEHIST=0
HISTSIZE=0
precmd_functions=()
preexec_functions=()
PROMPT=''
RPROMPT=''
PS2=''
setopt zle
unsetopt monitor
autoload -Uz compinit
(( $+functions[_main_complete] )) || compinit -D
zmodload zsh/zutil
# Completion expands knowledge, not arbitrary buffer expressions through _expand.
zstyle ':completion:*' completer _complete
unfunction compadd 2>/dev/null
compadd() {
  setopt localoptions extendedglob noksharrays
  local -a nmshcap_hits nmsh_labels nmshcap_inline
  local nmshcap_labelname=${@[$[${@[(i)-d]}+1]]}
  if (( ${@[(I)-d]} )); then
    if [[ $nmshcap_labelname == \(* ]]; then
      nmshcap_inline=( ${(z)nmshcap_labelname} )
      nmsh_labels=( "${(@Q)nmshcap_inline[2,-2]}" )
    else
      nmsh_labels=("${(@P)nmshcap_labelname}")
    fi
  fi
  # Calls used for internal match calculations are not presentation records.
  if [[ ${@[1,(i)(-|--)]} == *-(O|A|D)\ * ]]; then
    builtin compadd "$@"
    return
  fi
  builtin compadd -A nmshcap_hits -D nmsh_labels "$@"
  local -A nmshcap_pre nmshcap_hiddenpre nmshcap_suf nmshcap_hiddensuf nmshcap_groups nmshcap_unsorted nmshcap_ignoredpre nmshcap_ignoredsuf
  local -a nmshcap_ignored nmshcap_fileflag nmshcap_noquote
  zparseopts -a nmshcap_ignored -E a k q Q=nmshcap_noquote e n U l 1 2 C F: W: X: x: r: R: o:: O: A: D: E: M: \
    P:=nmshcap_pre p:=nmshcap_hiddenpre S:=nmshcap_suf s:=nmshcap_hiddensuf J:=nmshcap_groups V:=nmshcap_unsorted f=nmshcap_fileflag i:=nmshcap_ignoredpre I:=nmshcap_ignoredsuf
  local nmshcap_value nmshcap_description nmshcap_group=${nmshcap_groups[-J]:-${nmshcap_unsorted[-V]}}
  local nmshcap_prefix="${(Q)IPREFIX}${nmshcap_ignoredpre[-i]}${nmshcap_pre[-P]}${nmshcap_hiddenpre[-p]}"
  local nmshcap_suffix="${nmshcap_hiddensuf[-s]}${nmshcap_suf[-S]}${nmshcap_ignoredsuf[-I]}${(Q)ISUFFIX}"
  local nmshcap_kind=argument
  (( ${#nmshcap_fileflag} )) && nmshcap_kind=file
  if [[ $nmshcap_kind == file ]]; then
    nmshcap_prefix="${(Q)IPREFIX}${nmshcap_ignoredpre[-i]}${nmshcap_pre[-P]}${(Q)nmshcap_hiddenpre[-p]}"
  fi
  local nmshcap_i
  for (( nmshcap_i=1; nmshcap_i <= $#nmshcap_hits && nmsh_count < 4096; nmshcap_i++ )); do
    local nmshcap_candidate_kind=$nmshcap_kind
    nmshcap_value=$nmshcap_hits[$nmshcap_i]
    if [[ $nmshcap_kind == file ]] && (( $#nmshcap_noquote )); then
      nmshcap_value=${(Q)nmshcap_value}
    fi
    nmshcap_description=${nmsh_labels[$nmshcap_i]}
    local nmshcap_path=$nmshcap_prefix$nmshcap_value
    # Test directories using HOME without evaluating arbitrary completion text.
    # The request flag distinguishes unquoted HOME from escaped/quoted literals.
    if [[ $nmsh_home_expansion == 1 && $nmshcap_path == '~/'* ]]; then
      nmshcap_path=$HOME/${nmshcap_path#\~/}
    fi
    if [[ $nmshcap_kind == file && -d $nmshcap_path ]]; then
      nmshcap_candidate_kind=directory
      [[ $nmshcap_value != */ && $nmshcap_suffix != /* ]] && nmshcap_value+=/
    fi
    (( ${#nmshcap_value} + ${#nmshcap_description} + ${#nmshcap_prefix} + ${#nmshcap_suffix} + ${#nmshcap_group} > 8192 )) && continue
    (( nmsh_bytes += 4 * (2 * ${#nmshcap_value} + ${#nmshcap_description} + ${#nmshcap_prefix} + ${#nmshcap_suffix} + ${#nmshcap_group} + 32) ))
    (( nmsh_bytes > 1048576 )) && break
    printf '%s\0' "$nmshcap_value" "$nmshcap_value" "$nmshcap_description" "$nmshcap_group" "$nmshcap_prefix" "$nmshcap_suffix" "$nmshcap_candidate_kind" >> "$NMSH_COMPLETION_ROOT/results"
    (( nmsh_count++ ))
  done
  return 0
}
nmsh_complete() {
  integer nmsh_count=0
  integer nmsh_bytes=0
  _main_complete
  compstate[list]=''
  compstate[insert]=''
}
zle -C nmsh-knowledge complete-word nmsh_complete
nmsh_request() {
  local nmsh_home_expansion=$(<"$NMSH_COMPLETION_ROOT/home-expansion")
  BUFFER=$(<"$NMSH_COMPLETION_ROOT/buffer")
  CURSOR=$(<"$NMSH_COMPLETION_ROOT/cursor")
  zle nmsh-knowledge
  BUFFER=''
  CURSOR=0
  : > "$NMSH_COMPLETION_ROOT/done"
}
zle -N nmsh-request nmsh_request
bindkey -e
bindkey '^G' nmsh-request
bindkey '^M' undefined-key
bindkey '^J' undefined-key
: > "$NMSH_COMPLETION_ROOT/ready"
