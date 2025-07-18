interface Auth0Credentials {
    clientId: string;
    clientSecret: string;
    domain: string;
}
export interface Auth0Client {
    id: string;
    name: string;
    client_id: string;
    app_type: string;
    is_first_party: boolean;
    is_heroku_app: boolean;
    callbacks: string[];
    allowed_origins: string[];
    web_origins: string[];
    client_aliases: string[];
    allowed_clients: string[];
    allowed_logout_urls: string[];
    jwt_configuration: any;
    client_metadata: any;
    mobile: any;
    initiate_login_uri: string;
    native_social_login: any;
    refresh_token: any;
    oidc_conformant: boolean;
    cross_origin_auth: boolean;
    sso: boolean;
    sso_disabled: boolean;
    cross_origin_authentication: boolean;
    signing_keys: any[];
    grant_types: string[];
    custom_login_page_on: boolean;
    organization_usage: string;
    organization_require_behavior: string;
}
export interface Auth0Connection {
    id: string;
    options: any;
    strategy: string;
    name: string;
    provisioning_ticket_url: string;
    enabled_clients: string[];
    is_domain_connection: boolean;
    realms: string[];
    metadata: any;
    display_name: string;
}
export declare class Auth0Client {
    private credentials;
    private httpClient;
    private accessToken;
    constructor(credentials: Auth0Credentials);
    authenticate(): Promise<void>;
    getClients(): Promise<Auth0Client[]>;
    getConnections(): Promise<Auth0Connection[]>;
}
export {};
//# sourceMappingURL=auth0-client.d.ts.map