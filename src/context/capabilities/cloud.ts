import {isAbsolute, join} from 'node:path';
import {defineCapability, type CapabilityDefinition} from '../capability.js';
import {LARGE_METADATA_BYTES, parseIniData, parseJsonData, readMetadataText, readVersionFile, record, text} from '../services.js';

/**
 * Cloud context from LOCAL, NON-SECRET evidence only. No cloud API is called,
 * no authentication flow is started, no `credential_process` or SSO helper is
 * run, and secret values are never read into a fact, cache or log:
 *
 * - environment credentials are known by presence only (the shell snapshot
 *   never carries their values);
 * - the AWS shared credentials file is scanned line by line for the selected
 *   profile's expiry keys only, and only when a visible module asks for the
 *   expiry; every other line is discarded as it is read;
 * - account identifiers and signed-in identities are private, display-only
 *   fields: they never enter command snapshots or journals, and the first-party
 *   modules do not show them.
 */

const ACCOUNT_POLICY = {sensitivity: 'private', persistence: 'display-only'} as const;

export interface AwsFact {
  profile?: string;
  region?: string;
  account?: string;
  sso?: boolean;
  /** Epoch milliseconds when temporary credentials expire, when locally recorded. */
  expiresAt?: number;
  credentials?: 'environment' | 'web-identity' | 'sso' | 'process' | 'profile';
}

const EXPIRY_KEYS = new Set(['x_security_token_expires', 'aws_expiration', 'expiration']);

/** Section names, and the selected section's expiry, from the credentials file; nothing else survives the scan. */
async function scanCredentials(path: string, section: string | undefined): Promise<{sections: Set<string>; expires?: string}> {
  const content = await readMetadataText(path, LARGE_METADATA_BYTES);
  const sections = new Set<string>();
  let current: string | undefined, expires: string | undefined;
  for (const raw of (content ?? '').split(/\r?\n/u).slice(0, 8192)) {
    const line = raw.trim();
    const header = /^\[([^\]]{1,256})\]$/u.exec(line);
    if (header) { current = header[1]!.trim(); sections.add(current); continue; }
    if (current !== section || expires !== undefined) continue;
    const pair = /^([A-Za-z_]{1,64})\s*=\s*(\S{1,64})$/u.exec(line);
    if (pair && EXPIRY_KEYS.has(pair[1]!.toLowerCase())) expires = pair[2];
  }
  return {sections, ...(expires ? {expires} : {})};
}

const epoch = (value: string | undefined): number | undefined => {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
};

export const aws = defineCapability<AwsFact>({
  id: 'cloud.aws',
  title: 'AWS profile and region',
  reads: ['AWS_VAULT, AWS_PROFILE, AWS_DEFAULT_PROFILE, AWS_REGION, AWS_DEFAULT_REGION, AWS_CONFIG_FILE', 'the selected profile in ~/.aws/config (region, SSO and role metadata)',
    'credential presence (never values)', 'expiry keys of the selected profile in the shared credentials file, only when expiry is shown'],
  scope: 'user', family: 'metadata', cost: 'bounded-async', trust: 'user-metadata', sensitivity: 'public', persistence: 'snapshot-safe',
  fieldPolicy: {account: ACCOUNT_POLICY, expiresAt: {sensitivity: 'public', persistence: 'display-only'}},
  fields: ['profile', 'region', 'account', 'sso', 'expiresAt', 'credentials'],
  env: ['AWS_PROFILE', 'AWS_DEFAULT_PROFILE', 'AWS_REGION', 'AWS_DEFAULT_REGION', 'AWS_CONFIG_FILE', 'AWS_SHARED_CREDENTIALS_FILE', 'AWS_VAULT',
    'AWS_CREDENTIAL_EXPIRATION', 'AWS_SESSION_EXPIRATION', 'AWS_ACCESS_KEY_ID', 'AWS_SESSION_TOKEN', 'AWS_WEB_IDENTITY_TOKEN_FILE'],
  ttlMs: 10_000, timeoutMs: 1500, invalidateOn: ['command'],
  preview: {profile: 'dev', region: 'eu-west-1', sso: true, credentials: 'sso'},
  async resolve(context) {
    const env = context.env.values, present = context.env.present;
    const configPath = env.AWS_CONFIG_FILE && isAbsolute(env.AWS_CONFIG_FILE) ? env.AWS_CONFIG_FILE : join(context.home, '.aws', 'config');
    const credentialsPath = env.AWS_SHARED_CREDENTIALS_FILE && isAbsolute(env.AWS_SHARED_CREDENTIALS_FILE) ? env.AWS_SHARED_CREDENTIALS_FILE : join(context.home, '.aws', 'credentials');
    const config = parseIniData(await readMetadataText(configPath, LARGE_METADATA_BYTES));
    const selected = env.AWS_VAULT ?? env.AWS_PROFILE ?? env.AWS_DEFAULT_PROFILE;
    const wantsExpiry = context.fields.has('expiresAt');
    const environmentCredentials = present.has('AWS_ACCESS_KEY_ID');
    // The credentials file is touched only to learn whether a default profile exists (when config does not say) or, on demand, its expiry.
    const needDefault = selected === undefined && !config?.has('default');
    const scan = needDefault || (wantsExpiry && !environmentCredentials) ? await scanCredentials(credentialsPath, selected ?? 'default') : undefined;
    const profile = selected ?? (config?.has('default') || scan?.sections.has('default') ? 'default' : undefined);
    if (!profile && !environmentCredentials && !env.AWS_REGION && !env.AWS_DEFAULT_REGION) return undefined;
    const section = profile ? config?.get(profile === 'default' ? 'default' : `profile ${profile}`) ?? config?.get(profile) : undefined;
    const region = env.AWS_REGION ?? env.AWS_DEFAULT_REGION ?? text(section?.get('region'), 32);
    const roleAccount = /^arn:aws[\w-]*:iam::(\d{12}):/u.exec(section?.get('role_arn') ?? '')?.[1];
    const account = text(section?.get('sso_account_id'), 12) ?? roleAccount;
    const sso = Boolean(section?.has('sso_session') || section?.has('sso_start_url'));
    const credentials: AwsFact['credentials'] = environmentCredentials ? 'environment' : present.has('AWS_WEB_IDENTITY_TOKEN_FILE') ? 'web-identity'
      : sso ? 'sso' : section?.has('credential_process') ? 'process' : profile ? 'profile' : undefined;
    const expiresAt = wantsExpiry ? epoch(env.AWS_CREDENTIAL_EXPIRATION ?? env.AWS_SESSION_EXPIRATION) ?? epoch(scan?.expires) : undefined;
    const value: AwsFact = {...(profile ? {profile} : {}), ...(region && /^[a-z0-9-]{1,32}$/u.test(region) ? {region} : {}), ...(account && /^\d{12}$/u.test(account) ? {account} : {}),
      ...(sso ? {sso} : {}), ...(expiresAt !== undefined ? {expiresAt} : {}), ...(credentials ? {credentials} : {})};
    const evidence = [selected ? (env.AWS_VAULT ? 'AWS_VAULT' : env.AWS_PROFILE ? 'AWS_PROFILE' : 'AWS_DEFAULT_PROFILE') : 'default profile',
      section ? 'AWS config' : undefined, environmentCredentials ? 'environment credentials present' : undefined].filter(Boolean).join(', ');
    return {value, evidence};
  },
});

export interface GcpFact {configuration: string; project?: string; account?: string; region?: string}

export const gcp = defineCapability<GcpFact>({
  id: 'cloud.gcp',
  title: 'Google Cloud configuration',
  reads: ['CLOUDSDK_CONFIG, CLOUDSDK_ACTIVE_CONFIG_NAME, CLOUDSDK_CORE_PROJECT, CLOUDSDK_COMPUTE_REGION', 'gcloud active_config and the active configurations/config_<name> file'],
  scope: 'user', family: 'metadata', cost: 'bounded-async', trust: 'user-metadata', sensitivity: 'public', persistence: 'snapshot-safe',
  fieldPolicy: {account: ACCOUNT_POLICY},
  fields: ['configuration', 'project', 'account', 'region'], env: ['CLOUDSDK_CONFIG', 'CLOUDSDK_ACTIVE_CONFIG_NAME', 'CLOUDSDK_CORE_PROJECT', 'CLOUDSDK_COMPUTE_REGION'],
  ttlMs: 10_000, timeoutMs: 1000, invalidateOn: ['command'],
  preview: {configuration: 'default', project: 'my-project', region: 'europe-west1'},
  async resolve(context) {
    const env = context.env.values;
    const directory = env.CLOUDSDK_CONFIG && isAbsolute(env.CLOUDSDK_CONFIG) ? env.CLOUDSDK_CONFIG : join(context.home, '.config', 'gcloud');
    const configuration = env.CLOUDSDK_ACTIVE_CONFIG_NAME ?? await readVersionFile(join(directory, 'active_config')) ?? 'default';
    if (!/^[A-Za-z][A-Za-z0-9-]{0,63}$/u.test(configuration)) return undefined;
    const ini = parseIniData(await readMetadataText(join(directory, 'configurations', `config_${configuration}`)));
    const project = env.CLOUDSDK_CORE_PROJECT ?? text(ini?.get('core')?.get('project'), 64);
    if (!ini && !project) return undefined;
    const account = text(ini?.get('core')?.get('account'), 128);
    const region = env.CLOUDSDK_COMPUTE_REGION ?? text(ini?.get('compute')?.get('region'), 32);
    return {value: {configuration, ...(project ? {project} : {}), ...(account ? {account} : {}), ...(region ? {region} : {})},
      evidence: env.CLOUDSDK_CORE_PROJECT ? 'CLOUDSDK_CORE_PROJECT' : `gcloud configuration ${configuration}`};
  },
});

export interface AzureFact {subscription: string; subscriptionId?: string; tenantId?: string; cloud?: string}

export const azure = defineCapability<AzureFact>({
  id: 'cloud.azure',
  title: 'Azure subscription',
  reads: ['AZURE_CONFIG_DIR or ~/.azure: azureProfile.json default subscription name and identifiers (signed-in user names are not read)'],
  scope: 'user', family: 'metadata', cost: 'bounded-async', trust: 'user-metadata', sensitivity: 'public', persistence: 'snapshot-safe',
  fieldPolicy: {subscriptionId: ACCOUNT_POLICY, tenantId: ACCOUNT_POLICY},
  fields: ['subscription', 'subscriptionId', 'tenantId', 'cloud'], env: ['AZURE_CONFIG_DIR'], ttlMs: 10_000, timeoutMs: 1000, invalidateOn: ['command'],
  preview: {subscription: 'Engineering', cloud: 'AzureCloud'},
  async resolve(context) {
    const configured = context.env.values.AZURE_CONFIG_DIR;
    const directory = configured && isAbsolute(configured) ? configured : join(context.home, '.azure');
    const profile = parseJsonData(await readMetadataText(join(directory, 'azureProfile.json'), LARGE_METADATA_BYTES));
    const subscriptions = record(profile) && Array.isArray(profile.subscriptions) ? profile.subscriptions.slice(0, 256) : [];
    const current = subscriptions.find(item => record(item) && item.isDefault === true);
    if (!record(current)) return undefined;
    const subscription = text(current.name, 128);
    if (!subscription) return undefined;
    const subscriptionId = text(current.id, 64), tenantId = text(current.tenantId, 64), cloud = text(current.environmentName, 32);
    return {value: {subscription, ...(subscriptionId ? {subscriptionId} : {}), ...(tenantId ? {tenantId} : {}), ...(cloud ? {cloud} : {})},
      evidence: 'azureProfile.json default subscription'};
  },
});

export const CLOUD_CAPABILITIES = [aws, gcp, azure] as CapabilityDefinition<unknown>[];
