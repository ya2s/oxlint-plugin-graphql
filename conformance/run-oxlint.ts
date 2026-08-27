import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runOxlint } from "../tests/helpers/run-oxlint.js";
import type { OxlintDiagnostic } from "../tests/helpers/run-oxlint.js";
import { CONFORMANCE_ENV } from "./env.js";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));

export type OxlintRunResult =
  | { kind: "diagnostics"; diagnostics: OxlintDiagnostic[] }
  | { kind: "error"; message: string };

function writeOxlintrc(dir: string, ruleId: string, options: unknown[]): void {
  writeFileSync(
    join(dir, ".oxlintrc.json"),
    JSON.stringify({
      plugins: [],
      categories: { correctness: "off" },
      jsPlugins: [join(projectRoot, "dist/index.js")],
      rules: { [`graphql/${ruleId}`]: ["error", ...options] },
    }),
  );
}

/**
 * Runs real oxlint + this plugin against `dir/app.ts` (written by fixture.ts), as its own
 * subprocess with `dir` as its `cwd` (via `runOxlint`) — see documents-required-rules.ts for why
 * that `cwd` matters for two rules' message text.
 */
export function lintWithOxlint(input: { dir: string; ruleId: string; options: unknown[] }): OxlintRunResult {
  writeOxlintrc(input.dir, input.ruleId, input.options);

  const result = runOxlint({ cwd: input.dir, args: ["app.ts"], env: CONFORMANCE_ENV });

  // When the rule's `create()`/visitor throws, oxlint surfaces it as a diagnostic with NO
  // `code` field at all (not merely a code that fails to start with "graphql(" — the field is
  // simply absent from the JSON), message text starting with "Error running JS plugin." —
  // measured directly against the real oxlint CLI. Treat that as a distinct outcome rather than
  // silently filtering it out of the diagnostics list (which would make a crash look identical
  // to "zero diagnostics reported").
  const crash = result.diagnostics.find((d) => !(d.code ?? "").startsWith("graphql("));
  if (crash) return { kind: "error", message: crash.message };

  return {
    kind: "diagnostics",
    diagnostics: result.diagnostics.filter((d) => d.code.startsWith("graphql(")),
  };
}

/** ESLint's own `--fix` (and `Linter#verifyAndFix`) re-lints and reapplies non-conflicting
 *  fixes internally, up to 10 passes, within a single invocation — see eslint-runner.ts. Real
 *  `oxlint --fix`, measured directly, applies exactly ONE round of non-conflicting fixes per
 *  invocation and stops (confirmed: three back-to-back `oxlint --fix` runs on the same file were
 *  needed to fully sort a 3-field-out-of-order `alphabetize` case that `eslint --fix` sorts
 *  fully in one run). That's not an adapter bug — the fix *ranges* graphql-eslint's `alphabetize`
 *  reports for adjacent out-of-order fields genuinely overlap (verified directly: two ranges
 *  [56,135] and [87,189] for this exact case), so any correct fixer can only apply one of them
 *  per pass; the difference is purely in how many passes each *host tool*'s own `--fix` runs
 *  internally before returning, which a JS plugin has no control over. Re-invoking `--fix`
 *  ourselves until the file stops changing (mirroring what `verifyAndFix`'s internal loop
 *  already does for the ESLint side) measures the thing that's actually under test — the
 *  per-diagnostic fix-range/text computation Task 6 built — instead of an artifact of how many
 *  times each CLI's outer loop happens to iterate. */
const MAX_FIX_PASSES = 10;

export function fixWithOxlint(input: { dir: string; ruleId: string; options: unknown[] }): string {
  writeOxlintrc(input.dir, input.ruleId, input.options);
  const appPath = join(input.dir, "app.ts");

  let previous = readFileSync(appPath, "utf8");
  for (let pass = 0; pass < MAX_FIX_PASSES; pass += 1) {
    runOxlint({ cwd: input.dir, args: ["--fix", "app.ts"], env: CONFORMANCE_ENV });
    const current = readFileSync(appPath, "utf8");
    if (current === previous) break;
    previous = current;
  }
  return previous;
}
