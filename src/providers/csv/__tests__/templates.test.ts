import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CSV_TEMPLATES, generateTemplateExample } from '../templates.js';
import { validateCsv } from '../../../validator/validator.js';

describe('CSV_TEMPLATES', () => {
  it('exposes the expected templates', () => {
    expect(Object.keys(CSV_TEMPLATES).sort()).toEqual(
      [
        'oidc_connections',
        'organization_memberships',
        'organizations',
        'saml_connections',
        'users',
      ].sort(),
    );
  });

  it('has required fields that are a subset of headers', () => {
    for (const [name, template] of Object.entries(CSV_TEMPLATES)) {
      for (const required of template.required) {
        expect(template.headers).toContain(required);
      }
      for (const optional of template.optional) {
        expect(template.headers).toContain(optional);
      }
      expect(template.filename).toMatch(/\.csv$/);
      expect(template.example.length).toBeGreaterThan(0);
      expect(name).toBeTruthy();
    }
  });

  it('gives every example row one field per header', () => {
    for (const [name, template] of Object.entries(CSV_TEMPLATES)) {
      for (const example of template.example) {
        expect({ name, fields: example.split(',').length }).toEqual({
          name,
          fields: template.headers.length,
        });
      }
    }
  });

  it('emits a users template that the validator accepts', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'workos-template-test-'));
    const csvPath = path.join(dir, 'users.csv');
    fs.writeFileSync(csvPath, `${generateTemplateExample('users')}\n`, 'utf-8');

    try {
      const result = await validateCsv({ csvPath, quiet: true });
      expect(result.errors).toEqual([]);
      expect(result.warnings).toEqual([]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('users template validates email format', () => {
    const users = CSV_TEMPLATES.users;
    expect(users.validation).toBeDefined();
    const emailValidator = users.validation!.email;
    expect(emailValidator('john.doe@example.com')).toBe(true);
    expect(emailValidator('not-an-email')).not.toBe(true);
  });
});
