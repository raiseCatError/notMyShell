# Status Strip 2.0: /strip Studio with its live preview, then the strip on the bottom edge.
Output assets/readme/status-strip.gif
# demo-still: assets/readme/status-strip-studio.png 4.5s
# demo-still: assets/readme/status-strip.png 13s
# demo-config: {"statusStrip": {"enabled": true, "edge": "bottom", "style": "powerline", "clock": true, "cpu": true, "ram": true, "battery": false, "uptime": false}}

Hide
Type "cd ~/Projects/demo && clear && nmsh"
Enter
Sleep 5s
Show

Type "/strip"
Sleep 0.5s
Enter
Sleep 2s
Down
Sleep 1.2s
Down
Sleep 1.5s
Escape
Sleep 1s
Type "git status --short"
Enter
Sleep 2s
Type "ls"
Enter
Sleep 3s
