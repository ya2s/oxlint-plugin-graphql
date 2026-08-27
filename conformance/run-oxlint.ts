import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runOxlint } from "../tests/helpers/run-oxlint.js";
import type { OxlintDiagnostic } from "../tests/helpers/run-oxlint.js";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));

export type OxlintRunResult =
  | { kind: "diagnostics"; diagnostics: OxlintDiagnostic[] }
  | { kind: "error"; message: string };

/**
 * Runs real oxlint + this plugin against `dir/app.ts` (written by fixture.ts), as its own
 * subprocess with `dir` as its `cwd` (via `runOxlint`) — see documents-required-rules.ts for why
 * that `cwd` matters for two rules' message text.
 */
export function lintWithOxlint(input: { dir: string; ruleId: string; options: unknown[] }): OxlintRunResult {
  writeFileSync(
    join(input.dir, ".oxlintrc.json"),
    JSON.stringify({
      plugins: [],
      categories: { correctness: "off" },
      jsPlugins: [join(projectRoot, "dist/index.js")],
      rules: { [`graphql/${input.ruleId}`]: ["error", ...input.options] },
    }),
  );

  const result = runOxlint({ cwd: input.dir, args: ["app.ts"] });

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
