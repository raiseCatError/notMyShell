# NMSh physical-QA launcher for the release candidates. In zsh:
#
#   source /Volumes/nmsh-opus/wt/release-train/docs/development/nmsh-qa.zsh
#   nmsh_qa v019                 a new isolated QA session (Setup runs on its fresh home)
#   nmsh_qa v019 NO_COLOR=1      the same, with extra environment (remembered for reopening)
#   nmsh_qa_reopen v019          the latest v019 QA session again: same home, configuration, runtime and variables
#   nmsh_qa_reopen v019 <dir>    a specific earlier QA directory
#   nmsh_qa_sessions v019        what is live in that QA directory's own session service
#   nmsh_qa_list                 every QA directory, newest first
#   nmsh_qa_adopt v019 <dir>     bring a QA directory made by the earlier one-line helper under this launcher
#
# A QA directory holds its own HOME, configuration, runtime directory (the session service and its socket) and
# working directory. Nothing here reads or reaches your real NMSh sessions, settings or history: every command
# refuses a directory that is not a QA directory made for that candidate, and NMSh is only ever started with all
# three paths set together.

typeset -g NMSH_QA_ROOT=/Volumes/nmsh-opus/t
typeset -g NMSH_QA_WT=/Volumes/nmsh-opus/wt

_nmsh_qa_candidate() {
  [[ $1 == v019 || $1 == v020 ]] && return 0
  print -u2 "nmsh_qa: the candidate is v019 or v020 (got '${1:-nothing}')"
  return 2
}

# Refuse anything that is not one of this launcher's QA directories for that candidate.
_nmsh_qa_check() {  # <dir> <candidate>
  local q=$1 v=$2 mode
  if [[ ! $q =~ "^$NMSH_QA_ROOT/qa-[A-Za-z0-9]+\$" || ! -d $q || -L $q ]]; then
    print -u2 "nmsh_qa: '$q' is not a QA directory under $NMSH_QA_ROOT"; return 1
  fi
  if [[ ! -f $q/qa.meta || $(sed -n 's/^candidate=//p' $q/qa.meta) != $v ]]; then
    print -u2 "nmsh_qa: '$q' was not made for $v (see nmsh_qa_list)"; return 1
  fi
  mode=$(stat -f %Lp $q/run 2>/dev/null || stat -c %a $q/run 2>/dev/null)
  if [[ ! -O $q/run || $mode != 700 ]]; then
    print -u2 "nmsh_qa: '$q/run' must be yours with mode 700"; return 1
  fi
}

# The one place NMSh is started: HOME, configuration and runtime always come from the same QA directory.
_nmsh_qa_run() {  # <dir> <candidate> [VAR=value ...]
  local q=$1 v=$2; shift 2
  local w=$NMSH_QA_WT/$v
  print "QA dir   $q"
  print "build    $(node $w/dist/index.js --version | tr '\n' ' ')"
  (cd $q/work && env HOME=$q/home XDG_CONFIG_HOME=$q/home/.config NMSH_RUNTIME_DIR=$q/run "$@" node $w/dist/index.js)
}

nmsh_qa() {  # nmsh_qa v019|v020 [VAR=value ...]
  _nmsh_qa_candidate "$1" || return
  local v=$1; shift
  local w=$NMSH_QA_WT/$v q a
  [[ -f $w/dist/index.js ]] || { print -u2 "nmsh_qa: no build at $w/dist (run npm run build there)"; return 1; }
  mkdir -p $NMSH_QA_ROOT/qa-state || return
  q=$(mktemp -d $NMSH_QA_ROOT/qa-XXXXXX) || return
  mkdir -p $q/home $q/work $q/run && chmod 700 $q $q/run || return
  {
    print "candidate=$v"
    print "commit=$(git -C $w rev-parse HEAD)"
    print "created=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    for a in "$@"; do print -r -- "env=$a"; done
  } > $q/qa.meta
  print -r -- $q > $NMSH_QA_ROOT/qa-state/$v.latest
  _nmsh_qa_run $q $v "$@"
}

nmsh_qa_reopen() {  # nmsh_qa_reopen v019|v020 [QA dir]
  _nmsh_qa_candidate "$1" || return
  local v=$1 q=$2
  [[ -n $q ]] || q=$(cat $NMSH_QA_ROOT/qa-state/$v.latest 2>/dev/null)
  [[ -n $q ]] || { print -u2 "nmsh_qa_reopen: no $v QA session yet; start one with nmsh_qa $v"; return 1; }
  _nmsh_qa_check $q $v || return
  local commit=$(sed -n 's/^commit=//p' $q/qa.meta) now=$(git -C $NMSH_QA_WT/$v rev-parse HEAD)
  [[ $commit == $now || $commit == adopted ]] || print "note     this QA dir was made with ${commit[1,8]}; the $v worktree is now at ${now[1,8]}"
  local -a extra=("${(@f)$(sed -n 's/^env=//p' $q/qa.meta)}")
  extra=(${extra:#})
  nmsh_qa_sessions $v $q
  _nmsh_qa_run $q $v "${extra[@]}"
}

nmsh_qa_sessions() {  # nmsh_qa_sessions v019|v020 [QA dir]: live sessions in that QA directory's own service only
  _nmsh_qa_candidate "$1" || return
  local v=$1 q=$2
  [[ -n $q ]] || q=$(cat $NMSH_QA_ROOT/qa-state/$v.latest 2>/dev/null)
  _nmsh_qa_check "$q" $v || return
  if [[ -S $q/run/nmshd-v2.sock ]]; then
    print "live     (in $q/run)"
    env HOME=$q/home XDG_CONFIG_HOME=$q/home/.config NMSH_RUNTIME_DIR=$q/run node $NMSH_QA_WT/$v/dist/index.js --sessions | sed 's/^/         /'
  else
    print "live     none: no session service is running for this QA dir (/resume will offer its transcripts only)"
  fi
}

nmsh_qa_list() {  # every QA directory, newest first
  local q v latest state
  for q in $(ls -dt $NMSH_QA_ROOT/qa-*(N/) 2>/dev/null); do
    [[ -f $q/qa.meta ]] || continue
    v=$(sed -n 's/^candidate=//p' $q/qa.meta)
    latest=$(cat $NMSH_QA_ROOT/qa-state/$v.latest 2>/dev/null)
    state=$([[ -S $q/run/nmshd-v2.sock ]] && print 'service socket' || print 'no service')
    print -r -- "$v  $(sed -n 's/^created=//p' $q/qa.meta)  $(sed -n 's/^commit=//p' $q/qa.meta | cut -c1-8)  $state  $q$([[ $q == $latest ]] && print '  (latest)')"
  done
}

# A QA directory from the earlier helper (no qa.meta): checked, then recorded for that candidate and made the latest.
nmsh_qa_adopt() {  # nmsh_qa_adopt v019|v020 <dir>
  _nmsh_qa_candidate "$1" || return
  local v=$1 q=$2 mode pid build
  if [[ ! $q =~ "^$NMSH_QA_ROOT/qa-[A-Za-z0-9]+\$" || ! -d $q/home || ! -d $q/work || ! -d $q/run || -L $q ]]; then
    print -u2 "nmsh_qa_adopt: '$q' is not a QA directory (home, work and run under $NMSH_QA_ROOT/qa-*)"; return 1
  fi
  [[ -f $q/qa.meta ]] && { print -u2 "nmsh_qa_adopt: '$q' already belongs to $(sed -n 's/^candidate=//p' $q/qa.meta)"; return 1; }
  mode=$(stat -f %Lp $q/run 2>/dev/null || stat -c %a $q/run 2>/dev/null)
  [[ -O $q/run && $mode == 700 ]] || { print -u2 "nmsh_qa_adopt: '$q/run' must be yours with mode 700"; return 1; }
  # A running service says which build it is; it must be this candidate's.
  for pid in $(lsof -t $q/run/nmshd-v2.sock 2>/dev/null); do
    build=$(ps -o command= -p $pid)
    if [[ $build == *"$NMSH_QA_WT/"v0* && $build != *"$NMSH_QA_WT/$v/"* ]]; then
      print -u2 "nmsh_qa_adopt: the service in '$q' runs another candidate: $build"; return 1
    fi
  done
  mkdir -p $NMSH_QA_ROOT/qa-state || return
  { print "candidate=$v"; print "commit=adopted"; print "created=$(date -u -r $q +%Y-%m-%dT%H:%M:%SZ 2>/dev/null)"; } > $q/qa.meta
  print -r -- $q > $NMSH_QA_ROOT/qa-state/$v.latest
  print "adopted  $q for $v (now the latest; nmsh_qa_reopen $v)"
  nmsh_qa_sessions $v $q
}
