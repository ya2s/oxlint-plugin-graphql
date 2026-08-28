/**
 * The environment both engine subprocesses run under, pinned explicitly rather than left to
 * whatever inherits from the parent process.
 *
 * `@graphql-eslint/eslint-plugin@4.4.1` branches on `process.env.NODE_ENV === "test"` in six
 * places (grepped across esm/*.js and esm/rules/*\/index.js). Five are cache-bypass checks that
 * don't affect us either way (we spawn a fresh subprocess per case, so every module-level cache
 * starts empty regardless of NODE_ENV). The sixth, `match-document-filename`'s
 * `if (process.env.NODE_ENV !== "test" && isVirtualFile) return {};`, is a genuine behavioral
 * gate: outside test mode the rule does nothing at all for any embedded/virtual document (which
 * is all our fixtures ever are), so it is unconditionally vacuous; inside test mode it runs its
 * real filename-matching logic against the virtual path.
 *
 * Left unset, this is an accident of the harness's own execution context: `vitest` sets
 * `NODE_ENV=test` on itself, and `execFileSync` inherits the parent's `process.env` by default,
 * so both subprocesses silently ran in graphql-eslint's internal test mode — measuring how the
 * rule behaves when graphql-eslint's own authors exercise it in *their* test suite, not how it
 * behaves for a real end user of the published plugin (who never sets NODE_ENV=test). Verified
 * directly against the built oxlint plugin: the same rule+fixture produces a real diagnostic
 * under `NODE_ENV=test` and zero diagnostics under `NODE_ENV` unset/"production".
 *
 * This harness measures the mode a real user actually gets: NODE_ENV explicitly set to
 * something other than "test" for both engines, regardless of what value vitest itself runs
 * under. That makes `match-document-filename`'s 8 corpus cases vacuous by design (both engines
 * agree: zero diagnostics), not because the virtual filename structurally can never match any
 * naming pattern (an earlier, incorrect rationale — it can, and does, under NODE_ENV=test; see
 * above) but because the rule is inert for virtual files in the mode a real user runs in.
 */
export const CONFORMANCE_ENV: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: "production" };
