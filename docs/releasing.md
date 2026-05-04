# Releasing to npm

The published package is `workos-migrations`. It exposes these binaries:

- `workos-migrations`
- `workos-migrate`

Customers can run the CLI with:

```sh
npx workos-migrations@latest <command>
```

## One-time setup

1. Make sure the `workos-migrations` package is owned by the WorkOS npm organization or the WorkOS npm publisher account.
2. In npm, configure `workos-migrations` with Trusted Publisher for this repository's `Publish to npm` GitHub Actions workflow.
3. Configure the GitHub Actions `npm` environment if releases should require manual approval.

Do not add or manage an `NPM_TOKEN` for this package unless Trusted Publisher is unavailable. The publish workflow uses npm provenance, so the package can be traced back to the GitHub Actions run that published it.

## Public repository readiness

Complete this checklist before the first public release or any repository visibility change:

- Repository naming: confirm `workos-migrations` is clear, descriptive, and externally understandable.
- README: confirm it includes introduction, installation, usage examples, contributing guidance, and license information.
- SDK quality bar: review the README and command surface against current public WorkOS SDK repositories for clarity and consistency.
- CODEOWNERS: confirm `.github/CODEOWNERS` uses a WorkOS GitHub team, not individual maintainers.
- Branch protection: require at least one CODEOWNERS review on `main`, require CI status checks, and block force pushes and branch deletion.
- CI baseline: confirm pull requests and `main` merges run linting, formatting, typecheck, build, package smoke checks, and tests.
- Dependency management: confirm Dependabot is enabled for npm and GitHub Actions.
- Vulnerability management: confirm Coana pull-request and scheduled scans are configured for the public repository, and do not release with critical or high vulnerabilities open.
- Secrets: confirm any repository secrets required by CI/security tooling are configured. npm publishing should use Trusted Publisher, not a long-lived npm token.
- Final approval: get approval from the owning team and Security before changing repository visibility to public.

## Release process

1. Land the release changes on `main`.
2. Open a PR that updates `package.json` and `package-lock.json` to the new version.
3. After the version PR merges, create a GitHub Release from `main` with a tag that matches the package version:

   ```sh
   git fetch origin main
   git switch main
   git pull --ff-only origin main
   git tag v2.0.1
   git push origin v2.0.1
   ```

4. Publish the GitHub Release for that tag.
5. The `Publish to npm` workflow verifies the tag matches `package.json`, runs the full check suite, runs `npm pack --dry-run`, and publishes to npm.

## Local verification

Before opening a release PR, run:

```sh
npm ci
npm run check
npm run package:dry-run
```

To smoke-test the built CLI locally:

```sh
npm run build
npm run smoke:bin
```

## Version tag rule

The publish workflow accepts tags with or without a leading `v`, but the numeric part must match `package.json` exactly. For example, package version `2.0.1` can be published from `v2.0.1` or `2.0.1`; `v2.0.0` will be rejected.
