import type { GqlNode, ParserServices } from "./types.js";

/** Accepted by getText, matching how graphql-eslint rules call it with plain `{ range }` literals. */
export type RangeLike = { range: [number, number] };

export type SourceCodeShim = {
  text: string;
  ast: GqlNode;
  parserServices: ParserServices;
  getText(node?: RangeLike, beforeCount?: number, afterCount?: number): string;
  getNodeByRangeIndex(index: number): GqlNode | null;
  getAllComments(): GqlNode[];
  getCommentsBefore(node: GqlNode): GqlNode[];
  getCommentsAfter(node: GqlNode): GqlNode[];
  getTokenBefore(node: GqlNode): GqlNode | null;
  getTokenAfter(node: GqlNode): GqlNode | null;
  /**
   * With a node: walks `node.parent` up to the root, matching ESLint's SourceCode#getAncestors
   * (the only way graphql-eslint's own rules call it). Without one: falls back to the ancestors
   * closure supplied to createSourceCode, for callers that track traversal state themselves.
   */
  getAncestors(node?: GqlNode): GqlNode[];
  getLines(): string[];
};

// Root-level AST metadata that is not part of the GraphQL-ESTree's own child structure.
// `tokens` and `comments` only ever appear on the root node, and their entries happen to be
// plain objects with a `type` field, so a generic "walk anything that looks like a node" traverse
// would wrongly treat them as tree nodes. ESLint's own getNodeByRangeIndex avoids this because it
// walks via a fixed visitorKeys table instead of duck-typing; we exclude the same keys explicitly.
const NON_STRUCTURAL_KEYS = new Set(["parent", "leadingComments", "trailingComments", "tokens", "comments"]);

export function createSourceCode(options: {
  text: string;
  ast: GqlNode;
  services: ParserServices;
  getAncestors: () => GqlNode[];
}): SourceCodeShim {
  const { text, ast, services } = options;
  const comments = ((ast as { comments?: GqlNode[] }).comments ?? []).slice();
  const tokens = ((ast as { tokens?: GqlNode[] }).tokens ?? []).slice();

  return {
    text,
    ast,
    parserServices: services,
    getText: (node, beforeCount, afterCount) =>
      node
        ? text.slice(Math.max(node.range[0] - (beforeCount ?? 0), 0), node.range[1] + (afterCount ?? 0))
        : text,
    getNodeByRangeIndex: (index) => findInnermost(ast, index),
    getAllComments: () => comments,
    getCommentsBefore: (node) =>
      comments.filter((c) => c.range[1] <= node.range[0] && !hasTokenBetween(tokens, c.range[1], node.range[0])),
    getCommentsAfter: (node) =>
      comments.filter((c) => c.range[0] >= node.range[1] && !hasTokenBetween(tokens, node.range[1], c.range[0])),
    getTokenBefore: (node) => lastOrNull(tokens.filter((t) => t.range[1] <= node.range[0])),
    getTokenAfter: (node) => tokens.find((t) => t.range[0] >= node.range[1]) ?? null,
    getAncestors: (node) => (node ? ancestorsOf(node) : options.getAncestors()),
    getLines: () => text.split("\n"),
  };
}

function ancestorsOf(node: GqlNode): GqlNode[] {
  const result: GqlNode[] = [];
  for (let ancestor = node.parent; ancestor; ancestor = ancestor.parent ?? null) {
    result.push(ancestor);
  }
  return result.reverse();
}

/**
 * Finds the innermost node whose range contains `index`, matching ESLint's SourceCode#getNodeByRangeIndex:
 * a subtree is only descended into when its own range contains the index, so among nodes that tie on
 * range size (e.g. a wrapper node with the exact same range as its only child) the deeper one wins.
 */
function findInnermost(root: GqlNode, index: number): GqlNode | null {
  let found: GqlNode | null = null;

  const visit = (node: GqlNode): void => {
    if (node.range[0] > index || index >= node.range[1]) return;
    if (!found || node.range[1] - node.range[0] <= found.range[1] - found.range[0]) found = node;
    for (const key of Object.keys(node)) {
      if (NON_STRUCTURAL_KEYS.has(key) || key.startsWith("_")) continue;
      const value = (node as Record<string, unknown>)[key];
      if (Array.isArray(value)) {
        for (const item of value) if (isNode(item)) visit(item);
      } else if (isNode(value)) {
        visit(value);
      }
    }
  };

  visit(root);
  return found;
}

function isNode(value: unknown): value is GqlNode {
  return typeof value === "object" && value !== null && typeof (value as { type?: unknown }).type === "string";
}

function hasTokenBetween(tokens: GqlNode[], start: number, end: number): boolean {
  return tokens.some((token) => token.range[0] >= start && token.range[1] <= end);
}

function lastOrNull(nodes: GqlNode[]): GqlNode | null {
  return nodes.length > 0 ? nodes[nodes.length - 1]! : null;
}
