import { auth0Provider } from './auth0/index.js';
import { clerkProvider } from './clerk/index.js';
import { firebaseProvider } from './firebase/index.js';
import { cognitoProvider } from './cognito/index.js';
import { csvProvider } from './csv/index.js';
export const PROVIDERS = {
    auth0: auth0Provider,
    clerk: clerkProvider,
    firebase: firebaseProvider,
    cognito: cognitoProvider,
    csv: csvProvider,
};
export function getProvider(name) {
    return PROVIDERS[name];
}
export function getAllProviders() {
    return Object.values(PROVIDERS);
}
