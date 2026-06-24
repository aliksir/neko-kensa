> English version: [README.md](README.md)
> [neko-HQ](https://github.com/aliksir/neko-hq) エコシステムの一部です。

# neko-kensa (Japanese / 日本語)

[code-graph](https://github.com/nicolo-ribaudo/code-graph) MCP サーバーの SQLite データベースを活用したコード品質検査ツール。ゼロ依存設計。

code-graph の `index_repository` コマンドで生成された `graph.db` をクエリし、デッドコード検出・循環依存分析・構造的リント・リポジトリ統計・インタラクティブな依存グラフ可視化を提供します。npm 依存パッケージは一切不要です。

## インストール

```bash
npm install -g neko-kensa
```

または直接実行:

```bash
npx neko-kensa --help
```

## 前提条件

neko-kensa は [code-graph](https://github.com/nicobailon/code-graph) が生成する `graph.db` ファイルを必要とします。neko-kensa 単体ではコードを解析しません。事前に構築された SQLite データベースを読み取ります。

1. **Node.js >= 22.0.0**（組み込みの `node:sqlite` モジュールを使用）
2. **code-graph を MCP サーバーとして追加**（`.mcp.json` または Claude Code の設定）:
   ```json
   {
     "mcpServers": {
       "code-graph": {
         "command": "npx",
         "args": ["-y", "code-graph-mcp"]
       }
     }
   }
   ```
3. **Claude Code で `index_repository` を実行**して `graph.db` を生成:
   ```
   index_repository ツールを使って /path/to/your/repo をインデックスしてください
   ```
   これにより `~/.code-graph/graph.db` が生成されます。neko-kensa はこれを読み取り専用で参照します。
4. **neko-kensa のコマンドを実行**します。

## コマンド一覧

| コマンド | 説明 | 類似ツール |
|---------|------|-----------|
| `dead`  | エントリポイントから到達不能なファイルを検出 | [Knip](https://knip.dev/) |
| `deps`  | 循環依存とルール違反を検出 | [dependency-cruiser](https://github.com/sverweij/dependency-cruiser) |
| `stats` | リポジトリ統計を表示（ファイル数・シンボル数・言語別） | -- |
| `graph` | インタラクティブな HTML 依存/クラス/呼出グラフを生成 | [Astah](https://astah.net/) |
| `lint`  | 構造的なコード品質チェック | [Biome](https://biomejs.dev/) |

## 使い方

```
neko-kensa dead  [path] [--entry <file>...]  [--json] [--db <path>]
neko-kensa deps  [path] [--rules <file>]     [--json] [--db <path>]
neko-kensa stats                             [--json] [--db <path>]
neko-kensa graph <type> [--out <file>] [--dir]        [--db <path>]
neko-kensa lint  [--rules <file>]            [--json] [--db <path>]
```

### オプション

| オプション | 対象コマンド | 説明 |
|-----------|-------------|------|
| `--entry <file>` | `dead` | エントリポイントファイルを指定（複数指定可） |
| `--rules <file>` | `deps`, `lint` | ルールファイルのパス（デフォルト: `.neko-kensa.json`） |
| `--json` | `dead`, `deps`, `stats`, `lint` | JSON 形式で出力 |
| `--out <file>` | `graph` | HTML をファイルに書き出す（指定しない場合は標準出力） |
| `--dir` | `graph deps` | ディレクトリ単位で依存グラフを集約 |
| `--db <path>` | 全コマンド | graph.db のパス（デフォルト: `~/.code-graph/graph.db`） |

## 使用例

### デッドコード検出

```bash
# package.json からエントリポイントを自動検出
neko-kensa dead .

# エントリポイントを手動指定
neko-kensa dead . --entry src/index.mjs --entry src/cli.mjs

# CI 向け JSON 出力
neko-kensa dead . --json
```

### 循環依存検出

```bash
# 循環を検出
neko-kensa deps

# カスタムルールを適用
neko-kensa deps --rules .neko-kensa.json
```

### 依存ルール設定 (`.neko-kensa.json`)

```json
{
  "rules": [
    {
      "name": "no-ui-in-core",
      "type": "forbid",
      "from": { "pathPattern": "^src/core/" },
      "to": { "pathPattern": "^src/ui/" },
      "message": "core モジュールは UI モジュールに依存してはならない",
      "severity": "error"
    }
  ],
  "lint": {
    "large-file": { "max": 500 },
    "high-fan-out": { "max": 20 }
  }
}
```

### リポジトリ統計

```bash
neko-kensa stats
# Repository: /path/to/repo
# Files: 142
# Symbols: 1,203
# Dependencies: 856
# Circular dependencies: 2
#
# By language:
#   TypeScript  98 files
#   JavaScript  31 files
#   CSS         13 files
```

### インタラクティブグラフ可視化

```bash
# ファイル依存グラフ（HTML）
neko-kensa graph deps --out deps.html

# ディレクトリレベルの依存グラフ
neko-kensa graph deps --dir --out deps-dir.html

# クラス継承階層
neko-kensa graph class --out class.html

# 関数呼び出しグラフ
neko-kensa graph calls --out calls.html
```

生成される HTML は完全自己完結型で、インタラクティブな Canvas（パン・ズーム・ホバーツールチップ）を内蔵しています。表示に外部依存は不要です。

### 構造的リント

```bash
neko-kensa lint
# [large-file] (3 issues)
#   W src/generated/parser.ts: 1204 lines (max: 300)
#   W src/utils/helpers.ts: 450 lines (max: 300)
#   ...
#
# [high-fan-out] (1 issues)
#   W src/index.ts: 22 imports (max: 15)
#
# Summary: 4 issues (0 errors, 4 warnings)
```

#### リントルール

| ルール | デフォルト | 説明 |
|-------|-----------|------|
| `large-file` | 最大: 300行 | 行数が閾値を超えるファイル |
| `high-fan-out` | 最大: 15インポート | 外向き依存が多すぎるファイル |
| `high-fan-in` | 最大: 20依存元 | 他から依存されすぎているファイル |
| `deep-inheritance` | 最大: 5階層 | 継承チェーンが深すぎるクラス |
| `many-symbols` | 最大: 30シンボル | シンボルを多く公開しすぎているファイル |
| `unresolved-import` | -- | 解決できないインポート |

全ての閾値は `.neko-kensa.json` で設定可能です。

## 終了コード

| コード | 意味 |
|-------|------|
| 0 | 問題なし |
| 1 | 問題検出（デッドファイル・循環依存・リント違反） |

## アーキテクチャ

```
neko-kensa
  |-- src/
  |   |-- cli.mjs    エントリポイント・引数解析
  |   |-- db.mjs     graph.db の読み取り専用 SQLite ラッパー
  |   |-- dead.mjs   デッドコード検出（BFS 到達性解析）
  |   |-- deps.mjs   循環依存検出（Tarjan の SCC アルゴリズム）・ルール検査
  |   |-- stats.mjs  リポジトリ統計の集計
  |   |-- graph.mjs  インタラクティブ HTML グラフ生成（力学モデルレイアウト）
  |   |-- lint.mjs   構造的品質チェック
  |-- tests/         node:test ベースのテストスイート
  |-- package.json
```

## ライセンス

MIT
