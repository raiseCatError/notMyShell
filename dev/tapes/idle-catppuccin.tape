Require node
Require zsh

# Idle visuals (aurora), deterministic: fixed seed and frame clock (NMSH_DETERMINISTIC=1).
Output dev/tapes/output/idle-catppuccin.webm
Set Shell "zsh"
Set Width 1200
Set Height 650
Set FontSize 18
Set TypingSpeed 40ms
Set Framerate 24

Hide
Type "NMSH_IDLE_START_MS=30000 NMSH_DEMO_CONFIG='{"glyphStyle":"nerd","nmsh":{"palette":"catppuccinMocha","accent":"blue"}}' node dev/tapes/launch.mjs" Enter
Wait+Screen /notMyShell/
Show
Type "/screensaver start aurora" Sleep 300ms Enter
Sleep 6s
Screenshot dev/tapes/output/idle-catppuccin.png
Sleep 2s
Type " "
Sleep 1500ms
Hide
Ctrl+D
Sleep 1s
