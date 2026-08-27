import { rules as graphqlEslintRules } from "@graphql-eslint/eslint-plugin";
import { describe, expect, it } from "vitest";
import { rules } from "../../src/rules.js";

describe("exposed rules", () => {
  it("exposes every graphql-eslint rule under the same name", () => {
    for (const ruleId of Object.keys(graphqlEslintRules)) {
      expect(rules[ruleId], `missing rule ${ruleId}`).toBeDefined();
    }
  });

  it("exposes at least 60 rules", () => {
    expect(Object.keys(rules).length).toBeGreaterThanOrEqual(60);
  });

  it("gives every rule a createOnce implementation", () => {
    for (const [ruleId, rule] of Object.entries(rules)) {
      expect(typeof (rule as { createOnce?: unknown }).createOnce, ruleId).toBe("function");
    }
  });
});
