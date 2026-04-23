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
/**
 * Load a config file by path. Throws when the file is missing or malformed.
 *
 * Tolerant of minimal configs — missing top-level fields get sane defaults so
 * that e.g. a config with only `providers.cognito` set still works.
 */
export declare function loadConfig(filePath: string): MigrationConfig;
/**
 * Persist a config back to disk, writing `runs` at the end so diffs stay
 * readable when the settings don't change between runs.
 */
export declare function saveConfig(filePath: string, config: MigrationConfig): void;
/** Append one run entry and persist. */
export declare function appendRunLog(filePath: string, entry: MigrationRunLog): void;
/**
 * Find all valid config files in a directory. Returns absolute paths.
 *
 * "Valid" = JSON file that parses and has at least a `providers` field. Files
 * that fail to parse are skipped silently so a stray non-config JSON in the
 * folder doesn't break the flow.
 */
export declare function listConfigs(dir?: string): string[];
//# sourceMappingURL=migration-config.d.ts.map