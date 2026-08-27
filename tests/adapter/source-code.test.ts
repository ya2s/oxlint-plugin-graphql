import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { clearParseCache, parseDocuments } from "../../src/adapter/parse.js";
import { createSourceCode } from "../../src/adapter/source-code.js";
import { traverse } from "../../src/adapter/traverse.js";
import type { GqlNode } from "../../src/adapter/types.js";

const filePath = join(fileURLToPath(new URL("../fixtures/project", import.meta.url)), "app.ts");

const code = [
  "const q = gql`",
  "  # a comment",
  "  query User {",
  "    user { id }",
  "  }",
  "`;",
  "",
].join("\n");

function setup() {
  const parsed = parseDocuments({ code, filePath });
  if (parsed[0]!.kind !== "parsed") throw new Error("expected a parsed document");
  const { ast, services, document } = parsed[0]!;
  const sourceCode = createSourceCode({
    text: document.text,
    ast,
    services,
    getAncestors: () => [],
  });
  return { sourceCode, ast, text: document.text };
}

describe("createSourceCode", () => {
  beforeEach(() => {
    clearParseCache();
  });

  it("returns the whole text when no node is given", () => {
    const { sourceCode, text } = setup();
    expect(sourceCode.getText()).toBe(text);
  });

  it("returns the slice covered by a node's range", () => {
    const { sourceCode, ast } = setup();
    const operation = findNode(ast, "OperationDefinition")!;
    expect(sourceCode.getText(operation)).toContain("query User");
  });

  it("pads the slice by beforeCount/afterCount, mirroring ESLint's getText(node, before, after)", () => {
    const { sourceCode, ast, text } = setup();
    const operation = findNode(ast, "OperationDefinition")!;
    const name = findNode(operation, "Name")!;
    // name covers "User" ([23, 27)); one char of padding on each side pulls in the surrounding spaces.
    expect(sourceCode.getText(name, 1, 1)).toBe(text.slice(name.range[0] - 1, name.range[1] + 1));
    expect(sourceCode.getText(name, 1, 1)).toBe(" User ");
  });

  it("accepts a plain { range } object, as alphabetize and no-anonymous-operations call it", () => {
    const { sourceCode, ast } = setup();
    const operation = findNode(ast, "OperationDefinition")!;
    const firstChar = sourceCode.getText({ range: [operation.range[0], operation.range[0] + 1] });
    expect(firstChar).toBe("q");
  });

  it("finds the innermost node containing a character index", () => {
    const { sourceCode, ast, text } = setup();
    const index = text.indexOf("User");
    const found = sourceCode.getNodeByRangeIndex(index);

    expect(found).not.toBeNull();
    expect(found!.range[0]).toBeLessThanOrEqual(index);
    expect(found!.range[1]).toBeGreaterThan(index);
    expect(sourceCode.getText(found!)).toBe("User");
    void ast;
  });

  it("prefers the deeper node when a parent and child share an identical range", () => {
    const { sourceCode } = setup();
    // The parsed root (type "Program") and its sole child (type "Document") both cover [0, 50):
    // measured via parseForESLint on this fixture. ESLint's own getNodeByRangeIndex always returns
    // the deepest node it descends into, so the tie must resolve to "Document", not "Program".
    const found = sourceCode.getNodeByRangeIndex(0);
    expect(found?.type).toBe("Document");
  });

  it("never returns a raw token as if it were an AST node", () => {
    const { sourceCode, ast } = setup();
    // Index 44 sits on the inner closing "}" token (range [44, 45)), which is the same size as no
    // real AST node there. A naive traversal that also walks ast.tokens (their entries are plain
    // objects with a `type` field, e.g. { type: "}", range: [44, 45] }) would tie against the real
    // SelectionSet and could return the token instead. Measured expectation: the real SelectionSet.
    const found = sourceCode.getNodeByRangeIndex(44);
    expect(found?.type).toBe("SelectionSet");
    expect(found?.range).toEqual([39, 45]);
    void ast;
  });

  it("exposes comments and parser services", () => {
    const { sourceCode } = setup();
    expect(sourceCode.getAllComments().map((c) => c.type)).toContain("Line");
    expect(sourceCode.parserServices.schema).not.toBeNull();
  });

  it("returns the token immediately before and after a node", () => {
    const { sourceCode, ast } = setup();
    const operation = findNode(ast, "OperationDefinition")!;
    const name = findNode(operation, "Name")!;

    expect(sourceCode.getTokenBefore(name)?.value).toBe("query");
    // Punctuation tokens carry no `value` (measured: { type: "{", range: [28, 29] }, no `value` key)
    // — only Name tokens do — so parity with the real parser output means asserting on `type` here.
    expect(sourceCode.getTokenAfter(name)?.type).toBe("{");
  });

  it("returns the contiguous run of comments before a node, stopping at the nearest real token", () => {
    const { sourceCode, ast } = setup();
    const operation = findNode(ast, "OperationDefinition")!;
    const name = findNode(operation, "Name")!;

    // The comment sits directly before "query" with no token in between, so it counts as "before"
    // the OperationDefinition (whose range starts at the same position as the "query" token).
    expect(sourceCode.getCommentsBefore(operation).map((c) => c.value)).toEqual([" a comment"]);
    // But the "query" token itself sits between the comment and the Name node ("User"), so from
    // Name's perspective there is no comment directly before it.
    expect(sourceCode.getCommentsBefore(name)).toEqual([]);
  });

  it("returns the contiguous run of comments after a node", () => {
    const trailingCode = [
      "const q2 = gql`",
      "  query Second {",
      "    user { id }",
      "  }",
      "  # trailing",
      "`;",
      "",
    ].join("\n");
    const parsed = parseDocuments({ code: trailingCode, filePath });
    if (parsed[0]!.kind !== "parsed") throw new Error("expected a parsed document");
    const sourceCode = createSourceCode({
      text: parsed[0]!.document.text,
      ast: parsed[0]!.ast,
      services: parsed[0]!.services,
      getAncestors: () => [],
    });
    const operation = findNode(parsed[0]!.ast, "OperationDefinition")!;

    expect(sourceCode.getCommentsAfter(operation).map((c) => c.value)).toEqual([" trailing"]);
  });

  it("delegates getAncestors() to the traversal state when called with no node", () => {
    const parsed = parseDocuments({ code, filePath });
    if (parsed[0]!.kind !== "parsed") throw new Error("expected a parsed document");
    const marker = { type: "Document" } as GqlNode;
    const sourceCode = createSourceCode({
      text: parsed[0]!.document.text,
      ast: parsed[0]!.ast,
      services: parsed[0]!.services,
      getAncestors: () => [marker],
    });

    expect(sourceCode.getAncestors()).toEqual([marker]);
  });

  it("computes getAncestors(node) by walking node.parent, as ESLint's SourceCode#getAncestors does", () => {
    const { sourceCode, ast } = setup();
    // ESLint's real getAncestors(node) ignores any "current traversal" state and walks node.parent
    // up to the root (throwing if node.parent chain has never been wired). graphql-eslint's own
    // rules call it exactly this way: `context.sourceCode.getAncestors(node)` (selection-set-depth).
    traverse(ast, { enter: () => {}, leave: () => {} });
    const operation = findNode(ast, "OperationDefinition")!;
    const name = findNode(operation, "Name")!;

    const ancestors = sourceCode.getAncestors(name);

    expect(ancestors.map((a) => a.type)).toEqual(["Program", "Document", "OperationDefinition"]);
    expect(ancestors[ancestors.length - 1]).toBe(operation);
  });
});

function findNode(root: GqlNode, type: string): GqlNode | null {
  if (root.type === type) return root;
  for (const key of Object.keys(root)) {
    if (key === "parent") continue;
    const value = root[key];
    const children = Array.isArray(value) ? value : [value];
    for (const child of children) {
      if (typeof child === "object" && child !== null && typeof (child as GqlNode).type === "string") {
        const found = findNode(child as GqlNode, type);
        if (found) return found;
      }
    }
  }
  return null;
}
