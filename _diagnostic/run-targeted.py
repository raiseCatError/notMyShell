import concurrent.futures,subprocess,pathlib,json
root=pathlib.Path(__file__).parent
cmd=['node','--import=tsx','--import=./_diagnostic/trace-input-test.mjs','--test','--test-name-pattern=live zsh: a waiting read gets the answer','--test-timeout=120000','tests/inputOwnershipLive.test.ts']
def run(i):
 with (root/f'targeted-{i}.log').open('w') as out:r=subprocess.run(cmd,stdout=out,stderr=subprocess.STDOUT)
 return dict(iteration=i,exit=r.returncode)
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:rs=list(pool.map(run,range(6)))
(root/'targeted-results.json').write_text(json.dumps(rs,indent=2));print(rs)
raise SystemExit(any(r['exit'] for r in rs))
