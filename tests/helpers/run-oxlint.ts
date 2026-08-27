import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const OXLINT_BIN = join(fileURLToPath(new URL("../..", import.meta.url)), "node_modules/.bin/oxlint");

export type OxlintSpan = { offset: number; length: number; line: number; column: number };

export type OxlintDiagnostic = {
  message: string;
  code: string;
  severity: string;
  filename: string;
  labels: Array<{ label?: string; span: OxlintSpan }>;
};

export type OxlintResult = {
  diagnostics: OxlintDiagnostic[];
  stderr: string;
  exitCode: number;
};

export function runOxlint(options: {
  cwd: string;
  args?: string[];
  /** Overrides the child process's environment. Defaults to inheriting `process.env`
   *  unchanged (Node's own default when `env` is omitted from `execFileSync` options), so
   *  existing callers are unaffected. */
  env?: NodeJS.ProcessEnv;
}): OxlintResult {
  const args = ["-c", ".oxlintrc.json", "-f", "json", ...(options.args ?? ["."])];
  let stdout = "";
  let stderr = "";
  let exitCode = 0;
  try {
    stdout = execFileSync(OXLINT_BIN, args, {
      cwd: options.cwd,
      encoding: "utf8",
      env: options.env ?? process.env,
    });
  } catch (error) {
    const err = error as { stdout?: string; stderr?: string; status?: number };
    stdout = err.stdout ?? "";
    stderr = err.stderr ?? "";
    exitCode = err.status ?? 1;
  }
  const parsed = JSON.parse(stdout) as { diagnostics: OxlintDiagnostic[] };
  return { diagnostics: parsed.diagnostics, stderr, exitCode };
}
