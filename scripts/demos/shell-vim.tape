# Enter/exit real Vim, then switch to Fish with the NMSh theme/settings preserved.
Output assets/readme/shell-vim.gif
# demo-config: {"nmsh":{"palette":"catppuccinMocha"}}

Hide
Type "cd ~/Projects/demo && clear && nmsh"
Enter
Sleep 5s
Show

Type "vim -Nu NONE README.md"
Enter
Sleep 4s
Escape
Type ":q"
Enter
Sleep 3s
Type "/shell fish"
Enter
Hide
Sleep 15s
Type "/clear"
Enter
Sleep 1s
Show
Sleep 3s
Type "set -l greeting hello"
Sleep 2s
Ctrl+U
Type "/shell zsh"
Enter
Sleep 3s
