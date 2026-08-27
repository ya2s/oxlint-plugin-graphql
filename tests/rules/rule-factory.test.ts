import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { runOxlint } from "../helpers/run-oxlint.js";

const fixtures = fileURLToPath(new URL("./fixtures/single-rule", import.meta.url));

describe("wrapped graphql-eslint rule", () => {
  it("reports inside an embedded document at the right position", () => {
    const result = runOxlint({ cwd: fixtures, args: ["app.ts"] });
    const diagnostics = result.diagnostics.filter((d) => d.code === "graphql(no-anonymous-operations)");

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]!.message).toContain("Anonymous GraphQL operations are forbidden");
    // Measured with oxlint 1.80.0: app.ts's first line is a `// @ts-nocheck` fixture pragma
    // (see the file), so the `gql` template starts on host line 2. The embedded document's text
    // starts with the newline right after the opening backtick, so "query {" is document-text
    // line 2 and the template's lineOffset is (host start line - 1) = 1. Reported line =
    // 2 + 1 = 3, not the 4 the plan's literal brief guessed.
    expect(diagnostics[0]!.labels[0]!.span.line).toBe(3);
  });
});
