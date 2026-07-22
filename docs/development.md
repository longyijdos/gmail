# Development

## Requirements

- Node.js 22.12 or later
- npm 10 or later
- Git

Install dependencies and run the complete validation pipeline:

```sh
npm install
npm run check
npm run build
./dist/gml.js help
```

`npm run check` runs Biome, TypeScript, and the Vitest suite.

## Quality commands

```sh
npm run format
npm run format:check
npm run lint
npm run lint:fix
npm run typecheck
npm test
npm run check:fix
```

Husky installs through the `prepare` script. The pre-commit hook runs
`npm run check`. GitHub Actions runs the same command for pushes to `main` and
for pull requests.

## Project boundaries

Source code is divided into top-level modules under `src/`. Every module exposes
an explicit `index.ts` barrel, and cross-module imports use the `@/module`
aliases rather than internal paths. Architecture tests enforce both rules.

Tests are grouped by domain under `tests/`. Shared fixtures that modify process
globals live under `tests/support` so they can serialize those changes safely.

## API compatibility

Before changing Gmail resource clients, compare request and response contracts
with the official Gmail API v1 Discovery document and REST reference. Record
the result in [Gmail API compatibility](api-compatibility.md).

## Releases

The initial package is published at `@longyijdos/gmail`. Later releases are
driven by annotated `v*` tags:

```sh
npm version patch --no-git-tag-version
VERSION=$(node -p "require('./package.json').version")
npm run check
git add package.json
git commit -m "chore(release): v${VERSION}"
git tag -a "v${VERSION}" -m "v${VERSION}"
git push origin main "v${VERSION}"
```

The tag must match the version in `package.json`. The publish workflow:

1. Installs the locked development dependencies with `npm ci --include=dev`.
2. Runs the package `prepack` checks and build.
3. Publishes to npm through Trusted Publishing and OIDC.
4. Creates a GitHub Release with generated release notes after npm succeeds.

The workflow uses the `npm` GitHub Environment and does not store an npm token
in repository secrets. To inspect the package locally without publishing:

```sh
npm pack --dry-run
```
