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
  linkParents(root);
  const ancestors: GqlNode[] = [];
  visit(root, ancestors, handlers);
}

/**
 * Sets `.parent` for every node in the tree before any listener runs. Real graphql-eslint
 * parents the whole AST once during conversion, before any rule's own traversal begins, so a
 * listener that reaches into its own not-yet-visited subtree always sees `.parent` already set
 * on those descendants — e.g. `no-duplicate-fields`'s `SelectionSet(node)` listener reads
 * `node.selections[i].name.parent` directly, without visiting those nodes itself first.
 * `visit()` below re-assigns the same `.parent` values as it descends (harmless, and left in
 * place so `visit()` stays correct standalone), but without this separate up-front pass a
 * listener firing on an ancestor would see `.parent === undefined` on any child it inspects
 * before the walk reaches it — reproduced with `no-duplicate-fields` on a real duplicate-field
 * query, which threw `TypeError: Cannot read properties of undefined (reading 'type')`.
 */
function linkParents(node: GqlNode): void {
  const keys = KNOWN_VISITOR_KEYS[node.type] ?? Object.keys(node).filter((key) => !IGNORED_KEYS.has(key) && !key.startsWith("_"));
  for (const key of keys) {
    const value = node[key];
    if (Array.isArray(value)) {
      for (const item of value) {
        if (isNode(item)) {
          item.parent = node;
          linkParents(item);
        }
      }
    } else if (isNode(value)) {
      value.parent = node;
      linkParents(value);
    }
  }
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
