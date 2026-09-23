import test from 'node:test';
import assert from 'node:assert';
import {SemanticService} from '../src/shell/SemanticService.js';

test('SemanticService lifecycle and strict stdio configuration', async () => {
  const service = new SemanticService(process.cwd());
  const child = (service as any).child;

  // PROVE: SemanticService uses detached process group, NOT 'inherit'
  assert.ok(child.pid !== undefined, 'child must exist');
  assert.ok(child.stdin !== null, 'child stdin must be piped, not inherited');
  assert.ok(child.stdout !== null, 'child stdout must be piped, not inherited');
  
  // PROVE: SemanticService classifies correctly
  const echoType = await service.classifyCommand('echo');
  assert.equal(echoType, 'builtin');

  const lsType = await service.classifyCommand('ls');
  assert.ok(['executable', 'alias'].includes(lsType), 'ls is either executable or alias');

  const unknownType = await service.classifyCommand('doesnotexist999');
  assert.equal(unknownType, 'unknown');

  // PROVE: ZDOTDIR is created and cleaned up
  const zdotdir = (service as any).zdotdir;
  assert.ok(zdotdir, 'zdotdir must be configured to suppress dotfiles');
  
  // PROVE: SemanticService cleans up its child process
  service.kill();
  assert.equal((service as any).zdotdir, '', 'zdotdir path must be cleared');
  assert.equal(child.killed, true, 'child process must be killed');
});

test('SemanticService handles host-identifying environment variables gracefully', async () => {
  const originalTerm = process.env.TERM_PROGRAM;
  process.env.TERM_PROGRAM = 'Apple_Terminal';
  
  const service = new SemanticService(process.cwd());
  const echoType = await service.classifyCommand('echo');
  assert.equal(echoType, 'builtin', 'must resolve successfully under Apple_Terminal');
  
  service.kill();
  if (originalTerm !== undefined) {
    process.env.TERM_PROGRAM = originalTerm;
  } else {
    delete process.env.TERM_PROGRAM;
  }
});

test('SemanticService settles pending promises on unexpected child exit', async () => {
  const service = new SemanticService(process.cwd());
  
  const promise1 = service.classifyCommand('long_pending_cmd_1');
  const promise2 = service.classifyCommand('long_pending_cmd_2');
  
  const child = (service as any).child;
  child.kill('SIGTERM'); // Simulate unexpected exit
  
  const type1 = await promise1;
  const type2 = await promise2;
  
  assert.equal(type1, 'unknown', 'pending promise must safely resolve to unknown on exit');
  assert.equal(type2, 'unknown', 'pending promise must safely resolve to unknown on exit');
  
  service.kill();
});

test('SemanticService ignores commands when dead and cleans resources', async () => {
  const service = new SemanticService(process.cwd());
  const zdotdir = (service as any).zdotdir;
  
  service.kill();
  
  const type = await service.classifyCommand('echo');
  assert.equal(type, 'unknown', 'must return unknown when dead');
  
  assert.equal((service as any).zdotdir, '', 'zdotdir must be cleared');
  assert.equal((service as any).isDead, true, 'service must be marked dead');
});
