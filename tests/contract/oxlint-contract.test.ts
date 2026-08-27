import { copyFileSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { runOxlint } from "../helpers/run-oxlint.js";

const fixtures = fileURLToPath(new URL("./fixtures", import.meta.url));

describe("oxlint JS plugin contract", () => {
  const result = runOxlint({ cwd: fixtures, args: ["target.js"] });
  const probes = result.diagnostics.filter((d) => d.code === "contract(probe)");

  it("treats loc.column as 0-based, like ESLint", () => {
    const diagnostic = probes.find((d) => d.message === "loc-probe");
    expect(diagnostic?.labels[0]?.span).toMatchObject({ offset: 6, length: 1, line: 1, column: 7 });
  });

  it("exposes .oxlintrc settings to the plugin", () => {
    const diagnostic = probes.find((d) => d.message.startsWith("settings-probe:"));
    expect(diagnostic?.message).toBe('settings-probe:{"schemaSdl":"type Query { a: Int }"}');
  });

  it("fires the Program visitor exactly once per file", () => {
    expect(probes.filter((d) => d.message === "loc-probe")).toHaveLength(1);
  });

  it("reports nothing but the plugin diagnostics when native rules are disabled", () => {
    expect(result.diagnostics.every((d) => d.code.startsWith("contract("))).toBe(true);
  });

  it("applies fix ranges as offsets from the start of the file", () => {
    const dir = mkdtempSync(join(tmpdir(), "oxlint-contract-"));
    copyFileSync(join(fixtures, "plugin.js"), join(dir, "plugin.js"));
    copyFileSync(join(fixtures, "target.js"), join(dir, "target.js"));
    writeFileSync(
      join(dir, ".oxlintrc.json"),
      JSON.stringify({
        plugins: [],
        categories: { correctness: "off" },
        jsPlugins: ["./plugin.js"],
        rules: { "contract/probe": "off", "contract/fixer": "error" },
      }),
    );

    runOxlint({ cwd: dir, args: ["--fix", "target.js"] });

    // fix range [6, 7] is the "x" (index 6), so the fix replaces "x" with "9".
    expect(readFileSync(join(dir, "target.js"), "utf8")).toBe("const 9 = 1;\nconst y = 2;\n");
  });
});
