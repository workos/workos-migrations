/**
 * Per-customer migration config file support.
 *
 * Each JSON file under `./configs/` captures one customer's provider settings
 * (domains, prefixes, pool IDs, templates) so WorkOS engineering can replay
 * runs without re-typing CLI flags. Secrets (API keys, client secrets, AWS
 * credentials) are NOT persisted — they come from env vars or CLI flags.
 *
 * File shape:
 *
 *   {
 *     "customer": "acme",
 *     "providers": {
 *       "auth0": {
 *         "domain": "acme.auth0.com",
 *         "customDomain": "auth.acme.com",
 *         "entityIdPrefix": "urn:acme:sso:"
 *       },
 *       "cognito": {
 *         "region": "us-east-1",
 *         "userPoolIds": "us-east-1_XXX,us-east-1_YYY",
 *         "samlCustomAcsUrlTemplate": "https://sso.acme.com/{provider_name}/acs",
 *         "samlCustomEntityIdTemplate": "urn:amazon:cognito:sp:{user_pool_id}",
 *         "oidcCustomRedirectUriTemplate": "https://sso.acme.com/{provider_name}/oidc"
 *       }
 *     },
 *     "runs": []
 *   }
 */
import fs from 'fs';
import path from 'path';

export interface Auth0ConfigSettings {
  domain?: string;
  customDomain?: string;
  entityIdPrefix?: string;
}

export interface CognitoConfigSettings {
  region?: string;
  userPoolIds?: string;
  samlCustomAcsUrlTemplate?: string;
  samlCustomEntityIdTemplate?: string;
  oidcCustomRedirectUriTemplate?: string;
}

export interface MigrationRunLog {
  timestamp: string;
  provider: string;
  action: string;
  entities: string[];
  counts: Record<string, number>;
  outputFiles: string[];
}

export interface MigrationConfig {
  customer: string;
  providers: {
    auth0?: Auth0ConfigSettings;
    cognito?: CognitoConfigSettings;
  };
  runs: MigrationRunLog[];
}

const DEFAULT_CONFIG_DIR = './configs';

/**
 * Load a config file by path. Throws when the file is missing or malformed.
 *
 * Tolerant of minimal configs — missing top-level fields get sane defaults so
 * that e.g. a config with only `providers.cognito` set still works.
 */
export function loadConfig(filePath: string): MigrationConfig {
  const raw = fs.readFileSync(filePath, 'utf-8');
  const parsed = JSON.parse(raw);
  return normalizeConfig(parsed);
}

function normalizeConfig(input: unknown): MigrationConfig {
  if (!input || typeof input !== 'object') {
    throw new Error('config file must contain a JSON object');
  }
  const obj = input as Partial<MigrationConfig>;
  return {
    customer: typeof obj.customer === 'string' ? obj.customer : 'unnamed',
    providers: (obj.providers as MigrationConfig['providers']) ?? {},
    runs: Array.isArray(obj.runs) ? (obj.runs as MigrationRunLog[]) : [],
  };
}

/**
 * Persist a config back to disk, writing `runs` at the end so diffs stay
 * readable when the settings don't change between runs.
 */
export function saveConfig(filePath: string, config: MigrationConfig): void {
  const out = {
    customer: config.customer,
    providers: config.providers,
    runs: config.runs,
  };
  fs.writeFileSync(filePath, JSON.stringify(out, null, 2) + '\n');
}

/** Append one run entry and persist. */
export function appendRunLog(filePath: string, entry: MigrationRunLog): void {
  const config = loadConfig(filePath);
  config.runs.unshift(entry); // newest first
  saveConfig(filePath, config);
}

/**
 * Find all valid config files in a directory. Returns absolute paths.
 *
 * "Valid" = JSON file that parses and has at least a `providers` field. Files
 * that fail to parse are skipped silently so a stray non-config JSON in the
 * folder doesn't break the flow.
 */
export function listConfigs(dir: string = DEFAULT_CONFIG_DIR): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => path.join(dir, name))
    .filter((file) => {
      try {
        const parsed = JSON.parse(fs.readFileSync(file, 'utf-8'));
        return parsed && typeof parsed === 'object' && 'providers' in parsed;
      } catch {
        return false;
      }
    });
}
