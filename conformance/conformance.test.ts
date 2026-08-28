import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { rules as graphqlEslintRules } from "@graphql-eslint/eslint-plugin";
import { afterAll, describe, expect, it } from "vitest";
import { buildCorpus, isValidStandaloneGraphQL } from "./corpus.js";
import type { CorpusCase } from "./corpus.js";
import { buildSupplementalCorpus } from "./supplemental-corpus.js";
import { RULES_REQUIRING_DOCUMENTS, RULES_WITH_SELF_SCHEMA_EXAMPLES } from "./documents-required-rules.js";
import { buildFixture } from "./fixture.js";
import { extractCoreErrorMessage, findKnownDifference, KNOWN_DIFFERENCES } from "./known-differences.js";
import { normalizeEslintOutcome, normalizeOxlintOutcome } from "./normalize.js";
import type { NormalizedOutcome } from "./normalize.js";
import { fixWithEslint, lintWithEslint } from "./run-eslint.js";
import { fixWithOxlint, lintWithOxlint } from "./run-oxlint.js";
import {
  countFourWay,
  renderCoverage,
  renderExecutionCoverage,
  renderFixResults,
  renderFourWaySummary,
  renderMismatches,
  renderPerRuleAccounting,
} from "./report.js";
import type { CaseClassification, CaseResult, CoverageEntry, ExecutionCoverageEntry, FixCaseResult } from "./report.js";

const schemaPath = fileURLToPath(new URL("./fixtures/schema.graphql", import.meta.url));
const reportPath = fileURLToPath(new URL("./last-run-report.txt", import.meta.url));

/** Every section any describe block below wants in the final combined report — assembled once,
 *  at the very end of the file, in a top-level (not nested in any `describe`) `afterAll`, which
 *  vitest runs only after every describe block in the file has finished. Important 3 from
 *  review: this is written to a file AND to `process.stdout` directly (not `console.log`, which
 *  vitest's default reporter silently drops for a passing run — measured directly) so a human
 *  running the documented `pnpm test:conformance` (no `--reporter=verbose` needed) still sees
 *  the four-way accounting. */
const reportSections: string[] = [];
function appendReport(section: string): void {
  reportSections.push(section);
}

/** Every case actually run through both engines, from BOTH the derived and supplemental
 *  corpora — populated by `runCase` below. Used by the cross-corpus "execution coverage audit"
 *  and the "case classification pin" at the bottom of this file; each of the two "diagnostics
 *  match" describe blocks also keeps its own local array (for per-corpus reporting) in addition
 *  to pushing here. */
const combinedResults: CaseResult[] = [];

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

/** Pinned (Critical 1): a `KNOWN_DIFFERENCES` entry silently added or removed changes how many
 *  cases are "not-compared" without changing the headline pass rate — pinning the count makes
 *  that a loud, deliberate change instead of a silent one. */
const EXPECTED_KNOWN_DIFFERENCE_COUNT = 5;

/**
 * Review round 2, item 1 — the main fix: pins the expected CLASSIFICATION of every one of the
 * 100 derived corpus case ids (one of "substantive" / "vacuous" / "not-compared" / "excluded";
 * "mismatch" would appear here too if a case were EXPECTED to disagree, which none currently
 * are), not just which ones are excluded. The exclusion-only pin from round 1 left a hole the
 * reviewer demonstrated directly: removing a gated substantive case from the corpus made the
 * suite report "97 tests, all green" — nothing failed, because nothing asserted that
 * `alphabetize-0` specifically must exist and must specifically be substantive. This closes that
 * hole (a case silently leaving the gate now fails, whichever category it was in) and, as a
 * side effect, also closes the "7 all-vacuous rules have no `toEqual` pin" gap: a rule going
 * silently all-vacuous after a fixture/schema edit changes entries in this map from
 * "substantive" to "vacuous", which the `toEqual` below catches.
 *
 * Generated mechanically, not hand-typed: dumped from a real run (every derived case actually
 * executed once, its outcome recorded) and pasted in verbatim — see the task-10 report for the
 * exact reproduction. That is deliberate, not a shortcut: a graphql-eslint upgrade SHOULD make
 * this fail. When it does, a human must look at the diff (a case's category changing from
 * "substantive" to "vacuous" is a real signal something changed, not noise to suppress) and
 * regenerate this block from a fresh run — re-running the same dump used to build it — rather
 * than trying to hand-edit individual entries.
 */
const EXPECTED_CASE_CLASSIFICATIONS: Record<string, CaseClassification> = {
  "alphabetize-0": "substantive",
  "alphabetize-1": "vacuous",
  "alphabetize-2": "substantive",
  "alphabetize-3": "vacuous",
  "alphabetize-4": "substantive",
  "alphabetize-5": "vacuous",
  "description-style-0": "excluded",
  "description-style-1": "excluded",
  "input-name-0": "substantive",
  "input-name-1": "vacuous",
  "input-name-2": "vacuous",
  "known-directives-0": "vacuous",
  "known-fragment-names-0": "substantive",
  "known-fragment-names-1": "vacuous",
  "known-fragment-names-2": "vacuous",
  "lone-executable-definition-0": "substantive",
  "lone-executable-definition-1": "vacuous",
  "match-document-filename-0": "vacuous",
  "match-document-filename-1": "vacuous",
  "match-document-filename-2": "vacuous",
  "match-document-filename-3": "vacuous",
  "match-document-filename-4": "vacuous",
  "match-document-filename-5": "vacuous",
  "match-document-filename-6": "vacuous",
  "match-document-filename-7": "vacuous",
  "naming-convention-0": "substantive",
  "naming-convention-1": "excluded",
  "naming-convention-2": "not-compared",
  "naming-convention-3": "vacuous",
  "naming-convention-4": "excluded",
  "naming-convention-5": "not-compared",
  "naming-convention-6": "vacuous",
  "naming-convention-7": "not-compared",
  "naming-convention-8": "not-compared",
  "naming-convention-9": "excluded",
  "no-anonymous-operations-0": "excluded",
  "no-anonymous-operations-1": "excluded",
  "no-deprecated-0": "vacuous",
  "no-deprecated-1": "excluded",
  "no-deprecated-2": "vacuous",
  "no-duplicate-fields-0": "substantive",
  "no-duplicate-fields-1": "substantive",
  "no-duplicate-fields-2": "substantive",
  "no-hashtag-description-0": "substantive",
  "no-hashtag-description-1": "vacuous",
  "no-hashtag-description-2": "vacuous",
  "no-one-place-fragments-0": "substantive",
  "no-one-place-fragments-1": "vacuous",
  "no-root-type-0": "substantive",
  "no-root-type-1": "vacuous",
  "no-scalar-result-type-on-mutation-0": "substantive",
  "no-scalar-result-type-on-mutation-1": "vacuous",
  "no-typename-prefix-0": "substantive",
  "no-typename-prefix-1": "vacuous",
  "no-unreachable-types-0": "substantive",
  "no-unreachable-types-1": "vacuous",
  "no-unused-fields-0": "substantive",
  "no-unused-fields-1": "vacuous",
  "no-unused-fields-2": "vacuous",
  "relay-arguments-0": "substantive",
  "relay-arguments-1": "vacuous",
  "relay-connection-types-0": "substantive",
  "relay-connection-types-1": "vacuous",
  "relay-edge-types-0": "vacuous",
  "relay-page-info-0": "vacuous",
  "require-deprecation-date-0": "substantive",
  "require-deprecation-date-1": "substantive",
  "require-deprecation-date-2": "substantive",
  "require-deprecation-reason-0": "substantive",
  "require-deprecation-reason-1": "substantive",
  "require-deprecation-reason-2": "vacuous",
  "require-description-0": "substantive",
  "require-description-1": "vacuous",
  "require-description-2": "excluded",
  "require-description-3": "vacuous",
  "require-description-4": "not-compared",
  "require-field-of-type-query-in-mutation-result-0": "excluded",
  "require-field-of-type-query-in-mutation-result-1": "excluded",
  "require-import-fragment-0": "substantive",
  "require-import-fragment-1": "substantive",
  "require-import-fragment-2": "substantive",
  "require-import-fragment-3": "substantive",
  "require-nullable-fields-with-oneof-0": "substantive",
  "require-nullable-fields-with-oneof-1": "vacuous",
  "require-nullable-result-in-root-0": "substantive",
  "require-nullable-result-in-root-1": "vacuous",
  "require-selections-0": "substantive",
  "require-selections-1": "vacuous",
  "require-type-pattern-with-oneof-0": "excluded",
  "selection-set-depth-0": "substantive",
  "selection-set-depth-1": "vacuous",
  "selection-set-depth-2": "vacuous",
  "strict-id-in-types-0": "substantive",
  "strict-id-in-types-1": "vacuous",
  "unique-enum-value-names-0": "substantive",
  "unique-enum-value-names-1": "vacuous",
  "unique-fragment-name-0": "vacuous",
  "unique-fragment-name-1": "vacuous",
  "unique-operation-name-0": "vacuous",
  "unique-operation-name-1": "vacuous",
};

function computeExcludedCaseIds(corpus: CorpusCase[]): string[] {
  return corpus.filter((item) => !isValidStandaloneGraphQL(item.rawCode)).map((item) => item.caseId).sort();
}

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

  it("has exactly the expected set of excluded case ids (fails loudly on drift)", () => {
    expect(computeExcludedCaseIds(corpus)).toEqual(
      Object.entries(EXPECTED_CASE_CLASSIFICATIONS)
        .filter(([, classification]) => classification === "excluded")
        .map(([caseId]) => caseId)
        .sort(),
    );
  });

  it("has every derived corpus case id accounted for in EXPECTED_CASE_CLASSIFICATIONS (no case is unpinned)", () => {
    const corpusCaseIds = corpus.map((item) => item.caseId).sort();
    expect(Object.keys(EXPECTED_CASE_CLASSIFICATIONS).sort()).toEqual(corpusCaseIds);
  });

  it("has exactly the expected number of known differences (fails loudly on drift)", () => {
    expect(KNOWN_DIFFERENCES.length).toBe(EXPECTED_KNOWN_DIFFERENCE_COUNT);
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
    appendReport("=== Coverage audit (rules with >=1 documented example) ===\n" + renderCoverage(coverage));
  });
});

type Comparison =
  | { status: "equal-substantive" }
  | { status: "equal-vacuous" }
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
  if (!equal) return { status: "mismatch" };
  const diagnosticCount = eslintOutcome.kind === "diagnostics" ? eslintOutcome.diagnostics.length : 0;
  return { status: diagnosticCount > 0 ? "equal-substantive" : "equal-vacuous" };
}

const FIXABLE_RULE_IDS = new Set(
  Object.entries(graphqlEslintRules as unknown as Record<string, { meta?: { fixable?: unknown } }>)
    .filter(([, rule]) => Boolean(rule.meta?.fixable))
    .map(([ruleId]) => ruleId),
);

/** Records a `"skipped"` fix outcome when `item`'s rule is fixable but `runCase` is about to
 *  return before ever attempting a fix (the diagnostics comparison itself failed first) — review
 *  round 2, item 3: without this, such cases silently vanished from `fixResults` entirely,
 *  shrinking the denominator instead of showing up as "attempted but skipped". No-op for
 *  non-fixable rules. */
function recordSkippedFix(item: CorpusCase, fixResults: FixCaseResult[], reason: string): void {
  if (FIXABLE_RULE_IDS.has(item.ruleId)) {
    fixResults.push({ ruleId: item.ruleId, caseId: item.caseId, outcome: "skipped", detail: reason });
  }
}

/**
 * Runs one corpus case (derived or supplemental — same shape, same treatment) through both
 * engines, categorizes the outcome, and — for rules with `meta.fixable` set (only `alphabetize`
 * as of @graphql-eslint/eslint-plugin@4.4.1) — separately runs and compares each engine's real
 * autofix output on a *fresh* fixture (kept separate from the one used for the diagnostics
 * comparison, so applying fixes never mutates the file the diagnostics assertion just read).
 * Shared between the derived-corpus and supplemental-corpus describe blocks below so both get
 * identical treatment. Pushes into both a per-block `results` array (for that block's own
 * report section) and the module-level `combinedResults` (for the cross-corpus execution
 * coverage audit and classification pin at the bottom of this file).
 */
function runCase(item: CorpusCase, results: CaseResult[], fixResults: FixCaseResult[]): void {
  const requiresDocuments = RULES_REQUIRING_DOCUMENTS.has(item.ruleId);
  const schemaOverrideText = RULES_WITH_SELF_SCHEMA_EXAMPLES.has(item.ruleId) ? item.rawCode : undefined;
  const { dir } = buildFixture({ code: item.code, schemaPath, requiresDocuments, schemaOverrideText });

  const eslintOutcome = normalizeEslintOutcome(lintWithEslint({ dir, ruleId: item.ruleId, options: item.options }));
  const oxlintOutcome = normalizeOxlintOutcome(
    lintWithOxlint({ dir, ruleId: item.ruleId, options: item.options }),
    item.code,
  );

  const known = findKnownDifference(item.ruleId, item.caseId);
  const comparison = compareOutcomes(eslintOutcome, oxlintOutcome);

  const record = (result: CaseResult): void => {
    results.push(result);
    combinedResults.push(result);
  };

  if (known) {
    // Documented, irreducible difference: excluded from the pass/fail gate on diagnostic
    // *equality* (there's nothing to compare — both sides threw), but never silently trusted:
    // still asserts the outcome really is "both-errored" (Addition B / Critical 2 — a
    // known-difference is never counted as "passed" in the pass rate, it's its own
    // "not-compared" category), AND (Important 8) that the two engines' error text agrees once
    // normalized — an adapter regression that throws for a DIFFERENT reason than the documented
    // one must still fail loudly, not coast on a stale excuse.
    expect(
      comparison.status,
      "known-difference entry no longer matches observed behavior (both-errored expected) — re-investigate",
    ).toBe("both-errored");
    if (comparison.status === "both-errored") {
      const eslintCore = extractCoreErrorMessage(comparison.eslintMessage);
      const oxlintCore = extractCoreErrorMessage(comparison.oxlintMessage);
      expect(
        oxlintCore,
        `known-difference "${item.caseId}": normalized error text no longer matches between engines — eslint="${eslintCore}" oxlint="${oxlintCore}" — this could mean the adapter now throws for an unrelated reason`,
      ).toBe(eslintCore);
    }
    record({ ruleId: item.ruleId, caseId: item.caseId, category: "not-compared", detail: `known difference: ${known.reason}` });
    recordSkippedFix(item, fixResults, "diagnostics comparison is a documented known-difference (both-errored) — no diagnostics to fix");
    return;
  }

  if (comparison.status === "both-errored") {
    // Addition B: two sides both throwing is NOT evidence of parity. Never silently count this
    // as a pass — fail loudly so it gets investigated (fixed, or moved into
    // known-differences.ts with a reason) rather than accidentally shipping as "compared".
    record({
      ruleId: item.ruleId,
      caseId: item.caseId,
      category: "not-compared",
      detail: `UNDOCUMENTED (both sides threw): eslint=${comparison.eslintMessage} oxlint=${comparison.oxlintMessage}`,
    });
    recordSkippedFix(item, fixResults, "diagnostics comparison failed first (undocumented both-errored)");
    expect.fail(
      `both engines threw instead of producing diagnostics, and this case is not in known-differences.ts — not evidence of parity: eslint="${comparison.eslintMessage}" oxlint="${comparison.oxlintMessage}"`,
    );
    return;
  }

  if (comparison.status === "kind-mismatch") {
    record({ ruleId: item.ruleId, caseId: item.caseId, category: "mismatch" });
    recordSkippedFix(item, fixResults, "diagnostics comparison failed first (kind-mismatch: one side errored, the other produced diagnostics)");
    expect.fail(
      `one side errored and the other produced diagnostics: eslint=${JSON.stringify(eslintOutcome)} oxlint=${JSON.stringify(oxlintOutcome)}`,
    );
    return;
  }

  if (comparison.status === "mismatch") {
    record({ ruleId: item.ruleId, caseId: item.caseId, category: "mismatch" });
    recordSkippedFix(item, fixResults, "diagnostics comparison failed first (diagnostics differ between engines)");
    expect(oxlintOutcome).toEqual(eslintOutcome);
    return;
  }

  record({
    ruleId: item.ruleId,
    caseId: item.caseId,
    category: comparison.status === "equal-substantive" ? "substantive" : "vacuous",
  });
  expect(oxlintOutcome).toEqual(eslintOutcome);

  if (FIXABLE_RULE_IDS.has(item.ruleId)) {
    const eslintFixture = buildFixture({ code: item.code, schemaPath, requiresDocuments, schemaOverrideText });
    const eslintFixed = fixWithEslint({ dir: eslintFixture.dir, ruleId: item.ruleId, options: item.options });
    const oxlintFixture = buildFixture({ code: item.code, schemaPath, requiresDocuments, schemaOverrideText });
    const oxlintFixed = fixWithOxlint({ dir: oxlintFixture.dir, ruleId: item.ruleId, options: item.options });

    if (eslintFixed !== oxlintFixed) {
      fixResults.push({
        ruleId: item.ruleId,
        caseId: item.caseId,
        outcome: "mismatch",
        detail: "eslint fixed output and oxlint fixed output differ byte-for-byte",
      });
      expect(oxlintFixed, `autofix output differs for ${item.caseId}`).toBe(eslintFixed);
    } else if (comparison.status === "equal-vacuous") {
      // Review round 2, item 4: zero diagnostics means zero fixes SHOULD be applied — verify
      // that's actually what happened (both engines left the file untouched), rather than just
      // "both engines agree", which a fixer that always no-ops would also satisfy.
      fixResults.push({ ruleId: item.ruleId, caseId: item.caseId, outcome: "noop-match" });
      expect(eslintFixed, `case "${item.caseId}" has zero diagnostics — expected no fix, but the file changed`).toBe(item.code);
    } else {
      // Substantive: a real diagnostic was reported, so a real fix is expected. Assert the fixed
      // text actually differs from the input — otherwise a regression that silently stopped
      // applying fixes (both engines "fixing" by doing nothing) would read as a pass, since
      // `eslintFixed === oxlintFixed` alone can't distinguish "both fixed it the same way" from
      // "both did nothing".
      fixResults.push({ ruleId: item.ruleId, caseId: item.caseId, outcome: "fixed-match" });
      expect(
        eslintFixed,
        `case "${item.caseId}" reported a real diagnostic — expected a fix to change the file, but it is byte-identical to the input`,
      ).not.toBe(item.code);
    }
  }
}

describe("diagnostics match graphql-eslint", () => {
  const corpus = buildCorpus();
  const results: CaseResult[] = [];
  const fixResults: FixCaseResult[] = [];
  const excluded: { ruleId: string; caseId: string; reason: string }[] = [];

  for (const item of corpus) {
    // Bucket (ii) corpus artifact, not a rule under test: the example's own GraphQL doesn't
    // parse standalone (documentation shorthand like `# ...`), so both engines would fail for
    // reasons unrelated to the rule being compared. Recorded, not silently dropped — see the
    // "excluded" table below, and see `EXPECTED_CASE_CLASSIFICATIONS` above for why the set
    // itself (and every other case's category) can't silently drift.
    if (!isValidStandaloneGraphQL(item.rawCode)) {
      excluded.push({
        ruleId: item.ruleId,
        caseId: item.caseId,
        reason: "example code is not valid standalone GraphQL (documentation shorthand such as `# ...` or a bare `...`, not real syntax) — verified by running it through graphql-js's own parse()",
      });
      continue;
    }

    it(`${item.ruleId} :: ${item.title} (${item.caseId})`, () => {
      runCase(item, results, fixResults);
    });
  }

  afterAll(() => {
    const counts = countFourWay(results, excluded.length);
    let report = "=== Derived-corpus four-way accounting ===\n" + renderFourWaySummary(counts) + "\n\n";
    report += "=== Derived-corpus per-rule accounting ===\n" + renderPerRuleAccounting(results) + "\n\n";
    report += renderMismatches(results) + "\n\n";
    report += `Excluded cases (${excluded.length}):\n`;
    for (const item of excluded) {
      report += `  - ${item.ruleId} :: ${item.caseId}: ${item.reason}\n`;
    }
    report += "\n=== Autofix comparison (derived corpus) ===\n" + renderFixResults(fixResults);
    appendReport(report);
  });
});

/**
 * Hand-written cases (see supplemental-corpus.ts) for rules whose entire mechanically-derived
 * contribution is excluded — kept in a wholly separate describe block/table so the derived
 * corpus's "these numbers come straight from graphql-eslint's own docs" claim stays true; these
 * four rules' numbers are never folded into the derived-corpus accounting above, and are NOT
 * part of `EXPECTED_CASE_CLASSIFICATIONS` (that pin is derived-corpus only, by design).
 */
describe("diagnostics match graphql-eslint (supplemental corpus)", () => {
  const supplemental = buildSupplementalCorpus();
  const results: CaseResult[] = [];
  const fixResults: FixCaseResult[] = [];

  for (const item of supplemental) {
    it(`${item.ruleId} :: ${item.title} (${item.caseId})`, () => {
      runCase(item, results, fixResults);
    });
  }

  afterAll(() => {
    const counts = countFourWay(results, 0);
    let report = "=== Supplemental-corpus four-way accounting ===\n" + renderFourWaySummary(counts) + "\n\n";
    report += "=== Supplemental-corpus per-rule accounting ===\n" + renderPerRuleAccounting(results) + "\n\n";
    report += renderMismatches(results);
    appendReport(report);
  });
});

/**
 * Important 6 from review: audits EXECUTED and DIAGNOSTIC-PRODUCING coverage per rule, not just
 * "contributed at least one corpus case" (checked separately above, and not the same claim — a
 * rule can contribute cases that are ALL excluded, landing at zero executed cases while still
 * showing up as "contributing" in the mechanical corpus). Combines the derived and supplemental
 * corpora, since a rule reaching zero executed cases is the real problem regardless of which
 * corpus would have covered it. Reads `combinedResults`, populated by the two "diagnostics
 * match" describe blocks above — vitest runs describe blocks' bodies (registration) up front but
 * their `it()`s/`afterAll`s execute in file declaration order for top-level siblings, so both of
 * those blocks have finished populating `combinedResults` by the time this one's `it()` runs.
 */
describe("execution coverage audit", () => {
  const derived = buildCorpus();
  const supplemental = buildSupplementalCorpus();
  const allRuleIds = Object.keys(graphqlEslintRules).sort();

  const contributedByRule = new Map<string, number>();
  for (const item of [...derived, ...supplemental]) {
    contributedByRule.set(item.ruleId, (contributedByRule.get(item.ruleId) ?? 0) + 1);
  }

  it("every rule contributing a case (derived or supplemental) has at least one EXECUTED case", () => {
    const executedByRule = new Map<string, number>();
    for (const result of combinedResults) {
      executedByRule.set(result.ruleId, (executedByRule.get(result.ruleId) ?? 0) + 1);
    }
    const zeroExecutedRuleIds = allRuleIds.filter(
      (id) => (contributedByRule.get(id) ?? 0) > 0 && (executedByRule.get(id) ?? 0) === 0,
    );
    expect(zeroExecutedRuleIds, "rules contributing cases but never executing any — needs a supplemental case").toEqual([]);
  });

  afterAll(() => {
    const executedByRule = new Map<string, number>();
    const diagnosticProducingByRule = new Map<string, number>();
    for (const result of combinedResults) {
      executedByRule.set(result.ruleId, (executedByRule.get(result.ruleId) ?? 0) + 1);
      if (result.category === "substantive") {
        diagnosticProducingByRule.set(result.ruleId, (diagnosticProducingByRule.get(result.ruleId) ?? 0) + 1);
      }
    }
    const entries: ExecutionCoverageEntry[] = allRuleIds.map((ruleId) => ({
      ruleId,
      contributedCaseCount: contributedByRule.get(ruleId) ?? 0,
      executedCaseCount: executedByRule.get(ruleId) ?? 0,
      diagnosticProducingCaseCount: diagnosticProducingByRule.get(ruleId) ?? 0,
    }));
    appendReport("=== Execution & diagnostic-producing coverage audit ===\n" + renderExecutionCoverage(entries));
  });
});

/**
 * Review round 2, item 1: the actual pin assertion. Reads `combinedResults` (populated by the
 * "diagnostics match graphql-eslint" describe block above — see the ordering note on that
 * block/on `combinedResults` itself) plus the excluded-case-id list, builds the ACTUAL
 * classification of every derived case id, and asserts it equals `EXPECTED_CASE_CLASSIFICATIONS`
 * exactly. This is the describe block that fails when a case is removed from, renamed in, or
 * silently reclassified within the corpus — the hole the round-1 exclusion-only pin left open.
 */
describe("case classification pin", () => {
  const derived = buildCorpus();
  const derivedCaseIds = new Set(derived.map((item) => item.caseId));
  const excludedCaseIds = new Set(computeExcludedCaseIds(derived));

  it("every derived case's actual classification matches the pinned expectation", () => {
    const actual: Record<string, CaseClassification> = {};
    for (const caseId of excludedCaseIds) {
      actual[caseId] = "excluded";
    }
    for (const result of combinedResults) {
      if (!derivedCaseIds.has(result.caseId)) continue; // supplemental-corpus result, not part of this pin
      actual[result.caseId] = result.category;
    }
    expect(actual).toEqual(EXPECTED_CASE_CLASSIFICATIONS);
  });

  afterAll(() => {
    const fullReport = reportSections.join("\n\n");
    writeFileSync(reportPath, fullReport, "utf8");
    // Important 3: guaranteed visible even without --reporter=verbose (console.log from a
    // passing test is silently dropped by vitest's default reporter — measured directly).
    process.stdout.write("\n" + fullReport + "\n");
  });
});
