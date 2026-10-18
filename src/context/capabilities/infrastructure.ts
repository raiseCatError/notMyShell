import {createHash} from 'node:crypto';
import {delimiter, isAbsolute, join} from 'node:path';
import {defineCapability, type CapabilityDefinition} from '../capability.js';
import {findNearest, isDirectory, LARGE_METADATA_BYTES, listNames, parseJsonData, parseYamlData, readMetadataText, readVersionFile, record, text} from '../services.js';

/**
 * Infrastructure context from local configuration only. Kubeconfig is parsed as
 * data: contexts and namespaces are read, `users` (including exec credential
 * plugins) are never consulted, and nothing contacts a cluster, registry or
 * state backend.
 */

export interface KubernetesFact {context: string; namespace?: string; cluster?: string}

export const kubernetes = defineCapability<KubernetesFact>({
  id: 'infra.kubernetes',
  title: 'Kubernetes context',
  reads: ['KUBECONFIG files (at most 16, absolute paths) or ~/.kube/config: current-context and contexts only; users/exec are never read'],
  scope: 'user', family: 'metadata', cost: 'bounded-async', trust: 'user-metadata', sensitivity: 'public', persistence: 'snapshot-safe',
  fields: ['context', 'namespace', 'cluster'], env: ['KUBECONFIG'], ttlMs: 5_000, timeoutMs: 1500, invalidateOn: ['command'],
  preview: {context: 'dev-cluster', namespace: 'web', cluster: 'dev'},
  async resolve(context) {
    const configured = context.env.values.KUBECONFIG;
    const files = configured ? configured.split(delimiter).filter(isAbsolute).slice(0, 16) : [join(context.home, '.kube', 'config')];
    let current: string | undefined;
    const contexts = new Map<string, {namespace?: string; cluster?: string}>();
    for (const file of files) {
      const content = await readMetadataText(file, LARGE_METADATA_BYTES);
      if (content === undefined) continue;
      const data = await parseYamlData(content);
      // A merged KUBECONFIG takes the first current-context and the first definition of each context.
      current ??= record(data) ? text(data['current-context'], 253) : /^current-context:[ \t]*(['"]?)(.*?)\1[ \t]*$/mu.exec(content)?.[2]?.slice(0, 253) || undefined;
      if (record(data) && Array.isArray(data.contexts)) for (const item of data.contexts.slice(0, 256)) {
        if (!record(item) || typeof item.name !== 'string' || contexts.has(item.name)) continue;
        const detail = record(item.context) ? item.context : {};
        contexts.set(item.name, {namespace: text(detail.namespace, 63), cluster: text(detail.cluster, 253)});
      }
      if (context.signal.aborted) return undefined;
    }
    if (!current) return undefined;
    const detail = contexts.get(current) ?? {};
    return {value: {context: current, ...(detail.namespace ? {namespace: detail.namespace} : {}), ...(detail.cluster ? {cluster: detail.cluster} : {})},
      evidence: configured ? 'KUBECONFIG' : '~/.kube/config'};
  },
});

export interface DockerFact {context: string}

export const docker = defineCapability<DockerFact>({
  id: 'infra.docker',
  title: 'Docker context',
  reads: ['DOCKER_CONTEXT, DOCKER_HOST', 'Docker CLI config.json currentContext (DOCKER_CONFIG or ~/.docker)'],
  scope: 'user', family: 'metadata', cost: 'bounded-async', trust: 'user-metadata', sensitivity: 'public', persistence: 'snapshot-safe',
  fields: ['context'], env: ['DOCKER_CONTEXT', 'DOCKER_HOST', 'DOCKER_CONFIG'], ttlMs: 5_000, timeoutMs: 1000, invalidateOn: ['command'],
  preview: {context: 'colima'},
  async resolve(context) {
    const env = context.env.values;
    if (env.DOCKER_CONTEXT) return {value: {context: env.DOCKER_CONTEXT}, evidence: 'DOCKER_CONTEXT'};
    if (env.DOCKER_HOST) return {value: {context: env.DOCKER_HOST}, evidence: 'DOCKER_HOST'};
    const directory = env.DOCKER_CONFIG && isAbsolute(env.DOCKER_CONFIG) ? env.DOCKER_CONFIG : join(context.home, '.docker');
    const config = parseJsonData(await readMetadataText(join(directory, 'config.json'), LARGE_METADATA_BYTES));
    const current = record(config) ? text(config.currentContext, 128) : undefined;
    return {value: {context: current ?? 'default'}, evidence: current ? 'Docker CLI config' : 'no context configured (default)'};
  },
});

export interface TerraformFact {workspace: string; tool: 'terraform' | 'opentofu'}

export const terraform = defineCapability<TerraformFact>({
  id: 'infra.terraform',
  title: 'Terraform / OpenTofu workspace',
  reads: ['*.tf, *.tofu file names in the working directory', 'TF_WORKSPACE', 'TF_DATA_DIR or .terraform/environment', '.terraform.lock.hcl provider sources'],
  scope: 'workspace', family: 'metadata', cost: 'bounded-async', trust: 'workspace', sensitivity: 'public', persistence: 'snapshot-safe',
  fields: ['workspace', 'tool'], env: ['TF_WORKSPACE', 'TF_DATA_DIR'], ttlMs: 10_000, timeoutMs: 1000, invalidateOn: ['command'],
  preview: {workspace: 'staging', tool: 'terraform'},
  async resolve(context) {
    const names = await listNames(context.cwd, 1024);
    const tofu = names.some(name => name.endsWith('.tofu') || name.endsWith('.tofu.json'));
    const configured = tofu || names.some(name => name.endsWith('.tf') || name.endsWith('.tf.json')) || names.includes('.terraform');
    if (!configured) return undefined;
    const env = context.env.values;
    const dataDir = env.TF_DATA_DIR ? (isAbsolute(env.TF_DATA_DIR) ? env.TF_DATA_DIR : join(context.cwd, env.TF_DATA_DIR)) : join(context.cwd, '.terraform');
    const workspace = env.TF_WORKSPACE ?? await readVersionFile(join(dataDir, 'environment')) ?? 'default';
    let tool: TerraformFact['tool'] = tofu ? 'opentofu' : 'terraform';
    if (!tofu && names.includes('.terraform.lock.hcl') && /registry\.opentofu\.org\//u.test(await readMetadataText(join(context.cwd, '.terraform.lock.hcl'), LARGE_METADATA_BYTES) ?? '')) tool = 'opentofu';
    return {value: {workspace, tool}, evidence: env.TF_WORKSPACE ? 'TF_WORKSPACE' : await isDirectory(dataDir) ? 'Terraform data directory' : 'no workspace selected (default)'};
  },
});

export interface HelmChartFact {name: string; version?: string; appVersion?: string}

export const helmChart = defineCapability<HelmChartFact>({
  id: 'infra.helm',
  title: 'Helm chart',
  reads: ['nearest Chart.yaml up to the repository root (name, version, appVersion)'],
  scope: 'workspace', family: 'metadata', cost: 'bounded-async', trust: 'workspace', sensitivity: 'public', persistence: 'snapshot-safe',
  fields: ['name', 'version', 'appVersion'], env: [], ttlMs: 30_000, timeoutMs: 1000, invalidateOn: ['command'],
  preview: {name: 'web', version: '1.4.2', appVersion: '2.0.0'},
  async resolve(context) {
    const chart = await findNearest(context, ['Chart.yaml']);
    const data = chart ? await parseYamlData(await readMetadataText(chart.path)) : undefined;
    const name = record(data) ? text(data.name, 128) : undefined;
    if (!record(data) || !name) return undefined;
    const version = text(data.version, 64), appVersion = text(data.appVersion, 64);
    return {value: {name, ...(version ? {version} : {}), ...(appVersion ? {appVersion} : {})}, evidence: 'Chart.yaml'};
  },
});

export interface PulumiFact {project: string; stack?: string}

export const pulumi = defineCapability<PulumiFact>({
  id: 'infra.pulumi',
  title: 'Pulumi project and stack',
  reads: ['nearest Pulumi.yaml (project name)', 'the Pulumi CLI workspace settings file for that project (selected stack) under PULUMI_HOME or ~/.pulumi'],
  scope: 'workspace', family: 'metadata', cost: 'bounded-async', trust: 'user-metadata', sensitivity: 'public', persistence: 'snapshot-safe',
  fields: ['project', 'stack'], env: ['PULUMI_HOME'], ttlMs: 10_000, timeoutMs: 1000, invalidateOn: ['command'],
  preview: {project: 'platform', stack: 'dev'},
  async resolve(context) {
    const projectFile = await findNearest(context, ['Pulumi.yaml', 'Pulumi.yml']);
    const data = projectFile ? await parseYamlData(await readMetadataText(projectFile.path)) : undefined;
    const project = record(data) ? text(data.name, 128) : undefined;
    if (!projectFile || !project) return undefined;
    let stack: string | undefined;
    if (context.fields.has('stack') && /^[A-Za-z0-9_.-]{1,100}$/u.test(project)) {
      // The CLI keys its per-project workspace settings by project name and the SHA-1 of the project file path.
      const home = context.env.values.PULUMI_HOME && isAbsolute(context.env.values.PULUMI_HOME) ? context.env.values.PULUMI_HOME : join(context.home, '.pulumi');
      const digest = createHash('sha1').update(projectFile.path).digest('hex');
      const settings = parseJsonData(await readMetadataText(join(home, 'workspaces', `${project}-${digest}-workspace.json`)));
      stack = record(settings) ? text(settings.stack, 128) : undefined;
    }
    return {value: {project, ...(stack ? {stack} : {})}, evidence: stack ? 'Pulumi.yaml, Pulumi workspace settings' : 'Pulumi.yaml'};
  },
});

export const INFRASTRUCTURE_CAPABILITIES = [kubernetes, docker, terraform, helmChart, pulumi] as CapabilityDefinition<unknown>[];
