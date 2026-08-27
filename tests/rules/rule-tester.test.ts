import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { RuleTester } from "oxlint/plugins-dev";
import { describe, expect, it } from "vitest";
import { rules } from "../../src/rules.js";
import { toOxlintRule } from "../../src/adapter/rule-factory.js";

RuleTester.describe = describe;
RuleTester.it = it;

const projectFile = join(fileURLToPath(new URL("../fixtures/project", import.meta.url)), "app.ts");

const ruleTester = new RuleTester({ languageOptions: { parserOptions: { lang: "ts" } } });

ruleTester.run("no-anonymous-operations", rules["no-anonymous-operations"]!, {
  valid: [
    { code: "const a = 1;\n", filename: projectFile },
    { code: "const q = gql`query User { user { id } }`;\n", filename: projectFile },
  ],
  invalid: [
    {
      name: "anonymous operation inside a gql template",
      code: ["const q = gql`", "  query {", "    user { id }", "  }", "`;", ""].join("\n"),
      filename: projectFile,
      // RuleTester's `Error` type requires `message` or `messageId` (RequireAtLeastOne) — the
      // brief's literal `errors: [{ line: 2 }]` does not type-check under our strict tsconfig.
      // Asserting via `messageId` (rather than `message`) doesn't work here: oxlint's own engine
      // re-derives the diagnostic's `message` from `meta.messages[messageId]` whenever
      // `messageId` is present, and since we deliberately don't forward `messageId` to
      // `context.report()` (see rule-factory.ts — forwarding it broke the real, already-correct
      // interpolated message on the actual CLI, not just here), the diagnostic never carries one
      // for RuleTester to check either. `message` is the supported path.
      errors: [{ message: "Anonymous GraphQL operations are forbidden. Make sure to name your query!", line: 2 }],
    },
  ],
});

describe("rule error wrapping", () => {
  it("reports the rule id and the file path when a rule throws", () => {
    const exploding = toOxlintRule("exploding", {
      meta: {},
      create() {
        throw new Error("kaboom");
      },
    });

    const visitor = (exploding as { createOnce(context: unknown): { Program(): void } }).createOnce({
      sourceCode: { text: "const q = gql`{ user { id } }`;\n" },
      physicalFilename: projectFile,
      settings: {},
      options: [],
      report: () => {},
    });

    expect(() => visitor.Program()).toThrow(/rule "exploding" failed on .*app\.ts: kaboom/);
  });
});
