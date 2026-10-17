import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';

test('production publishing is manual, release-gated and isolated behind environment approval', async () => {
  const workflow = parse(readFileSync(new URL('../../.github/workflows/website-deploy.yml', import.meta.url), 'utf8'));
  assert.deepEqual(Object.keys(workflow.on), ['workflow_dispatch']);
  assert.equal(workflow.on.workflow_dispatch.inputs.confirmation.required, true);
  assert.deepEqual(workflow.permissions, { contents: 'read' });
  assert.match(workflow.jobs.build.if, /github\.ref == 'refs\/heads\/master'/);
  assert.match(workflow.jobs.build.if, /inputs\.confirmation == 'nmsh\.raisecaterror\.com'/);
  assert.equal(workflow.jobs.build.defaults.run['working-directory'], 'website');
  assert.ok(workflow.jobs.build.steps.some(step => step.run === 'npm run build:launch'));
  assert.doesNotMatch(JSON.stringify(workflow.jobs.build), /secrets\./);
  const deploy = workflow.jobs.deploy;
  assert.equal(deploy.needs, 'build');
  assert.equal(deploy.environment.name, 'nmsh-production');
  const upload = deploy.steps.find(step => step.env?.CLOUDFLARE_API_TOKEN);
  assert.ok(upload);
  assert.match(upload.run, /wrangler pages deploy dist --project-name nmsh --branch master/);
  assert.equal(deploy.steps.filter(step => step.env?.CLOUDFLARE_API_TOKEN).length, 1);
  const preflight = upload.run.match(/<<'NODE'\n([\s\S]+?)\nNODE/)[1];
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const checkTarget = new AsyncFunction('process', 'fetch', preflight);
  const environment = { env: { CLOUDFLARE_ACCOUNT_ID: '0123456789abcdef0123456789abcdef', CLOUDFLARE_API_TOKEN: 'test-only' } };
  const config = { owner: 'raiseCatError', repo_name: 'notMyShell', production_deployments_enabled: false, deployments_enabled: false, preview_deployment_setting: 'none' };
  const response = async () => ({ ok: true, json: async () => ({ success: true, result: { name: 'nmsh', production_branch: 'master', build_config: { root_dir: 'website' }, source: { type: 'github', config } } }) });
  await checkTarget(environment, response);
  config.production_deployments_enabled = true;
  await assert.rejects(checkTarget(environment, response), /manual-only settings changed/);
  for (const job of Object.values(workflow.jobs)) {
    for (const step of job.steps) if (step.uses) assert.match(step.uses, /@[a-f\d]{40}$/);
  }
});
