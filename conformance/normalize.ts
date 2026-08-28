import type { EslintRunResult } from "./run-eslint.js";
import type { OxlintDiagnostic } from "../tests/helpers/run-oxlint.js";
import type { OxlintRunResult } from "./run-oxlint.js";

export type NormalizedDiagnostic = {
  ruleId: string;
  line: number;
  column: number;
  endLine: number | null;
  endColumn: number | null;
  message: string;
};

export type EslintMessage = {
  ruleId: string | null;
  line?: number;
  column?: number;
  endLine?: number;
  endColumn?: number;
  message: string;
};

/**
 * Either side's result for one case, normalized to a shape that can be compared directly:
 * `"diagnostics"` when linting completed (possibly with zero diagnostics), `"error"` when the
 * rule itself threw. Kept as a tagged union — rather than folding a thrown error into an empty
 * diagnostics array — specifically so "both sides errored" can never collapse into "both sides
 * agree there's nothing to report": the two are different outcomes, and conformance.test.ts
 * treats them differently (see its `classifyOutcome`).
 */
export type NormalizedOutcome =
  | { kind: "diagnostics"; diagnostics: NormalizedDiagnostic[] }
  | { kind: "error"; message: string };

export function normalizeEslint(messages: EslintMessage[]): NormalizedDiagnostic[] {
  return messages
    .map((message) => ({
      ruleId: (message.ruleId ?? "").replace("@graphql-eslint/", ""),
      line: message.line ?? 0,
      column: message.column ?? 0,
      endLine: message.endLine ?? null,
      endColumn: message.endColumn ?? null,
      message: message.message,
    }))
    .sort(byPosition);
}

export function normalizeOxlint(diagnostics: OxlintDiagnostic[], text: string): NormalizedDiagnostic[] {
  return diagnostics
    .map((diagnostic) => {
      const span = diagnostic.labels[0]!.span;
      const end = offsetToLineColumn(text, span.offset + span.length);
      return {
        ruleId: diagnostic.code.replace(/^graphql\((.*)\)$/, "$1"),
        line: span.line,
        column: span.column,
        endLine: span.length > 0 ? end.line : null,
        endColumn: span.length > 0 ? end.column : null,
        message: diagnostic.message,
      };
    })
    .sort(byPosition);
}

export function normalizeEslintOutcome(result: EslintRunResult): NormalizedOutcome {
  if (result.kind === "error") return { kind: "error", message: result.message };
  return { kind: "diagnostics", diagnostics: normalizeEslint(result.messages) };
}

export function normalizeOxlintOutcome(result: OxlintRunResult, text: string): NormalizedOutcome {
  if (result.kind === "error") return { kind: "error", message: result.message };
  return { kind: "diagnostics", diagnostics: normalizeOxlint(result.diagnostics, text) };
}

function byPosition(a: NormalizedDiagnostic, b: NormalizedDiagnostic): number {
  return a.line - b.line || a.column - b.column || a.ruleId.localeCompare(b.ruleId);
}

export function offsetToLineColumn(text: string, offset: number): { line: number; column: number } {
  const before = text.slice(0, offset);
  const lines = before.split("\n");
  return { line: lines.length, column: (lines[lines.length - 1]?.length ?? 0) + 1 };
}
