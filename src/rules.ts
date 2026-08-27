import { rules as graphqlEslintRules } from "@graphql-eslint/eslint-plugin";
import type { Rule } from "@oxlint/plugins";
import { toOxlintRule } from "./adapter/rule-factory.js";
import type { GraphQLESLintRuleLike } from "./adapter/rule-factory.js";
import { PARSE_ERROR_RULE_ID, parseErrorRule } from "./rules/parse-error.js";

export const rules: Record<string, Rule> = {
  ...Object.fromEntries(
    Object.entries(graphqlEslintRules as unknown as Record<string, GraphQLESLintRuleLike>).map(
      ([ruleId, rule]) => [ruleId, toOxlintRule(ruleId, rule)],
    ),
  ),
  [PARSE_ERROR_RULE_ID]: parseErrorRule,
};
