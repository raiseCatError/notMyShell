import concurrent.futures,json,os,pathlib,subprocess,time,sys,signal
root=pathlib.Path(__file__).resolve().parent
out=pathlib.Path(os.environ.get('NMSH_DIAG_OUTPUT',str(root/'results')));out.mkdir(exist_ok=True)
repos={k:pathlib.Path(v).resolve() for k,v in json.loads(sys.argv[1]).items()}
assert subprocess.check_output(['git','rev-parse','HEAD'],cwd=repos['baseline'],text=True).strip()=='be3f6abe26a112a39f3a23c800954b8981ae5b0e'
assert subprocess.check_output(['git','rev-parse','HEAD'],cwd=repos['merged'],text=True).strip()=='c690de055daeb7b33ed8b5e302ef01133b3e55b4'
def run(case):
 label,control,index=case;repo=repos[label];folder=out/(label+('-controlled-' if control else '-natural-')+str(index));folder.mkdir()
 for f in ['trace-runtime.mjs','entry.mjs','test.mjs']:(folder/f).write_text((root/(f+'.template')).read_text().replace('@REPO@',str(repo)))
 if control:(folder/'control').touch()
 cmd=['node','--import=tsx','--import='+str(repo/'scripts/test-file-teardown.mjs'),'--import='+str(folder/'test.mjs'),'--test','--test-name-pattern=live zsh: a waiting read gets the answer','tests/inputOwnershipLive.test.ts']
 started=time.time()
 with (folder/'test.log').open('w') as log:
  child=subprocess.Popen(cmd,cwd=repo,stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
  timedout=False
  try:code=child.wait(timeout=280)
  except subprocess.TimeoutExpired:
   timedout=True
   # Capture the ownership tree before ending any parent, including detached descendants.
   table=[line.split(None,3) for line in subprocess.check_output(['ps','-A','-o','pid=,ppid=,pgid=,comm='],text=True).splitlines()]
   owned={child.pid};found=[]
   while True:
    new=[row for row in table if int(row[1]) in owned and int(row[0]) not in owned]
    if not new:break
    found.extend(new);owned.update(int(row[0]) for row in new)
   for row in reversed(found):
    try:os.kill(int(row[0]),signal.SIGKILL)
    except ProcessLookupError:pass
   child.kill();code=child.wait()
  result=dict(label=label,controlled=control,index=index,exit=code,timeout=timedout,seconds=time.time()-started)
  (folder/'outcome.json').write_text(json.dumps(result,indent=2))
 return result
# Fixed comparison budget, never rerun a failing cell. Two workers match normal canonical concurrency.
cases=[(k,False,i) for i in range(1) for k in repos]+[(k,True,0) for k in repos]
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:rows=list(pool.map(run,cases))
(out/'results.json').write_text(json.dumps({'rows':rows,'heads':{k:subprocess.check_output(['git','rev-parse','HEAD'],cwd=p,text=True).strip() for k,p in repos.items()},'node':subprocess.check_output(['node','--version'],text=True).strip(),'note':'Controlled runnable observations prove reachability only; never a historical-cause or validation-green claim'},indent=2));print(json.dumps(rows,indent=2))
