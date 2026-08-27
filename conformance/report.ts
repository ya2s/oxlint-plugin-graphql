/**
 * Every EXECUTED corpus case (one that actually ran through both engines and was compared —
 * i.e. not one of the pre-execution `excluded` cases) lands in exactly one of these four
 * categories. Deliberately NOT collapsed into a single "passed" boolean: a case where both
 * engines threw and a case where both engines agree on a real diagnostic are both "the
 * assertions inside the `it()` didn't fail", but they are not the same kind of evidence, and
 * folding them into one pass rate is exactly the miscount this file exists to prevent (see the
 * task-10 report's "Critical 2" fix).
 */
export type CaseCategory =
  | "substantive" // both engines agree, and at least one diagnostic was actually compared
  | "vacuous" // both engines agree, but neither reported anything — equal, not informative
  | "not-compared" // both engines threw; nothing was actually compared (known-difference only — an undocumented one fails its `it()` before ever reaching this table)
  | "mismatch"; // a genuine disagreement; only appears here if the corpus test suite has real failures

export type CaseResult = {
  ruleId: string;
  caseId: string;
  category: CaseCategory;
  /** Present only for `category: "not-compared"` — points at the `KnownDifference` reason. */
  detail?: string;
};

export type FourWayCounts = {
  substantive: number;
  vacuous: number;
  notCompared: number;
  excluded: number;
};

export function countFourWay(results: CaseResult[], excludedCount: number): FourWayCounts {
  return {
    substantive: results.filter((r) => r.category === "substantive").length,
    vacuous: results.filter((r) => r.category === "vacuous").length,
    notCompared: results.filter((r) => r.category === "not-compared").length,
    excluded: excludedCount,
  };
}

/** Headline four-way accounting: substantive vs. vacuous vs. not-compared vs. excluded, with the
 *  total corpus size these four numbers must sum to. */
export function renderFourWaySummary(counts: FourWayCounts): string {
  const total = counts.substantive + counts.vacuous + counts.notCompared + counts.excluded;
  const pct = (n: number) => (total === 0 ? "0%" : `${Math.round((n / total) * 100)}%`);
  return [
    `Total corpus cases: ${total}`,
    `  Substantive (>=1 diagnostic actually compared, equal): ${counts.substantive} (${pct(counts.substantive)})`,
    `  Vacuous (equal, zero diagnostics on both sides):        ${counts.vacuous} (${pct(counts.vacuous)})`,
    `  Not-compared (both engines threw, documented reason):   ${counts.notCompared} (${pct(counts.notCompared)})`,
    `  Excluded (corpus artefact, never executed):             ${counts.excluded} (${pct(counts.excluded)})`,
  ].join("\n");
}

/** Per-rule breakdown of the same four categories — a rule with a 100% "pass rate" that is 100%
 *  vacuous is not the same claim as one that is 100% substantive; this table makes the
 *  difference visible per rule instead of only in the aggregate. */
export function renderPerRuleAccounting(results: CaseResult[]): string {
  const byRule = new Map<string, FourWayCounts>();
  for (const result of results) {
    const entry = byRule.get(result.ruleId) ?? { substantive: 0, vacuous: 0, notCompared: 0, excluded: 0 };
    if (result.category === "substantive") entry.substantive += 1;
    else if (result.category === "vacuous") entry.vacuous += 1;
    else if (result.category === "not-compared") entry.notCompared += 1;
    byRule.set(result.ruleId, entry);
  }

  const lines = ["| Rule | Substantive | Vacuous | Not-compared |", "| --- | --- | --- | --- |"];
  for (const [ruleId, counts] of [...byRule.entries()].sort()) {
    lines.push(`| \`graphql/${ruleId}\` | ${counts.substantive} | ${counts.vacuous} | ${counts.notCompared} |`);
  }
  return lines.join("\n");
}

export function renderMismatches(results: CaseResult[]): string {
  const mismatches = results.filter((r) => r.category === "mismatch");
  if (mismatches.length === 0) return "Mismatches: none";
  const lines = [`Mismatches: ${mismatches.length}`];
  for (const m of mismatches) lines.push(`  - ${m.ruleId} :: ${m.caseId}`);
  return lines.join("\n");
}

/** One row of the "does every rule that documents examples contribute to the corpus" audit —
 *  see task brief Addition A. */
export type CoverageEntry = { ruleId: string; caseCount: number; zeroReason?: string };

export function renderCoverage(entries: CoverageEntry[]): string {
  const sorted = [...entries].sort((a, b) => a.ruleId.localeCompare(b.ruleId));
  const zero = sorted.filter((e) => e.caseCount === 0);
  const totalCases = sorted.reduce((sum, e) => sum + e.caseCount, 0);

  const lines = [
    `Rules audited: ${sorted.length}`,
    `Rules contributing at least one case: ${sorted.length - zero.length}`,
    `Total corpus cases: ${totalCases}`,
    `Rules contributing zero cases: ${zero.length}`,
    "",
    "| Rule | Cases | Reason for zero |",
    "| --- | --- | --- |",
  ];
  for (const entry of sorted) {
    lines.push(`| \`graphql/${entry.ruleId}\` | ${entry.caseCount} | ${entry.caseCount === 0 ? (entry.zeroReason ?? "") : ""} |`);
  }
  return lines.join("\n");
}

/** One row of the "does every rule that contributes to the corpus actually get EXECUTED, and
 *  does execution actually produce a diagnostic anywhere" audit — see task-10 report's
 *  "Important 6". A rule can contribute cases to `buildCorpus()` yet still have zero of them
 *  actually executed (every one excluded before its `it()` is ever created), which is a
 *  different, easy-to-miss blind spot from "contributes zero corpus cases" in the first place. */
export type ExecutionCoverageEntry = {
  ruleId: string;
  contributedCaseCount: number;
  executedCaseCount: number;
  diagnosticProducingCaseCount: number;
};

export function renderExecutionCoverage(entries: ExecutionCoverageEntry[]): string {
  const sorted = [...entries].sort((a, b) => a.ruleId.localeCompare(b.ruleId));
  const zeroExecuted = sorted.filter((e) => e.contributedCaseCount > 0 && e.executedCaseCount === 0);
  const zeroDiagnosticProducing = sorted.filter((e) => e.executedCaseCount > 0 && e.diagnosticProducingCaseCount === 0);

  const lines = [
    `Rules with >=1 contributed case but ZERO executed: ${zeroExecuted.length}${zeroExecuted.length > 0 ? " (" + zeroExecuted.map((e) => e.ruleId).join(", ") + ")" : ""}`,
    `Rules with >=1 executed case but ZERO diagnostic-producing (i.e. every executed case is vacuous): ${zeroDiagnosticProducing.length}${zeroDiagnosticProducing.length > 0 ? " (" + zeroDiagnosticProducing.map((e) => e.ruleId).join(", ") + ")" : ""}`,
    "",
    "| Rule | Contributed | Executed | Diagnostic-producing |",
    "| --- | --- | --- | --- |",
  ];
  for (const entry of sorted) {
    lines.push(
      `| \`graphql/${entry.ruleId}\` | ${entry.contributedCaseCount} | ${entry.executedCaseCount} | ${entry.diagnosticProducingCaseCount} |`,
    );
  }
  return lines.join("\n");
}

export type FixCaseResult = { ruleId: string; caseId: string; passed: boolean; detail?: string };

export function renderFixResults(results: FixCaseResult[]): string {
  const passed = results.filter((r) => r.passed).length;
  const lines = [`Fix comparisons: ${passed}/${results.length} produced byte-identical output on both engines.`];
  for (const r of results) {
    lines.push(`  - ${r.ruleId} :: ${r.caseId}: ${r.passed ? "match" : `MISMATCH — ${r.detail ?? ""}`}`);
  }
  return lines.join("\n");
}
