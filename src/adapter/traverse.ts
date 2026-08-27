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

let linkParentsCallCount = 0;

/** Test-only instrumentation (mirrors parse.ts's getParseCallCount/clearParseCache pattern):
 *  lets a test prove `linkParents` runs exactly once per parse, not once per `traverse()` call. */
export function getLinkParentsCallCount(): number {
  return linkParentsCallCount;
}

export function resetLinkParentsCallCount(): void {
  linkParentsCallCount = 0;
}

/**
 * Sets `.parent` for every node in the tree, once. Called from `parse.ts` immediately after
 * `parseForESLint` produces an AST — NOT from `traverse()` — so that by the time any rule's own
 * traversal (or `SourceCode#getNodeByRangeIndex`, which also calls `traverse()` internally, in a
 * loop for every comment in `no-hashtag-description`) begins, every node's `.parent` is already
 * correct. This matches real graphql-eslint/ESLint's own architecture: the whole AST is parented
 * once during parsing/conversion, decoupled from the later rule-visiting traversal.
 *
 * Without this being a separate, one-time pass, a rule listener that reaches into its own
 * not-yet-visited subtree sees `.parent === undefined` on descendants the walk hasn't reached
 * yet — e.g. `no-duplicate-fields`'s `SelectionSet(node)` listener reads
 * `node.selections[i].name.parent` directly, without visiting those nodes itself first.
 * Reproduced with `no-duplicate-fields` on a real duplicate-field query, which threw
 * `TypeError: Cannot read properties of undefined (reading 'type')`.
 *
 * `traverse()`'s own `visit()` still re-assigns the same `.parent` values as it descends, so
 * `traverse()` stays correct standalone (its own tests build plain object trees directly,
 * without going through `parse.ts`) — but doing that assignment is O(n) work folded into the
 * single listener-firing pass, not a second full O(n) pass on top of it the way calling
 * `linkParents` from inside `traverse()` would be.
 */
export function linkParents(root: GqlNode): void {
  linkParentsCallCount += 1;
  root.parent = null;
  linkChildren(root);
}

/**
 * The single definition of "what counts as a child key" for a node, shared by `linkChildren`
 * (the one-time parenting pass) and `visit` (the rule-visiting traversal). These two previously
 * each inlined the identical expression — the one real half-migration left over from splitting
 * `linkParents` out of `traverse()` (see `linkParents`' own doc comment): changing one without
 * the other would silently make "what counts as a child" diverge between them, with nothing to
 * catch it.
 */
function childKeysOf(node: GqlNode): readonly string[] {
  return KNOWN_VISITOR_KEYS[node.type] ?? Object.keys(node).filter((key) => !IGNORED_KEYS.has(key) && !key.startsWith("_"));
}

function linkChildren(node: GqlNode): void {
  const keys = childKeysOf(node);
  for (const key of keys) {
    const value = node[key];
    if (Array.isArray(value)) {
      for (const item of value) {
        if (isNode(item)) {
          item.parent = node;
          linkChildren(item);
        }
      }
    } else if (isNode(value)) {
      value.parent = node;
      linkChildren(value);
    }
  }
}

function visit(node: GqlNode, ancestors: GqlNode[], handlers: TraverseHandlers): void {
  handlers.enter(node, ancestors.slice());

  ancestors.push(node);
  const keys = childKeysOf(node);
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
