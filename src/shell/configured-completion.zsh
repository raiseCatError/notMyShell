#!/bin/zsh -f
# This parent owns a hidden PTY, never the frontend's terminal.
emulate -LR zsh
zmodload zsh/zpty || exit 1
zmodload zsh/datetime || exit 1
nmsh_cleanup() {
  local listing=$(zpty)
  local pid=${${listing#\(}%%\)*}
  [[ $pid == <-> && $pid -gt 1 ]] && kill -KILL -- -$pid 2>/dev/null
  if [[ -f $NMSH_COMPLETION_ROOT/pid ]]; then
    local pid=$(< $NMSH_COMPLETION_ROOT/pid)
    [[ $pid == <-> && $pid -gt 1 ]] && kill -KILL -- -$pid 2>/dev/null
  fi
  zpty -d bridge 2>/dev/null
  command rm -rf -- "$NMSH_COMPLETION_ROOT"
}
trap nmsh_cleanup EXIT
trap 'exit 2' TERM HUP INT
zpty -b bridge exec "${NMSH_ZSH_EXECUTABLE:-/bin/zsh}" -i || exit 1
local listing=$(zpty)
print -r -- ${${listing#\(}%%\)*} > "$NMSH_COMPLETION_ROOT/pid"
typeset -F deadline=$(( EPOCHREALTIME + ${NMSH_COMPLETION_STARTUP_MS:-1500} / 1000.0 ))
local discarded
integer bytes=0
nmsh_drain() {
  while zpty -r bridge discarded; do
    (( bytes += 4 * ${#discarded} ))
    (( bytes > 1048576 )) && exit 2
  done
}
until [[ -f $NMSH_COMPLETION_ROOT/ready ]]; do
  (( EPOCHREALTIME >= deadline )) && exit 2
  nmsh_drain
  zpty -t bridge || exit 1
  sleep 0.01
done
print READY
while IFS= read -r request; do
  [[ $request == <-> ]] || exit 1
  bytes=0
  deadline=$(( EPOCHREALTIME + ${NMSH_COMPLETION_QUERY_MS:-300} / 1000.0 ))
  zpty -w -n bridge $'\x07'
  until [[ -f $NMSH_COMPLETION_ROOT/done ]]; do
    (( EPOCHREALTIME >= deadline )) && exit 2
    nmsh_drain
    zpty -t bridge || exit 1
    sleep 0.005
  done
  print -r -- "DONE $request"
done
