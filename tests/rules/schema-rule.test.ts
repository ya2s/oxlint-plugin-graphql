import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { runOxlint } from "../helpers/run-oxlint.js";

const fixtures = fileURLToPath(new URL("./fixtures/schema-rule", import.meta.url));

// "no-deprecated" requires a schema (`requireGraphQLSchema` throws if
// `context.sourceCode.parserServices.schema` is null) and reports using GraphQL type-info
// (`node.typeInfo().fieldDef.deprecationReason`) computed during parsing, independent of our
// own traversal — a different wiring path than the selector/node.parent cases above.
describe("rule that requires a schema", () => {
  it("reports the deprecated field exactly once, at its position", () => {
    const result = runOxlint({ cwd: fixtures, args: ["app.ts"] });
    const diagnostics = result.diagnostics.filter((d) => d.code === "graphql(no-deprecated)");

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]!.message).toBe(
      'Field "name" is marked as deprecated in your GraphQL schema (reason: use fullName instead)',
    );
    expect(diagnostics[0]!.labels[0]!.span.line).toBe(6);
  });
});
