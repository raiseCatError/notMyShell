# Sticky block controls: one long command block at its beginning, middle and end, then the hand-off to the next block.
# The controls ride on NMSh's own sticky header row (its viewport, not the terminal's native scrollback).
Output docs/captures/sticky-controls.gif
# demo-config: {"outputFolding": "never"}
# demo-still: docs/captures/sticky-1-beginning.png 3.4s
# demo-still: docs/captures/sticky-2-middle.png 6.4s
# demo-still: docs/captures/sticky-3-end.png 9.4s
# demo-still: docs/captures/sticky-4-transition.png 11.6s
# demo-still: docs/captures/sticky-5-next-block.png 14.6s

Hide
Type "cd ~/Projects/demo && clear && nmsh"
Enter
Sleep 5s
Type "seq -f 'build step %g of 300' 1 300"
Enter
Sleep 1.5s
Type "seq -f 'test case %g passed' 1 40"
Enter
Sleep 1.5s
Show

Sleep 0.5s
PageUp 11
Sleep 2.4s
PageDown 4
Sleep 2.6s
PageDown 4
Sleep 2.6s
PageDown 2
Sleep 3s
PageDown 1
Sleep 4s
