#!/bin/zsh -f
# This parent owns a hidden PTY, never the frontend's terminal.
emulate -LR zsh
zmodload zsh/zpty || exit 1
zpty -b bridge /bin/zsh -i || exit 1
trap 'zpty -d bridge 2>/dev/null' EXIT
local discarded
integer bytes=0
nmsh_drain() {
  while zpty -r bridge discarded; do
    (( bytes += 4 * ${#discarded} ))
    (( bytes > 1048576 )) && exit 2
  done
}
until [[ -f $NMSH_COMPLETION_ROOT/ready ]]; do
  nmsh_drain
  zpty -t bridge || exit 1
  sleep 0.01
done
print READY
while IFS= read -r request; do
  [[ $request == <-> ]] || exit 1
  bytes=0
  zpty -w -n bridge $'\x07'
  until [[ -f $NMSH_COMPLETION_ROOT/done ]]; do
    nmsh_drain
    zpty -t bridge || exit 1
    sleep 0.005
  done
  print -r -- "DONE $request"
done
