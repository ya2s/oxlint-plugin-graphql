import type { GraphQLSchema } from "graphql";

export type EmbeddedDocument = {
  /** Virtual file path, following ESLint's processor convention. */
  filePath: string;
  text: string;
  /** Added to a reported line number. */
  lineOffset: number;
  /** Added to a reported range. */
  offset: number;
};

export type GqlLoc = {
  start: { line: number; column: number };
  end: { line: number; column: number };
};

export type GqlNode = {
  type: string;
  loc: GqlLoc;
  range: [number, number];
  parent: GqlNode | null | undefined;
  [key: string]: unknown;
};

export type ParserServices = {
  schema: GraphQLSchema | null;
  siblingOperations: unknown;
};

export type ParseError = {
  message: string;
  /** 1-based line within the embedded document. */
  line: number;
  /** 0-based column within the embedded document. */
  column: number;
};

export type ParsedDocument =
  | { kind: "parsed"; document: EmbeddedDocument; ast: GqlNode; services: ParserServices }
  | { kind: "error"; document: EmbeddedDocument; error: ParseError };
