# Auth0 SSO Handoff

`export auth0 --entities sso` writes Auth0 enterprise SAML/OIDC connections into the package's `sso/` files. `import-package` then creates the WorkOS connections through the Connections API (`POST /connections`), including organizations, verified domains, legacy ACS URL / entity ID overrides, attribute mappings, and (with `--include-secrets`) bring-your-own SP key pairs. This document describes what the export produces and how to finish the job by hand when the automated path cannot be used.

The Connections API migration capabilities are enabled per WorkOS environment. When they are off, `import-package` reports SSO as `handoff` and leaves the files below for manual processing; ask WorkOS to enable them and re-run (creation is idempotent on `externalId`).

## What gets written

When `sso` is in the requested entities list, the package exporter writes the following under the package root:

```text
sso/
  saml_connections.csv
  oidc_connections.csv
  custom_attribute_mappings.csv
  proxy_routes.csv
  handoff_notes.md
raw/
  auth0-connections.jsonl
```

`raw/auth0-connections.jsonl` contains the original Auth0 connection JSON, with secrets redacted by default. Pass `--include-secrets` only when the output directory can safely store IdP signing material and OIDC client secrets.

## Which connections are exported

The exporter inspects every Auth0 connection and only emits handoff rows for enterprise SAML or OIDC connections that contain enough data for a WorkOS connection to be created.

Skipped with warnings:

- Database connections (`auth0`, `Username-Password-Authentication`, …)
- Passwordless connections (sms, email)
- Social/OAuth connections (Google, Microsoft, Facebook, …)
- Generic OAuth strategies that are not SAML/OIDC
- Enterprise connections missing required fields (no SAML signing cert, no OIDC issuer, etc.)

The skip reasons are recorded as `unsupported_connection_protocol` and `incomplete_connection_configuration` warnings inside `warnings.jsonl`.

## Multi-org consolidation

If a single Auth0 connection is enabled for several Auth0 organizations, the exporter emits one handoff row whose `domains` column is the union of source organization domains. A `multi_org_connection_consolidated` warning is recorded so the operator can review and confirm the consolidation before creating the WorkOS connection. The enabled organization IDs are preserved in `sso/proxy_routes.csv` and the raw Auth0 connection JSON.

## Operator workflow

1. Run `export auth0 --entities sso --output-dir <pkg>` (add `--include-secrets` to carry OIDC client secrets and Auth0 `signingKey` / `decryptionKey` pairs into the CSVs).
2. Read `sso/handoff_notes.md` for any tenant-specific notes the exporter recorded.
3. Run `import-package <pkg> --plan` to see the connections, referenced custom attributes, and anything that will be skipped, then `import-package <pkg>`. Results land in `workos_sso_connections.csv` and `sso/proxy_routes.csv`.

### Manual fallback

When the Connections API is not enabled, or for rows the importer skipped, work through `sso/saml_connections.csv` and `sso/oidc_connections.csv` by hand:

1. Create the WorkOS organization that matches `organizationExternalId` (or use an existing one) and add the listed domains.
2. Create a SAML or OIDC connection in WorkOS using the IdP metadata fields. Re-upload signing certificates and metadata XML where required.
3. For OIDC connections, regenerate or paste the client secret manually (it is redacted in the export by default).
4. Apply `customAttributes` from the corresponding rows in `sso/custom_attribute_mappings.csv` to the new WorkOS connection.
5. If a callback proxy is in use during cutover (see `proxy-sample-auth0/`), update `sso/proxy_routes.csv` rows with the WorkOS connection ID and ACS URL so the proxy can route traffic during cutover.

## What the importer cannot do

- OIDC rows without a `clientSecret` are skipped (Auth0 exports redact it by default). Re-export with `--include-secrets` or pass `--sso-secrets <file>`.
- IdP-initiated SSO and NameID format overrides have no Connections API field yet; enable them in the WorkOS dashboard after import.
- SP key pairs are accepted only at creation. A connection created without `requestSigningKey` + `requestSigningCert` gets WorkOS-generated keys, and the customer IdP must be updated with the new SP certificate before signed requests work.
- Auth0 tenant-level signing keys are not exportable; those connections need a fresh Admin Portal setup.
- Expired IdP certificates are rejected by the API; refresh the certificate at the source first.
