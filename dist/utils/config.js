"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadConfig = loadConfig;
exports.saveConfig = saveConfig;
exports.getProviderCredentials = getProviderCredentials;
exports.saveProviderCredentials = saveProviderCredentials;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const os_1 = __importDefault(require("os"));
const CONFIG_DIR = path_1.default.join(os_1.default.homedir(), '.workos-migrations');
const CONFIG_FILE = path_1.default.join(CONFIG_DIR, 'config.json');
function loadConfig() {
    try {
        if (!fs_1.default.existsSync(CONFIG_FILE)) {
            return { providers: {} };
        }
        const configContent = fs_1.default.readFileSync(CONFIG_FILE, 'utf8');
        return JSON.parse(configContent);
    }
    catch (error) {
        console.warn('Failed to load config file, using empty config');
        return { providers: {} };
    }
}
function saveConfig(config) {
    try {
        if (!fs_1.default.existsSync(CONFIG_DIR)) {
            fs_1.default.mkdirSync(CONFIG_DIR, { recursive: true });
        }
        fs_1.default.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
    }
    catch (error) {
        console.warn('Failed to save config file');
    }
}
function getProviderCredentials(providerName) {
    const config = loadConfig();
    return config.providers[providerName] || {};
}
function saveProviderCredentials(providerName, credentials) {
    const config = loadConfig();
    config.providers[providerName] = credentials;
    saveConfig(config);
}
//# sourceMappingURL=config.js.map