import { join } from "node:path";
import { processors } from "@graphql-eslint/eslint-plugin";
import type { EmbeddedDocument } from "./types.js";

type ProcessorBlock = { filename: string; text: string; lineOffset: number; offset: number };

export function extractDocuments(code: string, filePath: string): EmbeddedDocument[] {
  const blocks = processors.graphql.preprocess(code, filePath) as Array<string | ProcessorBlock>;

  const documents: EmbeddedDocument[] = [];
  for (const block of blocks) {
    if (typeof block === "string") continue;
    documents.push({
      filePath: join(filePath, `${documents.length}_${block.filename}`),
      text: block.text,
      lineOffset: block.lineOffset,
      offset: block.offset,
    });
  }
  return documents;
}
