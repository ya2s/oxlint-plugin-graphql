import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { runOxlint } from "../helpers/run-oxlint.js";

const fixtures = fileURLToPath(new URL("./fixtures/parent-rule", import.meta.url));

// Exercises two things the plan's brief (which only prescribed a no-anonymous-operations
// fixture) does not cover:
//
// - "no-root-type"'s visitor key is an esquery selector
//   (":matches(ObjectTypeDefinition, ObjectTypeExtension) > .name[value=/^(...)$/]"), and its
//   suggestion fix reads `node.parent`.
// - "no-duplicate-fields" reads `node.parent` eagerly (not lazily inside a fix closure) via
//   `SelectionSet(node)` inspecting `node.selections[i].name.parent` — a child it has not
//   itself visited yet. This actually caught a real bug: traverse.ts only wired `.parent`
//   progressively as it walked, so an ancestor's listener reaching into its own unvisited
//   subtree saw `.parent === undefined` and crashed with
//   "TypeError: Cannot read properties of undefined (reading 'type')". Fixed by adding a
//   `linkParents` pre-pass in src/adapter/traverse.ts that parents the whole tree before any
//   listener runs, matching real graphql-eslint's architecture (the whole AST is parented once
//   during conversion, not during the rule-visiting traversal).
//
// Enabling both rules together in one run also doubles as the "no duplicate reports" check:
// parseDocuments' cache is shared across rules on the same file, so a caching bug would show up
// here as either rule firing more than once.
describe("rules that read node.parent, run together", () => {
  const result = runOxlint({ cwd: fixtures, args: ["app.ts"] });

  it("fires no-root-type exactly once, at the type name's position", () => {
    const diagnostics = result.diagnostics.filter((d) => d.code === "graphql(no-root-type)");
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]!.message).toBe("Root type `Mutation` is forbidden.");
    expect(diagnostics[0]!.labels[0]!.span.line).toBe(3);
  });

  it("fires no-duplicate-fields exactly once, at the duplicate field's position", () => {
    const diagnostics = result.diagnostics.filter((d) => d.code === "graphql(no-duplicate-fields)");
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]!.message).toBe("Field `id` defined multiple times.");
    expect(diagnostics[0]!.labels[0]!.span.line).toBe(12);
  });

  it("reports nothing else", () => {
    expect(result.diagnostics).toHaveLength(2);
  });
});
