import type { MigrationSource } from './types.js';
import { auth0Source } from './auth0/index.js';

/**
 * The single registry of migration sources. The CLI, wizard, and capability
 * matrix are (progressively) driven from this map rather than per-provider
 * imports. Adapters are added here one at a time as they prove equivalence
 * against their existing logic.
 */
export const SOURCES: Record<string, MigrationSource> = {
  auth0: auth0Source,
};

export function getSource(id: string): MigrationSource | undefined {
  return SOURCES[id];
}

export function listSources(): MigrationSource[] {
  return Object.values(SOURCES);
}
