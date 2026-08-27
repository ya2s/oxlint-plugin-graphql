---
"oxlint-plugin-graphql": minor
---

Initial public release. Exposes all 64 `@graphql-eslint/eslint-plugin` rules, plus this
package's own `graphql/parse-error`, as an oxlint JS plugin, with all five upstream flat configs
ported (`schema-recommended`, `schema-all`, `schema-relay`, `operations-recommended`,
`operations-all`), autofix/suggestion mapping onto host-file coordinates, and support for
existing `graphql.config.*` files.
