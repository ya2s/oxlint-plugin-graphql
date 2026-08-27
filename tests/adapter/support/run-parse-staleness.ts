import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const runnerPath = fileURLToPath(new URL("./parse-staleness-runner.ts", import.meta.url));
const loaderPath = fileURLToPath(new URL("./strip-types-loader.mjs", import.meta.url));

export type StalenessResult = { first: string[]; second: string[] };

/**
 * Spawns tests/adapter/support/parse-staleness-runner.ts in a fresh `node` subprocess with
 * `NODE_ENV=production` pinned (see that file's doc comment for why this must be a subprocess,
 * not an in-process vitest call), and `NODE` deliberately unset.
 *
 * `NODE` matters for a completely different, surprising reason from `NODE_ENV`: `pnpm run <script>`
 * (which is how this very test suite gets invoked by `pnpm test`) sets a bare `NODE` env var to
 * the node binary path, and inherits it down through vitest into whatever `execFileSync` spawns
 * from inside a test. `@graphql-eslint/eslint-plugin`'s schema cache (esm/cache.js's
 * `ModuleCache.get`) has `if (process.env.NODE || process.hrtime(lastSeen)[0] < settings.lifetime)
 * return result;` -- so when `NODE` is set to any truthy string (regardless of its value), the
 * `10-second lifetime` on the right of `||` is never even evaluated: the cached schema is returned
 * forever, no matter how much real time passes. Verified directly: the exact same scenario that
 * self-heals after 11s under a plain shell invocation stays stale forever once `NODE` is set.
 * Deleting `NODE` here keeps this test's outcome about the fix this task actually makes (clearing
 * OUR OWN cache), not about which shell happened to launch the test. See the report for why this
 * also means a real language server started via `pnpm exec`/`pnpm run` (common in monorepo
 * tooling) can NOT rely on graphql-eslint's own cache expiring at all, ever, for as long as it
 * keeps that inherited `NODE` variable.
 *
 * `waitMs` is the delay the runner waits, inside its single long-lived process, between editing
 * the schema file and calling `parseDocuments` a second time. Pass 0 to observe the state
 * immediately after the edit; pass something past `@graphql-eslint/eslint-plugin`'s own 10-second
 * schema-cache TTL to observe the state once that cache would have expired on its own.
 */
export function runParseStalenessScenario(input: { projectDir: string; schemaPath: string; waitMs: number }): StalenessResult {
  const { NODE: _unusedNode, ...restEnv } = process.env;
  const env = { ...restEnv, NODE_ENV: "production" };

  const stdout = execFileSync(
    process.execPath,
    [
      "--experimental-strip-types",
      "--no-warnings",
      "--loader",
      pathToFileURL(loaderPath).href,
      runnerPath,
      input.projectDir,
      input.schemaPath,
      String(input.waitMs),
    ],
    { encoding: "utf8", env },
  );
  return JSON.parse(stdout) as StalenessResult;
}
