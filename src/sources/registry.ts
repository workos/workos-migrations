import type { MigrationSource } from './types.js';
import { auth0Source } from './auth0/index.js';
import { cognitoSource } from './cognito/index.js';
import { clerkSource } from './clerk/index.js';
import { firebaseSource } from './firebase/index.js';
import { csvSource } from './csv/index.js';

/**
 * The single registry of migration sources. The CLI, wizard, and capability
 * matrix are (progressively) driven from this map rather than per-provider
 * imports. Adding a source here is the only registration step.
 */
export const SOURCES: Record<string, MigrationSource> = {
  auth0: auth0Source,
  cognito: cognitoSource,
  clerk: clerkSource,
  firebase: firebaseSource,
  csv: csvSource,
};

export function getSource(id: string): MigrationSource | undefined {
  return SOURCES[id];
}

export function listSources(): MigrationSource[] {
  return Object.values(SOURCES);
}
