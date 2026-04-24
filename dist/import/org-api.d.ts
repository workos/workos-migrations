import type { WorkOS } from '@workos-inc/node';
export declare function getOrganizationById(workos: WorkOS, orgId: string): Promise<boolean>;
export declare function getOrganizationByExternalId(workos: WorkOS, externalId: string): Promise<string | null>;
export declare function createOrganization(workos: WorkOS, name: string, externalId: string): Promise<string>;
