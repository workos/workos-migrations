import fs from 'fs';
import path from 'path';
import os from 'os';
import { Config, ProviderCredentials } from '../types';

const CONFIG_DIR = path.join(os.homedir(), '.workos-migrations');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

export function loadConfig(): Config {
  try {
    if (!fs.existsSync(CONFIG_FILE)) {
      return { providers: {} };
    }
    
    const configContent = fs.readFileSync(CONFIG_FILE, 'utf8');
    return JSON.parse(configContent);
  } catch (error) {
    console.warn('Failed to load config file, using empty config');
    return { providers: {} };
  }
}

export function saveConfig(config: Config): void {
  try {
    if (!fs.existsSync(CONFIG_DIR)) {
      fs.mkdirSync(CONFIG_DIR, { recursive: true });
    }
    
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
  } catch (error) {
    console.warn('Failed to save config file');
  }
}

export function getProviderCredentials(providerName: string): ProviderCredentials {
  const config = loadConfig();
  return config.providers[providerName] || {};
}

export function saveProviderCredentials(providerName: string, credentials: ProviderCredentials): void {
  const config = loadConfig();
  config.providers[providerName] = credentials;
  saveConfig(config);
}