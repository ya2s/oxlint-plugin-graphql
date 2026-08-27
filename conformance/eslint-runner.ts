/**
 * Runs inside its OWN subprocess, spawned by run-eslint.ts with `cwd` set to the case's fixture
 * directory (see fixture.ts). This mirrors `lintWithOxlint`'s subprocess-per-case model, and is
 * required (not just symmetric for its own sake): `@graphql-eslint/eslint-plugin`'s `utils.js`
 * captures `const CWD = process.cwd()` once, at module import time, and two rules
 * (`no-one-place-fragments`, `unique-fragment-name`) embed `relative(CWD, filePath)` directly in
 * their reported message. Only a fresh process per case — imported after its `cwd` is already
 * the fixture directory — gives both engines the same `CWD` and therefore the same message text.
 *
 * Also works around two gaps in the brief's suggested `lintWithEslint` shape (measured against
 * the installed eslint@9.39.5 + @graphql-eslint/eslint-plugin@4.4.1):
 *
 *  1. The plugin's default export has a singular `processor` (the object itself), not a
 *     `processors: { graphql: ... }` map. Registering `plugins: { "@graphql-eslint": graphqlEslintNS }`
 *     directly and referencing `processor: "@graphql-eslint/graphql"` throws
 *     `Could not find "graphql" in plugin "@graphql-eslint"` — confirmed by running it. Wrapping
 *     it as `{ parser, processors: { graphql: processor }, rules }` fixes this.
 *  2. ESLint's flat-config processor path defaults `filterCodeBlock` to
 *     `blockFilename => blockFilename.endsWith(".js")` (see eslint's linter.js,
 *     `_verifyWithFlatConfigArrayAndProcessor`), which silently drops every `*.graphql` block the
 *     processor produces — `linter.verify` returns `[]` with no error. Passing
 *     `filterCodeBlock: () => true` in the verify options is required to get any diagnostics at
 *     all through the processor path.
 *
 * A third gap was found via the corpus itself, not by reading source ahead of time: passing a
 * bare relative `filename: "app.ts"` made `unique-fragment-name`/`unique-operation-name` report
 * spurious cross-file duplicates that real oxlint (and real-world ESLint) does not. Both rules
 * compare the *currently-parsed* document's virtual path (`context.filename`, built by ESLint's
 * `ProcessorService` as `path.join(file.path, "0_" + block.filename)`) against each sibling
 * operation's path (built independently by graphql-eslint's own documents loader as
 * `path.resolve(location, "0_document.graphql")`, which is always absolute). With a relative
 * `file.path` those two strings never match even for the same physical file, so the rule always
 * treats "this document, read twice" as two different files and reports a false conflict. Real
 * ESLint (via its CLI/FlatESLint) always resolves file paths to absolute before linting, so this
 * mismatch is purely an artifact of `Linter.verify` accepting a relative filename — fixed by
 * resolving `app.ts` to an absolute path here, matching how oxlint already reports
 * `physicalFilename`.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Linter } from "eslint";
import graphqlEslintNS from "@graphql-eslint/eslint-plugin";

const [, , ruleId, optionsJson] = process.argv;
if (!ruleId || optionsJson === undefined) {
  throw new Error("usage: eslint-runner.ts <ruleId> <optionsJson>");
}
const options: unknown[] = JSON.parse(optionsJson);
const code = readFileSync("app.ts", "utf8");

const pluginObj = {
  parser: graphqlEslintNS.parser,
  processors: { graphql: graphqlEslintNS.processor },
  rules: graphqlEslintNS.rules,
};

const linter = new Linter({ configType: "flat" });

try {
  const messages = linter.verify(
    code,
    [
      {
        files: ["**/*.ts"],
        plugins: { "@graphql-eslint": pluginObj as never },
        processor: "@graphql-eslint/graphql",
      },
      {
        files: ["**/*.graphql"],
        languageOptions: { parser: graphqlEslintNS.parser as never },
        plugins: { "@graphql-eslint": pluginObj as never },
        rules: { [`@graphql-eslint/${ruleId}`]: ["error", ...options] as never },
      },
    ],
    { filename: resolve("app.ts"), filterCodeBlock: () => true },
  );
  process.stdout.write(JSON.stringify({ kind: "messages", messages }));
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stdout.write(JSON.stringify({ kind: "error", message }));
}
