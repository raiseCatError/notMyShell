#!/bin/bash
rm -f assets/readme/demo/demo.cast
tmux new-session -d -s demorec -x 100 -y 20 "asciinema rec -c nmsh assets/readme/demo/demo.cast"
sleep 4

tmux send-keys -t demorec "git status" Enter
sleep 2

tmux send-keys -t demorec "sleep 3" Enter
sleep 5

tmux send-keys -t demorec "echo 'NMSh animated activity'" Enter
sleep 2

tmux send-keys -t demorec "exit" Enter
sleep 2
