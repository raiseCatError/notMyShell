#!/usr/bin/env zsh
# Tests for nmsh-qa.zsh's stabilized-candidate launcher: build selection, wrong commits, wrong session identities,
# reopening, and that original-candidate QA directories are never touched. Self-contained: a throwaway repository with
# two commits, fake builds (a dist/index.js that records how it was started) and a fake session service on a real
# Unix socket. Nothing here reads /Volumes/nmsh-opus or any real NMSh state.
#
#   zsh docs/development/nmsh-qa.test.zsh

emulate -R zsh
setopt pipefail
here=${0:A:h}
T=$(mktemp -d /tmp/nqa.XXXXXX) || exit 1  # short: a Unix socket path must fit in 104 bytes
T=${T:A}  # one canonical spelling (macOS TMPDIR ends in a slash; /var is /private/var)
typeset -g pass=0 failed=0
typeset -ga service_pids

cleanup() {
  (( ${#service_pids} )) && kill ${service_pids[@]} 2>/dev/null
  chmod -R u+w $T 2>/dev/null; rm -rf $T
}
trap cleanup EXIT

check() {  # <description>: passes when the command just before it succeeded (`[[ ... ]]; check 'name'`)
  local rc=$?
  if (( rc == 0 )); then (( pass++ )); else (( failed++ )); print -u2 "FAIL  $1"; fi
}
has() { [[ $1 == *$2* ]]; }

# --- a repository with two commits, standing in for the stabilization heads -----------------------------------------
repo=$T/repo
git init -q $repo && git -C $repo config user.email t@example.invalid && git -C $repo config user.name t
print 'dist/\nnode_modules/' > $repo/.gitignore
print '{"name":"nmsh","version":"0.19.0"}' > $repo/package.json
print one > $repo/src.txt
git -C $repo add -A && git -C $repo commit -qm one
A=$(git -C $repo rev-parse HEAD)
print two > $repo/src.txt
git -C $repo commit -qam two
B=$(git -C $repo rev-parse HEAD)

unset NMSH_QA_ROOT NMSH_QA_WT NMSH_QA_BUILDS NMSH_QA_REPO
export NMSH_QA_ROOT=$T/t NMSH_QA_WT=$T/wt NMSH_QA_BUILDS=$T/b NMSH_QA_REPO=$repo
mkdir -p $NMSH_QA_ROOT $NMSH_QA_BUILDS
unset NMSH_ACTIVE
source $here/nmsh-qa.zsh
NMSH_QA_STABLE_PIN=(v019 $A v020 $B)
NMSH_QA_STABLE_VERSION=(v019 0.19.0 v020 0.19.0)

# A fake build: the real layout and stamp, with a frontend that writes how it was started to $NQA_PROBE.
fake_build() {  # <candidate> <commit>
  local v=$1 sha=$2 b=$NMSH_QA_BUILDS/$1-${2[1,12]}
  git -C $repo worktree add -q --detach $b $sha || return
  mkdir -p $b/dist
  cat > $b/dist/index.js <<'JS'
const fs = require('fs');
if (process.argv.includes('--version')) { console.log('notMyShell fake'); process.exit(0); }
if (process.argv.includes('--sessions')) { console.log('fake-live-session'); process.exit(0); }
fs.writeFileSync(process.env.NQA_PROBE, JSON.stringify({argv: process.argv, cwd: process.cwd(), env: process.env}));
JS
  cat > $b/dist/sessionService.js <<'JS'
require('net').createServer(() => {}).listen(process.argv[2]);
JS
  print "{\n  \"version\": \"0.19.0\",\n  \"commit\": \"${sha[1,7]}\"\n}" > $b/dist/build-info.json
  _nmsh_qas_stamp $v $sha $b >/dev/null
}
start_service() {  # <build dir> <socket>: a process of that build holding the socket
  node $1/dist/sessionService.js $2 &
  service_pids+=($!)
  local i; for i in {1..50}; do [[ -S $2 ]] && return 0; sleep 0.1; done; return 1
}
probe() { node -e 'const p=JSON.parse(require("fs").readFileSync(process.argv[1]));const k=process.argv[2];console.log(k==="cwd"?p.cwd:k==="argv1"?p.argv[1]:(p.env[k]??"<unset>"))' $NQA_PROBE $1; }
export NQA_PROBE=$T/probe.json

fake_build v019 $A
fake_build v020 $B
B19=$NMSH_QA_BUILDS/v019-${A[1,12]}
B20=$NMSH_QA_BUILDS/v020-${B[1,12]}

# The maintainer's original QA directory (earlier helper): must stay untouched by every stabilized command.
orig=$NMSH_QA_ROOT/qa-AbC123; mkdir -p $orig/home $orig/work $orig/run; chmod 700 $orig $orig/run
print keep > $orig/home/marker

# --- selection: each candidate starts its own pinned build, fully isolated -------------------------------------------
export CLAUDE_CONFIG_DIR=$HOME/.claude-real NMSH_SESSION_ID=outer ZDOTDIR=$HOME/zd
out=$(nmsh_qa_stable v019 NO_COLOR=1 2>&1); rc=$?
[[ $rc == 0 ]]; check 'v019 launches'
q19=$(cat $NMSH_QA_ROOT/qa-state/stable-v019.latest)
[[ $(probe argv1) == $B19/dist/index.js ]]; check 'v019 runs its pinned build'
has "$out" 'STABILIZED v019 candidate'; check 'banner names the candidate'
has "$out" "commit   $A"; check 'banner shows the full commit'
has "$out" 'branch   stabilize/v0.19.0'; check 'banner shows the source branch'
has "$out" "QA dir   $q19"; check 'banner shows the QA dir'
[[ $(probe HOME) == $q19/home ]]; check 'HOME is the QA home'
[[ $(probe XDG_CONFIG_HOME) == $q19/home/.config ]]; check 'XDG_CONFIG_HOME is in the QA home'
[[ $(probe NMSH_RUNTIME_DIR) == $q19/run ]]; check 'runtime is the QA run dir'
[[ $(probe cwd) == ${q19:A}/work ]]; check 'working directory is the QA work dir'
[[ $(probe CLAUDE_CONFIG_DIR) == '<unset>' ]]; check 'real Claude config is not inherited'
[[ $(probe NMSH_SESSION_ID) == '<unset>' ]]; check 'outer NMSh session variables are not inherited'
[[ $(probe ZDOTDIR) == '<unset>' ]]; check 'ZDOTDIR is not inherited'
[[ $(probe NO_COLOR) == 1 ]]; check 'extra variables reach NMSh'
[[ $(_nmsh_qas_meta $q19 kind) == stable ]]; check 'session metadata: kind'
[[ $(_nmsh_qas_meta $q19 commit) == $A ]]; check 'session metadata: commit'
[[ $(_nmsh_qas_meta $q19 version) == 0.19.0 ]]; check 'session metadata: version'
[[ $(_nmsh_qas_meta $q19 branch) == stabilize/v0.19.0 ]]; check 'session metadata: branch'
[[ $(_nmsh_qas_meta $q19 build) == $B19 ]]; check 'session metadata: build'
[[ $(stat -f %Lp $q19/run 2>/dev/null || stat -c %a $q19/run) == 700 ]]; check 'run dir is private'
unset CLAUDE_CONFIG_DIR NMSH_SESSION_ID ZDOTDIR

out=$(nmsh_qa_stable v020 2>&1)
q20=$(cat $NMSH_QA_ROOT/qa-state/stable-v020.latest)
[[ $(probe argv1) == $B20/dist/index.js ]]; check 'v020 runs its own pinned build'
[[ $q20 != $q19 && ${q20:t} == qa-stable-v020-* ]]; check 'v020 gets a different QA dir'
[[ $(whence -f qa19) == *'nmsh_qa_stable v019'* ]]; check 'short form qa19 is the same command'
out=$(nmsh_qa_stable v021 2>&1); [[ $? != 0 ]]; check 'unknown candidate refused'

# --- refusals that keep a session isolated --------------------------------------------------------------------------
n_before=$(print -l $NMSH_QA_ROOT/qa-stable-*(N/) | wc -l)
out=$(nmsh_qa_stable v019 HOME=/tmp 2>&1); [[ $? != 0 ]]; check 'HOME override refused'
out=$(nmsh_qa_stable v019 XDG_CONFIG_HOME=/tmp 2>&1); [[ $? != 0 ]]; check 'XDG override refused'
out=$(nmsh_qa_stable v019 CLAUDE_CONFIG_DIR=$HOME/.claude 2>&1); [[ $? != 0 ]]; check 'real Claude config refused'
out=$(NMSH_ACTIVE=1 nmsh_qa_stable v019 2>&1); [[ $? != 0 ]] && has "$out" 'inside NMSh'; check 'inside NMSh refused'
out=$(NMSH_ACTIVE=1 nmsh_qa_stable_reopen v019 2>&1); [[ $? != 0 ]]; check 'reopen inside NMSh refused'
[[ $(print -l $NMSH_QA_ROOT/qa-stable-*(N/) | wc -l) == $n_before ]]; check 'no QA dir made by a refusal'

# --- wrong commit / wrong build ---------------------------------------------------------------------------------------
rm -f $NQA_PROBE
saved=$NMSH_QA_STABLE_PIN[v019]
NMSH_QA_STABLE_PIN[v019]=${A[1,12]}
out=$(nmsh_qa_stable v019 2>&1); [[ $? != 0 ]]; check 'abbreviated pin refused'
NMSH_QA_STABLE_PIN[v019]=$B   # a commit that has no v019 build
out=$(nmsh_qa_stable v019 2>&1); [[ $? != 0 ]] && has "$out" 'nmsh_qa_stable_build v019'; check 'missing build refused'
NMSH_QA_STABLE_PIN[v019]=$saved
[[ ! -e $NQA_PROBE ]]; check 'refused launches never started NMSh'

git -C $B19 checkout -q --detach $B
out=$(nmsh_qa_stable v019 2>&1); [[ $? != 0 ]] && has "$out" "expected $A"; check 'build at the wrong commit refused'
git -C $B19 checkout -q --detach $A

print changed > $B19/src.txt
out=$(nmsh_qa_stable v019 2>&1); [[ $? != 0 ]] && has "$out" 'modified sources'; check 'modified sources refused'
git -C $B19 checkout -q -- src.txt

chmod u+w $B19/dist; print '// edited' >> $B19/dist/index.js 2>/dev/null || { chmod u+w $B19/dist/index.js; print '// edited' >> $B19/dist/index.js; }
out=$(nmsh_qa_stable v019 2>&1); [[ $? != 0 ]] && has "$out" 'changed after it was built'; check 'dist changed after build refused'
sed -i '' -e '$d' $B19/dist/index.js 2>/dev/null || sed -i -e '$d' $B19/dist/index.js
_nmsh_qas_verify v019 $A; check 'digest matches again once restored'

[[ ! -w $B19/dist/build-info.json ]]; check 'stamped dist is read-only'
chmod u+w $B19/dist/build-info.json
print "{\n  \"version\": \"0.19.0\",\n  \"commit\": \"${B[1,7]}\"\n}" > $B19/dist/build-info.json
_nmsh_qas_stamp v019 $A $B19 >/dev/null 2>&1   # even re-stamped, the build's own identity disagrees
out=$(nmsh_qa_stable v019 2>&1); [[ $? != 0 ]]; check 'build-info of another commit refused'
chmod u+w $B19/dist/build-info.json
print "{\n  \"version\": \"0.19.0\",\n  \"commit\": \"${A[1,7]}\",\n  \"dirty\": true\n}" > $B19/dist/build-info.json
_nmsh_qas_stamp v019 $A $B19 >/dev/null 2>&1
out=$(nmsh_qa_stable v019 2>&1); [[ $? != 0 ]]; check 'dirty build refused'
chmod u+w $B19/dist/build-info.json
print "{\n  \"version\": \"0.19.0\",\n  \"commit\": \"${A[1,7]}\"\n}" > $B19/dist/build-info.json
_nmsh_qas_stamp v019 $A $B19 >/dev/null
_nmsh_qas_verify v019 $A; check 'restored build verifies'
out=$(nmsh_qa_stable_build v019 2>&1); has "$out" 'ready'; check 'build of a ready pin is a no-op'

# --- reopening: the same session, its own build, its own service ------------------------------------------------------
rm -f $NQA_PROBE
out=$(nmsh_qa_stable_reopen v019 2>&1); rc=$?
[[ $rc == 0 ]]; check 'reopen succeeds'
[[ $(probe HOME) == $q19/home ]]; check 'reopen uses the same QA home'
[[ $(probe NMSH_RUNTIME_DIR) == $q19/run ]]; check 'reopen uses the same runtime'
[[ $(probe NO_COLOR) == 1 ]]; check 'reopen keeps remembered variables'
[[ $(cat $NMSH_QA_ROOT/qa-state/stable-v019.latest) == $q19 ]]; check 'reopen makes no new QA dir'
has "$out" 'live     none'; check 'reopen says no service is live'

start_service $B19 $q19/run/nmshd-v2.sock
out=$(nmsh_qa_stable_reopen v019 2>&1); rc=$?
[[ $rc == 0 ]] && has "$out" 'fake-live-session'; check 'reopen with its own live service'
has "$(nmsh_qa_stable_list)" "live (pid"; check 'list shows the live service'
out=$(nmsh_qa_stable_remove $q19 --yes 2>&1); [[ $? != 0 && -d $q19 ]]; check 'remove refuses a live session'
out=$(nmsh_qa_stable_stop $q19 --yes 2>&1); [[ $? == 0 ]] && has "$out" 'stopped'; check 'explicit stop ends that service'
sleep 0.3
out=$(nmsh_qa_stable_sessions v019 2>&1); has "$out" 'live     none'; check 'service gone after stop'

# Another build's service in this session's runtime: refused before NMSh starts.
rm -f $q19/run/nmshd-v2.sock $NQA_PROBE
start_service $B20 $q19/run/nmshd-v2.sock
out=$(nmsh_qa_stable_reopen v019 2>&1); rc=$?
[[ $rc != 0 ]] && has "$out" 'not this session'"'"'s build'; check 'service of another build refused'
[[ ! -e $NQA_PROBE ]]; check '... and NMSh was not started'
has "$(nmsh_qa_stable_list)" 'ANOTHER BUILD'; check 'list flags another build'
out=$(nmsh_qa_stable_stop $q19 --yes 2>&1); [[ $? != 0 ]]; check 'stop refuses to signal another build'
kill ${service_pids[-1]}; sleep 0.3; rm -f $q19/run/nmshd-v2.sock

# Wrong session identity.
out=$(nmsh_qa_stable_reopen v020 $q19 2>&1); [[ $? != 0 ]]; check 'v019 session refused as v020'
out=$(nmsh_qa_stable_reopen v019 $orig 2>&1); [[ $? != 0 ]]; check 'original QA dir refused'
out=$(nmsh_qa_stable_reopen v019 $T 2>&1); [[ $? != 0 ]]; check 'arbitrary dir refused'
cp $q19/qa.meta $T/meta.saved
sed -i '' -e "s/^commit=.*/commit=$B/" $q19/qa.meta 2>/dev/null || sed -i -e "s/^commit=.*/commit=$B/" $q19/qa.meta
out=$(nmsh_qa_stable_reopen v019 $q19 2>&1); [[ $? != 0 ]]; check 'commit not matching recorded build refused'
grep -v '^kind=' $T/meta.saved > $q19/qa.meta
out=$(nmsh_qa_stable_reopen v019 $q19 2>&1); [[ $? != 0 ]]; check 'missing stabilized identity refused'
cp $T/meta.saved $q19/qa.meta
chmod 755 $q19/run
out=$(nmsh_qa_stable_reopen v019 $q19 2>&1); [[ $? != 0 ]]; check 'shared runtime dir refused'
chmod 700 $q19/run
ln -s $q19 $NMSH_QA_ROOT/qa-stable-v019-link
out=$(nmsh_qa_stable_reopen v019 $NMSH_QA_ROOT/qa-stable-v019-link 2>&1); [[ $? != 0 ]]; check 'symlinked QA dir refused'
rm $NMSH_QA_ROOT/qa-stable-v019-link

# Moving the pin: the latest session does not silently switch builds.
fake_build v019 $B
NMSH_QA_STABLE_PIN[v019]=$B
out=$(nmsh_qa_stable_reopen v019 2>&1); [[ $? != 0 ]] && has "$out" "nmsh_qa_stable_reopen v019 $q19"; check 'latest session from an older pin refused'
rm -f $NQA_PROBE
out=$(nmsh_qa_stable_reopen v019 $q19 2>&1); [[ $? == 0 ]] && has "$out" 'note'; check 'explicit older session reopens'
[[ $(probe argv1) == $B19/dist/index.js ]]; check '... on the build it was made with'
out=$(nmsh_qa_stable v019 2>&1)
[[ $(probe argv1) == $NMSH_QA_BUILDS/v019-${B[1,12]}/dist/index.js ]]; check 'new session takes the new pin'
NMSH_QA_STABLE_PIN[v019]=$A

# --- original-candidate QA directories are never touched -------------------------------------------------------------
out=$(nmsh_qa_stable_stop $orig --yes 2>&1); [[ $? != 0 ]]; check 'stop refuses an original QA dir'
out=$(nmsh_qa_stable_remove $orig --yes 2>&1); [[ $? != 0 && -f $orig/home/marker ]]; check 'remove refuses an original QA dir'
out=$(_nmsh_qa_check $q19 v019 2>&1); [[ $? != 0 ]]; check 'original commands refuse a stabilized dir'
[[ $(nmsh_qa_list) != *qa-stable-* ]]; check 'original list skips stabilized dirs'
has "$(nmsh_qa_stable_list)" 'original-candidate QA directories: 1'; check 'stabilized list counts the original dir'

# --- explicit cleanup of a stabilized session -------------------------------------------------------------------------
out=$(nmsh_qa_stable_remove $q20 </dev/null 2>&1); [[ $? != 0 && -d $q20 ]]; check 'remove asks first (no answer, nothing removed)'
out=$(nmsh_qa_stable_remove $q20 --yes 2>&1); [[ $? == 0 && ! -e $q20 ]]; check 'remove --yes deletes it'
[[ ! -e $NMSH_QA_ROOT/qa-state/stable-v020.latest ]]; check '... and its latest pointer'
out=$(nmsh_qa_stable_reopen v020 2>&1); [[ $? != 0 ]] && has "$out" 'qa20'; check 'reopen with no session says how to start one'
[[ -f $orig/home/marker ]]; check 'original QA dir still intact'

print "nmsh-qa: $pass passed, $failed failed"
(( failed == 0 ))
