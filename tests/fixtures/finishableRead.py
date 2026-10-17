#!/usr/bin/env python3
"""A real canonical terminal reader that the test can finish after observing an unsent reply."""
import pathlib, select, sys, termios

fd = sys.stdin.fileno()
saved = termios.tcgetattr(fd)
try:
    mode = termios.tcgetattr(fd)
    mode[3] |= termios.ICANON | termios.ECHO
    termios.tcsetattr(fd, termios.TCSANOW, mode)
    print('Quick? ', end='', flush=True)
    while not pathlib.Path(sys.argv[1]).exists():
        if select.select([sys.stdin], [], [], 0.05)[0]:
            sys.stdin.readline()
            break
finally:
    termios.tcsetattr(fd, termios.TCSANOW, saved)
print('READ-FINISHED')
