Require node
Require zsh

Output dev/tapes/output/command.gif
Set Shell "zsh"
Set Width 1200
Set Height 650
Set FontSize 18
Set TypingSpeed 60ms

Hide
Type "node dev/tapes/launch.mjs" Enter
Wait+Screen /notMyShell/
Show
Type "echo 'Hello from NMSh'" Enter
Wait+Screen /Hello from NMSh/
Sleep 2s
Hide
Ctrl+D
Sleep 1s
