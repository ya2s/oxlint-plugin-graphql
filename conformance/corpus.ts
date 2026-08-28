import { rules as graphqlEslintRules } from "@graphql-eslint/eslint-plugin";
import { parse } from "graphql";

export type CorpusCase = {
  ruleId: string;
  caseId: string;
  title: string;
  options: unknown[];
  code: string;
  /**
   * The raw, un-embedded example source (i.e. `example.code` before `toEmbedded` wraps it in a
   * `gql` template). Not part of the task-10 brief's `CorpusCase` shape — added because
   * `no-unused-fields`'s own examples embed a miniature schema directly in the same string as
   * the query, and the fixture builder needs that raw GraphQL text to derive a per-case schema
   * (see `RULES_WITH_SELF_SCHEMA_EXAMPLES` in `documents-required-rules.ts`).
   */
  rawCode: string;
};

type RuleExample = { title?: string; code: string; usage?: unknown[] };

export function buildCorpus(): CorpusCase[] {
  const cases: CorpusCase[] = [];

  for (const [ruleId, rule] of Object.entries(
    graphqlEslintRules as unknown as Record<string, { meta?: { docs?: { examples?: RuleExample[] } } }>,
  )) {
    const examples = rule.meta?.docs?.examples ?? [];
    examples.forEach((example, index) => {
      cases.push({
        ruleId,
        caseId: `${ruleId}-${index}`,
        title: example.title ?? `example ${index}`,
        options: example.usage ?? [],
        code: toEmbedded(example.code),
        rawCode: example.code,
      });
    });
  }

  return cases;
}

/**
 * Embeds an example's GraphQL in a JS `gql` template, so both engines lint the exact same input.
 *
 * A handful of examples (relay-connection-types, require-selections) include a literal backtick
 * inside a comment, used as markdown-style code formatting in the docs (e.g. `` `Connection` ``
 * suffix). Embedded verbatim inside a `` gql`...` `` JS template literal, that backtick would
 * prematurely close the template — breaking the *host* `.ts` file's own JS syntax, not the
 * GraphQL inside it. These are escaped (`` ` `` → `` \` ``) rather than excluded from the corpus:
 * a backslash-escaped backtick inside a template literal evaluates back to a literal backtick in
 * the template's *cooked* value, so `@graphql-tools/graphql-tag-pluck` (which reads the cooked
 * string, not the raw source) recovers the exact original GraphQL text — verified directly:
 * relay-connection-types-0, escaped this way, produces an identical real diagnostic on both
 * engines. `\` and `${` are escaped defensively for the same reason, even though no current
 * example contains either.
 */
export function toEmbedded(graphql: string): string {
  const escaped = graphql.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");
  return `const doc = gql\`\n${escaped.trimEnd()}\n\`;\n`;
}

/**
 * Some rules' documented examples use `# ...` or a bare `...` as documentation shorthand for
 * "elided content" (e.g. no-anonymous-operations' `query { # ... }`, or
 * require-field-of-type-query-in-mutation-result's `type User { ... }`) — not real GraphQL
 * syntax (`...` only has meaning as a fragment spread, `...FragmentName`). Embedded verbatim,
 * these fail to parse at all, which both engines would report as very different-looking parse
 * failures for reasons that have nothing to do with the rule under test. Detected mechanically
 * (not by hardcoding which examples are affected) by actually running the example's raw code
 * through graphql-js's own `parse`.
 */
export function isValidStandaloneGraphQL(code: string): boolean {
  try {
    parse(code);
    return true;
  } catch {
    return false;
  }
}
