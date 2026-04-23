import { CSV_TEMPLATES } from '../templates';

describe('CSV_TEMPLATES', () => {
  it('exposes the expected templates', () => {
    expect(Object.keys(CSV_TEMPLATES).sort()).toEqual(
      ['connections', 'organization_memberships', 'organizations', 'users'].sort(),
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

  it('users template validates email format', () => {
    const users = CSV_TEMPLATES.users;
    expect(users.validation).toBeDefined();
    const emailValidator = users.validation!.email;
    expect(emailValidator('john.doe@example.com')).toBe(true);
    expect(emailValidator('not-an-email')).not.toBe(true);
  });
});
