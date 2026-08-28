import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { clearParseCache, getParseCallCount, parseDocuments } from "../../src/adapter/parse.js";

const projectDir = fileURLToPath(new URL("../fixtures/project", import.meta.url));
const filePath = join(projectDir, "app.ts");

const code = ["const q = gql`", "  query User {", "    user { id }", "  }", "`;", ""].join("\n");

describe("parseDocuments", () => {
  beforeEach(() => {
    clearParseCache();
  });

  it("parses each embedded document into a GraphQL ESTree program", () => {
    const parsed = parseDocuments({ code, filePath });

    expect(parsed).toHaveLength(1);
    expect(parsed[0]!.kind).toBe("parsed");
    if (parsed[0]!.kind !== "parsed") return;
    expect(parsed[0]!.ast.type).toBe("Program");
  });

  it("loads the schema from the on-disk graphql-config", () => {
    const parsed = parseDocuments({ code, filePath });

    if (parsed[0]!.kind !== "parsed") throw new Error("expected a parsed document");
    expect(parsed[0]!.services.schema?.getQueryType()?.name).toBe("Query");
  });

  it("builds the schema from settings when schemaSdl is given", () => {
    const parsed = parseDocuments({
      code: "const q = gql`{ a }`;\n",
      filePath: "/tmp/no-config/app.ts",
      schemaSdl: "type Query { a: Int }",
    });

    if (parsed[0]!.kind !== "parsed") throw new Error("expected a parsed document");
    expect(parsed[0]!.services.schema?.getQueryType()?.getFields().a).toBeDefined();
  });

  it("returns a parse error instead of throwing on invalid GraphQL", () => {
    const parsed = parseDocuments({ code: "const q = gql`query {`;\n", filePath });

    expect(parsed[0]!.kind).toBe("error");
    if (parsed[0]!.kind !== "error") return;
    expect(parsed[0]!.error.message).toContain("Syntax Error");
    expect(parsed[0]!.error.line).toBe(1);
  });

  it("parses successfully with a null schema when no graphql-config exists (parity with graphql-eslint)", () => {
    // graphql-eslint does not require a schema to be configured up front: schema availability is
    // enforced per rule at rule-execution time (`requireGraphQLSchema` / `requireGraphQLOperations`),
    // not by the parser. A project with no graphql-config at all must still parse.
    const parsed = parseDocuments({
      code: "const q = gql`{ a }`;\n",
      filePath: "/tmp/no-graphql-config/app.ts",
    });

    expect(parsed[0]!.kind).toBe("parsed");
    if (parsed[0]!.kind !== "parsed") return;
    expect(parsed[0]!.services.schema).toBeNull();
  });

  it("throws when the graphql-config schema fails to load", () => {
    const brokenSchemaDir = join(projectDir, "..", "broken-schema");

    expect(() =>
      parseDocuments({
        code: "const q = gql`{ a }`;\n",
        filePath: join(brokenSchemaDir, "app.ts"),
      }),
    ).toThrow(/Unable to find any GraphQL type definitions/);
  });

  it("loads a TypeScript graphql config file", () => {
    const tsProject = join(projectDir, "ts-config");
    const parsed = parseDocuments({ code, filePath: join(tsProject, "app.ts") });

    if (parsed[0]!.kind !== "parsed") throw new Error("expected a parsed document");
    expect(parsed[0]!.services.schema?.getQueryType()?.name).toBe("Query");
  });

  it("parses a file only once even when called repeatedly", () => {
    parseDocuments({ code, filePath });
    const afterFirst = getParseCallCount();
    parseDocuments({ code, filePath });
    parseDocuments({ code, filePath });

    expect(getParseCallCount()).toBe(afterFirst);
  });

  it("re-parses when the file content changes", () => {
    parseDocuments({ code, filePath });
    const afterFirst = getParseCallCount();
    parseDocuments({ code: code.replace("id", "name"), filePath });

    expect(getParseCallCount()).toBe(afterFirst + 1);
  });

  it("keys the cache by schemaSdl, not just filePath and code", () => {
    const sameCode = "const q = gql`{ a }`;\n";
    const sameFilePath = "/tmp/no-config/app.ts";

    const first = parseDocuments({
      code: sameCode,
      filePath: sameFilePath,
      schemaSdl: "type Query { a: Int }",
    });
    const second = parseDocuments({
      code: sameCode,
      filePath: sameFilePath,
      schemaSdl: "type Query { a: String }",
    });

    if (first[0]!.kind !== "parsed") throw new Error("expected a parsed document");
    if (second[0]!.kind !== "parsed") throw new Error("expected a parsed document");
    expect(first[0]!.services.schema?.getQueryType()?.getFields().a?.type.toString()).toBe("Int");
    expect(second[0]!.services.schema?.getQueryType()?.getFields().a?.type.toString()).toBe("String");
  });
});
