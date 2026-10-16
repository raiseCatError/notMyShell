# NMSh physical-QA launcher. In zsh (Ghostty or Terminal.app, from a plain shell, not from inside NMSh):
#
#   source /Volumes/nmsh-opus/wt/release-train/docs/development/nmsh-qa.zsh
#
# STABILIZED candidates (draft PRs #395 and #396): what physical QA now tests. Each runs from its own read-only
# build of one pinned commit, verified before every launch.
#
#   qa19 / qa20                       new isolated QA session (Setup runs on its fresh home)
#   qa19r / qa20r                     reopen that session after closing the window (same home, runtime, service)
#   nmsh_qa_stable v019 [VAR=value]   the long form of qa19 (extra variables are remembered for reopening)
#   nmsh_qa_stable_reopen v019 [dir]  the long form of qa19r; a dir picks an earlier stabilized QA session
#   nmsh_qa_stable_sessions v019      what is live in that QA session's own service
#   nmsh_qa_stable_list               every stabilized QA session and build, and whether its service is live
#   nmsh_qa_stable_build v019         prepare the pinned build (once; already done for the current pins)
#   nmsh_qa_stable_stop <dir>         end one stabilized QA session's service (asks first; nothing ends on its own)
#   nmsh_qa_stable_remove <dir>       delete one stabilized QA directory whose service has ended (asks first)
#
# ORIGINAL candidates (release/v0.19.0 9e85a910, release/v0.20.0 c71a4284; frozen, not stabilized): the earlier
# commands, unchanged, for the QA sessions made with them on 2026-10-15.
#
#   nmsh_qa v019                 a new isolated QA session on the ORIGINAL candidate
#   nmsh_qa v019 NO_COLOR=1      the same, with extra environment (remembered for reopening)
#   nmsh_qa_reopen v019          the latest original v019 QA session again: same home, configuration, runtime and variables
#   nmsh_qa_reopen v019 <dir>    a specific earlier QA directory
#   nmsh_qa_sessions v019        what is live in that QA directory's own service
#   nmsh_qa_list                 every original-candidate QA directory, newest first
#   nmsh_qa_adopt v019 <dir>     bring a QA directory made by the earlier one-line helper under this launcher
#
# A QA directory holds its own HOME, configuration, runtime directory (the session service and its socket) and
# working directory. Nothing here reads or reaches your real NMSh sessions, settings or history: every command
# refuses a directory that is not a QA directory made for that candidate, and NMSh is only ever started with all
# three paths set together. Original and stabilized QA directories are named apart (qa-XXXXXX, qa-stable-v019-XXXXXX)
# and each set of commands refuses the other's.

typeset -g NMSH_QA_ROOT=${NMSH_QA_ROOT:-/Volumes/nmsh-opus/t}
typeset -g NMSH_QA_WT=${NMSH_QA_WT:-/Volumes/nmsh-opus/wt}

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
  print "ORIGINAL release candidate $v (not stabilized; for the stabilized build use nmsh_qa_stable $v)"
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

nmsh_qa_list() {  # every original-candidate QA directory, newest first
  local q v latest state
  for q in $(ls -dt $NMSH_QA_ROOT/qa-*(N/) 2>/dev/null); do
    [[ -f $q/qa.meta ]] || continue
    [[ $(sed -n 's/^kind=//p' $q/qa.meta) == stable ]] && continue  # nmsh_qa_stable_list shows those
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

# ---------------------------------------------------------------------------------------------------------------------
# STABILIZED candidates. Everything below runs only a pinned build: a detached worktree at exactly the pinned commit
# under $NMSH_QA_BUILDS, built once (npm ci, npm run build), stamped with a digest of its dist and made read-only.
# Every launch re-checks the commit, the tracked sources, the digest and the build's own identity, and refuses on any
# difference. A QA session records the build it was made with; reopening it uses that build again and refuses when
# the session service answering in its runtime directory is any other build.

typeset -g NMSH_QA_BUILDS=${NMSH_QA_BUILDS:-/Volumes/nmsh-opus/qa-builds}
typeset -g NMSH_QA_REPO=${NMSH_QA_REPO:-$NMSH_QA_WT/release-train}
# The pins say what "the stabilized v019/v020" is. Moving one is a reviewed edit of this file, never automatic.
typeset -gA NMSH_QA_STABLE_PIN NMSH_QA_STABLE_BRANCH NMSH_QA_STABLE_VERSION NMSH_QA_STABLE_PR
NMSH_QA_STABLE_PIN=(v019 adfce9c16d1808e56912b84366e51c999f8e8eff v020 2f00b301e49b702efcfb3ad60ac0ea923344b0c9)
NMSH_QA_STABLE_BRANCH=(v019 stabilize/v0.19.0 v020 stabilize/v0.20.0)
NMSH_QA_STABLE_VERSION=(v019 0.19.0 v020 0.20.0)
NMSH_QA_STABLE_PR=(v019 395 v020 396)

qa19()  { nmsh_qa_stable v019 "$@"; }
qa20()  { nmsh_qa_stable v020 "$@"; }
qa19r() { nmsh_qa_stable_reopen v019 "$@"; }
qa20r() { nmsh_qa_stable_reopen v020 "$@"; }

_nmsh_qas_meta() { sed -n "s/^$2=//p" $1/qa.meta 2>/dev/null | head -1; }  # <dir> <key>
_nmsh_qas_build_dir() { print -r -- $NMSH_QA_BUILDS/$1-${2[1,12]}; }      # <candidate> <commit>

# One hash over the name and content of every file the build produced.
_nmsh_qas_digest() {  # <build dir>
  (cd $1 && find dist -type f -print0 | LC_ALL=C sort -z | xargs -0 shasum -a 256 | shasum -a 256 | cut -c1-64)
}

# The build for <candidate> at <commit> is that commit, unmodified, built once and unchanged since. REPLY = its dir.
_nmsh_qas_verify() {  # <candidate> <commit>
  local v=$1 sha=$2 b head info c
  b=$(_nmsh_qas_build_dir $v $sha)
  [[ $sha =~ '^[0-9a-f]{40}$' ]] || { print -u2 "nmsh_qa_stable: '$sha' is not a full commit"; return 1; }
  [[ -d $b && ! -L $b ]] || { print -u2 "nmsh_qa_stable: no $v build at $b (prepare it: nmsh_qa_stable_build $v)"; return 1; }
  head=$(git -C $b rev-parse HEAD 2>/dev/null)
  [[ $head == $sha ]] || { print -u2 "nmsh_qa_stable: $b is at ${head:-no commit}, expected $sha; refusing"; return 1; }
  [[ -z $(git -C $b status --porcelain --untracked-files=no 2>/dev/null) ]] \
    || { print -u2 "nmsh_qa_stable: $b has modified sources; refusing"; return 1; }
  [[ -f $b/.nmsh-qa-build && $(sed -n 's/^commit=//p' $b/.nmsh-qa-build) == $sha ]] \
    || { print -u2 "nmsh_qa_stable: $b was never stamped as a finished build of $sha; refusing"; return 1; }
  [[ $(sed -n 's/^dist=//p' $b/.nmsh-qa-build) == $(_nmsh_qas_digest $b) ]] \
    || { print -u2 "nmsh_qa_stable: $b/dist changed after it was built; refusing"; return 1; }
  info=$(<$b/dist/build-info.json)
  c=$(print -r -- $info | sed -n 's/.*"commit": *"\([0-9a-f]*\)".*/\1/p')
  [[ ${#c} -ge 7 && $sha == $c* && $info != *'"dirty"'* ]] \
    || { print -u2 "nmsh_qa_stable: $b/dist says it is build '${c:-unknown}', not a clean build of ${sha[1,8]}; refusing"; return 1; }
  [[ $info == *"\"version\": \"${NMSH_QA_STABLE_VERSION[$v]}\""* ]] \
    || { print -u2 "nmsh_qa_stable: $b is not NMSh ${NMSH_QA_STABLE_VERSION[$v]}; refusing"; return 1; }
  REPLY=$b
}

# Stamp a finished build: dist read-only, then its digest recorded.
_nmsh_qas_stamp() {  # <candidate> <commit> <build dir>
  local v=$1 sha=$2 b=$3
  chmod -R a-w $b/dist || return
  {
    print "candidate=$v"
    print "commit=$sha"
    print "branch=${NMSH_QA_STABLE_BRANCH[$v]}"
    print "version=${NMSH_QA_STABLE_VERSION[$v]}"
    print "built=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    print "dist=$(_nmsh_qas_digest $b)"
  } > $b/.nmsh-qa-build
  _nmsh_qas_verify $v $sha >/dev/null && print "ready    $v ${sha[1,8]}  $b"
}

nmsh_qa_stable_build() {  # nmsh_qa_stable_build v019|v020: the pinned build, prepared once
  _nmsh_qa_candidate "$1" || return
  local v=$1 sha=${NMSH_QA_STABLE_PIN[$1]} b
  b=$(_nmsh_qas_build_dir $v $sha)
  if _nmsh_qas_verify $v $sha 2>/dev/null; then print "ready    $v ${sha[1,8]}  $b"; return 0; fi
  if [[ -e $b ]]; then  # never rebuild over something that does not verify; a person looks at it first
    print -u2 "nmsh_qa_stable_build: $b exists but does not verify:"; _nmsh_qas_verify $v $sha; return 1
  fi
  git -C $NMSH_QA_REPO cat-file -e "$sha^{commit}" 2>/dev/null \
    || { print -u2 "nmsh_qa_stable_build: $sha is not in $NMSH_QA_REPO (git fetch there first)"; return 1; }
  mkdir -p $NMSH_QA_BUILDS && git -C $NMSH_QA_REPO worktree add --detach $b $sha || return
  (cd $b && npm ci --no-audit --no-fund --prefer-offline && npm run build) \
    || { print -u2 "nmsh_qa_stable_build: the build failed; $b is left for inspection"; return 1; }
  _nmsh_qas_stamp $v $sha $b
}

# NMSh refuses to start inside an NMSh-managed shell; the launcher clears NMSH_* below, so it refuses first.
_nmsh_qas_outside() {
  [[ ${NMSH_ACTIVE:-} != 1 ]] && return 0
  print -u2 "nmsh_qa_stable: this shell runs inside NMSh. Open a new Ghostty or Terminal.app window without NMSh and run it there."
  return 1
}

# Extra VAR=value pairs are allowed, except the ones that keep a QA session apart from your own.
_nmsh_qas_extra_ok() {  # VAR=value ...
  local a n
  for a in "$@"; do
    [[ $a =~ '^[A-Za-z_][A-Za-z0-9_]*=' && $a != *$'\n'* ]] || { print -u2 "nmsh_qa_stable: '$a' is not VAR=value"; return 2; }
    n=${a%%=*}
    case $n in
      (HOME|XDG_*|NMSH_RUNTIME_DIR|ZDOTDIR|HISTFILE)
        print -u2 "nmsh_qa_stable: $n is set by the launcher to keep the QA session isolated"; return 2 ;;
      (CLAUDE_CONFIG_DIR)
        [[ ${a#*=} == $NMSH_QA_ROOT/* ]] || { print -u2 "nmsh_qa_stable: CLAUDE_CONFIG_DIR must be a disposable directory under $NMSH_QA_ROOT"; return 2; } ;;
    esac
  done
}

# The env(1) arguments for one QA session: its own home, configuration and runtime; nothing inherited that points
# at your own NMSh, shell startup files or Claude account. REPLY array: reply.
_nmsh_qas_env() {  # <dir>
  local q=$1 name
  reply=(-u CLAUDE_CONFIG_DIR -u ZDOTDIR -u HISTFILE -u XDG_DATA_HOME -u XDG_STATE_HOME -u XDG_CACHE_HOME -u XDG_RUNTIME_DIR)
  for name in ${(k)parameters[(I)NMSH_*]}; do [[ ${parameters[$name]} == *export* ]] && reply+=(-u $name); done
  reply+=(HOME=$q/home XDG_CONFIG_HOME=$q/home/.config NMSH_RUNTIME_DIR=$q/run)
}

# A stabilized QA directory for <candidate>, with a private runtime. Original QA directories never pass.
_nmsh_qas_check() {  # <dir> <candidate>
  local q=$1 v=$2 mode
  if [[ ${q:h} != $NMSH_QA_ROOT || ! ${q:t} =~ "^qa-stable-$v-[A-Za-z0-9]+\$" || ! -d $q || -L $q ]]; then
    print -u2 "nmsh_qa_stable: '$q' is not a stabilized $v QA directory (see nmsh_qa_stable_list)"; return 1
  fi
  if [[ $(_nmsh_qas_meta $q kind) != stable || $(_nmsh_qas_meta $q candidate) != $v
        || ! $(_nmsh_qas_meta $q commit) =~ '^[0-9a-f]{40}$' ]]; then
    print -u2 "nmsh_qa_stable: '$q' has no stabilized $v session identity (qa.meta); refusing"; return 1
  fi
  if [[ $(_nmsh_qas_meta $q build) != $(_nmsh_qas_build_dir $v $(_nmsh_qas_meta $q commit)) ]]; then
    print -u2 "nmsh_qa_stable: '$q' names a build that is not its commit's; refusing"; return 1
  fi
  mode=$(stat -f %Lp $q/run 2>/dev/null || stat -c %a $q/run 2>/dev/null)
  [[ -d $q/home && -d $q/work && -O $q/run && $mode == 700 ]] \
    || { print -u2 "nmsh_qa_stable: '$q' needs home, work and a run directory that is yours with mode 700"; return 1; }
}

# Every process holding a session-service socket in <dir> must be <build>'s own service or frontend.
# reply: the pids. Refuses (1) on any other process, so a reopen never attaches to a different build.
_nmsh_qas_service() {  # <dir> <build>
  local q=$1 b=$2 sock pid cmd
  reply=()
  for sock in $q/run/nmshd*.sock(N=); do
    for pid in $(lsof -t $sock 2>/dev/null); do
      cmd=$(ps -o command= -p $pid 2>/dev/null) || continue
      if [[ $cmd != *" $b/dist/sessionService.js"* && $cmd != *" $b/dist/index.js"* ]]; then
        print -u2 "nmsh_qa_stable: the session service in $q (pid $pid) is not this session's build; refusing"
        print -u2 "         running   $cmd"
        print -u2 "         expected  $b/dist/sessionService.js"
        return 1
      fi
      reply+=($pid)
    done
  done
}

# <candidate> [dir] -> REPLY: the named QA directory, or that candidate's latest stabilized one.
_nmsh_qas_pick() {
  local v=$1 q=$2
  if [[ -z $q ]]; then
    q=$(cat $NMSH_QA_ROOT/qa-state/stable-$v.latest 2>/dev/null)
    [[ -n $q ]] || { print -u2 "nmsh_qa_stable: no stabilized $v QA session yet; start one with qa${v#v0} (nmsh_qa_stable $v)"; return 1; }
  fi
  REPLY=${q:a}
}

_nmsh_qas_run() {  # <dir> <build>
  local q=$1 b=$2 v sha branch tip
  v=$(_nmsh_qas_meta $q candidate); sha=$(_nmsh_qas_meta $q commit); branch=$(_nmsh_qas_meta $q branch)
  local -a extra=("${(@f)$(sed -n 's/^env=//p' $q/qa.meta)}")
  extra=(${extra:#})
  _nmsh_qas_extra_ok "${extra[@]}" || return
  _nmsh_qas_env $q
  local -a isolate=("${reply[@]}")
  tip=$(git -C $b rev-parse -q --verify "refs/remotes/origin/$branch" 2>/dev/null)
  print "STABILIZED $v candidate · NMSh ${NMSH_QA_STABLE_VERSION[$v]} · draft PR #${NMSH_QA_STABLE_PR[$v]}"
  print "version  $(cd $q/work && env "${isolate[@]}" node $b/dist/index.js --version | tr '\n' ' ')"
  print "commit   $sha"
  print "branch   $branch$([[ -n $tip && $tip != $sha ]] && print " (origin/$branch has since moved to ${tip[1,8]}; this is the pinned build)")"
  print "build    $b"
  print "QA dir   $q"
  (( ${#extra} )) && print "env      ${extra[*]}"
  (cd $q/work && env "${isolate[@]}" "${extra[@]}" node $b/dist/index.js)
}

nmsh_qa_stable() {  # nmsh_qa_stable v019|v020 [VAR=value ...]: a new stabilized QA session
  _nmsh_qa_candidate "$1" || return
  local v=$1; shift
  _nmsh_qas_outside && _nmsh_qas_extra_ok "$@" || return
  local sha=${NMSH_QA_STABLE_PIN[$v]} b q a
  _nmsh_qas_verify $v $sha || return
  b=$REPLY
  # The service socket ($q/run/nmshd-v2.sock) must fit in a Unix socket path (104 bytes on macOS).
  (( ${#NMSH_QA_ROOT} + 44 <= 100 )) || { print -u2 "nmsh_qa_stable: NMSH_QA_ROOT is too long for a session socket path"; return 1; }
  mkdir -p $NMSH_QA_ROOT/qa-state || return
  q=$(mktemp -d $NMSH_QA_ROOT/qa-stable-$v-XXXXXX) || return
  mkdir -p $q/home $q/work $q/run && chmod 700 $q $q/run || return
  {
    print "kind=stable"
    print "candidate=$v"
    print "version=${NMSH_QA_STABLE_VERSION[$v]}"
    print "commit=$sha"
    print "branch=${NMSH_QA_STABLE_BRANCH[$v]}"
    print "pr=${NMSH_QA_STABLE_PR[$v]}"
    print "build=$b"
    print "created=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    for a in "$@"; do print -r -- "env=$a"; done
  } > $q/qa.meta
  print -r -- $q > $NMSH_QA_ROOT/qa-state/stable-$v.latest
  _nmsh_qas_run $q $b
}

nmsh_qa_stable_reopen() {  # nmsh_qa_stable_reopen v019|v020 [dir]: the same QA session, on the build it was made with
  _nmsh_qa_candidate "$1" || return
  local v=$1 pin=${NMSH_QA_STABLE_PIN[$1]} q sha b
  _nmsh_qas_outside && _nmsh_qas_pick $v "$2" || return
  q=$REPLY
  _nmsh_qas_check $q $v || return
  sha=$(_nmsh_qas_meta $q commit)
  if [[ $sha != $pin && -z $2 ]]; then
    print -u2 "nmsh_qa_stable_reopen: the latest stabilized $v session was made with ${sha[1,8]}; $v is now pinned to ${pin[1,8]}."
    print -u2 "  a new session on the pinned build:     nmsh_qa_stable $v"
    print -u2 "  that older session, on its own build:  nmsh_qa_stable_reopen $v $q"
    return 1
  fi
  [[ $sha == $pin ]] || print "note     this session was made with ${sha[1,8]}; the $v pin is now ${pin[1,8]}. Reopening it on its own build."
  _nmsh_qas_verify $v $sha || return
  b=$REPLY
  _nmsh_qas_sessions_of $q $b || return
  _nmsh_qas_run $q $b
}

# What is live in one QA directory's own service (never another service).
_nmsh_qas_sessions_of() {  # <dir> <build>
  local q=$1 b=$2
  _nmsh_qas_service $q $b || return
  local -a pids=("${reply[@]}")
  if (( ${#pids} )); then
    _nmsh_qas_env $q
    print "live     service pid ${pids[*]} in $q/run"
    (cd $q/work && env "${reply[@]}" node $b/dist/index.js --sessions) | sed 's/^/         /'
  elif [[ -n ${$(print -r -- $q/run/nmshd*.sock(N=))} ]]; then
    print "live     none: a socket is left but no process serves it (/resume offers this session's transcripts only)"
  else
    print "live     none: no session service is running for this QA dir (/resume offers its transcripts only)"
  fi
}

nmsh_qa_stable_sessions() {  # nmsh_qa_stable_sessions v019|v020 [dir]
  _nmsh_qa_candidate "$1" || return
  local v=$1 q
  _nmsh_qas_pick $v "$2" || return
  q=$REPLY
  _nmsh_qas_check $q $v || return
  _nmsh_qas_sessions_of $q $(_nmsh_qas_meta $q build)
}

nmsh_qa_stable_list() {  # pins, builds and every stabilized QA session, newest first
  local v sha q state latest pid n=0
  local -a pids socks
  for v in v019 v020; do
    sha=${NMSH_QA_STABLE_PIN[$v]}
    if _nmsh_qas_verify $v $sha >/dev/null 2>&1; then state=ready; elif [[ -e $(_nmsh_qas_build_dir $v $sha) ]]; then state='DOES NOT VERIFY'; else state='not built'; fi
    print -r -- "pin      $v ${sha[1,12]}  ${NMSH_QA_STABLE_BRANCH[$v]} (#${NMSH_QA_STABLE_PR[$v]})  build $state"
  done
  for q in $NMSH_QA_ROOT/qa-stable-*(N/om); do
    v=$(_nmsh_qas_meta $q candidate); sha=$(_nmsh_qas_meta $q commit)
    [[ $(_nmsh_qas_meta $q kind) == stable ]] || { print -r -- "?        $q (no stabilized identity; left alone)"; continue; }
    pids=()
    socks=($q/run/nmshd*.sock(N=))
    (( ${#socks} )) && for pid in $(lsof -t $socks 2>/dev/null); do pids+=("$pid $(ps -o command= -p $pid 2>/dev/null)"); done
    if (( ${#pids} == 0 )); then state='no service'
    elif [[ ${pids[*]} == *" $(_nmsh_qas_meta $q build)/dist/"* ]]; then state="live (pid ${${pids[1]}%% *})"
    else state='live, ANOTHER BUILD'
    fi
    latest=$(cat $NMSH_QA_ROOT/qa-state/stable-$v.latest 2>/dev/null)
    print -r -- "$v     $(_nmsh_qas_meta $q created)  ${sha[1,8]}$([[ $sha != ${NMSH_QA_STABLE_PIN[$v]} ]] && print ' (older pin)')  $state  $q$([[ $q == $latest ]] && print '  (latest)')"
  done
  for q in $NMSH_QA_ROOT/qa-*(N/); do [[ ${q:t} == qa-stable-* || ${q:t} == qa-state ]] || (( n++ )); done
  print -r -- "original-candidate QA directories: $n, untouched (nmsh_qa_list)"
}

# <dir> -> the candidate its name says, then the usual checks. REPLY: the candidate.
_nmsh_qas_owned() {
  local q=$1 v
  v=${${q:t}#qa-stable-}; v=${v%%-*}
  [[ ${q:t} == qa-stable-* ]] && _nmsh_qa_candidate "$v" 2>/dev/null \
    || { print -u2 "nmsh_qa_stable: '$q' is not a stabilized QA directory; only those can be stopped or removed here"; return 1; }
  _nmsh_qas_check $q $v || return
  REPLY=$v
}

nmsh_qa_stable_stop() {  # nmsh_qa_stable_stop <dir> [--yes]: end that QA directory's session service, after asking
  local q=${1:a} b
  _nmsh_qas_owned $q || return
  b=$(_nmsh_qas_meta $q build)
  _nmsh_qas_service $q $b || return
  local -a pids=("${reply[@]}")
  (( ${#pids} )) || { print "nothing to stop: no session service is running in $q"; return 0; }
  _nmsh_qas_sessions_of $q $b
  if [[ $2 != --yes ]]; then
    read -q "?End the session service (pid ${pids[*]}) and every live session above? [y/N] " || { print; return 1; }
    print
  fi
  kill -TERM ${pids[@]} && print "stopped  pid ${pids[*]} ($q)"
}

nmsh_qa_stable_remove() {  # nmsh_qa_stable_remove <dir> [--yes]: delete a stabilized QA directory whose service has ended
  local q=${1:a} v
  _nmsh_qas_owned $q || return
  v=$REPLY
  _nmsh_qas_service $q $(_nmsh_qas_meta $q build) || return
  (( ${#reply} == 0 )) || { print -u2 "nmsh_qa_stable_remove: its service is still running (pid ${reply[*]}); nmsh_qa_stable_stop $q first"; return 1; }
  if [[ $2 != --yes ]]; then
    read -q "?Delete $q (its home, configuration, transcripts and history)? [y/N] " || { print; return 1; }
    print
  fi
  rm -rf -- $q || return
  [[ $(cat $NMSH_QA_ROOT/qa-state/stable-$v.latest 2>/dev/null) == $q ]] && rm -f -- $NMSH_QA_ROOT/qa-state/stable-$v.latest
  print "removed  $q"
}
