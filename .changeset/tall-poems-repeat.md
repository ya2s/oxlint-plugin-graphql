---
"oxlint-plugin-graphql-eslint": patch
---

Expose `./package.json` from the package `exports` map so tooling that resolves `oxlint-plugin-graphql-eslint/package.json` (e.g. version checks) no longer fails with `ERR_PACKAGE_PATH_NOT_EXPORTED`.
