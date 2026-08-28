import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { runOxlint } from "../helpers/run-oxlint.js";

const fixtures = fileURLToPath(new URL("./fixtures/parse-error", import.meta.url));
const fixturesSmoke = fileURLToPath(new URL("./fixtures/parse-error-smoke", import.meta.url));
const fixturesMixed = fileURLToPath(new URL("./fixtures/parse-error-mixed", import.meta.url));
const fixturesMultipleBroken = fileURLToPath(new URL("./fixtures/parse-error-multiple-broken", import.meta.url));

describe("graphql/parse-error", () => {
  const result = runOxlint({ cwd: fixtures, args: ["app.ts"] });

  it("reports a syntax error exactly once, regardless of how many rules are enabled", () => {
    const diagnostics = result.diagnostics.filter((d) => d.code === "graphql(parse-error)");
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]!.message).toContain("Syntax Error");
  });

  it("keeps other rules silent on a document that failed to parse", () => {
    const others = result.diagnostics.filter(
      (d) => d.code.startsWith("graphql(") && d.code !== "graphql(parse-error)",
    );
    expect(others).toEqual([]);
  });

  it("points at the failing line in the host file", () => {
    const diagnostic = result.diagnostics.find((d) => d.code === "graphql(parse-error)");
    expect(diagnostic!.labels[0]!.span.line).toBe(4);
  });
});

describe("graphql/parse-error with 57 rules enabled", () => {
  const result = runOxlint({ cwd: fixturesSmoke, args: ["app.ts"] });

  it("reports syntax error exactly once even with 57 other rules enabled", () => {
    const diagnostics = result.diagnostics.filter((d) => d.code === "graphql(parse-error)");
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]!.message).toContain("Syntax Error");
  });

  it("keeps all other rules silent on the failed document", () => {
    const others = result.diagnostics.filter(
      (d) => d.code.startsWith("graphql(") && d.code !== "graphql(parse-error)",
    );
    expect(others).toEqual([]);
  });
});

describe("graphql/parse-error with mixed broken and valid documents", () => {
  const result = runOxlint({ cwd: fixturesMixed, args: ["app.ts"] });

  it("reports syntax error from the broken document", () => {
    const parseErrors = result.diagnostics.filter((d) => d.code === "graphql(parse-error)");
    expect(parseErrors).toHaveLength(1);
    expect(parseErrors[0]!.message).toContain("Syntax Error");
  });

  it("still reports findings from valid documents", () => {
    const anonOpErrors = result.diagnostics.filter((d) => d.code === "graphql(no-anonymous-operations)");
    expect(anonOpErrors.length).toBeGreaterThan(0);
  });

  it("only reports the broken document's error once", () => {
    const parseErrors = result.diagnostics.filter((d) => d.code === "graphql(parse-error)");
    expect(parseErrors).toHaveLength(1);
  });
});

describe("graphql/parse-error with multiple broken documents", () => {
  const result = runOxlint({ cwd: fixturesMultipleBroken, args: ["app.ts"] });

  it("reports one error per broken document, not one per file", () => {
    const parseErrors = result.diagnostics.filter((d) => d.code === "graphql(parse-error)");
    expect(parseErrors).toHaveLength(2);
  });

  it("reports both broken documents at their correct host file lines", () => {
    const parseErrors = result.diagnostics.filter((d) => d.code === "graphql(parse-error)");
    const lines = parseErrors.map((d) => d.labels[0]!.span.line).sort((a, b) => a - b);
    expect(lines).toEqual([4, 8]);
  });
});
