# oxlint-plugin-graphql

Runs [`@graphql-eslint/eslint-plugin`](https://github.com/dimaMachina/graphql-eslint) rules
inside [oxlint](https://oxc.rs/), via oxlint's JS-plugin API. It re-implements the
`SourceCode`/rule-runner surface graphql-eslint's rules expect, parses embedded GraphQL out of
your JS/TS with the same `graphql-tag-pluck`-based extraction graphql-eslint itself uses, and
maps every diagnostic and fix graphql-eslint produces back onto host-file coordinates so oxlint
can report and (where possible) fix them like any native rule.

All 64 upstream rules are exposed, as `graphql/<same-name>` (e.g.
`@graphql-eslint/no-anonymous-operations` becomes `graphql/no-anonymous-operations`), plus one
rule this plugin adds itself, `graphql/parse-error` (see [Behavioural
differences](#behavioural-differences-from-eslint) below) — 65 rules in total.

**Verified against:** oxlint `1.80.0`, `@graphql-eslint/eslint-plugin` `4.4.1`, `graphql` `16.14.2`,
Node `26.7.0` (this package's own `engines.node` requirement is `>=22.13.0`). Every command and
config example in this README was run for real while writing it — see
[Conformance](#conformance) for how the rule behaviour itself is checked against upstream.

## Install

```sh
pnpm add -D oxlint-plugin-graphql @graphql-eslint/eslint-plugin graphql
```

`@graphql-eslint/eslint-plugin` and `graphql` are peer dependencies — this plugin calls straight
into graphql-eslint's own rule implementations, so your installed version of it is what actually
runs. You also need `oxlint` itself in your project (`pnpm add -D oxlint`), since this package is
an oxlint plugin, not a linter on its own.

## Quick start

`.oxlintrc.json`:

```json
{
  "jsPlugins": ["oxlint-plugin-graphql"],
  "rules": {
    "graphql/no-anonymous-operations": "error",
    "graphql/require-selections": "error"
  }
}
```

With a `graphql.config.js` (or any [graphql-config](https://the-guild.dev/graphql/config) file)
next to it pointing at your schema —

```js
// graphql.config.js
export default { schema: "./schema.graphql", documents: "./app.ts" };
```

(`documents` is required here because `require-selections` is one of the rules listed in
[rules that require `documents`](#behavioural-differences-from-eslint) below; leaving it out
throws instead of linting) — and an `app.ts` containing:

```ts
const q = gql`
  query {
    user {
      name
    }
  }
`;
export { q };
```

running `oxlint` reports:

```
app.ts:2:3: error graphql(no-anonymous-operations): Anonymous GraphQL operations are forbidden. Make sure to name your query!
app.ts:3:10: error graphql(require-selections): Field `user.id` must be selected when it's available on a type. Include it in your selection set.
```

## Using a bundled config

graphql-eslint ships five flat configs (`schema-recommended`, `schema-all`, `schema-relay`,
`operations-recommended`, `operations-all`); this plugin ports all five, renaming their rule ids
and adding `graphql/parse-error: "error"` to each. Rule counts, read straight from the generated
configs:

| config                  | rules (upstream rules + `graphql/parse-error`) |
| ------------------------ | ------------------------------------------------: |
| `schema-recommended`     | 21                                                |
| `schema-all`              | 30                                                |
| `schema-relay`            | 5                                                 |
| `operations-recommended` | 33                                                |
| `operations-all`          | 38                                                |

**From `.oxlintrc.json`**, `extends` a generated JSON fragment (published under
`dist/configs/<name>.json`, resolvable via this package's `exports["./configs/*"]` map):

```json
{
  "extends": ["./node_modules/oxlint-plugin-graphql/dist/configs/operations-recommended.json"]
}
```

**From `oxlint.config.ts`**, import the config object directly and pass it to `extends`:

```ts
import { defineConfig } from "oxlint";
import { operationsRecommended } from "oxlint-plugin-graphql";

export default defineConfig({ extends: [operationsRecommended] });
```

Both forms were verified end to end against a real installed copy of this package (`file:`
dependency, real `node_modules` resolution) — `graphql(no-anonymous-operations)`,
`graphql(no-duplicate-fields)` and `graphql(require-selections)` all fired as expected.

> [!IMPORTANT]
> A JS plugin named inside a config object passed to `oxlint.config.ts`'s `extends` must be a
> **package name or an absolute path** — a relative path is rejected:
>
> ```
> Relative JS plugin specifiers are not supported in configs provided via `extends` in `oxlint.config.ts`.
> Found: "./node_modules/oxlint-plugin-graphql/dist/index.js"
> Use a package name (e.g. "eslint-plugin-foo") or an absolute path instead.
> ```
>
> This is why the config objects this package exports (`operationsRecommended`, etc.) use the bare
> package name `"oxlint-plugin-graphql"` as their `jsPlugins` entry. `.oxlintrc.json`'s top-level
> `jsPlugins` has no such restriction — a relative path works there.

## Scoping the plugin with `overrides`

To only run these rules against certain files, put `jsPlugins` inside an `overrides` entry instead
of at the top level:

```json
{
  "plugins": [],
  "overrides": [
    {
      "files": ["*.graphql.ts"],
      "jsPlugins": ["oxlint-plugin-graphql"],
      "rules": {
        "graphql/no-anonymous-operations": "error"
      }
    }
  ]
}
```

Verified directly: a file matching `*.graphql.ts` gets the `graphql/*` diagnostic, a sibling `.ts`
file that doesn't match the glob gets none.

## Aliasing the plugin name

The plugin registers itself as `graphql`. If that name ever collides with a future built-in oxlint
plugin, give it an alias with `jsPlugins`' object form:

```json
{
  "jsPlugins": [{ "name": "gql", "specifier": "oxlint-plugin-graphql" }],
  "rules": {
    "gql/no-anonymous-operations": "error"
  }
}
```

Verified: diagnostics print as `gql(no-anonymous-operations)` under this config.

## Schema without graphql-config: `settings.graphql.schemaSdl`

Existing `graphql.config.*`/`.graphqlrc.*` files work unchanged — nothing about how this plugin
reads them differs from graphql-eslint itself, and none of the options graphql-eslint v4 removed
(e.g. the old `parserOptions.schema`) come back. If your project has no graphql-config at all, set
`settings.graphql.schemaSdl` in `.oxlintrc.json` directly:

```json
{
  "jsPlugins": ["oxlint-plugin-graphql"],
  "settings": {
    "graphql": {
      "schemaSdl": "type Query { user: User }\ntype User { id: ID! name: String @deprecated(reason: \"use fullName instead\") fullName: String }"
    }
  },
  "rules": {
    "graphql/no-deprecated": "error"
  }
}
```

Against an `app.ts` containing:

```ts
const q = gql`
  query {
    user {
      name
    }
  }
`;
export { q };
```

this reports:

```
app.ts:4:7: error graphql(no-deprecated): Field "name" is marked as deprecated in your GraphQL schema (reason: use fullName instead)
```

This is exercised end to end in this package's own test suite
(`tests/e2e/fixtures/settings-schema`).

## Scope and limits

- **`.graphql` / `.gql` files are not linted.** oxlint has no custom-parser support, so this
  plugin only sees GraphQL *embedded* in JS/TS — `gql` tagged templates, `/* GraphQL */`-annotated
  strings, anything graphql-eslint's own `graphql-tag-pluck`-based extraction handles. For
  standalone `.graphql`/`.gql` files, keep running ESLint + graphql-eslint alongside oxlint. A
  minimal flat config that does that (verified against a real `.graphql` file):

  ```js
  // eslint.config.js
  import graphqlPlugin from "@graphql-eslint/eslint-plugin";

  export default [
    {
      files: ["**/*.graphql"],
      plugins: { "@graphql-eslint": graphqlPlugin },
      languageOptions: {
        parser: graphqlPlugin.parser,
        parserOptions: {
          graphQLConfig: { schema: "./schema.graphql", documents: "./**/*.graphql" },
        },
      },
      rules: graphqlPlugin.configs["flat/operations-recommended"].rules,
    },
  ];
  ```

  Run oxlint for your JS/TS and `eslint '**/*.graphql'` for your GraphQL documents; the two don't
  overlap.

- **`.vue` / `.svelte` embedded GraphQL is not covered, but not because oxlint can't see the
  code.** oxlint's own parser already extracts and lints the `<script>` block of both formats by
  default (verified directly: a syntax error placed inside `<script>` in a `.vue` or `.svelte`
  file is reported at its real in-block position, with or without `--vue-plugin` — that flag only
  adds a separate, additional set of template-aware native rules, +31 of them in the build tested
  here, and doesn't gate whether JS plugins see the script content at all). This plugin's own
  `Program` visitor does receive that extracted text for both formats. What actually blocks
  GraphQL extraction differs by format, and both are upstream `@graphql-eslint/eslint-plugin`
  behaviour, not an oxlint limitation and not something this plugin adds:
  - **`.vue`**: graphql-eslint's own processor unconditionally rejects it — the exact error
    is `Processing of .vue files is no longer supported, follow the new official vue example
    for ESLint's flat config ...` — regardless of what's installed.
  - **`.svelte`**: graphql-eslint's extractor (`graphql-tag-pluck`) does attempt real extraction,
    but needs the optional `svelte2tsx` and `svelte` packages installed to parse the component at
    all; without them it fails with `GraphQL template literals cannot be plucked from a Svelte
    template code without having the "svelte2tsx" & "svelte" package installed.` Neither package
    is a dependency of this plugin or of `@graphql-eslint/eslint-plugin`, so a default install
    hits this. Whether installing them makes `.svelte` extraction actually work end to end through
    oxlint was not verified here — the failure above surfaced as a plugin-load-time error with
    exit code 0 (silently non-fatal for the run), which is itself worth confirming before relying
    on it.

## Behavioural differences from ESLint

- **`graphql/parse-error` is this plugin's own rule — there's no upstream `@graphql-eslint/*`
  counterpart.** Under ESLint, a GraphQL syntax error inside a tagged template is a fatal parsing
  error, not a normal lint diagnostic. oxlint has no equivalent fatal-parse channel for a plugin,
  so this plugin reports syntax errors as a regular diagnostic from `graphql/parse-error` instead:

  ```
  app.ts:6:1: error graphql(parse-error): [graphql-eslint] Syntax Error: Expected Name, found <EOF>.
  ```

  It's included, as `"error"`, in every one of the five ported configs above, and needs no schema
  or `documents` to fire.

- **10 rules can throw unless graphql-config's `documents` is set and loaded.** This is
  graphql-eslint's own behaviour (`requireGraphQLOperations`), not something this plugin adds —
  re-derived directly from `@graphql-eslint/eslint-plugin@4.4.1`'s source (every call site of
  `requireGraphQLOperations`), not transcribed from its docs. Two groups, because they call it
  differently:

  - **7 always call it, unconditionally, on every lint of a matching node**: `no-unused-fragments`,
    `no-one-place-fragments`, `no-unused-fields`, `require-import-fragment`, `require-selections`,
    `unique-fragment-name`, and `unique-operation-name` (the last reuses `unique-fragment-name`'s
    own check function). Enabling any of these without `documents` configured throws on every
    matching file, every time.
  - **3 call it only when a document contains a fragment spread (`...Foo`) that can't be resolved
    within the same document**: `known-fragment-names`, `no-undefined-variables`, and
    `no-unused-variables` (all three route through a shared `handleMissingFragments` helper that
    only reaches `requireGraphQLOperations` when `missingFragments.length > 0`). A document with no
    such unresolved spread never throws, even with these rules enabled and no `documents`
    configured — verified directly: the same rule against the same schema throws only once an
    unresolvable `...UserFields` spread is added to the query.

  Running any of the 10 without `documents` configured (and, for the conditional 3, with a
  document that needs it) fails the whole file with:

  ```
  Error running JS plugin. ... Error: [oxlint-plugin-graphql] rule "no-unused-fragments" failed on <file>:
  Rule `no-unused-fragments` requires graphql-config `documents` field to be set and loaded.
  See https://the-guild.dev/graphql/eslint/docs/usage#providing-operations for more info
  ```

  Fix it by pointing `documents` at the files containing your operations, e.g. in
  `graphql.config.js`:

  ```js
  export default { schema: "./schema.graphql", documents: "./src/**/*.ts" };
  ```

- **`oxlint --fix` applies one pass of non-conflicting fixes per run; ESLint's `--fix` iterates
  internally until the file stops changing** (up to 10 internal passes). If two of this plugin's
  fixes only become non-conflicting after an earlier fix is applied, one `oxlint --fix` invocation
  may leave some of them unapplied — run it again (or a couple more times) to converge, the same
  way you'd re-run `oxlint --fix` for any other plugin with overlapping fixes.

- **Diagnostics never carry a `messageId`.** oxlint re-derives each message from the rule's
  `meta.messages` table; keeping the original `messageId` around would mean showing the
  un-interpolated template instead of the real message, so it's dropped. This means oxlint's
  `RuleTester` `messageId`-assertion style can't be used against these rules — assert on the
  rendered `message` text instead.

## Editor support

Diagnostics, quick-fix suggestions, and fix-on-save all work through the [oxc VS Code
extension](https://marketplace.visualstudio.com/items?itemName=oxc.oxc-vscode)
(`oxc.oxc-vscode`), because the extension's language server is just `oxlint --lsp` — the same
binary and flag verified directly here over raw LSP (`textDocument/didOpen` →
`textDocument/publishDiagnostics`, `textDocument/codeAction` for quick fixes, and a
`source.fixAll` code action for fix-on-save all returned the expected `graphql/*` results in a
scratch fixture with this plugin configured).

**Editing a schema file's *content*** (same path, new text) is picked up automatically, typically
within about 10 seconds, with no language-server restart. This works because a config-fingerprint
check (mtimes of the graphql-config file and every schema path it references) clears this
plugin's own parse cache on every edit, letting graphql-eslint's schema loader re-read the file —
and that loader has its own ~10-second cache that expires on its own. (That 10-second self-heal is
only reliable because this plugin also neutralizes a `process.env.NODE`-triggered bug in
graphql-eslint's cache — see `src/adapter/config-watch.ts`'s module doc comment for the full
story, including why an unpatched setup running under `pnpm exec`/`pnpm run` would never see the
edit at all.)

**Editing *which file* `graphql.config.*` points at** (changing the `schema` pointer, adding or
renaming a `projects` entry, or moving the config file) still requires restarting the language
server. graphql-eslint keeps its own `GraphQLConfig` object as a process-lifetime singleton that
this plugin cannot invalidate from the outside — the next parse still asks the stale object for
the file's project, and gets the old answer, until the process restarts.

## Conformance

This plugin is checked against real, installed `eslint` + `@graphql-eslint/eslint-plugin` on every
run of `pnpm test:conformance` — the same documented examples graphql-eslint ships for its own
rules, run through both engines and diff-checked. **We do not publish a bare pass rate**, because
most of that corpus never disagrees in a way that proves anything: the suite reports a four-way
split instead.

Latest run (100-case derived corpus, built from graphql-eslint's own rule doc examples):

| category                                                      |  count |  share |
| --------------------------------------------------------------- | -----: | -----: |
| **Substantive** — both engines reported the same real diagnostic(s) | 35 | 35% |
| **Vacuous** — both engines agreed on *zero* diagnostics             | 48 | 48% |
| **Not-compared** — both engines threw, for a documented reason      |  5 |  5% |
| **Mismatch** — genuine disagreement (should always be 0)            |  0 |  0% |
| **Excluded** — corpus artefact, not valid standalone GraphQL, never run | 12 | 12% |

The vacuous share is large because roughly half of graphql-eslint's own documented rule examples
are labelled "Correct" — they exist to show what *passes*, not what fails, so both engines
correctly report nothing on them. That's real, useful coverage (it proves neither engine
false-positives on the examples graphql-eslint itself calls valid) — it's just not the same claim
as "35 diagnostics matched," which is why it's broken out separately rather than folded into a
single percentage.

A second, hand-written **supplemental corpus** (4 cases, covering rules whose upstream examples
don't exercise their most interesting behaviour) is 100% substantive: 4/4 real, matching
diagnostics.

**Autofix comparison** (every case whose rule has `meta.fixable`, run through both engines'
`--fix`): 6 comparisons — 3 produced a real, byte-identical fix on both sides that actually
changed the input; 3 were correctly-vacuous no-ops (nothing to fix on either side); 0 mismatches.

**Execution coverage**: of the 65 rules this plugin exposes, 36 have at least one usable example in
graphql-eslint's own docs to build a corpus case from (the other 29 have no `meta.docs.examples` at
all upstream — not something this plugin can add). Every contributed case actually executes on
both engines (0 rules with cases that never ran). Of the rules that did execute, 7 never produced a
diagnostic in the corpus at all (`known-directives`, `match-document-filename`, `no-deprecated`,
`relay-edge-types`, `relay-page-info`, `unique-fragment-name`, `unique-operation-name`) — their
available examples all happen to be "Correct" ones.

**The 5 "not-compared" cases are pinned to specific, documented bugs in
`@graphql-eslint/eslint-plugin@4.4.1` itself** (not this plugin) — 4 in `naming-convention`, whose
own doc examples set option values (`requiredPattern: {}`, `forbiddenPatterns: [{}]`) that are
documentation placeholders, not working values, so both engines throw the identical underlying JS
error reading them; and 1 in `require-description`, whose rule builds an invalid empty esquery
selector (`:matches()`) for a particular option/schema combination, which both engines' selector
parser rejects identically. Full detail and the exact upstream code paths are in
`conformance/known-differences.ts`. The suite pins the count
(`expect(KNOWN_DIFFERENCES.length).toBe(5)`) and fails an *undocumented* both-threw case outright
— so a future graphql-eslint upgrade that fixes (or changes) one of these will make the suite fail
loudly, not silently start comparing something different.

Run it yourself: `pnpm test:conformance` (builds the package first, then runs the full corpus).

## Requirements

- Node.js `>=22.13.0` (this repo develops against `24`; CI builds on `24` and tests on `22.13`,
  `24`, and `26`). The floor is `22.13`, not `22.12`, because `pnpm` `11.24.0` (this repo's
  pinned package manager) itself refuses to run under `22.12` (`This version of pnpm requires
  at least Node.js v22.13`), and this repo's build tool, `tsdown`, additionally requires
  `22.18`+ (or `24.11`+) to load its own config natively — which is exactly why CI never runs
  `tsdown` on the `22.13`/`24` test legs, only on a dedicated `24` build job (see
  [`.github/workflows/ci.yml`](.github/workflows/ci.yml)).
- ESM only
- `@graphql-eslint/eslint-plugin` `^4.4.1` and `graphql` `^16` as peer dependencies
- `oxlint` itself (not a declared peer — bring your own; verified against `1.80.0`)

`esquery` is a regular runtime dependency (not bundled into the published output) — graphql-eslint
rules register their visitors using ESLint's own esquery selector syntax, and this plugin needs
the real `esquery` package to parse and match them. It's left as a real dependency, rather than
bundled, specifically so its (and `estraverse`'s) BSD license attributions stay visible to
dependency audits instead of disappearing into a bundle.

## License

MIT
