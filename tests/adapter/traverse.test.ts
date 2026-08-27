import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { traverse } from "../../src/adapter/traverse.js";
import { clearParseCache, parseDocuments } from "../../src/adapter/parse.js";
import type { GqlNode } from "../../src/adapter/types.js";

const projectDir = fileURLToPath(new URL("../fixtures/project", import.meta.url));

function node(type: string, extra: Record<string, unknown> = {}): GqlNode {
  return {
    type,
    loc: { start: { line: 1, column: 0 }, end: { line: 1, column: 1 } },
    range: [0, 1],
    ...extra,
  } as GqlNode;
}

describe("traverse", () => {
  it("visits nodes depth-first and reports enter and leave", () => {
    const root = node("Document", { definitions: [node("OperationDefinition", { name: node("Name") })] });
    const events: string[] = [];

    traverse(root, {
      enter: (n) => events.push(`enter:${n.type}`),
      leave: (n) => events.push(`leave:${n.type}`),
    });

    expect(events).toEqual([
      "enter:Document",
      "enter:OperationDefinition",
      "enter:Name",
      "leave:Name",
      "leave:OperationDefinition",
      "leave:Document",
    ]);
  });

  it("passes the ancestor chain, closest last", () => {
    const root = node("Document", { definitions: [node("OperationDefinition", { name: node("Name") })] });
    let ancestorsAtName: string[] = [];

    traverse(root, {
      enter: (n, ancestors) => {
        if (n.type === "Name") ancestorsAtName = ancestors.map((a) => a.type);
      },
      leave: () => {},
    });

    expect(ancestorsAtName).toEqual(["Document", "OperationDefinition"]);
  });

  it("ignores parent, comment keys, functions and plain values", () => {
    const child = node("Name");
    const root = node("Document", {
      definitions: [child],
      parent: node("ShouldNotVisit"),
      leadingComments: [node("Block")],
      trailingComments: [node("Line")],
      typeInfo: () => node("ShouldNotVisit"),
      kind: "Document",
      value: 42,
    });
    const visited: string[] = [];

    traverse(root, { enter: (n) => visited.push(n.type), leave: () => {} });

    expect(visited).toEqual(["Document", "Name"]);
  });

  it("traverses a real parsed AST without hanging and does not revisit nodes", () => {
    clearParseCache();

    const filePath = join(projectDir, "app.ts");
    const code = ["const q = gql`", "  query User {", "    user { id }", "  }", "`;", ""].join("\n");

    const parsed = parseDocuments({ code, filePath });
    expect(parsed[0]!.kind).toBe("parsed");
    if (parsed[0]!.kind !== "parsed") return;

    const root = parsed[0]!.ast;
    const events: Array<{ type: "enter" | "leave"; node: GqlNode }> = [];
    const visitedNodeObjects = new Set<object>();

    traverse(root, {
      enter: (node) => {
        events.push({ type: "enter", node });
        visitedNodeObjects.add(node);
      },
      leave: (node) => {
        events.push({ type: "leave", node });
      },
    });

    // Verify the traversal completed
    expect(events.length).toBeGreaterThan(0);

    // Count how many nodes were entered
    const enterEvents = events.filter((e) => e.type === "enter");
    const leaveEvents = events.filter((e) => e.type === "leave");
    expect(enterEvents.length).toBe(leaveEvents.length);

    // Check for required node types in the traversal
    const nodeTypes = new Set(enterEvents.map((e) => e.node.type));
    expect(nodeTypes.has("Document")).toBe(true);
    expect(nodeTypes.has("OperationDefinition")).toBe(true);
    expect(nodeTypes.has("Field")).toBe(true);
    expect(nodeTypes.has("Name")).toBe(true);

    // Verify no node was entered twice by checking object identity
    expect(visitedNodeObjects.size).toBe(enterEvents.length);
  });
});
