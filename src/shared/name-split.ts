import type { NameSplitStrategy } from './types.js';

/**
 * Split a display name into first and last name using the given strategy.
 * Used by Firebase and Supabase exporters to normalize `display_name` /
 * `user_metadata.full_name` into first/last columns.
 */
export function splitDisplayName(
  displayName: string | undefined,
  strategy: NameSplitStrategy,
): { firstName: string; lastName: string } {
  if (!displayName?.trim()) {
    return { firstName: '', lastName: '' };
  }

  const name = displayName.trim();

  switch (strategy) {
    case 'first-space': {
      const idx = name.indexOf(' ');
      if (idx === -1) return { firstName: name, lastName: '' };
      return { firstName: name.slice(0, idx), lastName: name.slice(idx + 1) };
    }
    case 'last-space': {
      const idx = name.lastIndexOf(' ');
      if (idx === -1) return { firstName: name, lastName: '' };
      return { firstName: name.slice(0, idx), lastName: name.slice(idx + 1) };
    }
    case 'first-name-only':
      return { firstName: name, lastName: '' };
    default:
      return { firstName: name, lastName: '' };
  }
}
