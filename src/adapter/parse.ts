import { parseForESLint } from "@graphql-eslint/eslint-plugin";
import { invalidateIfConfigChanged } from "./config-watch.js";
import { extractDocuments } from "./documents.js";
import { linkParents } from "./traverse.js";
import type { GqlNode, ParseError, ParsedDocument, ParserServices } from "./types.js";

const MAX_CACHE_ENTRIES = 8;

type CacheEntry = { code: string; schemaSdl: string | undefined; documents: ParsedDocument[] };

const cache = new Map<string, CacheEntry>();
let parseCallCount = 0;

export function clearParseCache(): void {
  cache.clear();
  parseCallCount = 0;
}

export function getParseCallCount(): number {
  return parseCallCount;
}

export function parseDocuments(options: {
  code: string;
  filePath: string;
  schemaSdl?: string;
}): ParsedDocument[] {
  // A long-lived process (the oxc language server) can outlive edits to graphql.config.* or the
  // schema files it points at. Neither is reflected in `code`/`schemaSdl`, the only inputs the
  // cache below is keyed on, so without this the cache would keep returning parses against a
  // schema that no longer matches disk. See config-watch.ts.
  invalidateIfConfigChanged(options.filePath, () => cache.clear());

  const cached = cache.get(options.filePath);
  if (cached && cached.code === options.code && cached.schemaSdl === options.schemaSdl) {
    cache.delete(options.filePath);
    cache.set(options.filePath, cached);
    return cached.documents;
  }

  const documents = extractDocuments(options.code, options.filePath).map((document) => {
    parseCallCount += 1;
    try {
      const parserOptions =
        options.schemaSdl === undefined
          ? { filePath: document.filePath }
          : { filePath: document.filePath, schemaSdl: options.schemaSdl };
      const result = parseForESLintDefeatingNodeCacheBypass(document.text, parserOptions) as unknown as {
        ast: GqlNode;
        services: ParserServices;
      };
      // Parent the whole AST once, here, before it is ever handed to a rule. See
      // linkParents' own doc comment in traverse.ts for why this must happen at parse time
      // rather than inside traverse() itself.
      linkParents(result.ast);
      return { kind: "parsed", document, ast: result.ast, services: result.services } as const;
    } catch (error) {
      return { kind: "error", document, error: toParseError(error) } as const;
    }
  });

  cache.set(options.filePath, { code: options.code, schemaSdl: options.schemaSdl, documents });
  if (cache.size > MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }
  return documents;
}

/**
 * Workaround for `@graphql-eslint/eslint-plugin@4.4.1`'s `esm/cache.js` (`ModuleCache.get`):
 *
 *   if (process.env.NODE || process.hrtime(lastSeen)[0] < settings.lifetime) return result;
 *
 * This gates the plugin's schema cache's 10-second TTL behind `process.env.NODE` — almost
 * certainly an upstream typo for `NODE_ENV` (compare the correct `process.env.NODE_ENV` checks
 * elsewhere in the same package, e.g. graphql-config.js). Whenever `NODE` is set to any truthy
 * string, the `||` short-circuits and the schema cache never expires, for the life of the
 * process. `pnpm run <script>`/`pnpm exec` always set a bare `NODE` env var to the node binary
 * path, so a language server launched that way (a very common launch path in a pnpm-managed
 * project) would never see a schema-content edit — regardless of invalidateIfConfigChanged
 * clearing THIS package's own cache — until the process restarts. Verified directly: see
 * tests/adapter/config-watch.test.ts's "re-reads the schema ... with NODE set" test and Task
 * 11's report.
 *
 * `parseForESLint` is synchronous, so it's safe to save, delete, and restore `process.env.NODE`
 * around just this one call: nothing else in the process can observe the mutation mid-call, and
 * the `finally` guarantees restoration even if `parseForESLint` throws.
 *
 * Delete this workaround if upstream fixes the typo (i.e. once `esm/cache.js` no longer checks
 * `process.env.NODE`).
 */
function parseForESLintDefeatingNodeCacheBypass(
  ...args: Parameters<typeof parseForESLint>
): ReturnType<typeof parseForESLint> {
  const hadNode = Object.hasOwn(process.env, "NODE");
  const savedNode = process.env.NODE;
  delete process.env.NODE;
  try {
    return parseForESLint(...args);
  } finally {
    if (hadNode) process.env.NODE = savedNode;
  }
}

function toParseError(error: unknown): ParseError {
  const raw = error as { message?: string; lineNumber?: number; column?: number };
  // Only GraphQL syntax errors carry a `lineNumber` (see @graphql-eslint/eslint-plugin's
  // parser.js, which attaches it only for `GraphQLError` instances). Config/schema loading
  // failures do not, so re-throw those instead of masking them as a per-document parse error.
  if (typeof raw?.message !== "string" || typeof raw.lineNumber !== "number") throw error;
  return {
    message: raw.message,
    line: raw.lineNumber,
    column: raw.column ?? 0,
  };
}
