# Diagnostic-only: deterministic scheduling of a genuine less repaint.
import errno, fcntl, json, os, pathlib, pty, re, select, signal, struct, subprocess, sys, time
root=pathlib.Path(sys.argv[1]); root.mkdir(parents=True,exist_ok=True)
source=pathlib.Path(__file__).with_suffix('.c').resolve()
lib=root/'less-window.so'
subprocess.run(['cc','-shared','-fPIC','-o',str(lib),str(source),'-ldl'],check=True)
fixture=root/'pager.txt';fixture.write_text('\n'.join(f'PROBE-LINE-{i}' for i in range(200)))
notify_read,notify_write=os.pipe();release_read,release_write=os.pipe()
pid,master=pty.fork()
if pid==0:
    os.close(notify_read);os.close(release_write)
    os.set_inheritable(notify_write,True);os.set_inheritable(release_read,True)
    fcntl.ioctl(1,termios_TIOCSWINSZ:=0x5414,struct.pack('HHHH',30,110,0,0))
    os.execvpe('less',['less','-PNMSH-PROBE-READY',str(fixture)],dict(os.environ,TERM='xterm-256color',LD_PRELOAD=str(lib),PROBE_NOTIFY=str(notify_write),PROBE_RELEASE=str(release_read)))
os.close(notify_write);os.close(release_read)
os.set_blocking(master,False);os.set_blocking(notify_read,False)
output=bytearray();events=''
def pump(until,seconds=5):
    global events
    deadline=time.monotonic()+seconds
    while not until():
        if time.monotonic()>deadline: raise RuntimeError('probe deadline: '+events+' '+repr(bytes(output)[-300:]))
        ready,_,_=select.select([master,notify_read],[],[],0.05)
        for fd in ready:
            try: data=os.read(fd,65536)
            except OSError as e:
                if e.errno==errno.EAGAIN: continue
                raise
            if fd==master: output.extend(data)
            else: events+=data.decode()
def resize(rows): fcntl.ioctl(master,0x5414,struct.pack('HHHH',rows,110,0,0))
try:
    pump(lambda:b'NMSH-PROBE-READY' in output)
    initial=len(output);resize(31)
    pump(lambda:'G' in events)
    resize(35) # Kernel alone delivers WINCH; no manual signal is injected.
    pump(lambda:'W' in events) # Original less handler has returned while its flush is gated.
    os.write(release_write,b'R')
    pump(lambda:b'NMSH-PROBE-READY' in output[initial:])
    # Observe the native process blocking on input with the final flag already set.
    pump(lambda:pathlib.Path(f'/proc/{pid}/wchan').read_text().strip() in ['wait_woken','n_tty_read','do_select','do_poll.constprop.0'])
    actual=struct.unpack('HHHH',fcntl.ioctl(master,0x5413,b'\0'*8))[:2]
    plain=re.sub(rb'\x1b\[[0-?]*[ -/]*[@-~]|\x1b[=>]',b'',bytes(output[initial:]))
    result={'events':events,'kernelSize':actual,'intermediateLine29':b'PROBE-LINE-29' in plain,'finalLine33':b'PROBE-LINE-33' in plain,'finalSizeResampled':'F' in events,'wchan':pathlib.Path(f'/proc/{pid}/wchan').read_text().strip(),'method':'less 590 original handler runs during gated intermediate repaint flush; release only after original handler returns; no synthetic output/keys/extra signals'}
    (root/'result.json').write_text(json.dumps(result,indent=2));(root/'output.bin').write_bytes(output)
    print(json.dumps(result),flush=True)
    assert actual==(35,110) and result['intermediateLine29'] and not result['finalLine33'] and not result['finalSizeResampled']
finally:
    os.kill(pid,signal.SIGKILL);os.waitpid(pid,0)
    for fd in [master,notify_read,release_write]:os.close(fd)
