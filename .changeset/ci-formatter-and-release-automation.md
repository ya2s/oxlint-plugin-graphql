---
"oxlint-plugin-graphql-eslint": patch
---

Pin the CLI formatter in the end-to-end output test so it measures message text and positions
rather than oxlint's environment detection, and add a changesets-driven release workflow that
versions and publishes from `main` using npm trusted publishing (OIDC), so no npm token is
stored in the repository.
