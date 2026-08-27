import { defineRule } from "@oxlint/plugins";
import type { Rule } from "@oxlint/plugins";
import { parseDocuments } from "../adapter/parse.js";
import { readSchemaSdl } from "../adapter/rule-factory.js";

export const PARSE_ERROR_RULE_ID = "parse-error";

export const parseErrorRule: Rule = defineRule({
  meta: {
    docs: {
      description:
        "Report GraphQL syntax errors found in embedded documents. Replaces ESLint's fatal parsing message.",
    },
  },
  createOnce(context) {
    return {
      Program() {
        const parsed = parseDocuments({
          code: context.sourceCode.text,
          filePath: context.physicalFilename,
          schemaSdl: readSchemaSdl(context.settings as Readonly<Record<string, unknown>>),
        });

        for (const document of parsed) {
          if (document.kind !== "error") continue;
          context.report({
            message: document.error.message,
            loc: {
              line: document.error.line + document.document.lineOffset,
              column: document.error.column,
            },
          });
        }
      },
    };
  },
} as Parameters<typeof defineRule>[0]);
