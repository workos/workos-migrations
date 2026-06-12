import { SOURCES, getSource, listSources } from '../registry';

describe('source registry', () => {
  it('registers all five current sources', () => {
    expect(Object.keys(SOURCES).sort()).toEqual(['auth0', 'clerk', 'cognito', 'csv', 'firebase']);
    expect(listSources()).toHaveLength(5);
  });

  it('every source satisfies the MigrationSource contract shape', () => {
    for (const source of listSources()) {
      expect(typeof source.id).toBe('string');
      expect(typeof source.displayName).toBe('string');
      expect(typeof source.validateCredentials).toBe('function');
      expect(typeof source.export).toBe('function');
      expect(['api', 'file', 'both']).toContain(source.capabilities.ingest);
      expect(['hash-inline', 'support-export', 'none']).toContain(source.capabilities.passwords);
      expect(getSource(source.id)).toBe(source);
    }
  });

  it('declares the expected ingest mode per source', () => {
    expect(getSource('auth0')?.capabilities.ingest).toBe('api');
    expect(getSource('cognito')?.capabilities.ingest).toBe('api');
    expect(getSource('clerk')?.capabilities.ingest).toBe('file');
    expect(getSource('firebase')?.capabilities.ingest).toBe('file');
    expect(getSource('csv')?.capabilities.ingest).toBe('file');
  });

  it('returns undefined for unknown sources', () => {
    expect(getSource('okta')).toBeUndefined();
  });
});
