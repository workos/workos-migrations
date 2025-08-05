"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CSVValidator = exports.generateTemplateExample = exports.getTemplate = exports.getAllTemplates = exports.CSVClient = exports.csvProvider = void 0;
exports.csvProvider = {
    name: 'csv',
    displayName: 'CSV Import to WorkOS',
    credentials: [
        {
            key: 'workosApiKey',
            name: 'WorkOS API Key',
            type: 'password',
            required: true,
            envVar: 'WORKOS_API_KEY',
        },
    ],
    entities: [
        {
            key: 'users',
            name: 'Users',
            description: 'User accounts with authentication details',
            enabled: true,
        },
        {
            key: 'organizations',
            name: 'Organizations',
            description: 'Organization entities',
            enabled: true,
        },
        {
            key: 'organization_memberships',
            name: 'Organization Memberships',
            description: 'User memberships in organizations',
            enabled: true,
        },
        {
            key: 'connections',
            name: 'Connections',
            description: 'Authentication connections (SSO configurations)',
            enabled: true,
        },
    ],
};
var client_1 = require("./client");
Object.defineProperty(exports, "CSVClient", { enumerable: true, get: function () { return client_1.CSVClient; } });
var templates_1 = require("./templates");
Object.defineProperty(exports, "getAllTemplates", { enumerable: true, get: function () { return templates_1.getAllTemplates; } });
Object.defineProperty(exports, "getTemplate", { enumerable: true, get: function () { return templates_1.getTemplate; } });
Object.defineProperty(exports, "generateTemplateExample", { enumerable: true, get: function () { return templates_1.generateTemplateExample; } });
var validator_1 = require("./validator");
Object.defineProperty(exports, "CSVValidator", { enumerable: true, get: function () { return validator_1.CSVValidator; } });
//# sourceMappingURL=index.js.map