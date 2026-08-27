import type { GqlNode } from "./types.js";

const IGNORED_KEYS = new Set(["parent", "leadingComments", "trailingComments"]);

// Mirrors eslint-visitor-keys' table (visitor-keys.json: `Program: ["body"]`) for node types whose
// duck-typed fields would otherwise be walked as children. graphql-eslint's parsed root is a real
// ESTree "Program" node that also carries `tokens`/`comments` arrays of plain `{ type, range }`
// objects — exactly what `isNode()` below treats as a node. ESLint's own traverser never descends
// into those because it consults a fixed visitor-key table first and only falls back to duck-typing
// for node types the table doesn't know, which is what happens here for every GraphQL-specific type.
const KNOWN_VISITOR_KEYS: Record<string, readonly string[]> = {
  Program: ["body"],
};

export type TraverseHandlers = {
  enter(node: GqlNode, ancestors: GqlNode[]): void;
  leave(node: GqlNode, ancestors: GqlNode[]): void;
};

export function traverse(root: GqlNode, handlers: TraverseHandlers): void {
  root.parent = null;
  const ancestors: GqlNode[] = [];
  visit(root, ancestors, handlers);
}

function visit(node: GqlNode, ancestors: GqlNode[], handlers: TraverseHandlers): void {
  handlers.enter(node, ancestors.slice());

  ancestors.push(node);
  const keys = KNOWN_VISITOR_KEYS[node.type] ?? Object.keys(node).filter((key) => !IGNORED_KEYS.has(key) && !key.startsWith("_"));
  for (const key of keys) {
    const value = node[key];
    if (Array.isArray(value)) {
      for (const item of value) {
        if (isNode(item)) {
          item.parent = node;
          visit(item, ancestors, handlers);
        }
      }
    } else if (isNode(value)) {
      value.parent = node;
      visit(value, ancestors, handlers);
    }
  }
  ancestors.pop();

  handlers.leave(node, ancestors.slice());
}

function isNode(value: unknown): value is GqlNode {
  return typeof value === "object" && value !== null && typeof (value as { type?: unknown }).type === "string";
}
