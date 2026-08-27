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

describe("oxlint-plugin-graphql end to end", () => {
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

  it("prints readable, correctly located messages through the default CLI formatter", () => {
    // Addition D: what a user actually sees, not the -f json shape every other test in this
    // repo asserts against. Run without runOxlint's helper (which hardcodes -f json).
    let stdout: string;
    try {
      stdout = execFileSync(OXLINT_BIN, ["-c", ".oxlintrc.json", "app.ts"], {
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
