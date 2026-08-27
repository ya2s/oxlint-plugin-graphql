import type { GraphQLSchema } from "graphql";

export type EmbeddedDocument = {
  /** ESLint の processor 規約に合わせた仮想ファイルパス */
  filePath: string;
  text: string;
  /** 報告された line に加算する値 */
  lineOffset: number;
  /** 報告された range に加算する値 */
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
  /** 埋め込みドキュメント内の 1-based 行 */
  line: number;
  /** 埋め込みドキュメント内の 0-based 列 */
  column: number;
};

export type ParsedDocument =
  | { kind: "parsed"; document: EmbeddedDocument; ast: GqlNode; services: ParserServices }
  | { kind: "error"; document: EmbeddedDocument; error: ParseError };
