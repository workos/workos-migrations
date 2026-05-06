# Auth0 SSO Handoff

Auth0 SSO connections cannot be imported automatically into WorkOS. This document describes what `export-auth0 --package --entities sso` produces and how to use those files to stand up the WorkOS connections by hand.

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

1. Run `export-auth0 --package --entities sso --output-dir <pkg>` (optionally with `--include-secrets`).
2. Read `sso/handoff_notes.md` for any tenant-specific notes the exporter recorded.
3. For every row in `sso/saml_connections.csv` and `sso/oidc_connections.csv`:
   1. Create the WorkOS organization that matches `organizationExternalId` (or use an existing one) and add the listed domains.
   2. Create a SAML or OIDC connection in WorkOS using the IdP metadata fields. Re-upload signing certificates and metadata XML where required.
   3. For OIDC connections, regenerate or paste the client secret manually (it is redacted in the export by default).
   4. Apply `customAttributes` from the corresponding rows in `sso/custom_attribute_mappings.csv` to the new WorkOS connection.
   5. If a callback proxy is in use during cutover (see `proxy-sample-auth0/`), update `sso/proxy_routes.csv` rows with the WorkOS connection ID and ACS URL so the proxy can route traffic during cutover.

When `import-package` is run against the package, SSO entities are reported with status `handoff` so the operator is prompted to follow this document instead of expecting an automated import.

## Why handoff-only

WorkOS SSO connections require organization-scoped customer setup, certificate exchange, and consent that does not map cleanly to a one-shot API call. Treating SSO as a handoff lets the migration package preserve all of the source data needed to create connections without fabricating WorkOS resources that operators cannot easily roll back.
