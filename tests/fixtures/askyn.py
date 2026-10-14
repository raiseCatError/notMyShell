#!/usr/bin/env python3
"""A harmless stand-in for e2fsck's yes/no questions: the terminal in single-key, no-echo mode (as e2fsck's ask_yn sets
it), one key per answer, Enter takes the default. Repairs nothing; prints what it was told."""
import os, sys, termios, tty

questions = sys.argv[1:] or ['Padding at end of inode bitmap is not set. Fix<y>? ']
fd = sys.stdin.fileno()
saved = termios.tcgetattr(fd)
answers = []
try:
    for question in questions:
        mode = termios.tcgetattr(fd)
        mode[3] &= ~(termios.ICANON | termios.ECHO)
        mode[6][termios.VMIN], mode[6][termios.VTIME] = 1, 0
        termios.tcsetattr(fd, termios.TCSANOW, mode)
        sys.stdout.write(question); sys.stdout.flush()
        key = os.read(fd, 1).decode(errors='replace')
        termios.tcsetattr(fd, termios.TCSANOW, saved)
        answer = 'yes' if key in ('y', 'Y', '\r', '\n') else 'no'
        answers.append(answer)
        sys.stdout.write(answer + '\n\n'); sys.stdout.flush()
finally:
    termios.tcsetattr(fd, termios.TCSANOW, saved)
print('ANSWERS=' + ','.join(answers))
