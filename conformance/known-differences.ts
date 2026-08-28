/**
 * Cases (or whole rules) that genuinely, irreducibly differ between real
 * ESLint+@graphql-eslint/eslint-plugin and real oxlint+this plugin, for reasons that are not
 * bugs in the adapter and not fixable by adjusting the corpus. Each entry needs a `reason`
 * explaining *why* the difference is irreducible — see the task-10 report for how each entry was
 * investigated before being added here.
 *
 * Entries here are excluded from the pass/fail gate in conformance.test.ts, and surfaced
 * separately in the rendered report as "known differences" rather than silently dropped.
 */
export type KnownDifference = {
  ruleId: string;
  /** Omit to cover every case for this rule. */
  caseId?: string;
  reason: string;
};

export const KNOWN_DIFFERENCES: readonly KnownDifference[] = [
  {
    ruleId: "naming-convention",
    caseId: "naming-convention-7",
    reason:
      'Both engines throw the identical underlying JS error ("Cannot read properties of ' +
      "undefined (reading 'includes')\") — not an adapter difference, a bug in " +
      "@graphql-eslint/eslint-plugin@4.4.1's own naming-convention rule when reading this " +
      'example\'s own documented `usage`. The doc example configures `requiredPattern: {}` for ' +
      "a selector key, but the rule's implementation expects `requiredPattern` to be a string " +
      "(it later calls `.includes(...)` on it) — `{}` is not a working option value, it is a doc " +
      "placeholder saying \"a pattern goes here\". There is no way to derive a working " +
      "`requiredPattern` mechanically from the example's own metadata without inventing content " +
      "not present in graphql-eslint's docs.",
  },
  {
    ruleId: "naming-convention",
    caseId: "naming-convention-8",
    reason:
      "Same root cause as naming-convention-7 (see its entry): both engines throw the identical " +
      "\"Cannot read properties of undefined (reading 'includes')\" for the same reason — the " +
      "example's `requiredPattern: {}` is a documentation placeholder, not a working option value.",
  },
  {
    ruleId: "naming-convention",
    caseId: "naming-convention-2",
    reason:
      'Both engines throw the identical underlying JS error ("pattern.test is not a function") ' +
      "for the same reason as naming-convention-7/8 (see that entry): the example's own " +
      "`usage` sets `forbiddenPatterns: [{}]` — a doc placeholder object, not a real RegExp/" +
      "string pattern — and the rule's implementation calls `.test()` on each entry expecting a " +
      "RegExp. Not derivable mechanically from the example's own metadata.",
  },
  {
    ruleId: "naming-convention",
    caseId: "naming-convention-5",
    reason:
      "Same root cause as naming-convention-2 (see its entry): `forbiddenPatterns: [{}]` is a " +
      "documentation placeholder, not a working pattern value.",
  },
  {
    ruleId: "require-description",
    caseId: "require-description-4",
    reason:
      "Both engines throw an equivalent esquery selector-syntax error for the same underlying " +
      'reason: require-description/index.js builds its listener key as `:matches(${[...kinds]})`' +
      " and, for this example's schema content plus its `ignoredSelectors` option, `kinds` " +
      'computes to an empty array — producing the literal, invalid selector `":matches()"`. ' +
      "ESLint's own esquery-based listener registration throws " +
      '"Syntax error in selector \\":matches():not(...)\\" at position 9: ... but \\")\\" found" — ' +
      "this plugin's selectors.ts uses the same esquery library to parse listener keys and " +
      "throws the equivalent parse error at the same position, for the same reason. This is a " +
      "genuine upstream graphql-eslint bug (an ill-formed selector the rule builds for itself), " +
      "reproduced faithfully by both engines rather than an adapter divergence.",
  },
];

export function findKnownDifference(ruleId: string, caseId: string): KnownDifference | undefined {
  return KNOWN_DIFFERENCES.find((d) => d.ruleId === ruleId && (d.caseId === undefined || d.caseId === caseId));
}

/**
 * Strips everything that legitimately differs between the two engines' error text — absolute
 * paths, this adapter's own `[oxlint-plugin-graphql-eslint] rule "X" failed on <path>:` prefix and
 * stack trace, ESLint's `\nOccurred while linting <path>...` tail — down to the underlying JS
 * error's own message, so a `KnownDifference` can assert the two sides threw for the *same*
 * reason, not merely that both threw.
 *
 * One more wrinkle, found while verifying `require-description-4`: when the underlying failure
 * is an esquery selector-parse error, ESLint's own listener registration (in
 * `createRuleListeners`/`NodeEventGenerator`) wraps it as
 * `Syntax error in selector "<selector>" at position N: <core>` *before* ESLint ever gets to
 * append its own `Occurred while linting` tail — this plugin's `selectors.ts` throws the same
 * esquery library's error directly, with no such wrapper. That prefix is stripped too, on
 * whichever side has it.
 */
export function extractCoreErrorMessage(raw: string): string {
  let core: string;
  const oxlintWithStack = raw.match(/rule "[^"]+" failed on .*?: ([\s\S]*?)\n\s+at /);
  const oxlintNoStack = raw.match(/rule "[^"]+" failed on .*?: ([\s\S]*)$/);
  if (oxlintWithStack) {
    core = oxlintWithStack[1]!;
  } else if (oxlintNoStack) {
    core = oxlintNoStack[1]!;
  } else {
    const occurredIndex = raw.indexOf("\nOccurred while linting");
    core = occurredIndex === -1 ? raw : raw.slice(0, occurredIndex);
  }
  return core.trim().replace(/^Syntax error in selector ".*?" at position \d+: /, "");
}
