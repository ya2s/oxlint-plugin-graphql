export type CaseResult = { ruleId: string; caseId: string; passed: boolean; detail?: string };

export function renderTable(results: CaseResult[]): string {
  const byRule = new Map<string, { passed: number; total: number }>();
  for (const result of results) {
    const entry = byRule.get(result.ruleId) ?? { passed: 0, total: 0 };
    entry.total += 1;
    if (result.passed) entry.passed += 1;
    byRule.set(result.ruleId, entry);
  }

  const lines = ["| Rule | Cases | Pass rate |", "| --- | --- | --- |"];
  for (const [ruleId, entry] of [...byRule.entries()].sort()) {
    const rate = entry.total === 0 ? 0 : Math.round((entry.passed / entry.total) * 100);
    lines.push(`| \`graphql/${ruleId}\` | ${entry.total} | ${rate}% |`);
  }

  const totalPassed = results.filter((r) => r.passed).length;
  const overallRate = results.length === 0 ? 0 : Math.round((totalPassed / results.length) * 100);
  lines.push("", `Overall: ${totalPassed}/${results.length} (${overallRate}%)`);

  return lines.join("\n");
}

/** One row of the coverage audit: how many corpus cases a rule contributed, and — critically —
 *  why zero, when it contributed zero. See task brief Addition A. */
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
