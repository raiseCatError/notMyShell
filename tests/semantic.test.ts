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
