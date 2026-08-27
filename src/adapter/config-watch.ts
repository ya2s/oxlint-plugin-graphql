/**
 * Keeps `parseDocuments`'s own cache (parse.ts) honest in a long-lived process: without this, a
 * schema or graphql-config edit is invisible to it forever, since the cache is keyed only by
 * `filePath`/`code`/`schemaSdl`, none of which change when a *different* file on disk changes.
 *
 * CARRY FORWARD TO TASK 13'S README ("known limitations" section) -- the real, current situation
 * as of the fix in parse.ts's `parseForESLintDefeatingNodeCacheBypass`:
 *
 * 1. Editing the CONTENT of an already-configured schema file (same path, new text) does NOT
 *    need a language server restart. This module's cache-clear (via the fingerprint below) lets
 *    a fresh `parseDocuments` call through immediately; that call reaches
 *    `@graphql-eslint/eslint-plugin`'s own schema cache (esm/cache.js's `ModuleCache`, used by
 *    esm/schema.js), which expires 10 seconds after each load. So the edit becomes visible
 *    automatically, typically within ~10 seconds of the edit, with no restart required.
 *
 * 2. That 10-second expiry is ONLY reliable because of a workaround, not for free. `ModuleCache`
 *    actually reads `if (process.env.NODE || process.hrtime(lastSeen)[0] < settings.lifetime)
 *    return result;` -- `process.env.NODE` (almost certainly an upstream typo for `NODE_ENV`)
 *    makes the cache immortal whenever `NODE` is set to any truthy string, and `pnpm run
 *    <script>`/`pnpm exec` -- a common way to launch a language server in a pnpm-managed project
 *    -- always sets a bare `NODE` env var to the node binary path. Verified directly: without a
 *    workaround, a schema-content edit under `NODE` set is NEVER observed, even after 11+
 *    seconds, only a restart fixes it. `parseForESLintDefeatingNodeCacheBypass` in parse.ts
 *    neutralizes `process.env.NODE` around each synchronous `parseForESLint` call specifically to
 *    restore case 1's "no restart needed, ~10s latency" behavior even when `NODE` is set. See
 *    that function's doc comment and Task 11's follow-up report for the measurements.
 *
 * 3. Editing graphql.config.* itself so it points at a *different* schema file (its `schema`
 *    pointer changes, a `projects` entry is added/removed/renamed, or the config file is moved)
 *    STILL requires a language server restart -- this is NOT fixed by anything in this task.
 *    This fingerprint does detect that edit (the config file's own mtime is always included) and
 *    correctly clears this module's cache, but `@graphql-eslint/eslint-plugin`'s OWN module-level
 *    `graphQLConfig` singleton (esm/graphql-config.js) is never rebuilt within a process once
 *    set, so the next real parse still asks the *stale* GraphQLConfig object for the file's
 *    project, which still returns the *old* schema pointer. Verified directly: even 11+ seconds
 *    after such an edit, in a process that never restarts, the old schema is still what gets
 *    used. Re-importing graphql-eslint's parser module with a cache-busting query string (an
 *    approach considered for defeating this singleton outright) does not work -- see Task 11's
 *    report for why.
 *
 * See tests/adapter/config-watch.test.ts's "re-reads the schema" tests (both the plain case and
 * the `NODE`-set case) for the measurements behind all of the above.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const CONFIG_FILE_NAMES = [
  "graphql.config.ts",
  "graphql.config.js",
  "graphql.config.mjs",
  "graphql.config.cjs",
  "graphql.config.json",
  "graphql.config.yaml",
  "graphql.config.yml",
  ".graphqlrc",
  ".graphqlrc.ts",
  ".graphqlrc.js",
  ".graphqlrc.json",
  ".graphqlrc.yaml",
  ".graphqlrc.yml",
  "package.json",
];

const fingerprints = new Map<string, string>();

/**
 * A fingerprint of `filePath`'s graphql-config and the schema file(s) it points at, built from
 * mtimes only (no parsing). Two calls return the same string iff nothing relevant on disk has
 * changed since. See `invalidateIfConfigChanged`, the only real consumer: it stores the previous
 * fingerprint per directory and clears the parse cache when this changes.
 */
export function getConfigFingerprint(filePath: string): string {
  const parts: string[] = [];

  for (const configPath of findConfigFiles(filePath)) {
    parts.push(`${configPath}:${mtime(configPath)}`);
    for (const schemaPath of schemaFilesOf(configPath)) {
      parts.push(`${schemaPath}:${mtime(schemaPath)}`);
    }
  }

  return parts.join("|");
}

/**
 * Calls `onChange` (expected to clear the parse cache) the first time this is called for a given
 * directory, and again whenever `getConfigFingerprint` for `filePath` differs from the last
 * value seen for that directory. Safe to call on every `parseDocuments` invocation: the common
 * case (nothing changed) is just an mtime comparison.
 */
export function invalidateIfConfigChanged(filePath: string, onChange: () => void): void {
  const key = dirname(resolve(filePath));
  const current = getConfigFingerprint(filePath);
  if (fingerprints.get(key) !== current) {
    fingerprints.set(key, current);
    onChange();
  }
}

function findConfigFiles(filePath: string): string[] {
  let dir = dirname(resolve(filePath));
  const found: string[] = [];

  for (;;) {
    for (const name of CONFIG_FILE_NAMES) {
      const candidate = join(dir, name);
      if (existsSync(candidate)) found.push(candidate);
    }
    if (found.length > 0) return found;

    const parent = dirname(dir);
    if (parent === dir) return found;
    dir = parent;
  }
}

/**
 * Scans a config file's raw text for quoted paths ending in a schema-like extension. Crude by
 * design: a real parse would need to run each config loader (JS/TS/JSON/YAML) and resolve
 * graphql-config's own project/extends semantics, all of which this function must stay fast and
 * synchronous enough to run on every parse.
 *
 * It both undershoots and overshoots, and neither is fixed:
 *
 * - Undershoot (misses a real schema path, so an edit to that file is not detected until
 *   graphql-eslint's own eventual cache expiry -- see the module doc comment above -- rather
 *   than being reacted to right away): glob patterns (`"./schema/**\/*.graphql"` never resolves
 *   to any `existsSync` candidate, so a schema split across multiple files via a glob is
 *   invisible); and any schema path that isn't a literal quoted string in a JS/TS config --
 *   computed or concatenated paths (`path.join(__dirname, "schema.graphql")`, a template
 *   literal, an imported constant) are invisible to a text-only regex scan.
 * - Overshoot (fingerprints a file that isn't actually this project's schema, so an edit to it
 *   triggers an unnecessary cache clear -- harmless, just a wasted re-parse): the regex matches
 *   ANY quoted path with a schema-like extension anywhere in the file's text, with no awareness
 *   of which JSON/JS key it sits under. In particular, when `package.json` is the discovered
 *   config file (i.e. it carries a `"graphql"` field), an unrelated field like
 *   `"someToolConfig": "./unrelated-config.json"` matches the extension pattern just as well and
 *   gets swept into the fingerprint, so editing that unrelated file also invalidates the cache.
 */
function schemaFilesOf(configPath: string): string[] {
  let content: string;
  try {
    content = statSync(configPath).isFile() ? readFileSync(configPath, "utf8") : "";
  } catch {
    return [];
  }

  const matches = content.matchAll(/["'`]([^"'`\s]+\.(?:graphql|graphqls|gql|json))["'`]/g);
  const dir = dirname(configPath);
  const paths: string[] = [];
  for (const match of matches) {
    const candidate = resolve(dir, match[1]!);
    if (existsSync(candidate)) paths.push(candidate);
  }
  return paths;
}

function mtime(path: string): number {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return 0;
  }
}
