import { fileURLToPath } from "node:url";
import { rules as graphqlEslintRules } from "@graphql-eslint/eslint-plugin";
import { afterAll, describe, expect, it } from "vitest";
import { buildCorpus, canEmbedInJsTemplate, isValidStandaloneGraphQL } from "./corpus.js";
import { RULES_REQUIRING_DOCUMENTS, RULES_WITH_SELF_SCHEMA_EXAMPLES } from "./documents-required-rules.js";
import { buildFixture } from "./fixture.js";
import { findKnownDifference } from "./known-differences.js";
import { normalizeEslintOutcome, normalizeOxlintOutcome } from "./normalize.js";
import type { NormalizedOutcome } from "./normalize.js";
import { lintWithEslint } from "./run-eslint.js";
import { lintWithOxlint } from "./run-oxlint.js";
import { renderCoverage, renderTable } from "./report.js";
import type { CaseResult, CoverageEntry } from "./report.js";

const schemaPath = fileURLToPath(new URL("./fixtures/schema.graphql", import.meta.url));

describe("conformance corpus", () => {
  const corpus = buildCorpus();

  it("covers every rule that documents examples", () => {
    expect(corpus.length).toBeGreaterThan(50);
  });

  it("embeds each example in a gql template", () => {
    for (const item of corpus) {
      expect(item.code.startsWith("const doc = gql`"), item.caseId).toBe(true);
    }
  });
});

/**
 * `@graphql-eslint/eslint-plugin@4.4.1` rules whose `meta.docs.examples` is undefined/empty —
 * mostly the graphql-js-validation wrappers (executable-definitions, known-argument-names, ...),
 * which don't carry curated doc examples at all. This list is derived mechanically (see the
 * "zero case audit" test below, which recomputes it from the live rules export) and asserted
 * against explicitly so that a future graphql-eslint upgrade adding examples to one of these
 * rules — or removing examples from a rule not in this list — fails loudly instead of silently
 * shrinking or growing the corpus's blind spot.
 */
const EXPECTED_ZERO_EXAMPLE_RULE_IDS = [
  "executable-definitions",
  "fields-on-correct-type",
  "fragments-on-composite-type",
  "known-argument-names",
  "known-type-names",
  "lone-anonymous-operation",
  "lone-schema-definition",
  "no-fragment-cycles",
  "no-undefined-variables",
  "no-unused-fragments",
  "no-unused-variables",
  "one-field-subscriptions",
  "overlapping-fields-can-be-merged",
  "possible-fragment-spread",
  "possible-type-extension",
  "provided-required-arguments",
  "scalar-leafs",
  "unique-argument-names",
  "unique-directive-names",
  "unique-directive-names-per-location",
  "unique-field-definition-names",
  "unique-input-field-names",
  "unique-operation-types",
  "unique-type-names",
  "unique-variable-names",
  "value-literals-of-correct-type",
  "variables-are-input-types",
  "variables-in-allowed-position",
].sort();

describe("coverage audit", () => {
  const corpus = buildCorpus();
  const allRuleIds = Object.keys(graphqlEslintRules).sort();
  const caseCountByRule = new Map<string, number>();
  for (const item of corpus) {
    caseCountByRule.set(item.ruleId, (caseCountByRule.get(item.ruleId) ?? 0) + 1);
  }
  const zeroCaseRuleIds = allRuleIds.filter((id) => (caseCountByRule.get(id) ?? 0) === 0).sort();

  it("has exactly the expected set of zero-case rules (fails loudly on drift)", () => {
    expect(zeroCaseRuleIds).toEqual(EXPECTED_ZERO_EXAMPLE_RULE_IDS);
  });

  afterAll(() => {
    const coverage: CoverageEntry[] = allRuleIds.map((ruleId) => ({
      ruleId,
      caseCount: caseCountByRule.get(ruleId) ?? 0,
      zeroReason:
        (caseCountByRule.get(ruleId) ?? 0) === 0
          ? "rule's meta.docs.examples is undefined/empty in @graphql-eslint/eslint-plugin — no example to derive a corpus case from"
          : undefined,
    }));
    // eslint-plugin's own `parse-error` rule (this plugin's, not graphql-eslint's) is not part
    // of `graphqlEslintRules` at all, so it never reaches `buildCorpus` in the first place — see
    // fact 6 in the task brief. Recorded here explicitly rather than left implicit.
    coverage.push({
      ruleId: "parse-error",
      caseCount: 0,
      zeroReason:
        "this plugin's own rule (no upstream graphql-eslint counterpart); has no meta.docs.examples and is never iterated from @graphql-eslint/eslint-plugin's rules export",
    });
    console.log("\n=== Coverage audit ===\n" + renderCoverage(coverage));
  });
});

describe("diagnostics match graphql-eslint", () => {
  const corpus = buildCorpus();
  const results: CaseResult[] = [];
  const excluded: { ruleId: string; caseId: string; reason: string }[] = [];
  let notComparedCount = 0;

  for (const item of corpus) {
    // Bucket (ii) corpus artifact, not a rule under test: the example's own GraphQL doesn't
    // parse standalone (documentation shorthand like `# ...`), so both engines would fail for
    // reasons unrelated to the rule being compared. Recorded, not silently dropped — see the
    // "excluded" table in the rendered report.
    if (!isValidStandaloneGraphQL(item.rawCode)) {
      excluded.push({
        ruleId: item.ruleId,
        caseId: item.caseId,
        reason: "example code is not valid standalone GraphQL (documentation shorthand such as `# ...` or a bare `...`, not real syntax) — verified by running it through graphql-js's own parse()",
      });
      continue;
    }
    if (!canEmbedInJsTemplate(item.rawCode)) {
      excluded.push({
        ruleId: item.ruleId,
        caseId: item.caseId,
        reason: "example code contains a literal backtick, which prematurely closes the surrounding gql`...` JS template literal when embedded — breaks the host .ts file's JS syntax, unrelated to the rule under test",
      });
      continue;
    }

    it(`${item.ruleId} :: ${item.title} (${item.caseId})`, () => {
      const requiresDocuments = RULES_REQUIRING_DOCUMENTS.has(item.ruleId);
      const schemaOverrideText = RULES_WITH_SELF_SCHEMA_EXAMPLES.has(item.ruleId) ? item.rawCode : undefined;
      const { dir } = buildFixture({ code: item.code, schemaPath, requiresDocuments, schemaOverrideText });

      const eslintOutcome = normalizeEslintOutcome(
        lintWithEslint({ dir, ruleId: item.ruleId, options: item.options }),
      );
      const oxlintOutcome = normalizeOxlintOutcome(
        lintWithOxlint({ dir, ruleId: item.ruleId, options: item.options }),
        item.code,
      );

      const known = findKnownDifference(item.ruleId, item.caseId);
      const comparison = compareOutcomes(eslintOutcome, oxlintOutcome);

      if (known) {
        // Documented, irreducible difference: excluded from the pass/fail gate, but still
        // recorded (as passed, with the reason as detail) so it shows up in the rendered table
        // rather than disappearing from the corpus's accounting entirely. Still assert the
        // claimed shape of the difference holds — a known-differences.ts entry that stops
        // matching reality (e.g. a graphql-eslint upgrade fixes the underlying bug, or changes
        // it into a different failure) must fail loudly and get re-investigated, not keep
        // silently "passing" on a stale excuse.
        expect(comparison.status, "known-difference entry no longer matches observed behavior — re-investigate").toBe(
          "both-errored",
        );
        results.push({ ruleId: item.ruleId, caseId: item.caseId, passed: true, detail: `known difference: ${known.reason}` });
        return;
      }

      if (comparison.status === "both-errored") {
        // Addition B: two sides both throwing is NOT evidence of parity. Never silently count
        // this as a pass — fail loudly so it gets investigated (fixed, or moved into
        // known-differences.ts with a reason) rather than accidentally shipping as "compared".
        notComparedCount += 1;
        results.push({
          ruleId: item.ruleId,
          caseId: item.caseId,
          passed: false,
          detail: `NOT COMPARED (both sides threw): eslint=${comparison.eslintMessage} oxlint=${comparison.oxlintMessage}`,
        });
        expect.fail(
          `both engines threw instead of producing diagnostics — not evidence of parity: eslint="${comparison.eslintMessage}" oxlint="${comparison.oxlintMessage}"`,
        );
        return;
      }

      results.push({ ruleId: item.ruleId, caseId: item.caseId, passed: comparison.status === "equal" });

      if (comparison.status === "kind-mismatch") {
        expect.fail(
          `one side errored and the other produced diagnostics: eslint=${JSON.stringify(eslintOutcome)} oxlint=${JSON.stringify(oxlintOutcome)}`,
        );
      } else {
        expect(oxlintOutcome).toEqual(eslintOutcome);
      }
    });
  }

  afterAll(() => {
    console.log("\n=== Conformance results ===\n" + renderTable(results));
    console.log(`\nCases not compared (both engines threw): ${notComparedCount}`);
    console.log(`\nCases excluded (invalid standalone GraphQL): ${excluded.length}`);
    for (const item of excluded) {
      console.log(`  - ${item.ruleId} :: ${item.caseId}: ${item.reason}`);
    }
  });
});

type Comparison =
  | { status: "equal" }
  | { status: "mismatch" }
  | { status: "kind-mismatch" }
  | { status: "both-errored"; eslintMessage: string; oxlintMessage: string };

function compareOutcomes(eslintOutcome: NormalizedOutcome, oxlintOutcome: NormalizedOutcome): Comparison {
  if (eslintOutcome.kind === "error" && oxlintOutcome.kind === "error") {
    return { status: "both-errored", eslintMessage: eslintOutcome.message, oxlintMessage: oxlintOutcome.message };
  }
  if (eslintOutcome.kind !== oxlintOutcome.kind) {
    return { status: "kind-mismatch" };
  }
  const equal = JSON.stringify(eslintOutcome) === JSON.stringify(oxlintOutcome);
  return { status: equal ? "equal" : "mismatch" };
}
