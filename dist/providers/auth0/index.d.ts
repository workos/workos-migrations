import { Provider } from '../../types';
export declare const auth0Provider: Provider;
export { Auth0Client } from './client';
export type { Auth0User, Auth0Connection, Auth0Client as Auth0AppClient, Auth0Role, Auth0Organization, } from './client';
export type { Auth0TransformConfig, TransformResult } from './transform';
export { transformAuth0Connections } from './transform';
export { toWorkOSUserRow, summarizeAuth0Users, providerPrefix } from './user';
export type { UserTransformSummary } from './user';
