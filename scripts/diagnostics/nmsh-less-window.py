# Identical gated native-less timing against unmodified application snapshots.
import json, os, pathlib, select, subprocess, sys, threading, time
root=pathlib.Path(sys.argv[1]);root.mkdir(parents=True,exist_ok=True)
repo=pathlib.Path.cwd();lib=root/'less-window.so'
subprocess.run(['cc','-shared','-fPIC','-o',str(lib),'scripts/diagnostics/less-window.c','-ldl'],check=True)
fixture=pathlib.Path('tests/sessionLifecycle.test.ts').read_text()
variants={'dev':'be3f6abe26a112a39f3a23c800954b8981ae5b0e','combined':'3173058d48668d6c3f5ba8839518a7dfb91beb15','dev-fixed':'0b60d625b7aa17e84ce2e505bec07b0300baed26','combined-fixed':'bd1d7750fcb84263ba864c5e721585f6551890fb'}
results=[]
for label,sha in variants.items():
    path=root/label;subprocess.run(['git','worktree','add','--detach',str(path),sha],check=True)
    (path/'node_modules').symlink_to(repo/'node_modules',target_is_directory=True)
    subprocess.run(['npm','run','build'],cwd=path,check=True)
    notify=root/f'{label}.notify';release=root/f'{label}.release';os.mkfifo(notify);os.mkfifo(release)
    nfd=os.open(notify,os.O_RDWR|os.O_NONBLOCK);rfd=os.open(release,os.O_RDWR|os.O_NONBLOCK)
    changed=fixture.replace('`less -P${pagerPrompt} pager.txt`',f'`LD_PRELOAD={lib} PROBE_NOTIFY_PATH={notify} PROBE_RELEASE_PATH={release} less -P${{pagerPrompt}} pager.txt`')
    assert changed!=fixture
    (path/'tests/sessionLifecycle.test.ts').write_text(changed)
    events=[];stopped=threading.Event()
    def coordinate():
        while not stopped.is_set():
            ready,_,_=select.select([nfd],[],[],0.05)
            if not ready: continue
            data=os.read(nfd,4096).decode();events.extend(data)
            if 'W' in data: os.write(rfd,b'R') # Release only after the original less WINCH handler returned.
    worker=threading.Thread(target=coordinate);worker.start()
    started=time.monotonic()
    try:
        with (root/f'{label}.log').open('w') as log:
            result=subprocess.run(['node','--import=tsx','--test','--test-name-pattern=vim and less survive detach and repaint after reattach','tests/sessionLifecycle.test.ts'],cwd=path,stdout=log,stderr=subprocess.STDOUT,timeout=90)
        code=result.returncode
    finally:
        stopped.set();worker.join();os.close(nfd);os.close(rfd)
    results.append({'variant':label,'sha':sha,'exit':code,'events':''.join(events),'seconds':round(time.monotonic()-started,3)})
    print(json.dumps(results[-1]),flush=True);(root/'results.json').write_text(json.dumps(results,indent=2))
assert all(row['exit']!=0 and 'G' in row['events'] and 'W' in row['events'] for row in results[:2]),results
assert all(row['exit']==0 and 'G' not in row['events'] and 'F' in row['events'] for row in results[2:]),results
