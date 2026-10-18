# Live sessions: the window goes away mid-build (SIGHUP, as a closing window sends) and the build keeps going; nmsh reattaches.
Output assets/readme/sessions.gif

Hide
Type "cd ~/Projects/demo && clear"
Enter
Type "(sleep 13; pkill -HUP -P $$ -f bin/nmsh) &!"
Enter
Type "clear && nmsh"
Enter
Sleep 5s
Show

Type "./build.sh"
Sleep 0.6s
Enter
Sleep 7s
Hide
Sleep 1s
Type "clear"
Enter
Show
Sleep 1s
Type "nmsh"
Sleep 0.5s
Enter
Sleep 3s
Enter
Sleep 6s
