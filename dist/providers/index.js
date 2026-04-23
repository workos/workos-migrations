"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PROVIDERS = void 0;
exports.getProvider = getProvider;
exports.getAllProviders = getAllProviders;
const auth0_1 = require("./auth0");
const clerk_1 = require("./clerk");
const firebase_1 = require("./firebase");
const cognito_1 = require("./cognito");
const csv_1 = require("./csv");
exports.PROVIDERS = {
    auth0: auth0_1.auth0Provider,
    clerk: clerk_1.clerkProvider,
    firebase: firebase_1.firebaseProvider,
    cognito: cognito_1.cognitoProvider,
    csv: csv_1.csvProvider,
};
function getProvider(name) {
    return exports.PROVIDERS[name];
}
function getAllProviders() {
    return Object.values(exports.PROVIDERS);
}
