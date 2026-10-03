Require node
Require zsh

# Idle visuals (aurora), deterministic: fixed seed and frame clock (NMSH_DETERMINISTIC=1).
Output dev/tapes/output/idle-aurora.webm
Set Shell "zsh"
Set Width 1200
Set Height 650
Set FontSize 18
Set TypingSpeed 40ms
Set Framerate 24

Hide
Type "NMSH_IDLE_START_MS=20000 NMSH_DEMO_CONFIG='{"glyphStyle":"nerd","presentation":{"preset":"aurora"}}' node dev/tapes/launch.mjs" Enter
Wait+Screen /notMyShell/
Show
Type "/screensaver start aurora" Sleep 300ms Enter
Sleep 6s
Screenshot dev/tapes/output/idle-aurora.png
Sleep 2s
Type " "
Sleep 1500ms
Hide
Ctrl+D
Sleep 1s
