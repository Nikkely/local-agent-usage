# local-agent-usage

このマシンの **ローカルログ** を読んで、AI コーディングエージェント
（**Claude Code** と **OpenAI Codex CLI**）のトークン消費量を週・月単位で
可視化するローカル HTML ダッシュボードを生成する CLI です。API キーは不要です。

## 使い方

```bash
npx local-agent-usage                          # 過去30日・全エージェント
npx local-agent-usage --days 90                # 期間指定
npx local-agent-usage --source codex           # Codex のみ
npx local-agent-usage --output report.html     # 出力先指定
npx local-agent-usage --open false             # ブラウザ自動オープン無効
```

API キーは不要です。ローカルのセッションログを直接読みます。

## データソース

| ソース   | 読み取り元                    | 上書き用 env          |
| -------- | ----------------------------- | --------------------- |
| `claude` | `~/.claude/projects/**/*.jsonl` | `CLAUDE_PROJECTS_DIR` |
| `codex`  | `~/.codex/sessions/**/*.jsonl`  | `CODEX_SESSIONS_DIR`  |
| `all`    | 上記両方（マージ + エージェント別内訳） | —                     |

`--source all`（既定）では、片方のログが見つからない場合は警告してスキップし、
両方とも空のときだけエラーになります。`--source claude` / `--source codex` を
明示した場合は、そのログが無ければエラーになります。

## オプション

| オプション        | 既定値                     | 説明                                         |
| ----------------- | -------------------------- | -------------------------------------------- |
| `--days <n>`      | `30`                       | さかのぼる日数                               |
| `--output <path>` | `local-agent-usage.html`   | 出力 HTML ファイル                           |
| `--source <src>`  | `all`                      | 読み取るエージェント: `claude` / `codex` / `all` |
| `--open <bool>`   | `true`                     | レポートをブラウザで自動オープン             |
| `-h, --help`      | —                          | ヘルプ表示                                   |

## 可視化

ダークテーマ / monospace の Chart.js ダッシュボード:

1. 週別 積み上げ棒グラフ（Input / Output）
2. 月別 積み上げ棒グラフ
3. 累積トークン 折れ線グラフ（週・月 切替）
4. 日別詳細 棒グラフ（Input / Output / Cache read / Cache write）
5. 日別エージェント内訳 棒グラフ（`all` かつ複数ソースがある場合のみ）
6. サマリーカード（合計トークン・キャッシュ・推定コスト・ピーク日）

## コスト計算（概算）

Sonnet 4.6 レートを基準にした **概算**です（全エージェントに同じレートを適用）:

| 種別        | $/MTok |
| ----------- | ------ |
| Input       | 3.00   |
| Output      | 15.00  |
| Cache write | 3.75   |
| Cache read  | 0.30   |

> モデル別の集計はしていないため、金額はあくまで目安です。Codex のトークンも
> 同じレートで概算しています。

## 仕組み / 注意点

- **Claude**: セッションログの `type: "assistant"` 行の `usage` を集計。resume/fork
  で重複するメッセージは `message.id` + `requestId` で重複排除します。
- **Codex**: `token_count` イベントの `total_token_usage`（セッション内累積）の
  **差分** を各イベントに割り当てて集計します。`last_token_usage` の単純合計は
  実ログ上で過大計上になるため採用していません。`cached_input_tokens` は
  cache read、uncached input は `input_tokens − cached_input_tokens` として扱い、
  Codex には cache write の概念が無いため 0 とします。
- 日付は **ローカルタイムゾーン** で集計します（両ソース共通）。

## 開発

```bash
npm install
npm run build      # dist/ へコンパイル
node dist/cli.js --help
```

## License

MIT
