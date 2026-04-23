import { Provider } from '../types';
import { auth0Provider } from './auth0';
import { clerkProvider } from './clerk';
import { firebaseProvider } from './firebase';
import { cognitoProvider } from './cognito';
import { csvProvider } from './csv';

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
