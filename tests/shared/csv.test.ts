import {
  escapeCSVField,
  createCSVRow,
  createCSV,
  rowsToCsv,
  SAML_HEADERS,
  OIDC_HEADERS,
  USER_HEADERS,
} from '../../src/shared/csv';

describe('escapeCSVField', () => {
  it.each([
    ['', ''],
    ['simple', 'simple'],
    ['has, comma', '"has, comma"'],
    ['has "quotes"', '"has ""quotes"""'],
    ['line1\nline2', '"line1\nline2"'],
    ['has\rreturn', '"has\rreturn"'],
    [undefined, ''],
    [null, ''],
  ])('%p → %p', (input, expected) => {
    expect(escapeCSVField(input as string | undefined | null)).toBe(expected);
  });
});

describe('createCSVRow', () => {
  it('joins escaped fields with commas', () => {
    expect(createCSVRow(['a', 'b,c', 'd"e'])).toBe('a,"b,c","d""e"');
  });

  it('coerces null and undefined to empty strings', () => {
    expect(createCSVRow(['a', null, undefined, 'b'])).toBe('a,,,b');
  });
});

describe('createCSV', () => {
  it('prepends the header row and trailing newline', () => {
    const out = createCSV(['a', 'b'], ['1,2', '3,4']);
    expect(out).toBe('a,b\n1,2\n3,4\n');
  });

  it('outputs just the header when rows are empty', () => {
    expect(createCSV(['a', 'b'], [])).toBe('a,b\n');
  });
});

describe('rowsToCsv', () => {
  it('produces the same content as createCSV for structured rows', () => {
    const out = rowsToCsv(['x', 'y'], [
      { x: '1', y: 'hello, world' },
      { x: '2', y: 'plain' },
    ]);
    expect(out).toBe('x,y\n1,"hello, world"\n2,plain\n');
  });

  it('emits blanks for missing keys', () => {
    const out = rowsToCsv(['x', 'y', 'z'], [{ x: '1' }]);
    expect(out).toBe('x,y,z\n1,,\n');
  });
});

describe('header schemas', () => {
  it('SAML headers include the new name + customAttributes columns', () => {
    expect(SAML_HEADERS).toContain('name');
    expect(SAML_HEADERS).toContain('customAttributes');
  });

  it('OIDC headers include the new name + customAttributes columns', () => {
    expect(OIDC_HEADERS).toContain('name');
    expect(OIDC_HEADERS).toContain('customAttributes');
  });

  it('User headers match the official WorkOS users import template', () => {
    expect([...USER_HEADERS]).toEqual([
      'user_id',
      'email',
      'email_verified',
      'first_name',
      'last_name',
      'password_hash',
    ]);
  });
});
