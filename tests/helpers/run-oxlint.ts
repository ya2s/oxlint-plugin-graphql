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

export function runOxlint(options: { cwd: string; args?: string[] }): OxlintResult {
  const args = ["-c", ".oxlintrc.json", "-f", "json", ...(options.args ?? ["."])];
  let stdout = "";
  let stderr = "";
  let exitCode = 0;
  try {
    stdout = execFileSync(OXLINT_BIN, args, { cwd: options.cwd, encoding: "utf8" });
  } catch (error) {
    const err = error as { stdout?: string; stderr?: string; status?: number };
    stdout = err.stdout ?? "";
    stderr = err.stderr ?? "";
    exitCode = err.status ?? 1;
  }
  const parsed = JSON.parse(stdout) as { diagnostics: OxlintDiagnostic[] };
  return { diagnostics: parsed.diagnostics, stderr, exitCode };
}
