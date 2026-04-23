/**
 * Item #12 verification: the CSV provider's connections_saml / connections_oidc
 * templates must match the shared SAML_HEADERS / OIDC_HEADERS exactly so that
 * a transform output can be validated through the CSV provider's validator
 * without column drift.
 */
import fs from 'fs';
import path from 'path';
import os from 'os';
import { CSV_TEMPLATES } from '../../../src/providers/csv/templates';
import { CSVValidator } from '../../../src/providers/csv/validator';
import { SAML_HEADERS, OIDC_HEADERS, rowsToCsv } from '../../../src/shared/csv';
import { transformAuth0Connections } from '../../../src/providers/auth0/transform';
import type { Auth0Connection } from '../../../src/providers/auth0/client';

describe('CSV provider templates ↔ shared schema', () => {
  it('connections_saml.headers == shared SAML_HEADERS (order + values)', () => {
    expect([...CSV_TEMPLATES.connections_saml.headers]).toEqual([...SAML_HEADERS]);
  });

  it('connections_oidc.headers == shared OIDC_HEADERS (order + values)', () => {
    expect([...CSV_TEMPLATES.connections_oidc.headers]).toEqual([...OIDC_HEADERS]);
  });

  it('connections_oidc marks the three API-required fields as required', () => {
    expect(CSV_TEMPLATES.connections_oidc.required).toEqual(
      expect.arrayContaining(['organizationName', 'clientId', 'clientSecret', 'discoveryEndpoint']),
    );
  });

  it('customAttributes validator accepts a valid JSON object', () => {
    const validator = CSV_TEMPLATES.connections_saml.validation?.customAttributes;
    expect(validator).toBeDefined();
    expect(validator!('{"foo":"bar"}')).toBe(true);
    expect(validator!('')).toBe(true);
    expect(validator!('not json')).not.toBe(true);
    expect(validator!('[1,2,3]')).not.toBe(true); // array is not an object
  });

  it('idpInitiatedEnabled validator accepts true/false/TRUE/FALSE', () => {
    const validator = CSV_TEMPLATES.connections_saml.validation?.idpInitiatedEnabled;
    expect(validator).toBeDefined();
    expect(validator!('true')).toBe(true);
    expect(validator!('FALSE')).toBe(true);
    expect(validator!('maybe')).not.toBe(true);
  });
});

describe('transform output → CSV provider validator (round trip)', () => {
  const connection: Auth0Connection = {
    id: 'con_1',
    name: 'acme-saml',
    display_name: 'Acme SAML',
    strategy: 'samlp',
    enabled_clients: ['client_a'],
    options: {
      signInEndpoint: 'https://idp.acme.com/sso',
      cert: 'MIICXjCCAce',
      fieldsMap: {
        email: 'email',
        given_name: 'firstName',
        family_name: 'lastName',
      },
      idpinitiated: { enabled: true, client_id: 'client_a' },
    },
  };

  it('transform output passes validation against the connections_saml template', () => {
    const result = transformAuth0Connections([connection], {
      customDomain: 'auth.acme.com',
      entityIdPrefix: 'urn:acme:sso:',
    });

    const validation = CSVValidator.validateContent(result.samlCsv, CSV_TEMPLATES.connections_saml);
    expect(validation.errors).toEqual([]);
    expect(validation.totalRows).toBe(1);
    expect(validation.validRows).toBe(1);
  });

  it('round-trip via file I/O — write shared headers, read back, validate', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'csv-contract-'));
    try {
      const file = path.join(tmp, 'saml.csv');
      fs.writeFileSync(
        file,
        rowsToCsv(SAML_HEADERS, [
          {
            organizationName: 'Test Org',
            organizationExternalId: 'test',
            idpUrl: 'https://idp.test.com/sso',
            x509Cert: 'MIITEST',
            idpInitiatedEnabled: 'true',
            importedId: 'test',
          },
        ]),
      );

      const content = fs.readFileSync(file, 'utf-8');
      const validation = CSVValidator.validateContent(content, CSV_TEMPLATES.connections_saml);
      expect(validation.errors).toEqual([]);
      expect(validation.validRows).toBe(1);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('OIDC transform output validates against connections_oidc', () => {
    const oidcConnection: Auth0Connection = {
      id: 'con_oidc',
      name: 'acme-oidc',
      display_name: 'Acme OIDC',
      strategy: 'oidc',
      enabled_clients: ['client_a'],
      options: {
        type: 'back_channel',
        client_id: 'oidc-client',
        client_secret: 'oidc-secret',
        discovery_url: 'https://idp.acme.com/.well-known/openid-configuration',
      },
    };

    const result = transformAuth0Connections([oidcConnection], {
      customDomain: 'auth.acme.com',
    });
    const validation = CSVValidator.validateContent(result.oidcCsv, CSV_TEMPLATES.connections_oidc);
    expect(validation.errors).toEqual([]);
    expect(validation.validRows).toBe(1);
  });
});
