# oxlint-plugin-graphql 設計

- 日付: 2026-08-27
- ステータス: 設計確定（実装計画待ち）
- リポジトリ: ya2s/oxlint-plugin-graphql

## 1. 目的

`@graphql-eslint/eslint-plugin` のルールを oxlint 上で実行できるようにする npm 公開パッケージ
`oxlint-plugin-graphql` を作る。graphql-eslint のルール実装は再実装せず、そのまま実行する。

## 2. 前提（調査で確定した事実）

### oxlint 側（v1.80.0 / JS Plugins は alpha）

- `.oxlintrc.json` または `oxlint.config.ts` の `jsPlugins` に import specifier を書いてプラグインを読み込む。
  パスは設定ファイル相対で解決される。`overrides[n].jsPlugins` でファイル glob 単位の適用も可能。
- ESLint v9 互換の plugin API。`create` / `createOnce`（`@oxlint/plugins` の `eslintCompatPlugin`）、
  visitor、selector、scope、SourceCode API、fix、suggestion、inline disable directive に対応。
- `context.report` の `Diagnostic` 型は `node` と `loc` のいずれか必須、`message` と `messageId` の
  いずれか必須。`loc` は `{ start, end? }` または `{ line, column }`。
  **JS AST ノードを持たない埋め込み GraphQL の位置にも報告できる。**
- `fix.range` はそのファイルのソース先頭からのオフセット基準。`suggest[].fix` も同形式。
- `context.filename` / `context.physicalFilename` / `context.settings`（JSON 値のみ）/ `context.options` が利用可能。
- JS プラグインの診断は language server 経由で IDE に出る（VS Code 拡張 `oxc.oxc-vscode`）。
  suggestion / quick-fix / fix-on-save も対象。
- 未対応: custom file formats と custom parser（Svelte / Vue / Angular 等）、型情報依存ルール。
  **`.graphql` / `.gql` ファイルを oxlint がリントすることは現時点で不可能。**
- `extends` の意味論: `.oxlintrc.json` では設定ファイルへのパスの配列（設定ファイル相対）。
  `oxlint.config.ts` では `OxlintConfig[]` を直接渡す。JS プラグインの `configs` は読まれない。
- ネイティブ plugin 名は `eslint / react / unicorn / typescript / oxc / import / jsdoc / jest /
  vitest / jsx-a11y / nextjs / react-perf / promise / node / vue`。`graphql` は未使用。

### graphql-eslint 側（v4.4.1）

- ルール本体は GraphQL AST を ESTree 風に変換したツリーを visit する。動作に custom parser が必須。
- `parser.parseForESLint(code, options)` は **ESLint に依存しない純関数**。戻り値は
  `{ ast, services: { schema, siblingOperations } }`。
- `processor.preprocess(code, filePath)` も **ESLint に依存しない純関数**。戻り値は
  `[...blocks, code]` で、各 block は `{ filename, text, lineOffset, offset }`。
  `graphql-tag-pluck` の実行、graphql-config の `extensions.pluckConfig` 解決、
  キーワード不在時の早期リターンまで内包する。
- `postprocess` は `message.line += lineOffset`、`endLine` も同様、`fix.range` と
  `suggestions[].fix.range` に `offset` を加算する。column は補正しない。
- graphql-config は `loadConfigSync`（`rootDir` はリント対象ファイルからの相対探索、
  `throwOnMissing: false`、code-file-loader 拡張つき）で読む。`graphql-config` は `jiti` を
  持つため `graphql.config.ts` も同期ロードできる。
- ロード済み config はモジュールスコープの singleton、スキーマは `ModuleCache`（lifetime 10 秒）。
- ルールが使う context の面は `report` / `options` / `filename` と
  `sourceCode` の `getText` / `ast` / `parserServices` / `getNodeByRangeIndex` /
  `getTokenBefore` / `getTokenAfter` / `getCommentsBefore` / `getCommentsAfter` /
  `getAllComments` / `getAncestors` のみ。
- 全ルールが `meta.docs.examples`（`{ title: "Incorrect" | "Correct", code, usage? }`）を持つ。
- v4 で `parserOptions.schema` 等の指定は廃止され、指定すると例外になる。

### Node のサポート状況（2026-08-27 時点）

- v20: EOL 済み（2026-04-30）
- v22: Maintenance LTS、EOL 2027-04-30
- v24: Active LTS、EOL 2028-04-30
- v26: Current、2026-10-28 に LTS 化予定

## 3. スコープ

### やること

- JS / TS ファイル中に埋め込まれた GraphQL ドキュメント（`gql` タグ付きテンプレート、
  `/* GraphQL */` マジックコメント等、`graphql-tag-pluck` が扱える形式すべて）のリント。
- graphql-eslint の全ルールを同名で公開する。schema 系ルール（`require-description` など）は
  JS / TS に埋め込まれた SDL に対して機能する。独立した `.graphql` ファイルには適用できない。
- graphql-eslint に存在しない追加ルールとして `graphql/parse-error` を 1 本だけ設ける（第 8 節）。
- graphql-eslint の全 config（`flat/schema-recommended` / `flat/schema-all` / `flat/schema-relay` /
  `flat/operations-recommended` / `flat/operations-all`）相当を移植する。本家と同様に `-all` は
  `-recommended` のルールを含む合成とする。
- autofix と suggestion の透過。
- 既存の `graphql.config.*` をそのまま使う。

### やらないこと

- `.graphql` / `.gql` ファイルのリント。oxlint 側が custom parser 未対応のため不可能。
  README で「`.graphql` ファイルは ESLint + graphql-eslint を併用する」と明記する。
- `.vue` / `.svelte` 中の埋め込み。oxlint 側が未対応。
- 型情報依存の機能。graphql-eslint には該当ルールがないため実害なし。
- graphql-eslint のルール実装の再実装や改変。

### 将来対応の余地

oxlint が custom parser / custom file format に対応した時点で、`adapter/documents.ts` に
「`.graphql` ファイルはオフセット 0 の単一ドキュメントを返す」分岐を足すだけで乗る構造にする。
他の層は変更不要とする。

## 4. アーキテクチャ

方式は「自前アダプタ」。ESLint ランタイムには依存せず、graphql-eslint の parser と processor は
そのまま再利用し、ESLint ランタイムの代役だけを自作する。

```
src/
  index.ts                 プラグイン本体 (meta / rules)。default export
  rules.ts                 本家 rules を列挙して rule-factory でラップ
  adapter/
    rule-factory.ts        graphql-eslint ルール → oxlint ルール変換
    documents.ts           埋め込み抽出（本家 processor.preprocess を呼ぶ）。将来の .graphql 分岐点
    parse.ts               本家 parseForESLint 呼び出しとファイル単位キャッシュ
    source-code.ts         GraphQL ESTree 用 SourceCode shim（自作）
    traverse.ts            visitor walker（自作）
    context.ts             context shim（自作）
    report-mapper.ts       仮想ドキュメント座標 → ホストファイル座標の変換（自作）
  configs/                 本家 configs をルール接頭辞差し替えで移植
  meta.ts                  name / version
```

自作は `source-code.ts` / `traverse.ts` / `context.ts` / `report-mapper.ts` の 4 ファイルのみ。
互換性リスクはこの 4 ファイルに閉じ込め、第 9 節の conformance テストで担保する。

各モジュールの責務:

- `documents.ts`: ファイル本文とパスを受け、`EmbeddedDocument[]`（`{ text, lineOffset, offset }`）を返す。
  埋め込みが無ければ空配列。
- `parse.ts`: `EmbeddedDocument` を `parseForESLint` に通し、`{ ast, services }` またはパースエラーを返す。
- `source-code.ts`: GraphQL ESTree に対する ESLint 互換 `SourceCode`。第 2 節で列挙した面のみ実装する。
- `traverse.ts`: ノードの `type` を見て再帰する walker。`:exit`、`parent`、`getAncestors` 用の
  スタックを管理する。`parseForESLint` は `visitorKeys` を返さないため、ESLint の fallback と同じ
  「オブジェクト値を走査して `type` を持つものを子とみなす」方式を実装する。
- `context.ts`: `report` / `options` / `filename` / `physicalFilename` / `settings` / `sourceCode` /
  `getSourceCode()` / `id` を持つ shim。`report` は `report-mapper.ts` に委譲する。
- `report-mapper.ts`: `messageId` + `data` を本家 `meta.messages` から文字列へ解決し、
  line / endLine に `lineOffset` を、fix と suggestion の range に `offset` を加算して
  oxlint の `context.report` に渡す。

## 5. データフロー（1 ファイルの処理）

1. 各ルールは `createOnce` で定義し、**`Program` visitor** で発火する。`before` フックは
   「将来 AST の内容次第で呼ばれなくなる可能性がある」と公式ドキュメントに明記があるため使わない。
   JS AST は一切参照しない。
2. `context.sourceCode.text` を取得し、`documents.ts` → `parse.ts` を通す。結果は
   **モジュールスコープの LRU（既定 8 エントリ、キーはファイル名、本文一致で検証）** に格納する。
   oxlint は 1 ファイルにつき有効ルール数だけ visitor を呼ぶため、このキャッシュが無いと
   N 重解析になる。キャッシュにより pluck・GraphQL パース・スキーマ取得はファイルごとに 1 回。
3. 各ドキュメントについて `context` / `SourceCode` shim を構築し、本家ルールの
   `create(shimContext)` を呼び、`traverse.ts` で visitor を回す。
4. ルールの report を `report-mapper.ts` が変換して oxlint に渡す。

## 6. 設定インターフェース

- スキーマと documents は **既存の `graphql.config.*` をそのまま使う**。`loadOnDiskGraphQLConfig`
  相当をそのまま呼ぶため、`projects`、`extensions.pluckConfig`、`package.json` の `graphql`
  フィールドも現状のまま効く。ESLint 固有の設定ではないので移行時に変更は不要。
- oxlint には `parserOptions` に相当する口が無いため、インライン SDL を渡す逃げ道として
  `.oxlintrc.json` の `settings.graphql.schemaSdl`（文字列）を受ける。指定時は
  `parseForESLint` の `schemaSdl` 経路に渡す。既定は graphql-config 自動探索。
- graphql-eslint v4 で廃止された `parserOptions.schema` 等は本家が例外を投げる。README に明記する。
- **LSP 常駐プロセスでのキャッシュ無効化**: graphql-config の singleton とスキーマの `ModuleCache`
  は CLI 前提の寿命設定なので、常駐 LSP では設定やスキーマを編集しても古い値を引き続ける恐れがある。
  `graphql.config.*` と（ファイル指定の）スキーマファイルの mtime を記録し、変化したら
  自前キャッシュを破棄し graphql-config を再ロードする。本家の singleton を跨げない場合は
  該当モジュールの再読み込み、それも不可なら「エディタ再読み込みが必要」を README に明記する。
  実挙動は第 11 節の検証項目とする。

## 7. ルール ID と config の配布

- `meta.name = "graphql"`。ルール ID は `graphql/no-anonymous-operations` のように本家と同名で揃える。
  ネイティブ plugin 名と衝突していないことは確認済み。将来衝突した場合は `jsPlugins` の
  alias で回避できる旨を README に書く。
- oxlint は JS プラグインの `configs` を読まないため、config は 2 形態で配布する。
  - `oxlint.config.ts` 向け: `extends` に渡せる設定オブジェクトを named export する。
  - `.oxlintrc.json` 向け: `extends: ["./node_modules/oxlint-plugin-graphql/configs/operations-recommended.json"]`
    のように参照できる JSON 断片を同梱する。
- `overrides[].jsPlugins` を使って GraphQL 関連ルールを特定の glob だけに適用する例を README に載せる。

## 8. エラーハンドリング

- **GraphQL の構文エラー**: 専用ルール `graphql/parse-error`（recommended 収録）だけが報告し、
  他のルールは該当ドキュメントを黙ってスキップする。全ルールが報告すると有効ルール数だけ
  重複するため。ESLint では fatal message として 1 回だけ出る挙動の代替であることを README に明記する。
- **スキーマ / graphql-config のロード失敗**: 例外を投げる。設定ミスであり fail fast が正しい。
  本家も同じ挙動。
- **pluck 失敗**: 無視する（JS 側の構文エラーは oxlint 本体が報告するため二重に出さない）。
- **ルール実行時の想定外の例外**: ルール ID とファイルパスを添えて再スローする。プラグインが
  黙って結果を落とさないようにする。

## 9. 互換性の担保（conformance）

目標は graphql-eslint との完全一致。ルール本体は本家コードをそのまま実行するので、差が出るのは
自作 shim 4 ファイルのみ。これを測定可能にする。

- **コーパス自動生成**: 全ルールの `meta.docs.examples` から fixture を生成する。`usage` が
  ルールオプションに対応する。ルール追加時も自動追従し、全ルール網羅が構造的に保証される。
  fixture は examples のコードを JS / TS の `gql` テンプレートに埋め込んだ形で生成し、
  参照実装側も同じ JS ファイルを processor 経路で処理する。両経路の入力ファイルを同一にすることで、
  ファイル種別の違いが比較結果に混入しないようにする。
- **差分オラクル**: 各ケースを 2 経路で実行して比較する。
  - (a) ESLint + graphql-eslint（parser + processor 経路） … 参照実装
  - (b) oxlint + 本プラグイン
  比較対象は `ruleId` / `severity` / `line` / `column` / `endLine` / `endColumn` / `message` /
  `suggestions` / `--fix` 後の出力の完全一致。
- **conformance テーブル**を README に出力する（ルール別 pass 率）。CI で graphql-eslint の
  バージョンを上げたときに差分が即座に検出される。
- `eslint` は devDependency としてのみ使う（参照実装の実行用）。runtime 依存には含めない。
- ユニットテストは `oxlint/plugins-dev` の `RuleTester` を使う。
- E2E は fixture プロジェクトで実際に `oxlint` CLI を実行し、`--format json` 出力と
  `--fix` 適用結果を比較する。

残余リスク: ESLint の `SourceCode` の境界条件（token 取得系など）で差が出る可能性はゼロではない。
ただし差異は必ず conformance テストで赤くなるため、隠れた非互換にはならない。

## 10. パッケージング

- パッケージ名: `oxlint-plugin-graphql`（公式の `oxlint-plugin-eslint` と同じ命名規約）。
- `engines.node`: `>=22.12.0`。oxlint の下限に揃え、EOL の Node 20 を落とす。
  開発環境（`.node-version`）は Active LTS の v24。CI マトリクスは 22.12 / 24 / 26。
- ESM のみ。TypeScript で実装し、ビルドは **tsdown**（内部で rolldown 1.2 と
  rolldown-plugin-dts を使用。d.ts 生成と exports 整合を設定ゼロで得るため）。
- 依存:
  - dependencies: `@oxlint/plugins`
  - peerDependencies: `@graphql-eslint/eslint-plugin`, `graphql`
  - devDependencies: `oxlint`, `eslint`, `vitest`, `typescript`, `tsdown`
- パッケージマネージャは pnpm。
- CI は GitHub Actions（lint / test / build / conformance）、リリースは Changesets。
- README に必ず書く項目: `.graphql` ファイルは対象外であること、ESLint 併用の手順、
  `graphql.config` は変更不要であること、`graphql/parse-error` の挙動、conformance テーブル、
  plugin 名衝突時の alias 回避方法。

## 11. 実装前に潰す検証項目

実装計画の最初のフェーズで、小さな実測により以下を確定する。ここで前提が崩れた場合は設計に戻る。

1. （検証済み 2026-08-27）JS プラグインから `context.settings` は読める。`.oxlintrc.json` の
   `settings` がそのままオブジェクトとして届く。
2. （検証済み 2026-08-27）`context.report` の `loc.column` は ESLint と同じ 0-based。
   `{ line: 1, column: 6 }` で報告すると oxlint の JSON 出力は `line: 1, column: 7`（1-based 表示）、
   `offset: 6` になる。`loc.end` を与えると `span.length` に反映される。
   したがって column の補正は不要で、本家 `postprocess` と同じく line のみ補正する。
   なお oxlint の JSON 出力は `diagnostics[].labels[].span` 形式で ESLint の JSON とは構造が異なるため、
   conformance 比較には両者を共通形へ正規化する層が必要。
3. LSP 常駐時のキャッシュ挙動。`graphql.config` とスキーマを編集したときに診断が更新されるか。
4. oxlint の JS プラグインが worker thread で動く場合に、graphql-config の `jiti` 経由の
   `graphql.config.ts` 同期ロードが成功すること。
5. `oxlint/plugins-dev` の `RuleTester` が `loc` ベースの report を検証できること。
6. oxlint の suggestion の受け渡し形状が graphql-eslint の suggestion と対応づけられること。
7. 実プロジェクト規模での性能（LRU キャッシュが効いていること、スキーマロードが 1 回で済むこと）。
