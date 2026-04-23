import { Config, ProviderCredentials } from '../types';
export declare function loadConfig(): Config;
export declare function saveConfig(config: Config): void;
export declare function getProviderCredentials(providerName: string): ProviderCredentials;
export declare function saveProviderCredentials(providerName: string, credentials: ProviderCredentials): void;
