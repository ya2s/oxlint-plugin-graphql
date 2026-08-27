import { toEmbedded } from "./corpus.js";
import type { CorpusCase } from "./corpus.js";

/**
 * Hand-written cases for rules whose *entire* mechanically-derived corpus contribution is
 * excluded (every documented example either fails to parse standalone, per
 * `isValidStandaloneGraphQL`, or needs schema/document plumbing graphql-eslint's own docs don't
 * provide) — see conformance.test.ts's "coverage audit" for the mechanically-computed list this
 * is checked against.
 *
 * Deliberately kept separate from `buildCorpus()` (mechanically derived straight from
 * `@graphql-eslint/eslint-plugin`'s own `meta.docs.examples`) rather than folded in: this file's
 * content is authored by hand, so mixing it into the derived corpus would make the corpus's
 * "these are the rule's own documented examples" claim false. `conformance.test.ts` runs and
 * reports these in a separate describe block with a separate table, never combined into the
 * derived corpus's counts.
 *
 * Each entry documents which real-world condition it's demonstrating, since (unlike the derived
 * corpus) there's no upstream doc example to point to for justification.
 */
export function buildSupplementalCorpus(): CorpusCase[] {
  return [
    {
      ruleId: "no-anonymous-operations",
      caseId: "no-anonymous-operations-supplemental-0",
      title: "Supplemental (anonymous query)",
      options: [],
      rawCode: "query {\n  user(id: \"1\") {\n    id\n  }\n}",
      code: toEmbedded("query {\n  user(id: \"1\") {\n    id\n  }\n}"),
    },
    {
      ruleId: "description-style",
      caseId: "description-style-supplemental-0",
      title: "Supplemental (block description with style: inline)",
      options: [{ style: "inline" }],
      rawCode: '""" Description """\ntype SomeType {\n  id: ID!\n}',
      code: toEmbedded('""" Description """\ntype SomeType {\n  id: ID!\n}'),
    },
    {
      // Needs the shared conformance schema's Mutation.renameUser field (see
      // fixtures/schema.graphql), which returns RenameUserPayload — a type with no field of
      // type Query, unlike CreateUserPayload (whose `user`/`query` shape is what the rule's own
      // "Correct" example, excluded as unparsable standalone GraphQL, was illustrating).
      ruleId: "require-field-of-type-query-in-mutation-result",
      caseId: "require-field-of-type-query-in-mutation-result-supplemental-0",
      title: "Supplemental (mutation result missing a Query-typed field)",
      options: [],
      rawCode: "type Mutation {\n  renameUser: RenameUserPayload!\n}",
      code: toEmbedded("type Mutation {\n  renameUser: RenameUserPayload!\n}"),
    },
    {
      ruleId: "require-type-pattern-with-oneof",
      caseId: "require-type-pattern-with-oneof-supplemental-0",
      title: "Supplemental (@oneOf type missing the error field)",
      options: [],
      rawCode: "type BadResult @oneOf {\n  ok: String\n}",
      code: toEmbedded("type BadResult @oneOf {\n  ok: String\n}"),
    },
  ];
}
