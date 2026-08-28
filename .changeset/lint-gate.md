---
"oxlint-plugin-graphql-eslint": patch
---

Make the CI lint step an actual gate: `oxlint` reports at warning severity and exited `0` even
when it found problems, so a lint regression could never fail the build.
