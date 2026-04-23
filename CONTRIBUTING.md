# Contributing to WorkOS Migrations

Thanks for your interest in contributing! This repo hosts a CLI that helps
customers migrate data from third-party identity providers to WorkOS.

## Development setup

```bash
# Install dependencies
npm install

# Run in development mode
npm run dev

# Build the TypeScript sources to dist/
npm run build

# Run the built CLI
npm start
```

Node.js `>=18` is required (see `engines` in `package.json`).

## Checks

Please run the following before opening a pull request:

```bash
npm run lint
npm run typecheck
npm run build
npm test
```

CI will run the same checks on every pull request.

## Adding a new provider

Providers live under `src/providers/<provider>/`. Each provider exports a
descriptor that declares its credential fields and the entities it can
export. See `src/providers/auth0/` for a complete example.

When you add a provider:

1. Create a new directory under `src/providers/<provider>/`.
2. Implement the provider's credential prompts and export logic.
3. Register it in `src/providers/index.ts`.
4. Update the README to document the new provider.

## Reporting issues

If you find a bug or have a feature request, please open a GitHub issue with:

- A clear description of the problem or desired behavior.
- Steps to reproduce (for bugs).
- The version of the CLI and the Node.js version you are using.

For security-related issues, see [`SECURITY.md`](./SECURITY.md).

## Pull request guidelines

- Keep changes focused and reasonably small.
- Update documentation when behavior changes.
- Follow existing code style; `npm run lint` will catch most issues.
- PRs require review from a code owner before they can be merged.
