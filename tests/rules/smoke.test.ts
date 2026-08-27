import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { runOxlint } from "../helpers/run-oxlint.js";

const fixtures = fileURLToPath(new URL("./fixtures/smoke", import.meta.url));

// tests/rules/exposed-rules.test.ts only checks that every wrapped rule has a `createOnce`
// function, which proves the factory ran, not that the rule actually works end to end. This
// enables a large, realistic set of rules at once (via .oxlintrc.json) and asserts the whole
// run completes — no rule throws and aborts the file, which is oxlint's behavior on an
// uncaught JS-plugin error (a single "Error running JS plugin" diagnostic instead of the
// individual rules' own diagnostics) — and that several specific rules genuinely fire, each
// through a different mechanism (schema-based typeInfo lookup, node.parent, a Relay-convention
// check spanning multiple selectors).
//
// 57 of the 64 rules are enabled. The other 7 all call graphql-eslint's own
// `requireGraphQLOperations` with no try/catch, which throws unless graphql-config's
// `documents` field is set and loaded (see tests/fixtures's shared graphql configs, none of
// which set `documents`: a glob matching no file with a real operation makes the parser throw,
// per an existing project constraint). That isn't a gap in this plugin's wiring — it's
// graphql-eslint's own documented requirement — so exercising it belongs to a fixture with a
// real `documents` glob, not this smoke test. Two different reasons land a rule in this list —
// each verified directly against this fixture, not assumed:
//   - Four rules call `requireGraphQLOperations` synchronously inside `create()`, before
//     returning any visitor at all, so they throw for *every* document regardless of its
//     content: no-unused-fields, no-one-place-fragments, require-import-fragment,
//     require-selections.
//   - no-unused-fragments calls it inside a `Document(node)` listener, which — because every
//     parsed document has exactly one `Document` root node — also fires, and therefore throws,
//     unconditionally for every document.
//   - The remaining two only call it inside a listener that requires a specific node to be
//     present, so they throw only when the document actually contains one:
//     unique-operation-name throws here because this fixture's operation is named
//     (`OperationDefinition[name!=undefined]`) — confirmed by running it in isolation.
//     unique-fragment-name would only throw given a `fragment` definition
//     (`FragmentDefinition`); this fixture has none, so including it here would pass
//     *vacuously* (its listener would simply never fire) rather than proving anything — this
//     was an actual bug fixed in this file (see the report), not a hypothetical.
// `selection-set-depth` also calls `requireGraphQLOperations`, but wraps it in try/catch and
// degrades to a warning instead of throwing, so it legitimately stays in the enabled set.
//
// 4 more rules (alphabetize, no-root-type, require-description, selection-set-depth) require
// rule options with no default; each is given a minimal valid options value here instead of
// being excluded, so the smoke test also proves options-schema forwarding (see
// rule-factory.ts's `schema: rule.meta.schema`) for that shape of rule.
describe("a large, realistic set of rules run together", () => {
  const result = runOxlint({ cwd: fixtures, args: ["app.ts"] });

  it("does not abort the file (no rule threw)", () => {
    expect(result.diagnostics.every((d) => !d.message.startsWith("Error running JS plugin"))).toBe(true);
  });

  it("fires no-deprecated on both uses of the deprecated field", () => {
    const diagnostics = result.diagnostics.filter((d) => d.code === "graphql(no-deprecated)");
    expect(diagnostics).toHaveLength(2);
    expect(diagnostics[0]!.message).toContain('marked as deprecated');
  });

  it("fires no-duplicate-fields on the repeated selection", () => {
    const diagnostics = result.diagnostics.filter((d) => d.code === "graphql(no-duplicate-fields)");
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]!.message).toBe("Field `name` defined multiple times.");
  });

  it("fires relay-page-info (no Connection type provides a PageInfo field)", () => {
    const diagnostics = result.diagnostics.filter((d) => d.code === "graphql(relay-page-info)");
    expect(diagnostics).toHaveLength(1);
  });

  it("reports nothing else", () => {
    expect(result.diagnostics).toHaveLength(4);
  });
});
