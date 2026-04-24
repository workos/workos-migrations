import type { Provider } from '../shared/types.js';
export declare const PROVIDERS: Record<string, Provider>;
export declare function getProvider(name: string): Provider | undefined;
export declare function getAllProviders(): Provider[];
