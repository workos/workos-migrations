# Merge Bulk Import Features Contract

**Created**: 2026-04-24
**Confidence Score**: 95/100
**Status**: Draft

## Problem Statement

The official `workos-migrations` repository on the WorkOS GitHub is an early-stage migration CLI with Auth0 export as its only functional feature. Its import pipeline calls a non-existent WorkOS API endpoint (`/migrations/csv-import`), and providers like Clerk, Firebase, and Cognito are stubbed out with `enabled: false`. Meanwhile, a separate `workos-bulk-user-import-tool-multi-org` repository contains a production-grade migration platform with working exporters, a real import pipeline using the WorkOS Node SDK, multi-threaded workers, TOTP enrollment, password hash merging, role processing, and comprehensive error handling.

The official repo should be the canonical migration tool for WorkOS customers, but it currently can't perform any actual migrations. The bulk tool has all the functionality but lives in a personal repo outside the official GitHub org.

## Goals

1. **Port the working import pipeline** into the official repo so customers can actually import users, create org memberships, and assign roles via direct WorkOS SDK API calls with concurrency, rate limiting, and checkpoint/resume
2. **Replace the basic Auth0 export** with the streaming CSV exporter that supports parallel user fetching, rate limiting by Auth0 plan tier, checkpoint/resume, and org membership resolution
3. **Add post-import tooling** including TOTP MFA factor enrollment, password hash merge from Auth0 NDJSON exports, and role definition/assignment processing
4. **Port Clerk and Firebase transformers** so the official repo supports all three major identity providers
5. **Modernize the CLI architecture** by switching from Inquirer.js menus to Commander.js commands (with an interactive wizard mode) and from CommonJS to ESM modules
6. **Port the interactive wizard and error analysis** tools for guided migration flows and post-import error triage with retry CSV generation

## Success Criteria

- [ ] `npx workos-migrate import --csv <file>` creates users via WorkOS SDK with configurable concurrency and rate limiting
- [ ] `npx workos-migrate import --csv <file> --workers 4` distributes work across Node.js Worker Threads
- [ ] Import supports checkpoint/resume via `--job-id` and `--resume` flags
- [ ] Import handles multi-org memberships from CSV columns (`org_id`, `org_external_id`, `org_name`)
- [ ] `npx workos-migrate export-auth0` produces streaming CSV output with parallel user fetching
- [ ] `npx workos-migrate merge-passwords` merges Auth0 NDJSON password exports into CSV
- [ ] `npx workos-migrate enroll-totp` enrolls TOTP MFA factors from CSV or NDJSON input
- [ ] `npx workos-migrate process-role-definitions` creates roles and assigns permissions
- [ ] `npx workos-migrate transform-clerk` converts Clerk CSV exports to WorkOS CSV format
- [ ] `npx workos-migrate transform-firebase` converts Firebase Auth JSON to WorkOS CSV format
- [ ] `npx workos-migrate validate --csv <file>` runs 3-pass validation with `--auto-fix` support
- [ ] `npx workos-migrate analyze --errors <file>` groups errors and generates retry CSVs
- [ ] `npx workos-migrate wizard` launches the interactive guided migration flow
- [ ] All commands support `--dry-run` or `--plan` mode where applicable
- [ ] Password hash algorithms supported: bcrypt, firebase-scrypt, auth0, md5, okta-bcrypt
- [ ] Existing Cognito provider stubs and SSO connections CSV template preserved
- [ ] Project uses ESM modules and Commander.js for CLI
- [ ] Existing tests from bulk tool ported and passing
- [ ] CI pipeline (`npm test`, `npm run lint`, `npm run build`) passes

## Scope Boundaries

### In Scope

- Commander.js CLI with all commands from bulk tool (`import`, `export-auth0`, `validate`, `analyze`, `merge-passwords`, `enroll-totp`, `process-role-definitions`, `transform-clerk`, `transform-firebase`, `wizard`, `map-fields`)
- ESM module system conversion
- Core import engine: importer, WorkOS SDK integration, concurrency control, rate limiter
- Multi-threaded worker architecture with distributed rate limiting and chunk coordination
- Checkpoint/resume system for interrupted imports
- Organization cache with pre-warming and thread-safe locking
- Auth0 streaming CSV exporter with all flags (rate-limit, page-size, user-fetch-concurrency, resume, etc.)
- Password hash merge tooling (Auth0 NDJSON format)
- TOTP enrollment from CSV and NDJSON
- Role definitions and multi-role assignment
- Clerk CSV transformer with org/role mapping
- Firebase JSON transformer with scrypt password encoding
- 3-pass CSV validator with auto-fix
- Error analysis with grouping, suggestions, and retry CSV generation
- Interactive wizard mode
- Dry-run / plan mode for imports
- Progress bars, ETAs, and summary reporting
- Preserve Cognito stubs from official repo
- Preserve SSO connections CSV template from official repo

### Out of Scope

- Cognito export implementation -- active development on a separate branch (`feat/cognito-export`), will be rebased after merge
- Stytch or other provider support -- not implemented in either repo
- WorkOS API bulk import endpoint integration -- the official repo's approach of uploading to `/migrations/csv-import` can be revisited if/when that endpoint exists
- Benchmark scripts and test data generators from bulk tool's `scripts/` directory -- operational tooling, not product features
- Auth0 E2E test scripts (create-auth0-test-data, cleanup, setup-auth0-test-orgs) -- require real Auth0 tenants

### Future Considerations

- Cognito export (in-progress on separate branch, rebase after merge)
- Stytch provider support
- Direct WorkOS bulk import API if/when available
- npm package publishing and versioning
- Migration guides and provider-specific documentation updates

---

_This contract was generated from brain dump input. Review and approve before proceeding to specification._
