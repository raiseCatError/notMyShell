# Keep Awake: start, composer edge + Status Strip, the idle reminder, stop.
# Inert backend: the real slash, controller and presentation paths, but nothing is kept awake.
Output assets/readme/keep-awake.gif
# demo-still: assets/readme/keep-awake.png 21s
# demo-env: NMSH_DETERMINISTIC=1
# demo-env: NMSH_KEEP_AWAKE_BACKEND=inert
# demo-env: NMSH_DEMO_AWAKE_IDLE_MS=5000
# demo-config: {"statusStrip": {"enabled": true, "clock": true, "cpu": false, "ram": false, "battery": false, "uptime": false}}

Hide
Type "cd ~/Projects/demo && clear && nmsh"
Enter
Sleep 5s
Show

Sleep 1s
Type "/zoomies display"
Sleep 0.8s
Enter
Sleep 2s
Type "npm test"
Enter
Sleep 3.5s
Type "# the prompt stays free while it runs"
Sleep 1s
Ctrl+U
Sleep 10s
Type "/zoomies status"
Enter
Sleep 2.5s
Type "/zoomies stop"
Enter
Sleep 3s
