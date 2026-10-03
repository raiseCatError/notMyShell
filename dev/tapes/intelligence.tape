Require node
Require zsh

Output dev/tapes/output/intelligence.gif
Set Shell "zsh"
Set Width 1200
Set Height 650
Set FontSize 18
Set TypingSpeed 60ms

Hide
Type "node dev/tapes/launch.mjs" Enter
Wait+Screen /notMyShell/
Show
Type "printf demo" Enter
Sleep 1s
Type "/history" Enter
Sleep 2s
Hide
Escape
Ctrl+D
Sleep 1s
