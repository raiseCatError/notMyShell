import pexpect
import time

child = pexpect.spawn('nmsh', encoding='utf-8')

# wait for prompt
child.expect('❯', timeout=10)
time.sleep(2)

def type_cmd(cmd):
    for char in cmd:
        child.send(char)
        time.sleep(0.05)
    time.sleep(0.5)
    child.send('\r')

type_cmd('git status')
time.sleep(2)
type_cmd('sleep 3')
time.sleep(5)
type_cmd('echo done')
time.sleep(2)
child.send('exit\r')
child.expect(pexpect.EOF)
