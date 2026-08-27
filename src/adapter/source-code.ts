import { traverse } from "./traverse.js";
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
  /** Walks `node.parent` up to the root, matching ESLint's SourceCode#getAncestors exactly, including
   *  throwing when called without a node — the only way graphql-eslint's own rules call it. */
  getAncestors(node: GqlNode): GqlNode[];
  getLines(): string[];
};

export function createSourceCode(options: {
  text: string;
  ast: GqlNode;
  services: ParserServices;
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
    getAncestors: (node) => {
      if (!node) throw new TypeError("Missing required argument: node.");
      return ancestorsOf(node);
    },
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
 * Uses the shared `traverse()` — safe now that it restricts "Program" to its real `body` key, so it
 * never walks the root's `tokens`/`comments` arrays as if they were AST nodes.
 */
function findInnermost(root: GqlNode, index: number): GqlNode | null {
  let found: GqlNode | null = null;
  traverse(root, {
    enter: (node) => {
      if (node.range[0] <= index && index < node.range[1]) {
        if (!found || node.range[1] - node.range[0] <= found.range[1] - found.range[0]) {
          found = node;
        }
      }
    },
    leave: () => {},
  });
  return found;
}

function hasTokenBetween(tokens: GqlNode[], start: number, end: number): boolean {
  return tokens.some((token) => token.range[0] >= start && token.range[1] <= end);
}

function lastOrNull(nodes: GqlNode[]): GqlNode | null {
  return nodes.length > 0 ? nodes[nodes.length - 1]! : null;
}
