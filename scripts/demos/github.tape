# /prs: the read-only GitHub workspace for this repository, through the recorder's own gh login.
# The one networked tape. The demo HOME cannot reach the keychain, so record it with
# GH_TOKEN="$(gh auth token)" npm run demos -- github  (inherited from the environment, never written to a file).
Output assets/readme/github.gif
# demo-still: assets/readme/github-prs.png 5s
# demo-still: assets/readme/github-pr.png 11.5s

Hide
Type "cd ~/Projects/demo && git remote add origin https://github.com/raiseCatError/notMyShell.git && clear && nmsh"
Enter
Sleep 5s
Show

Type "/prs"
Sleep 0.5s
Enter
Sleep 6s
Down 3
Sleep 1s
Enter
Sleep 6s
Escape
Sleep 1s
Escape
Sleep 1.5s
