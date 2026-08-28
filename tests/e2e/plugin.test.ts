import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { rules as graphqlEslintRules } from "@graphql-eslint/eslint-plugin";
import { describe, expect, it } from "vitest";
import { runOxlint } from "../helpers/run-oxlint.js";

const OXLINT_BIN = fileURLToPath(new URL("../../node_modules/.bin/oxlint", import.meta.url));
const DIST_INDEX = fileURLToPath(new URL("../../dist/index.js", import.meta.url));

function fixture(name: string): string {
  return fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
}

/**
 * Copies a fixture into a fresh tmp dir for a test that mutates it (--fix/--fix-suggestions).
 * The fixture's own `.oxlintrc.json` points `jsPlugins` at `../../../../dist/index.js` — correct
 * relative to the fixture's real location four directories under the project root, but wrong
 * once copied to an unrelated tmp dir (oxlint fails with "Failed to parse oxlint configuration
 * file" / ENOENT, confirmed by running this without the rewrite below). Rewriting the copy's
 * config to the absolute path keeps the source fixture's relative form — consistent with every
 * other fixture in this repo — while making the copy resolvable from anywhere.
 */
function copyFixture(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), `gql-e2e-${name}-`));
  cpSync(fixture(name), dir, { recursive: true });
  const configPath = join(dir, ".oxlintrc.json");
  const config = JSON.parse(readFileSync(configPath, "utf8")) as { jsPlugins: string[] };
  config.jsPlugins = [DIST_INDEX];
  writeFileSync(configPath, JSON.stringify(config, null, 2));
  return dir;
}

/** graphql-eslint's own `meta.hasSuggestions` flag, not a hand-maintained list — this is what
 *  makes the two rules below (no-anonymous-operations, no-typename-prefix) a mechanically
 *  derived choice rather than a guess. */
const hasSuggestionsRuleIds = Object.entries(graphqlEslintRules)
  .filter(([, rule]) => rule.meta?.hasSuggestions === true)
  .map(([id]) => id)
  .sort();

describe("oxlint-plugin-graphql-eslint end to end", () => {
  it("derives the hasSuggestions rule set mechanically from graphql-eslint's own meta flag", () => {
    // 24 rules in @graphql-eslint/eslint-plugin@4.4.1 declare `meta.hasSuggestions: true`. This
    // assertion pins that count so a version bump that adds/removes one is visible here, and
    // proves the two rules this suite exercises end to end (below) are drawn from that set
    // rather than picked by hand.
    expect(hasSuggestionsRuleIds).toHaveLength(24);
    expect(hasSuggestionsRuleIds).toContain("no-anonymous-operations");
    expect(hasSuggestionsRuleIds).toContain("no-typename-prefix");
  });

  it("reports diagnostics from several rules on one file", () => {
    const result = runOxlint({ cwd: fixture("multi-rule"), args: ["app.ts"] });
    const codes = result.diagnostics.map((d) => d.code).sort();

    expect(codes).toContain("graphql(no-anonymous-operations)");
    expect(codes).toContain("graphql(no-duplicate-fields)");
    expect(codes).toContain("graphql(require-selections)");
  });

  it("prints readable, correctly located messages through the agent CLI formatter", () => {
    // Addition D: a human-readable rendering, not the -f json shape every other test in this
    // repo asserts against. Run without runOxlint's helper (which hardcodes -f json).
    //
    // `-f agent` is pinned deliberately. With no -f, oxlint picks a formatter from the
    // environment: the same compact form locally, but GitHub Actions annotations
    // (`::error file=...`) once it detects CI — which made this assertion pass locally and
    // fail in CI. Naming the formatter keeps the test measuring message text and positions
    // rather than oxlint's environment detection.
    let stdout: string;
    try {
      stdout = execFileSync(OXLINT_BIN, ["-c", ".oxlintrc.json", "-f", "agent", "app.ts"], {
        cwd: fixture("multi-rule"),
        encoding: "utf8",
      });
    } catch (error) {
      stdout = (error as { stdout?: string }).stdout ?? "";
    }

    expect(stdout).toContain(
      "app.ts:3:3: error graphql(no-anonymous-operations): Anonymous GraphQL operations are forbidden. Make sure to name your query!",
    );
    expect(stdout).toContain("app.ts:6:7: error graphql(no-duplicate-fields): Field `name` defined multiple times.");
    expect(stdout).toContain(
      "app.ts:4:10: error graphql(require-selections): Field `user.id` must be selected when it's available on a type.",
    );
  });

  it("uses settings.graphql.schemaSdl when no graphql-config is present", () => {
    const result = runOxlint({ cwd: fixture("settings-schema"), args: ["app.ts"] });
    const diagnostics = result.diagnostics.filter((d) => d.code === "graphql(no-deprecated)");

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]!.message).toBe(
      'Field "name" is marked as deprecated in your GraphQL schema (reason: use fullName instead)',
    );
  });

  it("does NOT apply a suggestion-only fix under plain --fix", () => {
    // no-anonymous-operations has no meta.fixable `fix`, only `suggest` — plain --fix must
    // leave the file untouched. This is the baseline that --fix-suggestions is contrasted
    // against below.
    const dir = copyFixture("suggestions");
    const before = readFileSync(join(dir, "app.ts"), "utf8");

    runOxlint({ cwd: dir, args: ["--fix", "app.ts"] });

    expect(readFileSync(join(dir, "app.ts"), "utf8")).toBe(before);
  });

  it("applies the no-anonymous-operations suggestion via --fix-suggestions, leaving the rest of the file untouched", () => {
    const dir = copyFixture("suggestions");

    runOxlint({ cwd: dir, args: ["--fix-suggestions", "app.ts"] });

    const after = readFileSync(join(dir, "app.ts"), "utf8");
    expect(after).toBe(
      [
        '// @ts-nocheck -- fixture file linted by oxlint, not type-checked; `gql` is not a real import.',
        'import { gql } from "graphql-tag";',
        "",
        "const first = gql`",
        "  query user {",
        "    user {",
        "      id",
        "    }",
        "  }",
        "`;",
        "",
        "const second = gql`",
        "  query getUser {",
        "    user {",
        "      id",
        "    }",
        "  }",
        "`;",
        "",
        "export { first, second };",
        "",
      ].join("\n"),
    );
  });

  // Coverage gap B from the final review: every other fix/suggestion test in this file (and in
  // conformance/'s fixture builder) puts the violation in the FIRST embedded `gql` template, so
  // a bug in `report-mapper.ts`'s per-document `offset`/`lineOffset` handling for any document
  // past index 0 would never turn a single test red. This fixture has three templates; the
  // violation (and the suggestion that fixes it) is in the THIRD (index 2), with two earlier,
  // clean templates in between. Asserts the whole file byte-for-byte: both templates before the
  // fixed one, and the text around the fix within the third template, must be untouched.
  it("applies a suggestion to the third of three gql templates, leaving the first two untouched", () => {
    const dir = copyFixture("suggestions-later-document");

    runOxlint({ cwd: dir, args: ["--fix-suggestions", "app.ts"] });

    const after = readFileSync(join(dir, "app.ts"), "utf8");
    expect(after).toBe(
      [
        '// @ts-nocheck -- fixture file linted by oxlint, not type-checked; `gql` is not a real import.',
        "const first = gql`",
        "  query getUser {",
        "    user {",
        "      id",
        "    }",
        "  }",
        "`;",
        "",
        "const second = gql`",
        "  query getUsers {",
        "    users {",
        "      id",
        "    }",
        "  }",
        "`;",
        "",
        "const typeDefs = gql`",
        "  type User {",
        "    Id: ID!",
        "    name: String",
        "  }",
        "`;",
        "",
        "export { first, second, typeDefs };",
        "",
      ].join("\n"),
    );
  });

  // Coverage gap C from the final review: `toEmbedded` (conformance/corpus.ts) always wraps its
  // GraphQL in a multi-line template (`` gql`\n...\n` ``), so no test anywhere in this repo had
  // ever run a genuinely single-line `` gql`...` `` — the exact shape that broke a README
  // example. Verified directly against real ESLint (via conformance/eslint-runner.ts, same
  // fixture): it reports the identical `line: 2, column: 1` — NOT the host column where `query`
  // actually starts (~15) — because graphql-eslint's own `postprocess` only shifts `line` by
  // `lineOffset`, never `column` (see the design doc and the "Behavioural differences" README
  // section: `getNodeByRangeIndex`/`getTokenBefore` etc. are the parts that use `range`, which
  // IS offset-corrected; the reported `loc.column` for display is not, upstream included). This
  // asserts the real, matching-upstream behavior rather than the "looks right" column a naive
  // reader might expect — and separately confirms the *fix* still lands in the right place
  // (fixes are range-based, not line/column-based, so they're unaffected by this quirk).
  it("reports a single-line gql template at graphql-eslint's own (unshifted) column, and fixes it correctly anyway", () => {
    const result = runOxlint({ cwd: fixture("single-line-template"), args: ["app.ts"] });

    expect(result.diagnostics).toHaveLength(1);
    const span = result.diagnostics[0]!.labels[0]!.span;
    expect(span.line).toBe(2);
    expect(span.column).toBe(1);

    const dir = copyFixture("single-line-template");
    runOxlint({ cwd: dir, args: ["--fix-suggestions", "app.ts"] });
    const after = readFileSync(join(dir, "app.ts"), "utf8");
    expect(after).toBe(
      [
        '// @ts-nocheck -- fixture file linted by oxlint, not type-checked; `gql` is not a real import.',
        "const q = gql`query user { user { id } }`;",
        "export { q };",
        "",
      ].join("\n"),
    );
  });

  it("applies the no-typename-prefix suggestion via --fix-suggestions, leaving the second template untouched", () => {
    const dir = copyFixture("suggestions-typename-prefix");

    runOxlint({ cwd: dir, args: ["--fix-suggestions", "app.ts"] });

    const after = readFileSync(join(dir, "app.ts"), "utf8");
    expect(after).toBe(
      [
        '// @ts-nocheck -- fixture file linted by oxlint, not type-checked; `gql` is not a real import.',
        "const typeDefs = gql`",
        "  type User {",
        "    Id: ID!",
        "    name: String",
        "  }",
        "`;",
        "",
        "const query = gql`",
        "  query getUser {",
        "    user {",
        "      id",
        "    }",
        "  }",
        "`;",
        "",
        "export { typeDefs, query };",
        "",
      ].join("\n"),
    );
  });
});
