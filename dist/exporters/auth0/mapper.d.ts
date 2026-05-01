import type { Auth0User, Auth0Organization, CSVRow } from '../../shared/types.js';
export declare function mapAuth0UserToWorkOS(user: Auth0User, org: Auth0Organization, passwordHash?: {
    hash?: string;
    algorithm?: string;
} | null): CSVRow;
export declare function isFederatedAuth0User(user: Auth0User): boolean;
export declare function validateMappedRow(row: CSVRow): string | null;
export declare function extractOrgFromMetadata(user: Auth0User, customOrgIdField?: string, customOrgNameField?: string): {
    orgId?: string;
    orgName?: string;
} | null;
