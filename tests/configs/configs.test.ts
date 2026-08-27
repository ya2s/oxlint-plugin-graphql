import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { configs as graphqlEslintConfigs } from "@graphql-eslint/eslint-plugin";
import { beforeAll, describe, expect, it } from "vitest";
import { rules } from "../../src/rules.js";
import {
  configs,
  operationsAll,
  operationsRecommended,
  schemaAll,
  schemaRecommended,
  schemaRelay,
} from "../../src/configs/index.js";

const CONFIG_NAMES = ["schema-recommended", "schema-all", "schema-relay", "operations-recommended", "operations-all"];

const PARSE_ERROR_ID = "graphql/parse-error";

function upstreamRules(name: string): Record<string, unknown> {
  const source = (graphqlEslintConfigs as unknown as Record<string, { rules: Record<string, unknown> } | undefined>)[
    `flat/${name}`
  ];
  if (!source) throw new Error(`unknown graphql-eslint config: flat/${name}`);
  return source.rules;
}

describe("configs", () => {
  it("ports every graphql-eslint flat config", () => {
    expect(Object.keys(configs).sort()).toEqual([...CONFIG_NAMES].sort());
  });

  it("renames rule ids from @graphql-eslint/* to graphql/* and adds graphql/parse-error", () => {
    const sourceRules = Object.keys(upstreamRules("operations-recommended"));

    expect(Object.keys(operationsRecommended.rules).sort()).toEqual(
      [...sourceRules.map((id) => id.replace("@graphql-eslint/", "graphql/")), PARSE_ERROR_ID].sort(),
    );
  });

  it("keeps rule options untouched", () => {
    expect(operationsRecommended.rules["graphql/naming-convention"]).toEqual(
      upstreamRules("operations-recommended")["@graphql-eslint/naming-convention"],
    );
  });

  it("declares the plugin so extending a config is enough", () => {
    expect(operationsRecommended.jsPlugins).toEqual(["oxlint-plugin-graphql"]);
    for (const config of Object.values(configs)) {
      expect(config.jsPlugins).toEqual(["oxlint-plugin-graphql"]);
    }
  });

  it("adds graphql/parse-error as \"error\" to every ported config", () => {
    for (const [name, config] of Object.entries(configs)) {
      expect(config.rules[PARSE_ERROR_ID], name).toBe("error");
    }
  });
});

// Addition B: the rename from @graphql-eslint/* to graphql/* must be lossless in both
// directions -- no upstream rule silently dropped, nothing invented beyond the explicitly
// added graphql/parse-error (see ruling 3: upstream's own configs cannot contain a rule that
// doesn't exist upstream, so parse-error must be layered on top rather than derived).
describe("rename is lossless (addition B)", () => {
  const namedConfigs: Record<string, { rules: Record<string, unknown> }> = {
    "schema-recommended": schemaRecommended,
    "schema-all": schemaAll,
    "schema-relay": schemaRelay,
    "operations-recommended": operationsRecommended,
    "operations-all": operationsAll,
  };

  for (const name of CONFIG_NAMES) {
    it(`${name}: ported rule-id set equals upstream set with the prefix swapped, plus parse-error`, () => {
      const upstream = upstreamRules(name);
      const upstreamIds = Object.keys(upstream);
      const expectedIds = new Set([...upstreamIds.map((id) => id.replace("@graphql-eslint/", "graphql/")), PARSE_ERROR_ID]);

      const portedIds = new Set(Object.keys(namedConfigs[name]!.rules));

      expect(portedIds).toEqual(expectedIds);
      // rule count report: upstream count + 1 (graphql/parse-error)
      expect(portedIds.size).toBe(upstreamIds.length + 1);
    });

    it(`${name}: option tuples are deep-equal to upstream`, () => {
      const upstream = upstreamRules(name);
      const ported = namedConfigs[name]!.rules;

      for (const [upstreamId, value] of Object.entries(upstream)) {
        const portedId = upstreamId.replace("@graphql-eslint/", "graphql/");
        expect(ported[portedId], portedId).toEqual(value);
      }
    });
  }
});

// Addition C: a config naming a rule the plugin does not expose would fail at lint time, so
// every ported rule id must resolve to a key this plugin's rules.ts actually exports (rules.ts
// keys are bare -- e.g. "no-deprecated", "parse-error" -- while config rule ids carry the
// "graphql/" plugin prefix).
describe("every ported rule id exists in this plugin's rule set (addition C)", () => {
  for (const name of CONFIG_NAMES) {
    it(`${name}: every rule id resolves to an exported rule`, () => {
      const config = configs[name]!;
      const missing: string[] = [];
      for (const ruleId of Object.keys(config.rules)) {
        const bareId = ruleId.startsWith("graphql/") ? ruleId.slice("graphql/".length) : ruleId;
        if (!(bareId in rules)) missing.push(ruleId);
      }
      expect(missing, `rule ids missing from src/rules.ts: ${missing.join(", ")}`).toEqual([]);
    });
  }
});

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

// Shared by both describe blocks below (JSON fragment generation, and the end-to-end `extends`
// check): both need the freshly regenerated dist/configs/*.json, and previously each ran its own
// identical beforeAll to produce it -- redundant work, run twice on every test run for no reason.
// A single top-level (not nested in any describe) beforeAll runs once for the whole file instead.
beforeAll(() => {
  // The generator imports the *built* dist/index.js (see ruling 2 in the task brief: it
  // cannot import ../src/configs/index.js since Node won't resolve a .js specifier to a .ts
  // source). The repo's own `test` script runs `tsdown` before `vitest run`, so dist/ already
  // exists by the time this test runs. This deliberately does NOT re-run tsdown itself: vitest
  // runs test files concurrently, and other test files' fixtures load dist/index.js as an
  // oxlint jsPlugin mid-run -- rebuilding here (tsdown's `clean: true` removes dist/ first)
  // raced with those and intermittently broke them with a missing-module error.
  expect(existsSync(join(repoRoot, "dist", "index.js")), "dist/index.js: run `pnpm build` or `pnpm test` first").toBe(
    true,
  );
  // `process.execPath` (not a bare "node"), with `--experimental-strip-types` explicit: Node
  // only strips types from a bare `.ts` file unflagged starting at 22.18/23.6, and this repo's
  // declared floor is 22.13, which is below that. Every other subprocess spawn in this repo
  // already does it this way (conformance/run-eslint.ts, tests/adapter/support/run-parse-staleness.ts)
  // -- this was the one outlier, picking up whatever `node` happened to be first on PATH, which
  // silently passed in local dev (a newer Node) but failed the 22.13 CI leg with
  // ERR_UNKNOWN_FILE_EXTENSION.
  execFileSync(process.execPath, ["--experimental-strip-types", "scripts/generate-config-json.ts"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
});

describe("JSON fragment generation", () => {
  it("emits a JSON fragment for each config under dist/configs", () => {
    for (const name of Object.keys(configs)) {
      const path = join(repoRoot, "dist", "configs", `${name}.json`);
      expect(existsSync(path), path).toBe(true);
      expect(JSON.parse(readFileSync(path, "utf8"))).toEqual(configs[name]);
    }
  });
});

// Addition A: prove a ported config actually works end to end through the real oxlint binary,
// via .oxlintrc.json's `extends`. The fixture at tests/configs/fixtures/extends-e2e uses
// "extends": ["../../../../dist/configs/schema-relay.json"] -- a plain relative path from the
// .oxlintrc.json file to the generated fragment. This is the form that was found to work; see
// the task report for the resolution details (a bare `jsPlugins: ["oxlint-plugin-graphql"]`
// package-name specifier inside that fragment also resolves correctly here, via Node's
// self-referencing package resolution, since the fixture lives inside this package's own
// directory tree and package.json declares a matching "exports" field).
describe("a ported config works end to end through the real oxlint binary (addition A)", () => {
  const fixtureDir = fileURLToPath(new URL("./fixtures/extends-e2e", import.meta.url));

  // dist/configs/*.json is regenerated by the top-level beforeAll above, once for the whole
  // file -- no per-describe setup needed here anymore.

  it("fires graphql/relay-page-info, a real schema-relay rule pulled in via extends", () => {
    const OXLINT_BIN = join(repoRoot, "node_modules/.bin/oxlint");
    let stdout: string;
    try {
      stdout = execFileSync(OXLINT_BIN, ["-c", ".oxlintrc.json", "-f", "json", "."], {
        cwd: fixtureDir,
        encoding: "utf8",
      });
    } catch (error) {
      stdout = (error as { stdout?: string }).stdout ?? "";
    }
    const parsed = JSON.parse(stdout) as { diagnostics: Array<{ code: string; message: string }> };

    const relayDiagnostics = parsed.diagnostics.filter((d) => d.code === "graphql(relay-page-info)");
    expect(relayDiagnostics).toHaveLength(1);
    expect(relayDiagnostics[0]!.message).toContain("PageInfo");
  });
});
