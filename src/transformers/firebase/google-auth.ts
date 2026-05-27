import { GoogleAuth } from 'google-auth-library';
import type { IdentityPlatformAccessTokenProvider } from './identity-platform-client.js';

export interface GoogleAccessTokenProviderOptions {
  /** Path to a service account JSON key file. */
  keyFile?: string;
  /** Override the scopes (defaults to cloud-platform). */
  scopes?: string[];
}

const DEFAULT_SCOPES = ['https://www.googleapis.com/auth/cloud-platform'];

export function createGoogleAccessTokenProvider(
  options: GoogleAccessTokenProviderOptions = {},
): IdentityPlatformAccessTokenProvider {
  const auth = new GoogleAuth({
    keyFile: options.keyFile,
    scopes: options.scopes ?? DEFAULT_SCOPES,
  });

  return {
    async getAccessToken(): Promise<string> {
      const client = await auth.getClient();
      const result = await client.getAccessToken();
      const token = typeof result === 'string' ? result : result?.token;
      if (!token) {
        throw new Error(
          'Failed to obtain Google access token. Verify your service account credentials and cloud-platform scope.',
        );
      }
      return token;
    },
  };
}

export async function detectGoogleProjectId(
  options: GoogleAccessTokenProviderOptions = {},
): Promise<string | undefined> {
  const auth = new GoogleAuth({
    keyFile: options.keyFile,
    scopes: options.scopes ?? DEFAULT_SCOPES,
  });
  try {
    const projectId = await auth.getProjectId();
    return projectId || undefined;
  } catch {
    return undefined;
  }
}
