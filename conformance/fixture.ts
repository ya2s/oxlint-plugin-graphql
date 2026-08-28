import { cpSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type CaseFixture = { dir: string };

/**
 * Materializes ONE self-contained project directory per corpus case: `schema.graphql`,
 * `graphql.config.js`, and `app.ts` (the same embedded JS text handed to both engines — see
 * run-eslint.ts / run-oxlint.ts, which each add their own engine-specific config file on top of
 * this shared directory). Not part of the task-10 brief's file list; extracted because both
 * `lintWithEslint` and `lintWithOxlint` need the exact same on-disk fixture (schema, config,
 * source) for the comparison to mean anything — see "Both paths MUST lint the same JS fixture
 * text" in the task brief.
 */
export function buildFixture(input: {
  code: string;
  schemaPath: string;
  requiresDocuments: boolean;
  /** Raw schema.graphql text to write instead of copying `schemaPath` — see
   *  `RULES_WITH_SELF_SCHEMA_EXAMPLES` in documents-required-rules.ts. */
  schemaOverrideText?: string;
}): CaseFixture {
  const dir = mkdtempSync(join(tmpdir(), "gql-conformance-"));

  if (input.schemaOverrideText !== undefined) {
    writeFileSync(join(dir, "schema.graphql"), input.schemaOverrideText);
  } else {
    cpSync(input.schemaPath, join(dir, "schema.graphql"));
  }

  writeFileSync(
    join(dir, "graphql.config.js"),
    `export default { schema: "./schema.graphql"${input.requiresDocuments ? ', documents: "./app.ts"' : ""} };\n`,
  );
  writeFileSync(join(dir, "app.ts"), input.code);

  return { dir };
}
