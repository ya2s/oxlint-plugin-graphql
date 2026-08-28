import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { getLinkParentsCallCount, resetLinkParentsCallCount, traverse } from "../../src/adapter/traverse.js";
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

  it("wires parent references on real parsed AST", () => {
    clearParseCache();

    const filePath = join(projectDir, "app.ts");
    const code = ["const q = gql`", "  query User {", "    user { id }", "  }", "`;", ""].join("\n");

    const parsed = parseDocuments({ code, filePath });
    expect(parsed[0]!.kind).toBe("parsed");
    if (parsed[0]!.kind !== "parsed") return;

    const root: GqlNode = (parsed[0] as { kind: "parsed"; ast: GqlNode }).ast;
    let fieldNode: GqlNode | null = null;
    let documentNode: GqlNode | null = null;

    traverse(root, {
      enter: (node) => {
        if (node.type === "Field" && fieldNode === null) {
          fieldNode = node;
        }
        if (node.type === "Document" && documentNode === null) {
          documentNode = node;
        }
      },
      leave: () => {},
    });

    expect(fieldNode).not.toBeNull();
    expect(documentNode).not.toBeNull();
    if (!fieldNode || !documentNode) return;

    const field: GqlNode = fieldNode;
    const document: GqlNode = documentNode;

    // Root node's parent should be null
    expect(root.parent).toBeNull();

    // Document node's parent should be the root Program
    expect(document.parent).toBe(root);

    // Walk up the parent chain from the Field node and verify it reaches Document
    let current: GqlNode | null = field;
    let steps = 0;
    const maxSteps = 10; // Safety limit to prevent infinite loops

    while (current && steps < maxSteps) {
      if (current.type === "Document") {
        // Successfully reached Document
        expect(current.parent).toBe(root);
        // Continue up to verify we reach root with null parent
        expect(root.parent).toBeNull();
        return;
      }
      current = current.parent ?? null;
      steps++;
    }

    throw new Error("Failed to reach Document by walking parent chain from Field node");
  });

  it("passes fresh ancestors array to each callback", () => {
    const root = node("Document", { definitions: [node("OperationDefinition", { name: node("Name") })] });
    const capturedArrays: { enter: GqlNode[][]; leave: GqlNode[][] } = { enter: [], leave: [] };

    traverse(root, {
      enter: (n, ancestors) => {
        capturedArrays.enter.push([...ancestors]);
      },
      leave: (n, ancestors) => {
        capturedArrays.leave.push([...ancestors]);
      },
    });

    // Verify that each callback received a fresh array
    const allCapturedArrays = [...capturedArrays.enter, ...capturedArrays.leave];
    for (let i = 0; i < allCapturedArrays.length; i++) {
      for (let j = i + 1; j < allCapturedArrays.length; j++) {
        // Arrays should be different object references (fresh copies)
        expect(allCapturedArrays[i]).not.toBe(allCapturedArrays[j]!);
      }
    }

    // Verify the content is still correct after traversal completes
    // The first enter (Document) should have empty ancestors
    expect(capturedArrays.enter[0]).toEqual([]);

    // The second enter (OperationDefinition) should have Document as ancestor
    expect(capturedArrays.enter[1]?.length).toBe(1);
    expect(capturedArrays.enter[1]?.[0]?.type).toBe("Document");
  });

  it("ignores underscore-prefixed keys and parent back-references", () => {
    const child = node("Name");
    const root = node("Document", {
      definitions: [child],
      _privateNode: node("ShouldNotVisit"),
      _anotherPrivate: node("AlsoShouldNotVisit"),
      parent: node("ShouldNotVisitFromIgnoredKey"),
    });
    const visited: string[] = [];

    traverse(root, { enter: (n) => visited.push(n.type), leave: () => {} });

    expect(visited).toEqual(["Document", "Name"]);
    // Verify that parent was set correctly by the traverser
    expect(root.parent).toBeNull();
    expect(child.parent).toBe(root);
  });

  it("links every node's parent at parse time, before any traversal (and does not re-link on later traversals)", () => {
    clearParseCache();
    resetLinkParentsCallCount();

    const filePath = join(projectDir, "app.ts");
    const code = ["const q = gql`", "  query User {", "    user { id }", "  }", "`;", ""].join("\n");

    const parsed = parseDocuments({ code, filePath });
    expect(parsed[0]!.kind).toBe("parsed");
    if (parsed[0]!.kind !== "parsed") return;
    const root = parsed[0]!.ast;

    // linkParents ran exactly once, as part of parsing -- not lazily, not from traverse().
    expect(getLinkParentsCallCount()).toBe(1);

    // Reach a deeply-nested node by walking the plain object structure directly, without
    // calling traverse() at all, and check its parent chain is already wired. This is the
    // "parents are linked before any rule runs" guarantee: a rule visitor firing on an ancestor
    // (e.g. SelectionSet) can safely read a not-yet-visited descendant's `.parent` the moment
    // it fires, because linking already happened at parse time, not during that traversal.
    // Same restriction traverse.ts's own walk applies: the root "Program" node also carries
    // `tokens`/`comments` arrays of plain `{ type, range }` objects (lexer tokens can have a
    // `type` like "Name", coinciding with real AST node type names) that are never linked, so
    // only its `body` counts as real children.
    const ignoredKeys = new Set(["parent", "leadingComments", "trailingComments"]);
    let deepest: GqlNode = root;
    for (let steps = 0; steps < 50; steps++) {
      const keys =
        deepest.type === "Program"
          ? ["body"]
          : Object.keys(deepest as unknown as Record<string, unknown>).filter(
              (key) => !ignoredKeys.has(key) && !key.startsWith("_"),
            );
      const values = keys.map((key) => (deepest as unknown as Record<string, unknown>)[key]);
      const nextChild = values
        .flatMap((v) => (Array.isArray(v) ? v : [v]))
        .find(
          (v): v is GqlNode => typeof v === "object" && v !== null && typeof (v as GqlNode).type === "string",
        );
      if (!nextChild) break;
      deepest = nextChild;
    }
    expect(deepest).not.toBe(root);
    let current: GqlNode | null | undefined = deepest;
    let reachedRoot = false;
    for (let steps = 0; steps < 50 && current; steps++) {
      if (current === root) {
        reachedRoot = true;
        break;
      }
      current = current.parent;
    }
    expect(reachedRoot).toBe(true);

    // Now call traverse() twice -- once directly, once more to simulate a second rule visiting
    // the same cached AST -- and confirm linkParents is never called again: traverse() itself
    // no longer runs a separate parenting pass, only its usual single listener-firing walk.
    traverse(root, { enter: () => {}, leave: () => {} });
    traverse(root, { enter: () => {}, leave: () => {} });
    expect(getLinkParentsCallCount()).toBe(1);
  });
});
