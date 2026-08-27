/**
 * Every EXECUTED corpus case (one that actually ran through both engines and was compared —
 * i.e. not one of the pre-execution `excluded` cases) lands in exactly one of these four
 * categories. Deliberately NOT collapsed into a single "passed" boolean: a case where both
 * engines threw and a case where both engines agree on a real diagnostic are both "the
 * assertions inside the `it()` didn't fail", but they are not the same kind of evidence, and
 * folding them into one pass rate is exactly the miscount this file exists to prevent (see the
 * task-10 report's "Critical 2" fix).
 *
 * `"mismatch"` is included here (not treated as a separate, uncounted thing) precisely so a red
 * run's accounting still sums to the corpus size — see `countFourWay`'s doc comment (review
 * round 2, item 2): omitting it made a broken run's printed total silently shrink to
 * "corpus size minus however many cases just failed", while still claiming to be a complete
 * breakdown.
 */
export type CaseCategory =
  | "substantive" // both engines agree, and at least one diagnostic was actually compared
  | "vacuous" // both engines agree, but neither reported anything — equal, not informative
  | "not-compared" // both engines threw; nothing was actually compared (known-difference only — an undocumented one fails its `it()` before ever reaching this table)
  | "mismatch"; // a genuine disagreement; only appears here if the corpus test suite has real failures

/** `CaseCategory` plus `"excluded"` — the full classification of a corpus case id, including
 *  the ones that never get an `it()` at all. Used only for the round-2 "pin every case"
 *  assertion in conformance.test.ts; everywhere else, "excluded" cases are tracked separately
 *  (as a plain count) from the four `CaseCategory` values, since they were never run. */
export type CaseClassification = CaseCategory | "excluded";

export type CaseResult = {
  ruleId: string;
  caseId: string;
  category: CaseCategory;
  /** Present only for `category: "not-compared"` — points at the `KnownDifference` reason. */
  detail?: string;
};

/**
 * The five counts a corpus's cases split into — named `FourWayCounts` for continuity with the
 * round-1 fix report (which is full of references to "the four-way accounting"), even though
 * `mismatch` makes it five now. Renaming was judged not worth the churn; what matters is that
 * `substantive + vacuous + notCompared + mismatch + excluded` always equals the corpus size,
 * on both a green run (mismatch = 0) and a red one.
 */
export type FourWayCounts = {
  substantive: number;
  vacuous: number;
  notCompared: number;
  mismatch: number;
  excluded: number;
};

export function countFourWay(results: CaseResult[], excludedCount: number): FourWayCounts {
  return {
    substantive: results.filter((r) => r.category === "substantive").length,
    vacuous: results.filter((r) => r.category === "vacuous").length,
    notCompared: results.filter((r) => r.category === "not-compared").length,
    mismatch: results.filter((r) => r.category === "mismatch").length,
    excluded: excludedCount,
  };
}

/** Headline accounting: substantive vs. vacuous vs. not-compared vs. mismatch vs. excluded, with
 *  the total corpus size these five numbers must always sum to — on a green run AND a red one
 *  (review round 2, item 2: a prior version omitted `mismatch`, so a red run's printed total
 *  silently shrank to "corpus size minus however many cases just failed" while still looking
 *  like a complete breakdown). */
export function renderFourWaySummary(counts: FourWayCounts): string {
  const total = counts.substantive + counts.vacuous + counts.notCompared + counts.mismatch + counts.excluded;
  const pct = (n: number) => (total === 0 ? "0%" : `${Math.round((n / total) * 100)}%`);
  return [
    `Total corpus cases: ${total}`,
    `  Substantive (>=1 diagnostic actually compared, equal): ${counts.substantive} (${pct(counts.substantive)})`,
    `  Vacuous (equal, zero diagnostics on both sides):        ${counts.vacuous} (${pct(counts.vacuous)})`,
    `  Not-compared (both engines threw, documented reason):   ${counts.notCompared} (${pct(counts.notCompared)})`,
    `  Mismatch (genuine disagreement — should be zero):       ${counts.mismatch} (${pct(counts.mismatch)})`,
    `  Excluded (corpus artefact, never executed):             ${counts.excluded} (${pct(counts.excluded)})`,
  ].join("\n");
}

/** Per-rule breakdown of the same categories — a rule with a 100% "pass rate" that is 100%
 *  vacuous is not the same claim as one that is 100% substantive; this table makes the
 *  difference visible per rule instead of only in the aggregate. */
export function renderPerRuleAccounting(results: CaseResult[]): string {
  const byRule = new Map<string, FourWayCounts>();
  for (const result of results) {
    const entry = byRule.get(result.ruleId) ?? { substantive: 0, vacuous: 0, notCompared: 0, mismatch: 0, excluded: 0 };
    if (result.category === "substantive") entry.substantive += 1;
    else if (result.category === "vacuous") entry.vacuous += 1;
    else if (result.category === "not-compared") entry.notCompared += 1;
    else if (result.category === "mismatch") entry.mismatch += 1;
    byRule.set(result.ruleId, entry);
  }

  const lines = ["| Rule | Substantive | Vacuous | Not-compared | Mismatch |", "| --- | --- | --- | --- | --- |"];
  for (const [ruleId, counts] of [...byRule.entries()].sort()) {
    lines.push(`| \`graphql/${ruleId}\` | ${counts.substantive} | ${counts.vacuous} | ${counts.notCompared} | ${counts.mismatch} |`);
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

/**
 * Outcome of ONE fix comparison attempt (review round 2, items 3 & 4):
 *
 *  - `"fixed-match"`: the case's diagnostics were substantive (>=1 real diagnostic), a real fix
 *    was applied on both sides, and the two engines' fixed output is byte-identical AND actually
 *    different from the original input — i.e. fixing really happened, and happened the same way
 *    on both engines. This is the only outcome that proves the fix-range/`mergeFixes` machinery
 *    is working.
 *  - `"noop-match"`: the case's diagnostics were vacuous (zero diagnostics, nothing to fix), and
 *    both engines correctly left the file untouched. A legitimate, verified "nothing to do
 *    here" — but NOT evidence the fix machinery works, since nothing exercised it.
 *  - `"mismatch"`: both sides produced *some* fixed output, but it differs between engines.
 *  - `"skipped"`: the case's rule is fixable, but the DIAGNOSTICS comparison itself failed first
 *    (mismatch / kind-mismatch / undocumented both-errored) and `runCase` returned before ever
 *    attempting a fix. Recorded explicitly rather than left out of the array entirely — item 3
 *    from review: leaving skipped cases out of the array made the denominator quietly shrink to
 *    "however many fix comparisons happened to run", so a run where every diagnostics comparison
 *    failed could still print "N/N fix comparisons matched" with N well below the number of
 *    fixable cases that actually exist.
 */
export type FixOutcome = "fixed-match" | "noop-match" | "mismatch" | "skipped";

export type FixCaseResult = {
  ruleId: string;
  caseId: string;
  outcome: FixOutcome;
  /** Present for `"mismatch"` and `"skipped"`. */
  detail?: string;
};

export function renderFixResults(results: FixCaseResult[]): string {
  const fixedMatch = results.filter((r) => r.outcome === "fixed-match").length;
  const noopMatch = results.filter((r) => r.outcome === "noop-match").length;
  const mismatch = results.filter((r) => r.outcome === "mismatch").length;
  const skipped = results.filter((r) => r.outcome === "skipped").length;

  const lines = [
    `Fix comparisons attempted (rules with meta.fixable, all executed cases): ${results.length}`,
    `  Real fix applied, byte-identical on both engines AND actually changed the input: ${fixedMatch}`,
    `  No-op, correctly verified (vacuous — zero diagnostics, no fix applied by either engine): ${noopMatch}`,
    `  Mismatch (fixed output differs between engines): ${mismatch}`,
    `  Skipped (diagnostics comparison failed first — fix was never attempted): ${skipped}`,
  ];
  for (const r of results) {
    if (r.outcome === "mismatch" || r.outcome === "skipped") {
      lines.push(`  - ${r.ruleId} :: ${r.caseId}: ${r.outcome.toUpperCase()} — ${r.detail ?? ""}`);
    }
  }
  return lines.join("\n");
}
