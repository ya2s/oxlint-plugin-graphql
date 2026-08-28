export default {
  meta: { name: "contract" },
  rules: {
    probe: {
      create(context) {
        return {
          Program() {
            context.report({
              message: "loc-probe",
              loc: { start: { line: 1, column: 6 }, end: { line: 1, column: 7 } },
            });
            context.report({
              message: `settings-probe:${JSON.stringify(context.settings?.graphql ?? null)}`,
              loc: { line: 2, column: 0 },
            });
          },
        };
      },
    },
    fixer: {
      meta: { fixable: "code" },
      create(context) {
        return {
          Program() {
            context.report({
              message: "fix-probe",
              loc: { start: { line: 1, column: 6 }, end: { line: 1, column: 7 } },
              fix: () => ({ range: [6, 7], text: "9" }),
            });
          },
        };
      },
    },
  },
};
