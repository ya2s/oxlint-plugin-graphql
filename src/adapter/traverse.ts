import type { GqlNode } from "./types.js";

const IGNORED_KEYS = new Set(["parent", "leadingComments", "trailingComments"]);

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
  for (const key of Object.keys(node)) {
    if (IGNORED_KEYS.has(key) || key.startsWith("_")) continue;
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
