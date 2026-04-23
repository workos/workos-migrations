"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadConfig = loadConfig;
exports.saveConfig = saveConfig;
exports.appendRunLog = appendRunLog;
exports.listConfigs = listConfigs;
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
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const DEFAULT_CONFIG_DIR = './configs';
/**
 * Load a config file by path. Throws when the file is missing or malformed.
 *
 * Tolerant of minimal configs — missing top-level fields get sane defaults so
 * that e.g. a config with only `providers.cognito` set still works.
 */
function loadConfig(filePath) {
    const raw = fs_1.default.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw);
    return normalizeConfig(parsed);
}
function normalizeConfig(input) {
    if (!input || typeof input !== 'object') {
        throw new Error('config file must contain a JSON object');
    }
    const obj = input;
    return {
        customer: typeof obj.customer === 'string' ? obj.customer : 'unnamed',
        providers: obj.providers ?? {},
        runs: Array.isArray(obj.runs) ? obj.runs : [],
    };
}
/**
 * Persist a config back to disk, writing `runs` at the end so diffs stay
 * readable when the settings don't change between runs.
 */
function saveConfig(filePath, config) {
    const out = {
        customer: config.customer,
        providers: config.providers,
        runs: config.runs,
    };
    fs_1.default.writeFileSync(filePath, JSON.stringify(out, null, 2) + '\n');
}
/** Append one run entry and persist. */
function appendRunLog(filePath, entry) {
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
function listConfigs(dir = DEFAULT_CONFIG_DIR) {
    if (!fs_1.default.existsSync(dir))
        return [];
    return fs_1.default
        .readdirSync(dir)
        .filter((name) => name.endsWith('.json'))
        .map((name) => path_1.default.join(dir, name))
        .filter((file) => {
        try {
            const parsed = JSON.parse(fs_1.default.readFileSync(file, 'utf-8'));
            return parsed && typeof parsed === 'object' && 'providers' in parsed;
        }
        catch {
            return false;
        }
    });
}
//# sourceMappingURL=migration-config.js.map