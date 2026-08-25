/**
 * WorkOS user metadata constraints (https://workos.com/docs/user-management/metadata):
 * at most 10 key-value pairs per user, keys up to 40 ASCII characters, and values up
 * to 600 ASCII characters. The import API rejects users whose metadata violates these
 * limits, so any Firebase source field can poison a row — photo URLs and provider
 * profiles routinely exceed the length limit, and MFA enrollments and custom claims
 * can carry non-ASCII display names. Rather than exempting specific fields, every
 * metadata value is checked and offending values are omitted so the rest of the user
 * imports cleanly.
 */
export const METADATA_VALUE_MAX_LENGTH = 600;

function isAscii(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    if (value.charCodeAt(i) > 127) return false;
  }
  return true;
}

/**
 * Remove metadata fields whose value (serialized, for non-strings) would violate
 * WorkOS metadata constraints. Returns the removed keys so callers can warn.
 */
export function omitInvalidMetadataFields(metadata: Record<string, unknown>): string[] {
  const dropped: string[] = [];
  for (const [key, value] of Object.entries(metadata)) {
    const serialized = typeof value === 'string' ? value : JSON.stringify(value);
    if (serialized.length > METADATA_VALUE_MAX_LENGTH || !isAscii(serialized)) {
      delete metadata[key];
      dropped.push(key);
    }
  }
  return dropped;
}
