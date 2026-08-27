import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { CONFORMANCE_ENV } from "./env.js";
import type { EslintMessage } from "./normalize.js";

const runnerPath = fileURLToPath(new URL("./eslint-runner.ts", import.meta.url));

export type EslintRunResult = { kind: "messages"; messages: EslintMessage[] } | { kind: "error"; message: string };

/**
 * Runs real ESLint + @graphql-eslint/eslint-plugin against `dir/app.ts` (written by
 * fixture.ts), as a fresh subprocess with `dir` as its `cwd` — see eslint-runner.ts's doc
 * comment for why a subprocess (not an in-process `Linter.verify` call, as the brief originally
 * suggested) is required for correctness, not just symmetry with `lintWithOxlint`.
 */
export function lintWithEslint(input: { dir: string; ruleId: string; options: unknown[] }): EslintRunResult {
  const stdout = execFileSync(
    process.execPath,
    ["--experimental-strip-types", "--no-warnings", runnerPath, input.ruleId, JSON.stringify(input.options)],
    { cwd: input.dir, encoding: "utf8", env: CONFORMANCE_ENV },
  );
  return JSON.parse(stdout) as EslintRunResult;
}

/**
 * Runs ESLint's own multi-pass autofix (`Linter#verifyAndFix`, the same mechanism the real
 * `eslint --fix` CLI flag uses internally — see eslint-runner.ts) against `dir/app.ts` and
 * returns the fully-converged fixed source text.
 */
export function fixWithEslint(input: { dir: string; ruleId: string; options: unknown[] }): string {
  const stdout = execFileSync(
    process.execPath,
    ["--experimental-strip-types", "--no-warnings", runnerPath, input.ruleId, JSON.stringify(input.options), "fix"],
    { cwd: input.dir, encoding: "utf8", env: CONFORMANCE_ENV },
  );
  const result = JSON.parse(stdout) as { kind: "fixed"; output: string } | { kind: "error"; message: string };
  if (result.kind === "error") {
    throw new Error(`fixWithEslint failed for rule "${input.ruleId}": ${result.message}`);
  }
  return result.output;
}
