import { describe, expect, it } from "vitest";
import { extractDocuments } from "../../src/adapter/documents.js";

describe("extractDocuments", () => {
  it("returns nothing when the file has no GraphQL keyword", () => {
    expect(extractDocuments("const a = 1;\n", "/repo/app.ts")).toEqual([]);
  });

  it("extracts a gql tagged template with its line and character offsets", () => {
    const code = ["import { gql } from 'graphql-tag';", "", "const q = gql`", "  { id }", "`;", ""].join("\n");
    const documents = extractDocuments(code, "/repo/app.ts");

    expect(documents).toHaveLength(1);
    expect(documents[0]!.text).toBe("\n  { id }\n");
    expect(documents[0]!.lineOffset).toBe(2);
    expect(code.slice(documents[0]!.offset, documents[0]!.offset + documents[0]!.text.length)).toBe("\n  { id }\n");
  });

  it("names virtual documents the way ESLint's processor does", () => {
    const code = ["const a = gql`{ id }`;", "const b = gql`{ name }`;"].join("\n");
    const documents = extractDocuments(code, "/repo/app.ts");

    expect(documents.map((d) => d.filePath)).toEqual([
      "/repo/app.ts/0_document.graphql",
      "/repo/app.ts/1_document.graphql",
    ]);
  });

  it("returns nothing instead of throwing when the JS itself cannot be parsed", () => {
    expect(extractDocuments("const a = gql`{ id }`; function (", "/repo/app.ts")).toEqual([]);
  });
});
