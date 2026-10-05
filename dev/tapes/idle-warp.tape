Require node
Require zsh

# Idle visuals (warp), deterministic: fixed seed and frame clock (NMSH_DETERMINISTIC=1).
Output dev/tapes/output/idle-warp.webm
Set Shell "zsh"
Set Width 1200
Set Height 650
Set FontSize 18
Set TypingSpeed 40ms
Set Framerate 24

Hide
Type "NMSH_IDLE_START_MS=0 NMSH_DEMO_CONFIG='{"glyphStyle":"nerd","presentation":{"preset":"lavender"}}' node dev/tapes/launch.mjs" Enter
Wait+Screen /notMyShell/
Show
Type "/screensaver start warp" Sleep 300ms Enter
Sleep 6s
Screenshot dev/tapes/output/idle-warp.png
Sleep 2s
Type " "
Sleep 1500ms
Hide
Ctrl+D
Sleep 1s
