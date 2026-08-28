/**
 * Rules whose `create()` calls `requireGraphQLOperations` (graphql-eslint's `utils.js`) and
 * THROW when graphql-config's `documents` field isn't set and loaded. Re-derived by grepping
 * every caller of `requireGraphQLOperations` across `@graphql-eslint/eslint-plugin`'s rule
 * sources — this turned up an 8th caller beyond the task brief's fact 5 (which named seven):
 *
 *   no-unused-fragments, no-one-place-fragments, no-unused-fields, require-import-fragment,
 *   require-selections, unique-operation-name, unique-fragment-name, known-fragment-names
 *
 * `known-fragment-names` doesn't live in its own `rules/known-fragment-names/index.js` file the
 * way the other seven do — it's one of the graphql-js validation rules wrapped generically by
 * `rules/graphql-js-validation.js`, which calls `requireGraphQLOperations` from inside a shared
 * `handleMissingFragments` helper — and, unlike the other seven, only reaches that call when the
 * document being linted actually has a `...FragmentSpread` to a fragment not defined in the same
 * document (`getDocumentNode: handleMissingFragments`, conditioned on
 * `missingFragments.length > 0`). Concretely: of `known-fragment-names`'s three examples, only
 * "Incorrect" (`...UserFields # fragment not defined in the document`) hits the throw — its two
 * "Correct" examples both define the fragment inline, so `missingFragments` is empty and
 * `requireGraphQLOperations` is never called. Added to this set anyway (unconditionally, for
 * every case of the rule) since giving the two "Correct" cases a `documents` fixture too is a
 * harmless no-op for them.
 *
 * The same `handleMissingFragments` helper is also wired up for `no-undefined-variables` and
 * `no-unused-variables`, but both have zero documented examples (see
 * `EXPECTED_ZERO_EXAMPLE_RULE_IDS` in conformance.test.ts), so they never produce a corpus case
 * and need no entry here.
 *
 * `selection-set-depth` also calls `requireGraphQLOperations`, but wraps the call in try/catch
 * and degrades to a warning instead of throwing (see its rule source), so it is deliberately
 * excluded from this set — it needs no special fixture handling.
 *
 * For every case whose `ruleId` is in this set, the fixture builder points graphql-config's
 * `documents` field at the case's own `app.ts`, using `@graphql-tools/code-file-loader` (wired
 * up by graphql-eslint's `loadGraphQLConfig`) to pluck the same `gql` tagged template back out
 * as a sibling operation. This mirrors how a real project satisfies these rules (the file under
 * lint is itself part of the `documents` glob), and is why `no-one-place-fragments` and
 * `unique-fragment-name` — the two rules whose message text embeds
 * `relative(CWD, filePath)` — need each engine invoked as a *fresh subprocess* per case with the
 * fixture directory as its `cwd`: `CWD` is `process.cwd()` captured once at module import inside
 * `@graphql-eslint/eslint-plugin`'s `utils.js`, so only a fresh process per case gives both
 * engines the same `CWD` (see run-eslint.ts / run-oxlint.ts).
 */
export const RULES_REQUIRING_DOCUMENTS: ReadonlySet<string> = new Set([
  "no-unused-fragments",
  "no-one-place-fragments",
  "no-unused-fields",
  "require-import-fragment",
  "require-selections",
  "unique-operation-name",
  "unique-fragment-name",
  "known-fragment-names",
]);

/**
 * `no-unused-fields` reports `FieldDefinition` nodes from the document it is currently parsing,
 * not from graphql-config's `schema` — but it still needs a real `schema` to type-check the
 * *sibling operations* (`getUsedFields` builds a `TypeInfo` from `requireGraphQLSchema`'s
 * schema). Its own examples embed a complete miniature schema directly alongside the query, in
 * the very same `code` string, so linting them against the shared conformance schema (whose
 * `Query`/`User` types don't define the example's `me` / `someUnusedField` fields) makes every
 * case throw a schema-mismatch error instead of reporting the rule's actual diagnostic.
 *
 * For rules in this set, the fixture builder writes the case's raw example source as
 * `schema.graphql` itself. This works because `graphql-js`'s `buildSchema` silently ignores the
 * `OperationDefinition` mixed into the same text (verified directly against `graphql-js`:
 * `buildSchema` only reads the type-system definitions) — so the exact same text serves as both
 * the embedded document (via `toEmbedded`) and the schema.
 *
 * `no-unreachable-types` has the same shape for a different reason: it walks
 * `requireGraphQLSchema`'s schema itself (not the document under lint) looking for types no root
 * type can reach, and both its examples embed a complete miniature `Query`/`User` schema whose
 * reachability is exactly what the example is illustrating. Checked against the shared
 * conformance schema (where `User` is already reachable via `Query.user`), the example's
 * `User`/`Query.me: String` never triggers the rule's real logic — comparing genuinely equal but
 * *vacuous* zero-diagnostics on both sides instead of the rule's actual "Incorrect" diagnostic.
 * Verified directly: giving it its own example text as `schema.graphql` converts
 * `no-unreachable-types-0` into a genuine, non-vacuous matching comparison.
 */
export const RULES_WITH_SELF_SCHEMA_EXAMPLES: ReadonlySet<string> = new Set([
  "no-unused-fields",
  "no-unreachable-types",
]);
