import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
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
    { cwd: input.dir, encoding: "utf8" },
  );
  return JSON.parse(stdout) as EslintRunResult;
}
