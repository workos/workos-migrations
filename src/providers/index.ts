import type { Provider } from '../shared/types.js';
import { auth0Provider } from './auth0/index.js';
import { clerkProvider } from './clerk/index.js';
import { firebaseProvider } from './firebase/index.js';
import { cognitoProvider } from './cognito/index.js';
import { csvProvider } from './csv/index.js';

export const PROVIDERS: Record<string, Provider> = {
  auth0: auth0Provider,
  clerk: clerkProvider,
  firebase: firebaseProvider,
  cognito: cognitoProvider,
  csv: csvProvider,
};

export function getProvider(name: string): Provider | undefined {
  return PROVIDERS[name];
}

export function getAllProviders(): Provider[] {
  return Object.values(PROVIDERS);
}
