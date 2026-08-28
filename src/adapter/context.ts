import type { GqlReportDescriptor } from "./report-mapper.js";
import type { SourceCodeShim } from "./source-code.js";

export type RuleContextShim = {
  id: string;
  options: readonly unknown[];
  settings: Readonly<Record<string, unknown>>;
  filename: string;
  physicalFilename: string;
  sourceCode: SourceCodeShim;
  parserServices: SourceCodeShim["parserServices"];
  getSourceCode(): SourceCodeShim;
  getFilename(): string;
  report(descriptor: GqlReportDescriptor): void;
};

export function createRuleContext(options: {
  ruleId: string;
  options: readonly unknown[];
  settings: Readonly<Record<string, unknown>>;
  filename: string;
  physicalFilename: string;
  sourceCode: SourceCodeShim;
  report: (descriptor: GqlReportDescriptor) => void;
}): RuleContextShim {
  return {
    id: options.ruleId,
    options: options.options,
    settings: options.settings,
    filename: options.filename,
    physicalFilename: options.physicalFilename,
    sourceCode: options.sourceCode,
    parserServices: options.sourceCode.parserServices,
    getSourceCode: () => options.sourceCode,
    getFilename: () => options.filename,
    report: options.report,
  };
}
