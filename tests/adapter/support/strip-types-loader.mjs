/**
 * A minimal ESM loader hook that lets a plain `node --experimental-strip-types` subprocess
 * import this package's own `src/**\/*.ts` files directly, unbuilt.
 *
 * `src/` follows `tsconfig.json`'s `"moduleResolution": "nodenext"` convention: every relative
 * import is written with a `.js` extension (e.g. `import { extractDocuments } from
 * "./documents.js"`) even though only `documents.ts` exists on disk. `tsc`/`tsdown` resolve
 * that correctly when producing `dist/`, and `vitest` resolves it correctly via its own
 * esbuild-based resolver. Plain Node's ESM loader does neither: it resolves specifiers
 * literally, so `node --experimental-strip-types src/adapter/parse.ts` fails on parse.ts's own
 * `import ... from "./documents.js"` with `ERR_MODULE_NOT_FOUND` (verified directly).
 *
 * This hook is only a fallback: it first tries Node's normal resolution, and only on failure
 * retries a `.js` specifier as the sibling `.ts` file. It changes nothing for `.js` files that
 * genuinely exist (there are none in `src/`), and nothing outside this one failure mode.
 *
 * Used exclusively by tests/adapter/support/run-parse-staleness.ts, which needs a real,
 * separate `node` subprocess (not vitest, which pins `NODE_ENV=test` and so bypasses the very
 * module-level singleton this test exists to exercise — see that file's doc comment) that can
 * still import `src/adapter/parse.ts` by its real source path.
 */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    if (specifier.endsWith(".js") && context.parentURL) {
      const candidate = new URL(specifier.replace(/\.js$/, ".ts"), context.parentURL);
      if (existsSync(fileURLToPath(candidate))) {
        return nextResolve(candidate.href, context);
      }
    }
    throw error;
  }
}
