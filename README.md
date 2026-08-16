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
npx local-agent-usage --insights               # 傾向分析をテキストで標準出力
npx local-agent-usage --insights --json        # 同じ内容を JSON で
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
| `--insights`      | `false`                    | HTML の代わりに傾向分析をテキスト出力        |
| `--json`          | `false`                    | `--insights` の内容を JSON で出力            |
| `-h, --help`      | —                          | ヘルプ表示                                   |

## 可視化

ダークテーマ / monospace の Chart.js ダッシュボード:

1. 週別 積み上げ棒グラフ（Input / Output）
2. 月別 積み上げ棒グラフ
3. 累積トークン 折れ線グラフ（週・月 切替）
4. 日別詳細 棒グラフ（Input / Output / Cache read / Cache write）
5. 日別エージェント内訳 棒グラフ（`all` かつ複数ソースがある場合のみ）

さらに **Insights セクション**（傾向が読み取れるパネル群）:

7. モデル構成の週次推移（100% 積み上げ）
8. プロジェクト別 横棒（使い捨てパス — `worktrees` / `/private/var/folders` / `tmp` — は色分け）
9. セッション集中度（ローレンツ曲線：セッションを小さい順に並べた累積トークンシェア。破線 = 完全均等）
10. 週次 効率トレンド（棒 = tokens/稼働日、線 = $/MTok と cache read 比率）
11. 曜日 × 時間帯 ヒートマップ

**解釈文は載せません。** 埋め込んだ示唆はデータが動いた瞬間に嘘になるので、
グラフは事実だけを出し、読み取りは都度 LLM（`/usage-insights` スキル）に任せます。

## 傾向分析（`--insights`）

HTML レポートが「どれだけ使ったか」を出すのに対し、`--insights` は
「使い方がどう変わっているか / どこに消えているか」を出します。日次集計では
捨てている **プロジェクト / モデル / セッション / 時刻** の軸を保ったまま集計:

- 全体サマリ（input・output・cache read/write の内訳、稼働日あたり・セッションあたり）
- エージェント別シェアと初回・最終利用日
- 月次・週次トレンド（tok/day、out/call、cache read 比率、前期比）
- プロジェクト別 上位（cwd 単位。Claude と Codex は同じパスでまとまります）
- モデル別（初回・最終利用日つきなので移行時期が分かる）
- 時間帯ヒストグラム / 曜日別
- セッションサイズ分布（p10 / p50 / p90 / max、上位 10% のシェア）

`--json` を付けると同じ集計を JSON で出せるので、そのまま別ツールに渡せます。

Claude Code から使う場合は `/usage-insights` スキル
（`.claude/skills/usage-insights/`）が、この出力を読んで日本語の示唆に
まとめるところまでやります。

## コスト計算（概算）

Sonnet 4.6 レートを基準にした **概算**です（全エージェントに同じレートを適用）:

| 種別        | $/MTok |
| ----------- | ------ |
| Input       | 3.00   |
| Output      | 15.00  |
| Cache write | 3.75   |
| Cache read  | 0.30   |

> モデル別のレートは当てていないため、金額はあくまで目安です。Codex のトークンも
> 同じレートで概算しています。請求額としては使えないので、HTML レポートの
> サマリーカードには合計金額を出していません（`--insights` の表と週次
> $/MTok 線では、期間どうしの相対比較に使う前提で残しています）。

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
