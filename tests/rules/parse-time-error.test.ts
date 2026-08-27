import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { runOxlint } from "../helpers/run-oxlint.js";

const fixtures = fileURLToPath(new URL("./fixtures/unloadable-schema", import.meta.url));

// Important 4 from the final review: a rule-execution error (a rule's create()/visitor
// throwing) is already wrapped with attribution by rule-factory.ts's wrapRuleError, verified by
// tests/rules/rule-tester.test.ts's "rule error wrapping" describe block. This covers the other
// path: an exception escaping parseDocuments() itself (e.g. graphql-config's `schema` pointing
// at a file that doesn't exist), which previously reached the user as a raw, unattributed
// graphql-eslint/graphql-config error with a long node_modules stack and no indication which
// plugin or rule caused it. Fixed by wrapping that call the same way in both rule-factory.ts's
// Program() and parse-error.ts's Program().
describe("a parse-time failure (unloadable schema) is attributed to this plugin", () => {
  it("prints the plugin attribution and file path through the real oxlint CLI", () => {
    const result = runOxlint({ cwd: fixtures, args: ["app.ts"] });

    // oxlint surfaces an uncaught JS-plugin error as a diagnostic with no `code` field at all
    // (see conformance/run-oxlint.ts's doc comment for the same observation) and a message that
    // starts with "Error running JS plugin." -- this asserts what's inside that message, not
    // just that it exists.
    const crash = result.diagnostics.find((d) => !(d.code ?? "").startsWith("graphql("));
    expect(crash, JSON.stringify(result.diagnostics)).toBeDefined();
    expect(crash!.message).toContain('[oxlint-plugin-graphql] rule "no-anonymous-operations" failed on');
    expect(crash!.message).toContain("app.ts");
    expect(crash!.message).toContain("Unable to find any GraphQL type definitions");
  });
});
