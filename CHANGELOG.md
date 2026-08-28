# oxlint-plugin-graphql-eslint

## 0.1.1

### Patch Changes

- c5be005: Pin the CLI formatter in the end-to-end output test so it measures message text and positions
  rather than oxlint's environment detection, and add a changesets-driven release workflow that
  versions and publishes from `main` using npm trusted publishing (OIDC), so no npm token is
  stored in the repository.

## 0.1.0

### Minor Changes

- 87f74b7: Initial public release. Exposes all 64 `@graphql-eslint/eslint-plugin` rules, plus this
  package's own `graphql/parse-error`, as an oxlint JS plugin, with all five upstream flat configs
  ported (`schema-recommended`, `schema-all`, `schema-relay`, `operations-recommended`,
  `operations-all`), autofix/suggestion mapping onto host-file coordinates, and support for
  existing `graphql.config.*` files.
