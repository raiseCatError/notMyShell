#!/usr/bin/env bash
# #443 watchdog: every 2 s, the state of every process in the test sandboxes (fish, its commands, NMSh's frontend and
# session service): stat, wchan, elapsed, command, and, for anything sleeping in the kernel on a tty, its kernel stack.
out=${1:?out file}
while true; do
  {
    echo "=== $(date +%T.%N)"
    ps -eo pid,ppid,pgid,tpgid,stat,wchan:28,etimes,tty,args --sort=pid | grep -E 'fish|nmsh|/run |adb|printf|node .*src/index' | grep -v -E 'grep|443-watch'
    for pid in $(pgrep -f 'My Tools/run|platform-tools/adb' ; pgrep -x fish); do
      w=$(cat /proc/$pid/wchan 2>/dev/null)
      case "$w" in *tty*|*wait_woken*|*n_tty*|*pipe*) echo "--- stack $pid ($w)"; sudo cat /proc/$pid/stack 2>/dev/null | head -12 ;; esac
    done
  } >> "$out" 2>&1
  sleep 2
done
