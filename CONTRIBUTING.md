# コントリビューションガイド

Dexter JP へのコントリビューションを歓迎します。

## 開発環境のセットアップ

```bash
git clone https://github.com/edinetdb/dexter-jp.git
cd dexter-jp
bun install
cp env.example .env
```

`.env` に以下を設定:
- **EDINETDB_API_KEY** — [edinetdb.jp](https://edinetdb.jp) で無料取得
- **LLM APIキー** — OPENAI_API_KEY、GOOGLE_API_KEY 等いずれか1つ

## 開発コマンド

```bash
bun run start        # 起動
bun run dev          # ウォッチモード
bun run typecheck    # 型チェック
bun test             # テスト実行
```

## コードの構造

```
src/
  agent/         # エージェントループ、プロンプト、スクラッチパッド
  tools/
    finance/     # EDINET DB / J-Quants ツール群（ここが日本版の核心）
    search/      # Web検索（Exa, Perplexity, Tavily）
    browser/     # Playwright ブラウザ
  gateway/
    channels/    # メッセージング連携（Slack, Discord, LINE, WhatsApp）
    group/       # グループメンション検知、メッセージ履歴バッファ
    routing/     # チャネル→エージェントのルーティング
  skills/        # SKILL.md ワークフロー（DCF等）
  model/         # LLM抽象化（マルチプロバイダー）
  memory/        # 永続メモリ
  utils/         # キャッシュ、設定、ロガー
```

## Pull Requestの手順

1. フォークしてブランチを作成
2. 変更を実装
3. `AGENTS.md` の「Tests and validation」と対象計画に従い、変更リスクに応じた検証を実施する。対象計画の必須検証とCIは省略しない
4. 公開の承認を得てDraft PRを作成（日本語・英語どちらでもOK）。レビューとMerge Gateは `docs/REVIEW_POLICY.md` に従う

## ツールの追加方法

新しい金融データツールを追加する場合:

1. `src/tools/finance/` に新しい `.ts` ファイルを作成
2. `DynamicStructuredTool` で定義（既存ファイルを参考に）
3. `src/tools/finance/index.ts` でexport
4. メタツール（`get-financials.ts` or `read-filings.ts`）のルーティングに追加、または `src/tools/registry.ts` に直接登録

## EDINET DB API

APIドキュメント: [edinetdb.jp/docs](https://edinetdb.jp/docs)

主要エンドポイント:
- `GET /v1/search` — 企業検索
- `GET /v1/companies/{edinet_code}` — 企業詳細
- `GET /v1/companies/{edinet_code}/financials` — 財務時系列
- `GET /v1/companies/{edinet_code}/text-blocks` — 有報テキスト
- `GET /v1/companies/{edinet_code}/earnings` — 決算短信
- `GET /v1/companies/{edinet_code}/shareholders` — 大量保有報告書
- `GET /v1/screener` — スクリーニング

## ライセンス

MIT。コントリビューションも同ライセンスの下で公開されます。
