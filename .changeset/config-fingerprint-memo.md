---
"oxlint-plugin-graphql-eslint": patch
---

Memoize the graphql-config fingerprint per directory (1s TTL) instead of recomputing it on every
`parseDocuments` call. Because each enabled rule parses a file separately, the fingerprint — a
directory walk plus `existsSync`/`readFileSync`/`statSync` over the config and every schema path
it names — was recomputed once per (rule × file). On a 300-file fixture with the 33-rule
`operations-recommended` preset that was 9,900 calls costing 1,333ms, ~75% of the plugin's entire
JS-side cost; the run drops from 2.10s to 0.89s with identical diagnostics. The TTL sits far below
the ~10s floor `@graphql-eslint/eslint-plugin`'s own schema cache already imposes, so editor
behaviour is unchanged.
