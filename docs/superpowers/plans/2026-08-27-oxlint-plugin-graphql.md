# oxlint-plugin-graphql Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `@graphql-eslint/eslint-plugin` の全ルールを oxlint 上で実行できる npm 公開パッケージ `oxlint-plugin-graphql` を作る。

**Architecture:** graphql-eslint の parser（`parseForESLint`）と processor（`processor.preprocess`）は ESLint 非依存の純関数なのでそのまま再利用し、ESLint ランタイムの代役（`SourceCode` / `context` / AST walker / 座標変換）だけを自作する。各ルールは oxlint の `Program` visitor で発火し、JS AST は参照しない。互換性は「全ルールの `meta.docs.examples` から生成したコーパスを ESLint 経路と oxlint 経路の両方で走らせて診断を完全一致比較する」conformance テストで担保する。

**Tech Stack:** TypeScript / ESM / pnpm / tsdown（rolldown 内蔵）/ vitest / oxlint 1.80 / `@oxlint/plugins` / `@graphql-eslint/eslint-plugin` 4.4 / graphql 16

**Spec:** `docs/superpowers/specs/2026-08-27-oxlint-plugin-graphql-design.md`

## Global Constraints

- `engines.node`: `">=22.12.0"`。開発環境（`.node-version`）は 24。CI マトリクスは 22.12 / 24 / 26。
- ESM のみ。CJS 出力は作らない。
- ビルドは tsdown。`typescript` は `^7.0.0` を使う。rolldown-plugin-dts が TS 7 で失敗する場合のみ `^5.9.0` に下げる（その判断は Task 1 で行い、決めた側を package.json に固定する）。
- dependencies は `@oxlint/plugins` のみ。`@graphql-eslint/eslint-plugin` と `graphql` は peerDependencies。`eslint` は devDependencies のみ（conformance の参照実装用）で、runtime 依存に入れない。
- `eslint` は `^9`（graphql-eslint 4.4 が想定する系列、oxlint が互換を主張する系列）に固定する。
- プラグイン名は `graphql`。ルール ID は `graphql/<本家と同名>`。
- ルール実装・config の内容は graphql-eslint から機械的に導出する。ルール名や既定値をハードコードした一覧は作らない（本家更新に自動追従させるため）。
- `context.report` の `loc.column` は 0-based（ESLint と同一、検証済み）。座標変換で column は触らず、line と range のみ補正する。
- 仮想ドキュメントのファイルパスは ESLint の processor 規約に合わせ `<ホストファイルの絶対パス>/<index>_document.graphql` とする。graphql-eslint の `VIRTUAL_DOCUMENT_REGEX`（`/[/\\]\d+_document.graphql$/`）がこの形を前提にしているため。
- コミットは各タスクの最後に 1 回。コミットメッセージは英語。

---

### Task 1: プロジェクト初期化と oxlint 契約テスト

oxlint 側の前提（`loc` 基準、`settings`、`Program` 発火、`--fix` の range 解釈）を**恒久的な E2E テスト**として固定する。oxlint を上げたときに前提が壊れたら即座に落ちるようにするのが目的。

**Files:**
- Create: `package.json`, `tsconfig.json`, `tsdown.config.ts`, `vitest.config.ts`, `.node-version`, `.gitignore`
- Create: `tests/contract/fixtures/plugin.js`
- Create: `tests/contract/fixtures/.oxlintrc.json`
- Create: `tests/contract/fixtures/target.js`
- Create: `tests/helpers/run-oxlint.ts`
- Test: `tests/contract/oxlint-contract.test.ts`

**Interfaces:**
- Consumes: なし（最初のタスク）
- Produces:
  - `tests/helpers/run-oxlint.ts` から `runOxlint(options: { cwd: string; args?: string[] }): OxlintResult`
  - `type OxlintResult = { diagnostics: OxlintDiagnostic[]; stderr: string; exitCode: number }`
  - `type OxlintDiagnostic = { message: string; code: string; severity: string; filename: string; labels: Array<{ label?: string; span: { offset: number; length: number; line: number; column: number } }> }`

- [ ] **Step 1: プロジェクトファイルを作る**

`package.json`:

```json
{
  "name": "oxlint-plugin-graphql",
  "version": "0.0.0",
  "description": "Run @graphql-eslint/eslint-plugin rules on oxlint",
  "license": "MIT",
  "type": "module",
  "engines": { "node": ">=22.12.0" },
  "packageManager": "pnpm@11.24.0",
  "files": ["dist"],
  "exports": {
    ".": "./dist/index.js",
    "./configs/*": "./dist/configs/*"
  },
  "scripts": {
    "build": "tsdown",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@oxlint/plugins": "^1.80.0"
  },
  "peerDependencies": {
    "@graphql-eslint/eslint-plugin": "^4.4.1",
    "graphql": "^16"
  },
  "devDependencies": {
    "@graphql-eslint/eslint-plugin": "^4.4.1",
    "@types/node": "^22.12.0",
    "eslint": "^9",
    "graphql": "^16",
    "oxlint": "^1.80.0",
    "tsdown": "^0.22.14",
    "typescript": "^7.0.0",
    "vitest": "^4.1.0"
  }
}
```

`tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "es2023",
    "lib": ["es2023"],
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "declaration": true,
    "skipLibCheck": true,
    "verbatimModuleSyntax": true,
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["src", "tests", "scripts", "conformance"]
}
```

`tsdown.config.ts`:

```ts
import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  target: "node22.12",
});
```

`vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts", "conformance/**/*.test.ts"],
    testTimeout: 60_000,
  },
});
```

`.node-version`:

```
24
```

`.gitignore`:

```
node_modules
dist
```

- [ ] **Step 2: 依存をインストールする**

Run: `pnpm install`
Expected: 成功。`typescript@7` で `pnpm typecheck` が通ることも確認する。通らない場合のみ `typescript` を `^5.9.0` に下げて再実行し、下げた事実をコミットメッセージに書く。

- [ ] **Step 3: oxlint 実行ヘルパを書く**

`tests/helpers/run-oxlint.ts`:

```ts
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const OXLINT_BIN = join(fileURLToPath(new URL("../..", import.meta.url)), "node_modules/.bin/oxlint");

export type OxlintSpan = { offset: number; length: number; line: number; column: number };

export type OxlintDiagnostic = {
  message: string;
  code: string;
  severity: string;
  filename: string;
  labels: Array<{ label?: string; span: OxlintSpan }>;
};

export type OxlintResult = {
  diagnostics: OxlintDiagnostic[];
  stderr: string;
  exitCode: number;
};

export function runOxlint(options: { cwd: string; args?: string[] }): OxlintResult {
  const args = ["-c", ".oxlintrc.json", "-f", "json", ...(options.args ?? ["."])];
  let stdout = "";
  let stderr = "";
  let exitCode = 0;
  try {
    stdout = execFileSync(OXLINT_BIN, args, { cwd: options.cwd, encoding: "utf8" });
  } catch (error) {
    const err = error as { stdout?: string; stderr?: string; status?: number };
    stdout = err.stdout ?? "";
    stderr = err.stderr ?? "";
    exitCode = err.status ?? 1;
  }
  const parsed = JSON.parse(stdout) as { diagnostics: OxlintDiagnostic[] };
  return { diagnostics: parsed.diagnostics, stderr, exitCode };
}
```

- [ ] **Step 4: 契約テストを書く（失敗させる）**

`tests/contract/fixtures/plugin.js`:

```js
export default {
  meta: { name: "contract" },
  rules: {
    probe: {
      create(context) {
        return {
          Program() {
            context.report({
              message: "loc-probe",
              loc: { start: { line: 1, column: 6 }, end: { line: 1, column: 7 } },
            });
            context.report({
              message: `settings-probe:${JSON.stringify(context.settings?.graphql ?? null)}`,
              loc: { line: 2, column: 0 },
            });
          },
        };
      },
    },
    fixer: {
      meta: { fixable: "code" },
      create(context) {
        return {
          Program() {
            context.report({
              message: "fix-probe",
              loc: { start: { line: 1, column: 6 }, end: { line: 1, column: 7 } },
              fix: () => ({ range: [6, 7], text: "9" }),
            });
          },
        };
      },
    },
  },
};
```

`tests/contract/fixtures/.oxlintrc.json`:

```json
{
  "plugins": [],
  "categories": {},
  "jsPlugins": ["./plugin.js"],
  "settings": { "graphql": { "schemaSdl": "type Query { a: Int }" } },
  "rules": {
    "contract/probe": "error",
    "contract/fixer": "off"
  }
}
```

`tests/contract/fixtures/target.js`:

```js
const x = 1;
const y = 2;
```

`tests/contract/oxlint-contract.test.ts`:

```ts
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { runOxlint } from "../helpers/run-oxlint.js";

const fixtures = fileURLToPath(new URL("./fixtures", import.meta.url));

describe("oxlint JS plugin contract", () => {
  const result = runOxlint({ cwd: fixtures, args: ["target.js"] });
  const probes = result.diagnostics.filter((d) => d.code === "contract(probe)");

  it("treats loc.column as 0-based, like ESLint", () => {
    const diagnostic = probes.find((d) => d.message === "loc-probe");
    expect(diagnostic?.labels[0]?.span).toMatchObject({ offset: 6, length: 1, line: 1, column: 7 });
  });

  it("exposes .oxlintrc settings to the plugin", () => {
    const diagnostic = probes.find((d) => d.message.startsWith("settings-probe:"));
    expect(diagnostic?.message).toBe('settings-probe:{"schemaSdl":"type Query { a: Int }"}');
  });

  it("fires the Program visitor exactly once per file", () => {
    expect(probes.filter((d) => d.message === "loc-probe")).toHaveLength(1);
  });

  it("reports nothing but the plugin diagnostics when native rules are disabled", () => {
    expect(result.diagnostics.every((d) => d.code.startsWith("contract("))).toBe(true);
  });
});
```

Run: `pnpm vitest run tests/contract`
Expected: FAIL（`runOxlint` の解決やフィクスチャ配置の問題が出る想定。ここで実行系を確定させる）

- [ ] **Step 5: テストを通す**

Step 4 のエラーに合わせて `run-oxlint.ts` の解決方法とフィクスチャを直す。
Run: `pnpm vitest run tests/contract`
Expected: PASS（4 件）

- [ ] **Step 6: `--fix` の range 解釈を確認するテストを追加する**

`tests/contract/oxlint-contract.test.ts` に追記:

```ts
import { copyFileSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

it("applies fix ranges as offsets from the start of the file", () => {
  const dir = mkdtempSync(join(tmpdir(), "oxlint-contract-"));
  copyFileSync(join(fixtures, "plugin.js"), join(dir, "plugin.js"));
  copyFileSync(join(fixtures, "target.js"), join(dir, "target.js"));
  writeFileSync(
    join(dir, ".oxlintrc.json"),
    JSON.stringify({
      plugins: [],
      categories: {},
      jsPlugins: ["./plugin.js"],
      rules: { "contract/probe": "off", "contract/fixer": "error" },
    }),
  );

  runOxlint({ cwd: dir, args: ["--fix", "target.js"] });

  expect(readFileSync(join(dir, "target.js"), "utf8")).toBe("const x = 9;\nconst y = 2;\n");
});
```

Run: `pnpm vitest run tests/contract`
Expected: PASS（5 件）

- [ ] **Step 7: コミット**

```bash
git add -A
git commit -m "chore: scaffold project and pin oxlint plugin contract with e2e tests"
```

---

### Task 2: 埋め込みドキュメントの抽出

**Files:**
- Create: `src/adapter/types.ts`
- Create: `src/adapter/documents.ts`
- Test: `tests/adapter/documents.test.ts`

**Interfaces:**
- Consumes: なし
- Produces:
  - `src/adapter/types.ts`: `EmbeddedDocument`, `GqlNode`, `ParserServices`, `ParseError`, `ParsedDocument`
  - `src/adapter/documents.ts`: `extractDocuments(code: string, filePath: string): EmbeddedDocument[]`

- [ ] **Step 1: 失敗するテストを書く**

`tests/adapter/documents.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { extractDocuments } from "../../src/adapter/documents.js";

describe("extractDocuments", () => {
  it("returns nothing when the file has no GraphQL keyword", () => {
    expect(extractDocuments("const a = 1;\n", "/repo/app.ts")).toEqual([]);
  });

  it("extracts a gql tagged template with its line and character offsets", () => {
    const code = ["import { gql } from 'graphql-tag';", "", "const q = gql`", "  { id }", "`;", ""].join("\n");
    const documents = extractDocuments(code, "/repo/app.ts");

    expect(documents).toHaveLength(1);
    expect(documents[0]!.text).toBe("  { id }");
    expect(documents[0]!.lineOffset).toBe(3);
    expect(code.slice(documents[0]!.offset, documents[0]!.offset + 8)).toBe("  { id }");
  });

  it("names virtual documents the way ESLint's processor does", () => {
    const code = ["const a = gql`{ id }`;", "const b = gql`{ name }`;"].join("\n");
    const documents = extractDocuments(code, "/repo/app.ts");

    expect(documents.map((d) => d.filePath)).toEqual([
      "/repo/app.ts/0_document.graphql",
      "/repo/app.ts/1_document.graphql",
    ]);
  });

  it("returns nothing instead of throwing when the JS itself cannot be parsed", () => {
    expect(extractDocuments("const a = gql`{ id }`; function (", "/repo/app.ts")).toEqual([]);
  });
});
```

注: `lineOffset` と `offset` の期待値は graphql-tag-pluck の実測値に合わせる。Step 2 の実行で得た実際の値が上のコードと違う場合は、**テストの期待値を実測値に直してよい**（本家と同じ値であることが要件で、特定の数値が要件ではない）。ただし「`code.slice(offset, ...)` が document のテキストと一致する」という不変条件は必ず保つ。

- [ ] **Step 2: テストが失敗することを確認する**

Run: `pnpm vitest run tests/adapter/documents.test.ts`
Expected: FAIL（`Cannot find module '../../src/adapter/documents.js'`）

- [ ] **Step 3: 型を定義する**

`src/adapter/types.ts`:

```ts
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
```

- [ ] **Step 4: 抽出を実装する**

`src/adapter/documents.ts`:

```ts
import { join } from "node:path";
import { processors } from "@graphql-eslint/eslint-plugin";
import type { EmbeddedDocument } from "./types.js";

type ProcessorBlock = { filename: string; text: string; lineOffset: number; offset: number };

export function extractDocuments(code: string, filePath: string): EmbeddedDocument[] {
  const blocks = processors.graphql.preprocess(code, filePath) as Array<string | ProcessorBlock>;

  const documents: EmbeddedDocument[] = [];
  for (const block of blocks) {
    if (typeof block === "string") continue;
    documents.push({
      filePath: join(filePath, `${documents.length}_${block.filename}`),
      text: block.text,
      lineOffset: block.lineOffset,
      offset: block.offset,
    });
  }
  return documents;
}
```

- [ ] **Step 5: テストを通す**

Run: `pnpm vitest run tests/adapter/documents.test.ts`
Expected: PASS（4 件）。期待値が実測とずれた場合は Step 1 の注記に従いテストの数値を実測値へ直す。

- [ ] **Step 6: コミット**

```bash
git add -A
git commit -m "feat: extract embedded GraphQL documents via graphql-eslint processor"
```

---

### Task 3: パースとファイル単位キャッシュ

**Files:**
- Create: `src/adapter/parse.ts`
- Create: `tests/fixtures/project/graphql.config.js`
- Create: `tests/fixtures/project/schema.graphql`
- Test: `tests/adapter/parse.test.ts`

**Interfaces:**
- Consumes: `extractDocuments` (Task 2), `EmbeddedDocument` / `ParsedDocument` / `ParseError` (Task 2)
- Produces:
  - `parseDocuments(options: { code: string; filePath: string; schemaSdl?: string }): ParsedDocument[]`
  - `clearParseCache(): void`
  - `getParseCallCount(): number`（テスト専用のカウンタ）

- [ ] **Step 1: フィクスチャのプロジェクトを作る**

`tests/fixtures/project/schema.graphql`:

```graphql
type Query {
  user: User
}

type User {
  id: ID!
  name: String
}
```

`tests/fixtures/project/graphql.config.js`:

```js
export default {
  schema: "./schema.graphql",
  documents: "./**/*.ts",
};
```

`tests/fixtures/project/ts-config/schema.graphql`: `tests/fixtures/project/schema.graphql` と同じ内容。

`tests/fixtures/project/ts-config/graphql.config.ts`:

```ts
export default {
  schema: "./schema.graphql",
};
```

この TS 設定ファイルは spec 第 11 節 4（graphql-config の `jiti` 経由の同期ロードが oxlint の実行環境でも成功するか）を検証するために置く。

- [ ] **Step 2: 失敗するテストを書く**

`tests/adapter/parse.test.ts`:

```ts
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { clearParseCache, getParseCallCount, parseDocuments } from "../../src/adapter/parse.js";

const projectDir = fileURLToPath(new URL("../fixtures/project", import.meta.url));
const filePath = join(projectDir, "app.ts");

const code = ["const q = gql`", "  query User {", "    user { id }", "  }", "`;", ""].join("\n");

describe("parseDocuments", () => {
  beforeEach(() => {
    clearParseCache();
  });

  it("parses each embedded document into a GraphQL ESTree program", () => {
    const parsed = parseDocuments({ code, filePath });

    expect(parsed).toHaveLength(1);
    expect(parsed[0]!.kind).toBe("parsed");
    if (parsed[0]!.kind !== "parsed") return;
    expect(parsed[0]!.ast.type).toBe("Program");
  });

  it("loads the schema from the on-disk graphql-config", () => {
    const parsed = parseDocuments({ code, filePath });

    if (parsed[0]!.kind !== "parsed") throw new Error("expected a parsed document");
    expect(parsed[0]!.services.schema?.getQueryType()?.name).toBe("Query");
  });

  it("builds the schema from settings when schemaSdl is given", () => {
    const parsed = parseDocuments({
      code: "const q = gql`{ a }`;\n",
      filePath: "/tmp/no-config/app.ts",
      schemaSdl: "type Query { a: Int }",
    });

    if (parsed[0]!.kind !== "parsed") throw new Error("expected a parsed document");
    expect(parsed[0]!.services.schema?.getQueryType()?.getFields().a).toBeDefined();
  });

  it("returns a parse error instead of throwing on invalid GraphQL", () => {
    const parsed = parseDocuments({ code: "const q = gql`query {`;\n", filePath });

    expect(parsed[0]!.kind).toBe("error");
    if (parsed[0]!.kind !== "error") return;
    expect(parsed[0]!.error.message).toContain("Syntax Error");
    expect(parsed[0]!.error.line).toBe(1);
  });

  it("throws when the graphql-config schema cannot be loaded", () => {
    expect(() =>
      parseDocuments({ code: "const q = gql`{ a }`;\n", filePath: "/tmp/no-graphql-config/app.ts" }),
    ).toThrow();
  });

  it("loads a TypeScript graphql config file", () => {
    const tsProject = join(projectDir, "ts-config");
    const parsed = parseDocuments({ code, filePath: join(tsProject, "app.ts") });

    if (parsed[0]!.kind !== "parsed") throw new Error("expected a parsed document");
    expect(parsed[0]!.services.schema?.getQueryType()?.name).toBe("Query");
  });

  it("parses a file only once even when called repeatedly", () => {
    parseDocuments({ code, filePath });
    const afterFirst = getParseCallCount();
    parseDocuments({ code, filePath });
    parseDocuments({ code, filePath });

    expect(getParseCallCount()).toBe(afterFirst);
  });

  it("re-parses when the file content changes", () => {
    parseDocuments({ code, filePath });
    const afterFirst = getParseCallCount();
    parseDocuments({ code: code.replace("id", "name"), filePath });

    expect(getParseCallCount()).toBe(afterFirst + 1);
  });
});
```

- [ ] **Step 3: テストが失敗することを確認する**

Run: `pnpm vitest run tests/adapter/parse.test.ts`
Expected: FAIL（`Cannot find module '../../src/adapter/parse.js'`）

- [ ] **Step 4: 実装する**

`src/adapter/parse.ts`:

```ts
import { parseForESLint } from "@graphql-eslint/eslint-plugin";
import { extractDocuments } from "./documents.js";
import type { GqlNode, ParseError, ParsedDocument, ParserServices } from "./types.js";

const MAX_CACHE_ENTRIES = 8;

type CacheEntry = { code: string; documents: ParsedDocument[] };

const cache = new Map<string, CacheEntry>();
let parseCallCount = 0;

export function clearParseCache(): void {
  cache.clear();
  parseCallCount = 0;
}

export function getParseCallCount(): number {
  return parseCallCount;
}

export function parseDocuments(options: {
  code: string;
  filePath: string;
  schemaSdl?: string;
}): ParsedDocument[] {
  const cached = cache.get(options.filePath);
  if (cached && cached.code === options.code) {
    cache.delete(options.filePath);
    cache.set(options.filePath, cached);
    return cached.documents;
  }

  const documents = extractDocuments(options.code, options.filePath).map((document) => {
    parseCallCount += 1;
    try {
      const parserOptions = options.schemaSdl === undefined
        ? { filePath: document.filePath }
        : { filePath: document.filePath, schemaSdl: options.schemaSdl };
      const result = parseForESLint(document.text, parserOptions) as {
        ast: GqlNode;
        services: ParserServices;
      };
      return { kind: "parsed", document, ast: result.ast, services: result.services } as const;
    } catch (error) {
      return { kind: "error", document, error: toParseError(error) } as const;
    }
  });

  cache.set(options.filePath, { code: options.code, documents });
  if (cache.size > MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }
  return documents;
}

function toParseError(error: unknown): ParseError {
  const raw = error as { message?: string; lineNumber?: number; column?: number };
  if (typeof raw?.message !== "string") throw error;
  return {
    message: raw.message,
    line: raw.lineNumber ?? 1,
    column: raw.column ?? 0,
  };
}
```

注: スキーマや graphql-config のロード失敗は `toParseError` が `lineNumber` を持たない例外として受け取るため `throw error` で再スローされ、設計どおり fail fast になる。

- [ ] **Step 5: テストを通す**

Run: `pnpm vitest run tests/adapter/parse.test.ts`
Expected: PASS（8 件）

`/tmp/no-graphql-config/app.ts` のように graphql-config もスキーマも無い場所では `parseDocuments` が
例外を投げる（設計どおりの fail fast）。この挙動が「例外ではなく parse error」になっていた場合は
`toParseError` の判定を直す。

- [ ] **Step 6: コミット**

```bash
git add -A
git commit -m "feat: parse embedded documents with per-file caching"
```

---

### Task 4: AST walker

**Files:**
- Create: `src/adapter/traverse.ts`
- Test: `tests/adapter/traverse.test.ts`

**Interfaces:**
- Consumes: `GqlNode` (Task 2)
- Produces: `traverse(root: GqlNode, handlers: { enter(node: GqlNode, ancestors: GqlNode[]): void; leave(node: GqlNode, ancestors: GqlNode[]): void }): void`

`parseForESLint` は `visitorKeys` を返さないため、ESLint の fallback と同じ「オブジェクトのキーを走査して `type` を持つ値を子ノードとみなす」方式にする。除外キーは ESLint（eslint-visitor-keys の `getKeys`）と同じ `parent` / `leadingComments` / `trailingComments`。

- [ ] **Step 1: 失敗するテストを書く**

`tests/adapter/traverse.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { traverse } from "../../src/adapter/traverse.js";
import type { GqlNode } from "../../src/adapter/types.js";

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
});
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `pnpm vitest run tests/adapter/traverse.test.ts`
Expected: FAIL（`Cannot find module '../../src/adapter/traverse.js'`）

- [ ] **Step 3: 実装する**

`src/adapter/traverse.ts`:

```ts
import type { GqlNode } from "./types.js";

const IGNORED_KEYS = new Set(["parent", "leadingComments", "trailingComments"]);

export type TraverseHandlers = {
  enter(node: GqlNode, ancestors: GqlNode[]): void;
  leave(node: GqlNode, ancestors: GqlNode[]): void;
};

export function traverse(root: GqlNode, handlers: TraverseHandlers): void {
  const ancestors: GqlNode[] = [];
  visit(root, ancestors, handlers);
}

function visit(node: GqlNode, ancestors: GqlNode[], handlers: TraverseHandlers): void {
  handlers.enter(node, ancestors);

  ancestors.push(node);
  for (const key of Object.keys(node)) {
    if (IGNORED_KEYS.has(key)) continue;
    const value = node[key];
    if (Array.isArray(value)) {
      for (const item of value) {
        if (isNode(item)) visit(item, ancestors, handlers);
      }
    } else if (isNode(value)) {
      visit(value, ancestors, handlers);
    }
  }
  ancestors.pop();

  handlers.leave(node, ancestors);
}

function isNode(value: unknown): value is GqlNode {
  return typeof value === "object" && value !== null && typeof (value as { type?: unknown }).type === "string";
}
```

- [ ] **Step 4: テストを通す**

Run: `pnpm vitest run tests/adapter/traverse.test.ts`
Expected: PASS（3 件）

- [ ] **Step 5: コミット**

```bash
git add -A
git commit -m "feat: add GraphQL ESTree traverser"
```

---

### Task 5: SourceCode shim

**Files:**
- Create: `src/adapter/source-code.ts`
- Test: `tests/adapter/source-code.test.ts`

**Interfaces:**
- Consumes: `traverse` (Task 4), `GqlNode` / `ParserServices` (Task 2), `parseDocuments` (Task 3、テストで実 AST を得るため)
- Produces:
  - `createSourceCode(options: { text: string; ast: GqlNode; services: ParserServices; getAncestors: () => GqlNode[] }): SourceCodeShim`
  - `type SourceCodeShim = { text: string; ast: GqlNode; parserServices: ParserServices; getText(node?: GqlNode): string; getNodeByRangeIndex(index: number): GqlNode | null; getAllComments(): GqlNode[]; getCommentsBefore(node: GqlNode): GqlNode[]; getCommentsAfter(node: GqlNode): GqlNode[]; getTokenBefore(node: GqlNode): GqlNode | null; getTokenAfter(node: GqlNode): GqlNode | null; getAncestors(): GqlNode[]; getLines(): string[] }`

- [ ] **Step 1: 失敗するテストを書く**

`tests/adapter/source-code.test.ts`:

```ts
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { clearParseCache, parseDocuments } from "../../src/adapter/parse.js";
import { createSourceCode } from "../../src/adapter/source-code.js";
import type { GqlNode } from "../../src/adapter/types.js";

const filePath = join(fileURLToPath(new URL("../fixtures/project", import.meta.url)), "app.ts");

const code = [
  "const q = gql`",
  "  # a comment",
  "  query User {",
  "    user { id }",
  "  }",
  "`;",
  "",
].join("\n");

function setup() {
  const parsed = parseDocuments({ code, filePath });
  if (parsed[0]!.kind !== "parsed") throw new Error("expected a parsed document");
  const { ast, services, document } = parsed[0]!;
  const sourceCode = createSourceCode({
    text: document.text,
    ast,
    services,
    getAncestors: () => [],
  });
  return { sourceCode, ast, text: document.text };
}

describe("createSourceCode", () => {
  beforeEach(() => {
    clearParseCache();
  });

  it("returns the whole text when no node is given", () => {
    const { sourceCode, text } = setup();
    expect(sourceCode.getText()).toBe(text);
  });

  it("returns the slice covered by a node's range", () => {
    const { sourceCode, ast } = setup();
    const operation = findNode(ast, "OperationDefinition")!;
    expect(sourceCode.getText(operation)).toContain("query User");
  });

  it("finds the innermost node containing a character index", () => {
    const { sourceCode, ast, text } = setup();
    const index = text.indexOf("User");
    const found = sourceCode.getNodeByRangeIndex(index);

    expect(found).not.toBeNull();
    expect(found!.range[0]).toBeLessThanOrEqual(index);
    expect(found!.range[1]).toBeGreaterThan(index);
    expect(sourceCode.getText(found!)).toBe("User");
    void ast;
  });

  it("exposes comments and parser services", () => {
    const { sourceCode } = setup();
    expect(sourceCode.getAllComments().map((c) => c.type)).toContain("Line");
    expect(sourceCode.parserServices.schema).not.toBeNull();
  });

  it("returns the token immediately before and after a node", () => {
    const { sourceCode, ast } = setup();
    const operation = findNode(ast, "OperationDefinition")!;
    const name = findNode(operation, "Name")!;

    expect(sourceCode.getTokenBefore(name)?.value).toBe("query");
    expect(sourceCode.getTokenAfter(name)?.value).toBe("{");
  });

  it("delegates getAncestors to the traversal state", () => {
    const parsed = parseDocuments({ code, filePath });
    if (parsed[0]!.kind !== "parsed") throw new Error("expected a parsed document");
    const marker = { type: "Document" } as GqlNode;
    const sourceCode = createSourceCode({
      text: parsed[0]!.document.text,
      ast: parsed[0]!.ast,
      services: parsed[0]!.services,
      getAncestors: () => [marker],
    });

    expect(sourceCode.getAncestors()).toEqual([marker]);
  });
});

function findNode(root: GqlNode, type: string): GqlNode | null {
  if (root.type === type) return root;
  for (const key of Object.keys(root)) {
    if (key === "parent") continue;
    const value = root[key];
    const children = Array.isArray(value) ? value : [value];
    for (const child of children) {
      if (typeof child === "object" && child !== null && typeof (child as GqlNode).type === "string") {
        const found = findNode(child as GqlNode, type);
        if (found) return found;
      }
    }
  }
  return null;
}
```

注: `getTokenBefore` / `getAllComments` の期待値は `parseForESLint` が返す `tokens` / `comments` の実データに合わせる。Step 2 の実行で値が違った場合は実データに合わせてテストを直す。

- [ ] **Step 2: テストが失敗することを確認する**

Run: `pnpm vitest run tests/adapter/source-code.test.ts`
Expected: FAIL（`Cannot find module '../../src/adapter/source-code.js'`）

- [ ] **Step 3: 実装する**

`src/adapter/source-code.ts`:

```ts
import { traverse } from "./traverse.js";
import type { GqlNode, ParserServices } from "./types.js";

export type SourceCodeShim = {
  text: string;
  ast: GqlNode;
  parserServices: ParserServices;
  getText(node?: GqlNode): string;
  getNodeByRangeIndex(index: number): GqlNode | null;
  getAllComments(): GqlNode[];
  getCommentsBefore(node: GqlNode): GqlNode[];
  getCommentsAfter(node: GqlNode): GqlNode[];
  getTokenBefore(node: GqlNode): GqlNode | null;
  getTokenAfter(node: GqlNode): GqlNode | null;
  getAncestors(): GqlNode[];
  getLines(): string[];
};

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
    getText: (node) => (node ? text.slice(node.range[0], node.range[1]) : text),
    getNodeByRangeIndex: (index) => findInnermost(ast, index),
    getAllComments: () => comments,
    getCommentsBefore: (node) => comments.filter((c) => c.range[1] <= node.range[0] && !hasTokenBetween(tokens, c.range[1], node.range[0])),
    getCommentsAfter: (node) => comments.filter((c) => c.range[0] >= node.range[1] && !hasTokenBetween(tokens, node.range[1], c.range[0])),
    getTokenBefore: (node) => lastOrNull(tokens.filter((t) => t.range[1] <= node.range[0])),
    getTokenAfter: (node) => tokens.find((t) => t.range[0] >= node.range[1]) ?? null,
    getAncestors: options.getAncestors,
    getLines: () => text.split("\n"),
  };
}

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
```

- [ ] **Step 4: テストを通す**

Run: `pnpm vitest run tests/adapter/source-code.test.ts`
Expected: PASS（6 件）

- [ ] **Step 5: コミット**

```bash
git add -A
git commit -m "feat: add SourceCode shim over the GraphQL ESTree"
```

---

### Task 6: レポート変換と context shim

**Files:**
- Create: `src/adapter/report-mapper.ts`
- Create: `src/adapter/context.ts`
- Test: `tests/adapter/report-mapper.test.ts`

**Interfaces:**
- Consumes: `EmbeddedDocument` / `GqlNode` (Task 2), `SourceCodeShim` (Task 5)
- Produces:
  - `src/adapter/report-mapper.ts`:
    - `type GqlReportDescriptor = { node?: GqlNode; loc?: { start: { line: number; column: number }; end?: { line: number; column: number } }; message?: string; messageId?: string; data?: Record<string, unknown>; fix?: (fixer: FixerShim) => FixLike | FixLike[] | Iterable<FixLike> | null; suggest?: Array<{ desc?: string; messageId?: string; data?: Record<string, unknown>; fix: (fixer: FixerShim) => FixLike | FixLike[] | Iterable<FixLike> | null }> }`
    - `type FixLike = { range: [number, number]; text: string }`
    - `type FixerShim = { insertTextBefore(node: GqlNode, text: string): FixLike; insertTextBeforeRange(range: [number, number], text: string): FixLike; insertTextAfter(node: GqlNode, text: string): FixLike; insertTextAfterRange(range: [number, number], text: string): FixLike; remove(node: GqlNode): FixLike; removeRange(range: [number, number]): FixLike; replaceText(node: GqlNode, text: string): FixLike; replaceTextRange(range: [number, number], text: string): FixLike }`
    - `createReportMapper(options: { document: EmbeddedDocument; messages: Record<string, string>; emit: (diagnostic: MappedDiagnostic) => void }): (descriptor: GqlReportDescriptor) => void`
    - `type MappedDiagnostic = { message: string; loc: { start: { line: number; column: number }; end?: { line: number; column: number } }; fix?: () => FixLike[]; suggest?: Array<{ desc: string; fix: () => FixLike[] }> }`
  - `src/adapter/context.ts`:
    - `createRuleContext(options: { ruleId: string; options: readonly unknown[]; settings: Readonly<Record<string, unknown>>; filename: string; physicalFilename: string; sourceCode: SourceCodeShim; report: (descriptor: GqlReportDescriptor) => void }): RuleContextShim`

- [ ] **Step 1: 失敗するテストを書く**

`tests/adapter/report-mapper.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { createReportMapper } from "../../src/adapter/report-mapper.js";
import type { EmbeddedDocument, GqlNode } from "../../src/adapter/types.js";

const document: EmbeddedDocument = {
  filePath: "/repo/app.ts/0_document.graphql",
  text: "{ id }",
  lineOffset: 2,
  offset: 15,
};

const node: GqlNode = {
  type: "Field",
  loc: { start: { line: 1, column: 2 }, end: { line: 1, column: 4 } },
  range: [2, 4],
} as GqlNode;

describe("createReportMapper", () => {
  it("shifts lines by the document's line offset and leaves columns alone", () => {
    const emit = vi.fn();
    const report = createReportMapper({ document, messages: {}, emit });

    report({ node, message: "boom" });

    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "boom",
        loc: { start: { line: 3, column: 2 }, end: { line: 3, column: 4 } },
      }),
    );
  });

  it("resolves messageId and interpolates data", () => {
    const emit = vi.fn();
    const report = createReportMapper({
      document,
      messages: { named: "Field {{ name }} is bad" },
      emit,
    });

    report({ node, messageId: "named", data: { name: "id" } });

    expect(emit.mock.calls[0]![0].message).toBe("Field id is bad");
  });

  it("shifts fix ranges by the document's character offset", () => {
    const emit = vi.fn();
    const report = createReportMapper({ document, messages: {}, emit });

    report({ node, message: "boom", fix: (fixer) => fixer.replaceText(node, "name") });

    expect(emit.mock.calls[0]![0].fix!()).toEqual([{ range: [17, 19], text: "name" }]);
  });

  it("shifts suggestion fix ranges too", () => {
    const emit = vi.fn();
    const report = createReportMapper({ document, messages: { s: "use {{ x }}" }, emit });

    report({
      node,
      message: "boom",
      suggest: [{ messageId: "s", data: { x: "name" }, fix: (fixer) => fixer.removeRange([0, 1]) }],
    });

    const suggestion = emit.mock.calls[0]![0].suggest![0]!;
    expect(suggestion.desc).toBe("use name");
    expect(suggestion.fix()).toEqual([{ range: [15, 16], text: "" }]);
  });

  it("accepts a descriptor with loc instead of node", () => {
    const emit = vi.fn();
    const report = createReportMapper({ document, messages: {}, emit });

    report({ loc: { start: { line: 1, column: 0 } }, message: "boom" });

    expect(emit.mock.calls[0]![0].loc).toEqual({ start: { line: 3, column: 0 } });
  });
});
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `pnpm vitest run tests/adapter/report-mapper.test.ts`
Expected: FAIL（`Cannot find module '../../src/adapter/report-mapper.js'`）

- [ ] **Step 3: report-mapper を実装する**

`src/adapter/report-mapper.ts`:

```ts
import type { EmbeddedDocument, GqlNode } from "./types.js";

export type FixLike = { range: [number, number]; text: string };

export type FixerShim = {
  insertTextBefore(node: GqlNode, text: string): FixLike;
  insertTextBeforeRange(range: [number, number], text: string): FixLike;
  insertTextAfter(node: GqlNode, text: string): FixLike;
  insertTextAfterRange(range: [number, number], text: string): FixLike;
  remove(node: GqlNode): FixLike;
  removeRange(range: [number, number]): FixLike;
  replaceText(node: GqlNode, text: string): FixLike;
  replaceTextRange(range: [number, number], text: string): FixLike;
};

type FixFn = (fixer: FixerShim) => FixLike | FixLike[] | Iterable<FixLike> | null | undefined;

export type GqlReportDescriptor = {
  node?: GqlNode;
  loc?: { start: { line: number; column: number }; end?: { line: number; column: number } };
  message?: string;
  messageId?: string;
  data?: Record<string, unknown>;
  fix?: FixFn;
  suggest?: Array<{ desc?: string; messageId?: string; data?: Record<string, unknown>; fix: FixFn }>;
};

export type MappedDiagnostic = {
  message: string;
  loc: { start: { line: number; column: number }; end?: { line: number; column: number } };
  fix?: () => FixLike[];
  suggest?: Array<{ desc: string; fix: () => FixLike[] }>;
};

const FIXER: FixerShim = {
  insertTextBefore: (node, text) => ({ range: [node.range[0], node.range[0]], text }),
  insertTextBeforeRange: (range, text) => ({ range: [range[0], range[0]], text }),
  insertTextAfter: (node, text) => ({ range: [node.range[1], node.range[1]], text }),
  insertTextAfterRange: (range, text) => ({ range: [range[1], range[1]], text }),
  remove: (node) => ({ range: [node.range[0], node.range[1]], text: "" }),
  removeRange: (range) => ({ range: [range[0], range[1]], text: "" }),
  replaceText: (node, text) => ({ range: [node.range[0], node.range[1]], text }),
  replaceTextRange: (range, text) => ({ range: [range[0], range[1]], text }),
};

export function createReportMapper(options: {
  document: EmbeddedDocument;
  messages: Record<string, string>;
  emit: (diagnostic: MappedDiagnostic) => void;
}): (descriptor: GqlReportDescriptor) => void {
  const { document, messages, emit } = options;

  return (descriptor) => {
    const source = descriptor.loc ?? descriptor.node?.loc;
    if (!source) throw new Error("report descriptor must have a node or a loc");

    const diagnostic: MappedDiagnostic = {
      message: resolveMessage(descriptor.message, descriptor.messageId, descriptor.data, messages),
      loc: {
        start: { line: source.start.line + document.lineOffset, column: source.start.column },
        ...(source.end
          ? { end: { line: source.end.line + document.lineOffset, column: source.end.column } }
          : {}),
      },
    };

    if (descriptor.fix) {
      const fix = descriptor.fix;
      diagnostic.fix = () => shiftFixes(fix, document.offset);
    }

    if (descriptor.suggest && descriptor.suggest.length > 0) {
      diagnostic.suggest = descriptor.suggest.map((suggestion) => ({
        desc: resolveMessage(suggestion.desc, suggestion.messageId, suggestion.data, messages),
        fix: () => shiftFixes(suggestion.fix, document.offset),
      }));
    }

    emit(diagnostic);
  };
}

function shiftFixes(fix: FixFn, offset: number): FixLike[] {
  const result = fix(FIXER);
  if (result === null || result === undefined) return [];
  const fixes = isFix(result) ? [result] : Array.from(result as Iterable<FixLike>);
  return fixes.map((item) => ({
    range: [item.range[0] + offset, item.range[1] + offset],
    text: item.text,
  }));
}

function isFix(value: FixLike | FixLike[] | Iterable<FixLike>): value is FixLike {
  return !Array.isArray(value) && typeof (value as FixLike).text === "string";
}

function resolveMessage(
  message: string | undefined,
  messageId: string | undefined,
  data: Record<string, unknown> | undefined,
  messages: Record<string, string>,
): string {
  const template = message ?? (messageId ? messages[messageId] : undefined);
  if (template === undefined) {
    throw new Error(`cannot resolve message for messageId ${String(messageId)}`);
  }
  if (!data) return template;
  return template.replace(/\{\{\s*([^}\s]+)\s*\}\}/g, (match, key: string) =>
    key in data ? String(data[key]) : match,
  );
}
```

- [ ] **Step 4: テストを通す**

Run: `pnpm vitest run tests/adapter/report-mapper.test.ts`
Expected: PASS（5 件）

- [ ] **Step 5: context shim を実装する**

`src/adapter/context.ts`:

```ts
import type { GqlReportDescriptor } from "./report-mapper.js";
import type { SourceCodeShim } from "./source-code.js";

export type RuleContextShim = {
  id: string;
  options: readonly unknown[];
  settings: Readonly<Record<string, unknown>>;
  filename: string;
  physicalFilename: string;
  sourceCode: SourceCodeShim;
  parserServices: SourceCodeShim["parserServices"];
  getSourceCode(): SourceCodeShim;
  getFilename(): string;
  report(descriptor: GqlReportDescriptor): void;
};

export function createRuleContext(options: {
  ruleId: string;
  options: readonly unknown[];
  settings: Readonly<Record<string, unknown>>;
  filename: string;
  physicalFilename: string;
  sourceCode: SourceCodeShim;
  report: (descriptor: GqlReportDescriptor) => void;
}): RuleContextShim {
  return {
    id: options.ruleId,
    options: options.options,
    settings: options.settings,
    filename: options.filename,
    physicalFilename: options.physicalFilename,
    sourceCode: options.sourceCode,
    parserServices: options.sourceCode.parserServices,
    getSourceCode: () => options.sourceCode,
    getFilename: () => options.filename,
    report: options.report,
  };
}
```

- [ ] **Step 6: 型チェックを通す**

Run: `pnpm typecheck`
Expected: エラーなし

- [ ] **Step 7: コミット**

```bash
git add -A
git commit -m "feat: map graphql-eslint reports and fixes onto host file coordinates"
```

---

### Task 7: ルールファクトリと全ルール公開

**Files:**
- Create: `src/adapter/rule-factory.ts`
- Create: `src/rules.ts`
- Create: `src/meta.ts`
- Create: `src/index.ts`
- Test: `tests/rules/rule-factory.test.ts`
- Test: `tests/rules/exposed-rules.test.ts`

**Interfaces:**
- Consumes: `parseDocuments` (Task 3), `traverse` (Task 4), `createSourceCode` (Task 5), `createReportMapper` / `createRuleContext` (Task 6)
- Produces:
  - `src/adapter/rule-factory.ts`: `toOxlintRule(ruleId: string, rule: GraphQLESLintRuleLike): Rule`
  - `src/rules.ts`: `rules: Record<string, Rule>`
  - `src/index.ts`: default export のプラグイン、および named export の `rules`

- [ ] **Step 1: 失敗するテストを書く**

`tests/rules/rule-factory.test.ts`:

```ts
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { runOxlint } from "../helpers/run-oxlint.js";

const fixtures = fileURLToPath(new URL("./fixtures/single-rule", import.meta.url));

describe("wrapped graphql-eslint rule", () => {
  it("reports inside an embedded document at the right position", () => {
    const result = runOxlint({ cwd: fixtures, args: ["app.ts"] });
    const diagnostics = result.diagnostics.filter((d) => d.code === "graphql(no-anonymous-operations)");

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]!.message).toContain("Anonymous GraphQL operation is forbidden");
    expect(diagnostics[0]!.labels[0]!.span.line).toBe(4);
  });
});
```

`tests/rules/fixtures/single-rule/.oxlintrc.json`:

```json
{
  "plugins": [],
  "categories": {},
  "jsPlugins": ["../../../../src/index.ts"],
  "rules": { "graphql/no-anonymous-operations": "error" }
}
```

`tests/rules/fixtures/single-rule/graphql.config.js`:

```js
export default {
  schema: "./schema.graphql",
};
```

`tests/rules/fixtures/single-rule/schema.graphql`:

```graphql
type Query {
  user: User
}

type User {
  id: ID!
}
```

`tests/rules/fixtures/single-rule/app.ts`:

```ts
const q = gql`
  query {
    user {
      id
    }
  }
`;
```

注: `jsPlugins` に `.ts` を直接指定できない場合は、テスト前に `pnpm build` して `dist/index.js` を指す形に変える。どちらで動くかを Step 3 で確定し、動く側に統一する。

`tests/rules/exposed-rules.test.ts`:

```ts
import { rules as graphqlEslintRules } from "@graphql-eslint/eslint-plugin";
import { describe, expect, it } from "vitest";
import { rules } from "../../src/rules.js";

describe("exposed rules", () => {
  it("exposes every graphql-eslint rule under the same name", () => {
    for (const ruleId of Object.keys(graphqlEslintRules)) {
      expect(rules[ruleId], `missing rule ${ruleId}`).toBeDefined();
    }
  });

  it("exposes at least 60 rules", () => {
    expect(Object.keys(rules).length).toBeGreaterThanOrEqual(60);
  });

  it("gives every rule a createOnce implementation", () => {
    for (const [ruleId, rule] of Object.entries(rules)) {
      expect(typeof (rule as { createOnce?: unknown }).createOnce, ruleId).toBe("function");
    }
  });
});
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `pnpm vitest run tests/rules`
Expected: FAIL（`Cannot find module '../../src/rules.js'`）

- [ ] **Step 3: 実装する**

`src/meta.ts`:

```ts
export const PLUGIN_NAME = "graphql";
```

`src/adapter/rule-factory.ts`:

```ts
import { defineRule } from "@oxlint/plugins";
import type { Rule } from "@oxlint/plugins";
import { createRuleContext } from "./context.js";
import { parseDocuments } from "./parse.js";
import { createReportMapper } from "./report-mapper.js";
import type { GqlReportDescriptor } from "./report-mapper.js";
import { createSourceCode } from "./source-code.js";
import { traverse } from "./traverse.js";
import type { GqlNode, ParsedDocument } from "./types.js";

export type GraphQLESLintRuleLike = {
  meta: {
    messages?: Record<string, string>;
    fixable?: "code" | "whitespace";
    hasSuggestions?: boolean;
    schema?: unknown;
    docs?: { description?: string };
  };
  create(context: unknown): Record<string, ((node: GqlNode) => void) | undefined>;
};

export function readSchemaSdl(settings: Readonly<Record<string, unknown>>): string | undefined {
  const graphql = settings.graphql as { schemaSdl?: unknown } | undefined;
  return typeof graphql?.schemaSdl === "string" ? graphql.schemaSdl : undefined;
}

export function toOxlintRule(ruleId: string, rule: GraphQLESLintRuleLike): Rule {
  return defineRule({
    meta: {
      fixable: rule.meta.fixable,
      hasSuggestions: rule.meta.hasSuggestions,
      docs: { description: rule.meta.docs?.description ?? ruleId },
    },
    createOnce(context) {
      return {
        Program() {
          const parsed = parseDocuments({
            code: context.sourceCode.text,
            filePath: context.physicalFilename,
            schemaSdl: readSchemaSdl(context.settings as Readonly<Record<string, unknown>>),
          });

          for (const document of parsed) {
            if (document.kind !== "parsed") continue;
            runRuleOnDocument({ ruleId, rule, parsed: document, context });
          }
        },
      };
    },
  } as Parameters<typeof defineRule>[0]);
}

function runRuleOnDocument(input: {
  ruleId: string;
  rule: GraphQLESLintRuleLike;
  parsed: Extract<ParsedDocument, { kind: "parsed" }>;
  context: {
    options: readonly unknown[];
    settings: unknown;
    physicalFilename: string;
    report: (diagnostic: unknown) => void;
  };
}): void {
  const { ruleId, rule, parsed, context } = input;

  let ancestors: GqlNode[] = [];
  const sourceCode = createSourceCode({
    text: parsed.document.text,
    ast: parsed.ast,
    services: parsed.services,
    getAncestors: () => ancestors,
  });

  const report = createReportMapper({
    document: parsed.document,
    messages: rule.meta.messages ?? {},
    emit: (diagnostic) => {
      context.report({
        message: diagnostic.message,
        loc: diagnostic.loc,
        ...(diagnostic.fix ? { fix: () => diagnostic.fix!() } : {}),
        ...(diagnostic.suggest
          ? { suggest: diagnostic.suggest.map((s) => ({ desc: s.desc, fix: () => s.fix() })) }
          : {}),
      });
    },
  });

  const ruleContext = createRuleContext({
    ruleId,
    options: context.options,
    settings: (context.settings ?? {}) as Readonly<Record<string, unknown>>,
    filename: parsed.document.filePath,
    physicalFilename: context.physicalFilename,
    sourceCode,
    report: report as (descriptor: GqlReportDescriptor) => void,
  });

  let visitor: Record<string, ((node: GqlNode) => void) | undefined>;
  try {
    visitor = rule.create(ruleContext);
  } catch (error) {
    throw wrapRuleError(error, ruleId, context.physicalFilename);
  }

  try {
    traverse(parsed.ast, {
      enter: (node, currentAncestors) => {
        ancestors = currentAncestors.slice();
        visitor[node.type]?.(node);
      },
      leave: (node, currentAncestors) => {
        ancestors = currentAncestors.slice();
        visitor[`${node.type}:exit`]?.(node);
      },
    });
  } catch (error) {
    throw wrapRuleError(error, ruleId, context.physicalFilename);
  }
}

function wrapRuleError(error: unknown, ruleId: string, filePath: string): Error {
  const message = error instanceof Error ? error.message : String(error);
  const wrapped = new Error(`[oxlint-plugin-graphql] rule "${ruleId}" failed on ${filePath}: ${message}`);
  if (error instanceof Error && error.stack) wrapped.stack = error.stack;
  return wrapped;
}
```

`src/rules.ts`:

```ts
import { rules as graphqlEslintRules } from "@graphql-eslint/eslint-plugin";
import type { Rule } from "@oxlint/plugins";
import { toOxlintRule } from "./adapter/rule-factory.js";
import type { GraphQLESLintRuleLike } from "./adapter/rule-factory.js";

export const rules: Record<string, Rule> = Object.fromEntries(
  Object.entries(graphqlEslintRules as unknown as Record<string, GraphQLESLintRuleLike>).map(
    ([ruleId, rule]) => [ruleId, toOxlintRule(ruleId, rule)],
  ),
);
```

`src/index.ts`:

```ts
import { definePlugin } from "@oxlint/plugins";
import { PLUGIN_NAME } from "./meta.js";
import { rules } from "./rules.js";

const plugin = definePlugin({
  meta: { name: PLUGIN_NAME },
  rules,
});

export default plugin;
export { rules };
```

- [ ] **Step 4: テストを通す**

Run: `pnpm vitest run tests/rules`
Expected: PASS（4 件）。`jsPlugins` が `.ts` を読めない場合は Step 1 の注記に従い `pnpm build` 前提に変えて再実行する。

- [ ] **Step 5: RuleTester とエラーラップのユニットテストを足す**

spec 第 11 節 5（`oxlint/plugins-dev` の `RuleTester` が `loc` ベースの report を検証できるか）をここで確定させる。

`tests/rules/rule-tester.test.ts`:

```ts
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { RuleTester } from "oxlint/plugins-dev";
import { describe, expect, it } from "vitest";
import { rules } from "../../src/rules.js";
import { toOxlintRule } from "../../src/adapter/rule-factory.js";

RuleTester.describe = describe;
RuleTester.it = it;

const projectFile = join(
  fileURLToPath(new URL("../fixtures/project", import.meta.url)),
  "app.ts",
);

const ruleTester = new RuleTester({ languageOptions: { parserOptions: { lang: "ts" } } });

ruleTester.run("no-anonymous-operations", rules["no-anonymous-operations"]!, {
  valid: [
    { code: "const a = 1;\n", filename: projectFile },
    { code: "const q = gql`query User { user { id } }`;\n", filename: projectFile },
  ],
  invalid: [
    {
      name: "anonymous operation inside a gql template",
      code: ["const q = gql`", "  query {", "    user { id }", "  }", "`;", ""].join("\n"),
      filename: projectFile,
      errors: [{ line: 2 }],
    },
  ],
});

describe("rule error wrapping", () => {
  it("reports the rule id and the file path when a rule throws", () => {
    const exploding = toOxlintRule("exploding", {
      meta: {},
      create() {
        throw new Error("kaboom");
      },
    });

    const visitor = (exploding as { createOnce(context: unknown): { Program(): void } }).createOnce({
      sourceCode: { text: "const q = gql`{ user { id } }`;\n" },
      physicalFilename: projectFile,
      settings: {},
      options: [],
      report: () => {},
    });

    expect(() => visitor.Program()).toThrow(/rule "exploding" failed on .*app\.ts: kaboom/);
  });
});
```

注: `RuleTester` のテストケースが `filename` を受け付けない場合は、`filename` を外して
`new RuleTester({ settings: { graphql: { schemaSdl: "type Query { user: User } type User { id: ID! }" } }, languageOptions: { parserOptions: { lang: "ts" } } })`
に変える。`settings` も渡せない場合はこのファイルを `describe.skip` にして理由をコメントに書き、
互換性の検証は Task 10 の conformance に委ねる。

Run: `pnpm vitest run tests/rules`
Expected: PASS

- [ ] **Step 6: コミット**

```bash
git add -A
git commit -m "feat: expose all graphql-eslint rules as an oxlint plugin"
```

---

### Task 8: `graphql/parse-error` ルール

構文エラーを有効ルール数だけ重複報告しないよう、報告役を 1 本のルールに集約する。

**Files:**
- Create: `src/rules/parse-error.ts`
- Modify: `src/rules.ts`
- Test: `tests/rules/parse-error.test.ts`

**Interfaces:**
- Consumes: `parseDocuments` (Task 3), `readSchemaSdl` (Task 7)
- Produces: `src/rules/parse-error.ts`: `parseErrorRule: Rule`, `PARSE_ERROR_RULE_ID = "parse-error"`

- [ ] **Step 1: 失敗するテストを書く**

`tests/rules/fixtures/parse-error/.oxlintrc.json`:

```json
{
  "plugins": [],
  "categories": {},
  "jsPlugins": ["../../../../src/index.ts"],
  "rules": {
    "graphql/parse-error": "error",
    "graphql/no-anonymous-operations": "error",
    "graphql/no-duplicate-fields": "error"
  }
}
```

`tests/rules/fixtures/parse-error/graphql.config.js`:

```js
export default { schema: "./schema.graphql" };
```

`tests/rules/fixtures/parse-error/schema.graphql`:

```graphql
type Query {
  user: String
}
```

`tests/rules/fixtures/parse-error/app.ts`:

```ts
const q = gql`
  query User {
`;
```

`tests/rules/parse-error.test.ts`:

```ts
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { runOxlint } from "../helpers/run-oxlint.js";

const fixtures = fileURLToPath(new URL("./fixtures/parse-error", import.meta.url));

describe("graphql/parse-error", () => {
  const result = runOxlint({ cwd: fixtures, args: ["app.ts"] });

  it("reports a syntax error exactly once, regardless of how many rules are enabled", () => {
    const diagnostics = result.diagnostics.filter((d) => d.code === "graphql(parse-error)");
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]!.message).toContain("Syntax Error");
  });

  it("keeps other rules silent on a document that failed to parse", () => {
    const others = result.diagnostics.filter(
      (d) => d.code.startsWith("graphql(") && d.code !== "graphql(parse-error)",
    );
    expect(others).toEqual([]);
  });

  it("points at the failing line in the host file", () => {
    const diagnostic = result.diagnostics.find((d) => d.code === "graphql(parse-error)");
    expect(diagnostic!.labels[0]!.span.line).toBe(3);
  });
});
```

注: 期待行番号は実測に合わせる。ホストファイル上で構文エラーが指す行であることが要件。

- [ ] **Step 2: テストが失敗することを確認する**

Run: `pnpm vitest run tests/rules/parse-error.test.ts`
Expected: FAIL（`graphql(parse-error)` の診断が 0 件）

- [ ] **Step 3: 実装する**

`src/rules/parse-error.ts`:

```ts
import { defineRule } from "@oxlint/plugins";
import type { Rule } from "@oxlint/plugins";
import { parseDocuments } from "../adapter/parse.js";
import { readSchemaSdl } from "../adapter/rule-factory.js";

export const PARSE_ERROR_RULE_ID = "parse-error";

export const parseErrorRule: Rule = defineRule({
  meta: {
    docs: {
      description:
        "Report GraphQL syntax errors found in embedded documents. Replaces ESLint's fatal parsing message.",
    },
  },
  createOnce(context) {
    return {
      Program() {
        const parsed = parseDocuments({
          code: context.sourceCode.text,
          filePath: context.physicalFilename,
          schemaSdl: readSchemaSdl(context.settings as Readonly<Record<string, unknown>>),
        });

        for (const document of parsed) {
          if (document.kind !== "error") continue;
          context.report({
            message: document.error.message,
            loc: {
              line: document.error.line + document.document.lineOffset,
              column: document.error.column,
            },
          });
        }
      },
    };
  },
} as Parameters<typeof defineRule>[0]);
```

`src/rules.ts` を修正:

```ts
import { rules as graphqlEslintRules } from "@graphql-eslint/eslint-plugin";
import type { Rule } from "@oxlint/plugins";
import { toOxlintRule } from "./adapter/rule-factory.js";
import type { GraphQLESLintRuleLike } from "./adapter/rule-factory.js";
import { PARSE_ERROR_RULE_ID, parseErrorRule } from "./rules/parse-error.js";

export const rules: Record<string, Rule> = {
  ...Object.fromEntries(
    Object.entries(graphqlEslintRules as unknown as Record<string, GraphQLESLintRuleLike>).map(
      ([ruleId, rule]) => [ruleId, toOxlintRule(ruleId, rule)],
    ),
  ),
  [PARSE_ERROR_RULE_ID]: parseErrorRule,
};
```

- [ ] **Step 4: テストを通す**

Run: `pnpm vitest run tests/rules`
Expected: PASS（Task 7 の 4 件 + 3 件）

- [ ] **Step 5: コミット**

```bash
git add -A
git commit -m "feat: add graphql/parse-error rule to report syntax errors once"
```

---

### Task 9: config の移植と JSON 断片の生成

**Files:**
- Create: `src/configs/index.ts`
- Create: `scripts/generate-config-json.ts`
- Modify: `src/index.ts`, `package.json`
- Test: `tests/configs/configs.test.ts`

**Interfaces:**
- Consumes: `PLUGIN_NAME` (Task 7)
- Produces:
  - `src/configs/index.ts`: `schemaRecommended`, `schemaAll`, `schemaRelay`, `operationsRecommended`, `operationsAll`（いずれも `{ jsPlugins: string[]; rules: Record<string, unknown> }`）と `configs: Record<string, OxlintGraphqlConfig>`
  - `configs/*.json`（ビルド時に生成）

- [ ] **Step 1: 失敗するテストを書く**

`tests/configs/configs.test.ts`:

```ts
import { configs as graphqlEslintConfigs } from "@graphql-eslint/eslint-plugin";
import { describe, expect, it } from "vitest";
import { configs, operationsRecommended } from "../../src/configs/index.js";

describe("configs", () => {
  it("ports every graphql-eslint flat config", () => {
    expect(Object.keys(configs).sort()).toEqual(
      [
        "operations-all",
        "operations-recommended",
        "schema-all",
        "schema-recommended",
        "schema-relay",
      ].sort(),
    );
  });

  it("renames rule ids from @graphql-eslint/* to graphql/*", () => {
    const sourceRules = Object.keys(
      (graphqlEslintConfigs as Record<string, { rules: Record<string, unknown> }>)[
        "flat/operations-recommended"
      ]!.rules,
    );

    expect(Object.keys(operationsRecommended.rules).sort()).toEqual(
      sourceRules.map((id) => id.replace("@graphql-eslint/", "graphql/")).sort(),
    );
  });

  it("keeps rule options untouched", () => {
    expect(operationsRecommended.rules["graphql/naming-convention"]).toEqual(
      (graphqlEslintConfigs as Record<string, { rules: Record<string, unknown> }>)[
        "flat/operations-recommended"
      ]!.rules["@graphql-eslint/naming-convention"],
    );
  });

  it("declares the plugin so extending a config is enough", () => {
    expect(operationsRecommended.jsPlugins).toEqual(["oxlint-plugin-graphql"]);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `pnpm vitest run tests/configs`
Expected: FAIL（`Cannot find module '../../src/configs/index.ts'`）

- [ ] **Step 3: 実装する**

`src/configs/index.ts`:

```ts
import { configs as graphqlEslintConfigs } from "@graphql-eslint/eslint-plugin";

export type OxlintGraphqlConfig = {
  jsPlugins: string[];
  rules: Record<string, unknown>;
};

const PLUGIN_SPECIFIER = "oxlint-plugin-graphql";

function port(configName: string): OxlintGraphqlConfig {
  const source = (graphqlEslintConfigs as unknown as Record<string, { rules: Record<string, unknown> }>)[
    `flat/${configName}`
  ];
  if (!source) throw new Error(`unknown graphql-eslint config: flat/${configName}`);

  return {
    jsPlugins: [PLUGIN_SPECIFIER],
    rules: Object.fromEntries(
      Object.entries(source.rules).map(([ruleId, value]) => [
        ruleId.replace("@graphql-eslint/", "graphql/"),
        value,
      ]),
    ),
  };
}

export const schemaRecommended = port("schema-recommended");
export const schemaAll = port("schema-all");
export const schemaRelay = port("schema-relay");
export const operationsRecommended = port("operations-recommended");
export const operationsAll = port("operations-all");

export const configs: Record<string, OxlintGraphqlConfig> = {
  "schema-recommended": schemaRecommended,
  "schema-all": schemaAll,
  "schema-relay": schemaRelay,
  "operations-recommended": operationsRecommended,
  "operations-all": operationsAll,
};
```

`src/index.ts` に追記:

```ts
export { configs, operationsAll, operationsRecommended, schemaAll, schemaRecommended, schemaRelay } from "./configs/index.js";
export type { OxlintGraphqlConfig } from "./configs/index.js";
```

- [ ] **Step 4: テストを通す**

Run: `pnpm vitest run tests/configs`
Expected: PASS（4 件）

- [ ] **Step 5: JSON 断片の生成スクリプトを書く**

`scripts/generate-config-json.ts`:

```ts
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { configs } from "../src/configs/index.js";

const outDir = join(process.cwd(), "configs");
mkdirSync(outDir, { recursive: true });

for (const [name, config] of Object.entries(configs)) {
  writeFileSync(join(outDir, `${name}.json`), `${JSON.stringify(config, null, 2)}\n`);
}

console.log(`wrote ${Object.keys(configs).length} config files to ${outDir}`);
```

`package.json` を修正:

```json
{
  "files": ["dist", "configs"],
  "scripts": {
    "build": "tsdown && node --experimental-strip-types scripts/generate-config-json.ts",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  }
}
```

- [ ] **Step 6: JSON 断片が生成されることを確認するテストを追加する**

`tests/configs/configs.test.ts` に追記:

```ts
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

it("emits a JSON fragment for each config", () => {
  execFileSync("node", ["--experimental-strip-types", "scripts/generate-config-json.ts"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });

  for (const name of Object.keys(configs)) {
    const path = join(process.cwd(), "configs", `${name}.json`);
    expect(existsSync(path), path).toBe(true);
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual(configs[name]);
  }
});
```

`.gitignore` に `configs/` を追加する（生成物なので追跡しない）。

Run: `pnpm vitest run tests/configs`
Expected: PASS（5 件）

- [ ] **Step 7: コミット**

```bash
git add -A
git commit -m "feat: port graphql-eslint configs and emit oxlintrc json fragments"
```

---

### Task 10: conformance ハーネス

**Files:**
- Create: `conformance/corpus.ts`
- Create: `conformance/run-eslint.ts`
- Create: `conformance/run-oxlint.ts`
- Create: `conformance/normalize.ts`
- Create: `conformance/conformance.test.ts`
- Create: `conformance/report.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `rules` (Task 8), `runOxlint` (Task 1)
- Produces:
  - `conformance/corpus.ts`: `buildCorpus(): CorpusCase[]`、`type CorpusCase = { ruleId: string; caseId: string; title: string; options: unknown[]; code: string }`
  - `conformance/normalize.ts`: `type NormalizedDiagnostic = { ruleId: string; line: number; column: number; endLine: number | null; endColumn: number | null; message: string }`、`normalizeEslint(...)`, `normalizeOxlint(...)`
  - `conformance/report.ts`: `renderTable(results: CaseResult[]): string`、`type CaseResult = { ruleId: string; caseId: string; passed: boolean; detail?: string }`

- [ ] **Step 1: コーパス生成を書き、失敗するテストで検証する**

`conformance/corpus.ts`:

```ts
import { rules as graphqlEslintRules } from "@graphql-eslint/eslint-plugin";

export type CorpusCase = {
  ruleId: string;
  caseId: string;
  title: string;
  options: unknown[];
  code: string;
};

type RuleExample = { title?: string; code: string; usage?: unknown[] };

export function buildCorpus(): CorpusCase[] {
  const cases: CorpusCase[] = [];

  for (const [ruleId, rule] of Object.entries(
    graphqlEslintRules as unknown as Record<string, { meta?: { docs?: { examples?: RuleExample[] } } }>,
  )) {
    const examples = rule.meta?.docs?.examples ?? [];
    examples.forEach((example, index) => {
      cases.push({
        ruleId,
        caseId: `${ruleId}-${index}`,
        title: example.title ?? `example ${index}`,
        options: example.usage ?? [],
        code: toEmbedded(example.code),
      });
    });
  }

  return cases;
}

/** examples の GraphQL を JS の gql テンプレートに埋め込む。両経路で同じ入力を使うため。 */
export function toEmbedded(graphql: string): string {
  return `const doc = gql\`\n${graphql.trimEnd()}\n\`;\n`;
}
```

`conformance/conformance.test.ts`（最初は最小）:

```ts
import { describe, expect, it } from "vitest";
import { buildCorpus } from "./corpus.js";

describe("conformance corpus", () => {
  const corpus = buildCorpus();

  it("covers every rule that documents examples", () => {
    expect(corpus.length).toBeGreaterThan(50);
  });

  it("embeds each example in a gql template", () => {
    for (const item of corpus) {
      expect(item.code.startsWith("const doc = gql`"), item.caseId).toBe(true);
    }
  });
});
```

Run: `pnpm vitest run conformance`
Expected: PASS（2 件）。件数の下限が実測より高すぎた場合は実測に合わせて下げる（ただし 1 ルールも落ちていないことを Step 4 のテストで別に保証する）。

- [ ] **Step 2: 両経路の実行と正規化を書く**

`conformance/normalize.ts`:

```ts
import type { OxlintDiagnostic } from "../tests/helpers/run-oxlint.js";

export type NormalizedDiagnostic = {
  ruleId: string;
  line: number;
  column: number;
  endLine: number | null;
  endColumn: number | null;
  message: string;
};

export type EslintMessage = {
  ruleId: string | null;
  line?: number;
  column?: number;
  endLine?: number;
  endColumn?: number;
  message: string;
};

export function normalizeEslint(messages: EslintMessage[]): NormalizedDiagnostic[] {
  return messages
    .map((message) => ({
      ruleId: (message.ruleId ?? "").replace("@graphql-eslint/", ""),
      line: message.line ?? 0,
      column: message.column ?? 0,
      endLine: message.endLine ?? null,
      endColumn: message.endColumn ?? null,
      message: message.message,
    }))
    .sort(byPosition);
}

export function normalizeOxlint(diagnostics: OxlintDiagnostic[], text: string): NormalizedDiagnostic[] {
  return diagnostics
    .map((diagnostic) => {
      const span = diagnostic.labels[0]!.span;
      const end = offsetToLineColumn(text, span.offset + span.length);
      return {
        ruleId: diagnostic.code.replace(/^graphql\((.*)\)$/, "$1"),
        line: span.line,
        column: span.column,
        endLine: span.length > 0 ? end.line : null,
        endColumn: span.length > 0 ? end.column : null,
        message: diagnostic.message,
      };
    })
    .sort(byPosition);
}

function byPosition(a: NormalizedDiagnostic, b: NormalizedDiagnostic): number {
  return a.line - b.line || a.column - b.column || a.ruleId.localeCompare(b.ruleId);
}

export function offsetToLineColumn(text: string, offset: number): { line: number; column: number } {
  const before = text.slice(0, offset);
  const lines = before.split("\n");
  return { line: lines.length, column: (lines[lines.length - 1]?.length ?? 0) + 1 };
}
```

`conformance/run-eslint.ts`:

```ts
import { Linter } from "eslint";
import graphqlEslint from "@graphql-eslint/eslint-plugin";
import { parser } from "@graphql-eslint/eslint-plugin";
import type { EslintMessage } from "./normalize.js";

export function lintWithEslint(input: {
  code: string;
  filePath: string;
  ruleId: string;
  options: unknown[];
}): EslintMessage[] {
  const linter = new Linter({ configType: "flat" });

  return linter.verify(
    input.code,
    [
      {
        files: ["**/*.ts"],
        plugins: { "@graphql-eslint": graphqlEslint as never },
        processor: "@graphql-eslint/graphql",
      },
      {
        files: ["**/*.graphql"],
        languageOptions: { parser: parser as never },
        plugins: { "@graphql-eslint": graphqlEslint as never },
        rules: {
          [`@graphql-eslint/${input.ruleId}`]: ["error", ...input.options] as never,
        },
      },
    ],
    input.filePath,
  ) as EslintMessage[];
}
```

`conformance/run-oxlint.ts`:

```ts
import { mkdtempSync, writeFileSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runOxlint } from "../tests/helpers/run-oxlint.js";
import type { OxlintDiagnostic } from "../tests/helpers/run-oxlint.js";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));

export function lintWithOxlint(input: {
  code: string;
  ruleId: string;
  options: unknown[];
  schemaPath: string;
}): OxlintDiagnostic[] {
  const dir = mkdtempSync(join(tmpdir(), "gql-conformance-"));
  cpSync(input.schemaPath, join(dir, "schema.graphql"));
  writeFileSync(join(dir, "graphql.config.js"), 'export default { schema: "./schema.graphql" };\n');
  writeFileSync(join(dir, "app.ts"), input.code);
  writeFileSync(
    join(dir, ".oxlintrc.json"),
    JSON.stringify({
      plugins: [],
      categories: {},
      jsPlugins: [join(projectRoot, "dist/index.js")],
      rules: { [`graphql/${input.ruleId}`]: ["error", ...input.options] },
    }),
  );

  return runOxlint({ cwd: dir, args: ["app.ts"] }).diagnostics.filter((d) =>
    d.code.startsWith("graphql("),
  );
}
```

- [ ] **Step 3: 差分比較テストを書いて失敗させる**

`conformance/conformance.test.ts` に追記（先頭の vitest import に `afterAll` を追加する）:

```ts
import { afterAll } from "vitest";
import { fileURLToPath } from "node:url";
import { buildCorpus } from "./corpus.js";
import { normalizeEslint, normalizeOxlint } from "./normalize.js";
import { lintWithEslint } from "./run-eslint.js";
import { lintWithOxlint } from "./run-oxlint.js";
import { renderTable } from "./report.js";
import type { CaseResult } from "./report.js";

const schemaPath = fileURLToPath(new URL("./fixtures/schema.graphql", import.meta.url));

describe("diagnostics match graphql-eslint", () => {
  const corpus = buildCorpus();
  const results: CaseResult[] = [];

  for (const item of corpus) {
    it(`${item.ruleId} :: ${item.title}`, () => {
      const eslintDiagnostics = normalizeEslint(
        lintWithEslint({
          code: item.code,
          filePath: "app.ts",
          ruleId: item.ruleId,
          options: item.options,
        }),
      );
      const oxlintDiagnostics = normalizeOxlint(
        lintWithOxlint({
          code: item.code,
          ruleId: item.ruleId,
          options: item.options,
          schemaPath,
        }),
        item.code,
      );

      const passed = JSON.stringify(eslintDiagnostics) === JSON.stringify(oxlintDiagnostics);
      results.push({
        ruleId: item.ruleId,
        caseId: item.caseId,
        passed,
        ...(passed ? {} : { detail: `eslint=${JSON.stringify(eslintDiagnostics)} oxlint=${JSON.stringify(oxlintDiagnostics)}` }),
      });

      expect(oxlintDiagnostics).toEqual(eslintDiagnostics);
    });
  }

  afterAll(() => {
    console.log(renderTable(results));
  });
});
```

`conformance/report.ts`:

```ts
export type CaseResult = { ruleId: string; caseId: string; passed: boolean; detail?: string };

export function renderTable(results: CaseResult[]): string {
  const byRule = new Map<string, { passed: number; total: number }>();
  for (const result of results) {
    const entry = byRule.get(result.ruleId) ?? { passed: 0, total: 0 };
    entry.total += 1;
    if (result.passed) entry.passed += 1;
    byRule.set(result.ruleId, entry);
  }

  const lines = ["| Rule | Cases | Pass rate |", "| --- | --- | --- |"];
  for (const [ruleId, entry] of [...byRule.entries()].sort()) {
    const rate = entry.total === 0 ? 0 : Math.round((entry.passed / entry.total) * 100);
    lines.push(`| \`graphql/${ruleId}\` | ${entry.total} | ${rate}% |`);
  }
  return lines.join("\n");
}
```

`conformance/fixtures/schema.graphql`: 全ルールの examples が参照する型を含む十分に広いスキーマを置く。まずは以下から始め、conformance の失敗理由が「スキーマに型がない」だった場合に必要な型を足していく。

```graphql
type Query {
  user(id: ID!): User
  users: [User!]!
  node(id: ID!): Node
}

type Mutation {
  createUser(input: CreateUserInput!): CreateUserPayload
}

interface Node {
  id: ID!
}

input CreateUserInput {
  name: String!
}

type CreateUserPayload {
  user: User
  query: Query
}

type User implements Node {
  id: ID!
  name: String
  email: String @deprecated(reason: "Use contact")
  friends(first: Int, after: String): UserConnection
}

type UserConnection {
  edges: [UserEdge]
  pageInfo: PageInfo!
}

type UserEdge {
  cursor: String!
  node: User
}

type PageInfo {
  hasNextPage: Boolean!
  hasPreviousPage: Boolean!
  startCursor: String
  endCursor: String
}
```

Run: `pnpm build && pnpm vitest run conformance`
Expected: 一部 FAIL。ここが本タスクの本体。

- [ ] **Step 4: 失敗ケースを 1 件ずつ潰す**

各失敗について、原因を「shim の不足」か「コーパス側の前提不足（スキーマに型がない、rule が `.graphql` ファイル名に依存している等）」に分類する。

- shim の不足なら `src/adapter/*` を直す。直したら該当のユニットテストも追加する。
- コーパス側の前提不足ならスキーマや fixture を足す。
- ルール自体が独立 `.graphql` ファイル前提で埋め込みでは動作しない（例: `match-document-filename`）場合は、**両経路が同じ結果を返すこと**が要件なので、両方で診断 0 件になっていれば pass 扱いで正しい。そうならない場合のみ調査する。

Run: `pnpm vitest run conformance`
Expected: 全 PASS。どうしても一致しないケースは `conformance/known-differences.ts` に理由付きで列挙し、テストからは除外して README の conformance テーブルに「既知の差異」として明示する。

- [ ] **Step 5: `package.json` に conformance スクリプトを足す**

```json
{
  "scripts": {
    "build": "tsdown && node --experimental-strip-types scripts/generate-config-json.ts",
    "test": "vitest run tests",
    "test:conformance": "pnpm build && vitest run conformance",
    "typecheck": "tsc --noEmit"
  }
}
```

- [ ] **Step 6: コミット**

```bash
git add -A
git commit -m "test: add conformance harness comparing diagnostics against graphql-eslint"
```

---

### Task 11: LSP 常駐向けのキャッシュ無効化

**Files:**
- Create: `src/adapter/config-watch.ts`
- Modify: `src/adapter/parse.ts`
- Test: `tests/adapter/config-watch.test.ts`

**Interfaces:**
- Consumes: `parseDocuments` / `clearParseCache` (Task 3)
- Produces: `src/adapter/config-watch.ts`: `getConfigFingerprint(filePath: string): string`、`invalidateIfConfigChanged(filePath: string, onChange: () => void): void`

graphql-config のロード結果とスキーマは graphql-eslint 側でモジュール singleton になっており、CLI では問題ないが常駐 LSP では古い値を引き続ける。設定ファイルとスキーマファイルの mtime を指紋にして、変化したら自前のパースキャッシュを捨て、graphql-eslint のモジュールを再読み込みする。

- [ ] **Step 1: 失敗するテストを書く**

`tests/adapter/config-watch.test.ts`:

```ts
import { cpSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { getConfigFingerprint } from "../../src/adapter/config-watch.js";

function project(): string {
  const dir = mkdtempSync(join(tmpdir(), "gql-watch-"));
  writeFileSync(join(dir, "graphql.config.js"), 'export default { schema: "./schema.graphql" };\n');
  writeFileSync(join(dir, "schema.graphql"), "type Query { a: Int }\n");
  return dir;
}

describe("getConfigFingerprint", () => {
  it("is stable while nothing changes", () => {
    const dir = project();
    const filePath = join(dir, "app.ts");

    expect(getConfigFingerprint(filePath)).toBe(getConfigFingerprint(filePath));
  });

  it("changes when the schema file is touched", () => {
    const dir = project();
    const filePath = join(dir, "app.ts");
    const before = getConfigFingerprint(filePath);

    const later = new Date(Date.now() + 2000);
    utimesSync(join(dir, "schema.graphql"), later, later);

    expect(getConfigFingerprint(filePath)).not.toBe(before);
  });

  it("changes when the graphql config file is touched", () => {
    const dir = project();
    const filePath = join(dir, "app.ts");
    const before = getConfigFingerprint(filePath);

    const later = new Date(Date.now() + 2000);
    utimesSync(join(dir, "graphql.config.js"), later, later);

    expect(getConfigFingerprint(filePath)).not.toBe(before);
  });

  it("ignores unrelated files", () => {
    const dir = project();
    const filePath = join(dir, "app.ts");
    const before = getConfigFingerprint(filePath);

    cpSync(join(dir, "schema.graphql"), join(dir, "other.graphql"));

    expect(getConfigFingerprint(filePath)).toBe(before);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `pnpm vitest run tests/adapter/config-watch.test.ts`
Expected: FAIL（`Cannot find module '../../src/adapter/config-watch.js'`）

- [ ] **Step 3: 実装する**

`src/adapter/config-watch.ts`:

```ts
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const CONFIG_FILE_NAMES = [
  "graphql.config.ts",
  "graphql.config.js",
  "graphql.config.mjs",
  "graphql.config.cjs",
  "graphql.config.json",
  "graphql.config.yaml",
  "graphql.config.yml",
  ".graphqlrc",
  ".graphqlrc.ts",
  ".graphqlrc.js",
  ".graphqlrc.json",
  ".graphqlrc.yaml",
  ".graphqlrc.yml",
  "package.json",
];

const fingerprints = new Map<string, string>();

export function getConfigFingerprint(filePath: string): string {
  const parts: string[] = [];

  for (const configPath of findConfigFiles(filePath)) {
    parts.push(`${configPath}:${mtime(configPath)}`);
    for (const schemaPath of schemaFilesOf(configPath)) {
      parts.push(`${schemaPath}:${mtime(schemaPath)}`);
    }
  }

  return parts.join("|");
}

export function invalidateIfConfigChanged(filePath: string, onChange: () => void): void {
  const key = dirname(resolve(filePath));
  const current = getConfigFingerprint(filePath);
  if (fingerprints.get(key) !== current) {
    fingerprints.set(key, current);
    onChange();
  }
}

function findConfigFiles(filePath: string): string[] {
  let dir = dirname(resolve(filePath));
  const found: string[] = [];

  for (;;) {
    for (const name of CONFIG_FILE_NAMES) {
      const candidate = join(dir, name);
      if (existsSync(candidate)) found.push(candidate);
    }
    if (found.length > 0) return found;

    const parent = dirname(dir);
    if (parent === dir) return found;
    dir = parent;
  }
}

/** 設定ファイル本文から相対パスのスキーマ指定を拾う。URL 指定は無視する。 */
function schemaFilesOf(configPath: string): string[] {
  let content: string;
  try {
    content = statSync(configPath).isFile() ? readFileSync(configPath, "utf8") : "";
  } catch {
    return [];
  }

  const matches = content.matchAll(/["'`]([^"'`\s]+\.(?:graphql|graphqls|gql|json))["'`]/g);
  const dir = dirname(configPath);
  const paths: string[] = [];
  for (const match of matches) {
    const candidate = resolve(dir, match[1]!);
    if (existsSync(candidate)) paths.push(candidate);
  }
  return paths;
}

function mtime(path: string): number {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return 0;
  }
}
```

`src/adapter/parse.ts` を修正して、`parseDocuments` の先頭でキャッシュ無効化を挟む:

```ts
import { invalidateIfConfigChanged } from "./config-watch.js";

export function parseDocuments(options: {
  code: string;
  filePath: string;
  schemaSdl?: string;
}): ParsedDocument[] {
  invalidateIfConfigChanged(options.filePath, () => {
    cache.clear();
  });

  // 以降は従来どおり
```

- [ ] **Step 4: テストを通す**

Run: `pnpm vitest run tests/adapter`
Expected: PASS（既存分 + 4 件）

- [ ] **Step 5: graphql-eslint 側の singleton が残る場合の扱いを決める**

`tests/adapter/config-watch.test.ts` に追記:

```ts
it("re-reads the schema after it changes within the same process", async () => {
  const dir = project();
  const filePath = join(dir, "app.ts");
  const { clearParseCache, parseDocuments } = await import("../../src/adapter/parse.js");
  clearParseCache();

  const first = parseDocuments({ code: "const q = gql`{ a }`;\n", filePath });
  if (first[0]!.kind !== "parsed") throw new Error("expected a parsed document");
  expect(first[0]!.services.schema?.getQueryType()?.getFields().b).toBeUndefined();

  writeFileSync(join(dir, "schema.graphql"), "type Query { a: Int\n b: Int }\n");
  const later = new Date(Date.now() + 2000);
  utimesSync(join(dir, "schema.graphql"), later, later);

  const second = parseDocuments({ code: "const q = gql`{ a }`;\n", filePath });
  if (second[0]!.kind !== "parsed") throw new Error("expected a parsed document");
  expect(second[0]!.services.schema?.getQueryType()?.getFields().b).toBeDefined();
});
```

Run: `pnpm vitest run tests/adapter/config-watch.test.ts`
Expected: このテストが FAIL する場合、graphql-eslint のモジュール singleton が原因。その場合は次のいずれかを実装して通す。

1. `parse.ts` から graphql-eslint の parser を動的 import し、無効化時にクエリ文字列付き URL（`?v=<fingerprint>`）で再 import してモジュール状態をリセットする。
2. それが不可能なら、このテストを `it.skip` にし、README の「既知の制限」に「エディタ内でスキーマを変更した場合は oxc language server の再起動が必要」と明記する。skip の理由をテストのコメントに書く。

- [ ] **Step 6: コミット**

```bash
git add -A
git commit -m "feat: invalidate parse cache when graphql config or schema changes"
```

---

### Task 12: E2E（`--fix` / suggestion / 複数ルール）

**Files:**
- Create: `tests/e2e/fixtures/app/*`
- Test: `tests/e2e/plugin.test.ts`

**Interfaces:**
- Consumes: `runOxlint` (Task 1)、ビルド済み `dist/index.js` (Task 9 の build スクリプト)
- Produces: なし（回帰テストのみ）

- [ ] **Step 1: フィクスチャを作る**

`tests/e2e/fixtures/app/.oxlintrc.json`:

```json
{
  "plugins": [],
  "categories": {},
  "jsPlugins": ["../../../../dist/index.js"],
  "rules": {
    "graphql/no-anonymous-operations": "error",
    "graphql/require-selections": "error",
    "graphql/no-duplicate-fields": "error"
  }
}
```

`tests/e2e/fixtures/app/graphql.config.js`:

```js
export default { schema: "./schema.graphql" };
```

`tests/e2e/fixtures/app/schema.graphql`:

```graphql
type Query {
  user: User
}

type User {
  id: ID!
  name: String
}
```

`tests/e2e/fixtures/app/app.ts`:

```ts
const q = gql`
  query {
    user {
      name
      name
    }
  }
`;
```

- [ ] **Step 2: テストを書いて失敗させる**

`tests/e2e/plugin.test.ts`:

```ts
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { runOxlint } from "../helpers/run-oxlint.js";

const fixture = fileURLToPath(new URL("./fixtures/app", import.meta.url));

function copyFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "gql-e2e-"));
  cpSync(fixture, dir, { recursive: true });
  return dir;
}

describe("oxlint-plugin-graphql end to end", () => {
  it("reports diagnostics from several rules on one file", () => {
    const result = runOxlint({ cwd: fixture, args: ["app.ts"] });
    const codes = result.diagnostics.map((d) => d.code).sort();

    expect(codes).toContain("graphql(no-anonymous-operations)");
    expect(codes).toContain("graphql(no-duplicate-fields)");
    expect(codes).toContain("graphql(require-selections)");
  });

  it("applies suggestions from graphql-eslint with --fix-suggestions", () => {
    const dir = copyFixture();
    runOxlint({ cwd: dir, args: ["--fix-suggestions", "app.ts"] });

    const after = readFileSync(join(dir, "app.ts"), "utf8");
    expect(after).not.toBe(readFileSync(join(fixture, "app.ts"), "utf8"));
    expect(after).toContain("gql`");
  });

  it("uses settings.graphql.schemaSdl when no graphql-config is present", () => {
    const dir = mkdtempSync(join(tmpdir(), "gql-e2e-settings-"));
    cpSync(join(fixture, "app.ts"), join(dir, "app.ts"));
    writeFileSync(
      join(dir, ".oxlintrc.json"),
      JSON.stringify({
        plugins: [],
        categories: {},
        jsPlugins: [join(fileURLToPath(new URL("../..", import.meta.url)), "dist/index.js")],
        settings: { graphql: { schemaSdl: "type Query { user: User }\ntype User { id: ID! name: String }" } },
        rules: { "graphql/no-anonymous-operations": "error" },
      }),
    );

    const result = runOxlint({ cwd: dir, args: ["app.ts"] });

    expect(result.diagnostics.map((d) => d.code)).toContain("graphql(no-anonymous-operations)");
  });

  it("leaves files outside the embedded document untouched", () => {
    const dir = copyFixture();
    runOxlint({ cwd: dir, args: ["--fix-suggestions", "app.ts"] });

    const after = readFileSync(join(dir, "app.ts"), "utf8");
    expect(after.startsWith("const q = gql`")).toBe(true);
    expect(after.trimEnd().endsWith("`;")).toBe(true);
  });
});
```

Run: `pnpm build && pnpm vitest run tests/e2e`
Expected: 一部 FAIL の可能性あり（suggestion の受け渡し）。

- [ ] **Step 3: 失敗を潰す**

suggestion が適用されない場合は `rule-factory.ts` の `suggest` 受け渡しを oxlint の `Suggestion` 型（`desc` または `messageId` のいずれか必須、`fix` 必須）に合わせて直す。直したら `tests/adapter/report-mapper.test.ts` に対応するユニットテストを足す。

Run: `pnpm build && pnpm vitest run tests/e2e`
Expected: PASS（4 件）

- [ ] **Step 4: コミット**

```bash
git add -A
git commit -m "test: cover multi-rule diagnostics and suggestion fixes end to end"
```

---

### Task 13: README・CI・リリース準備

**Files:**
- Create: `README.md`
- Create: `.github/workflows/ci.yml`
- Create: `.changeset/config.json`
- Modify: `package.json`

**Interfaces:**
- Consumes: `renderTable` (Task 10)
- Produces: 公開可能なパッケージ

- [ ] **Step 1: README を書く**

`README.md` に以下を必ず含める。

- 何をするパッケージか（graphql-eslint のルールを oxlint で動かすブリッジ）
- インストール（`pnpm add -D oxlint-plugin-graphql @graphql-eslint/eslint-plugin graphql`）
- `.oxlintrc.json` の例:

```json
{
  "jsPlugins": ["oxlint-plugin-graphql"],
  "rules": {
    "graphql/no-anonymous-operations": "error",
    "graphql/require-selections": "error"
  }
}
```

- config を extends する例（JSON とも TS とも）:

```json
{
  "extends": ["./node_modules/oxlint-plugin-graphql/configs/operations-recommended.json"]
}
```

```ts
import { defineConfig } from "oxlint";
import { operationsRecommended } from "oxlint-plugin-graphql";

export default defineConfig({ extends: [operationsRecommended] });
```

- `overrides[].jsPlugins` で対象を絞る例
- **制限事項**（必須）:
  - `.graphql` / `.gql` ファイルは対象外。oxlint が custom parser 未対応のため。それらは ESLint + graphql-eslint を併用する。併用時の設定例も載せる。
  - `.vue` / `.svelte` は対象外。
  - `graphql.config` は変更不要。`parserOptions.schema` 等の v4 で廃止された指定は使えない。
  - 構文エラーは `graphql/parse-error` が 1 回だけ報告する（ESLint の fatal message の代替）。
  - プラグイン名が将来 oxlint のネイティブ名と衝突した場合の alias 回避方法。
  - Task 11 Step 5 で skip を選んだ場合はエディタ内でのスキーマ変更に再起動が必要であること。
- conformance テーブル（`pnpm test:conformance` の出力を貼る）
- VS Code で診断が出ること（`oxc.oxc-vscode`）

- [ ] **Step 2: CI を書く**

`.github/workflows/ci.yml`:

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        node: ["22.12", "24", "26"]
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node }}
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm typecheck
      - run: pnpm build
      - run: pnpm test
      - run: pnpm test:conformance
```

- [ ] **Step 3: Changesets を入れる**

Run: `pnpm add -D @changesets/cli && pnpm changeset init`
`package.json` の scripts に `"release": "pnpm build && changeset publish"` を追加する。

- [ ] **Step 4: 全テストとビルドを通す**

Run: `pnpm typecheck && pnpm build && pnpm test && pnpm test:conformance`
Expected: すべて PASS

- [ ] **Step 5: コミット**

```bash
git add -A
git commit -m "docs: add README, CI workflow and release tooling"
```

---

## 残作業（この計画の外）

- 実プロジェクト規模での性能実測（spec 第 11 節 7）。conformance が通った後、大きめのリポジトリで `--debug=timings` を取って README に載せる。
- `.graphql` ファイル対応。oxlint が custom parser に対応したら `src/adapter/documents.ts` に分岐を追加する。
