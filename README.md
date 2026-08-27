🇬🇧 [English version](README.en.md)

# Dexter JP — 日本株の自律型リサーチエージェント

> 質問から調査を計画し、複数のデータソースと決定論的な分析Engineを横断して、根拠と制約を明示したレポートまで仕上げる。

[EDINET DB](https://edinetdb.jp) + [J-Quants](https://jpx-jquants.com/) で動く、日本株特化の金融AIエージェント。
[virattt/dexter](https://github.com/virattt/dexter)（米国株版）をフォークし、日本市場向けに全面改修。

Dexter JPは個人・ローカル利用向けのリサーチソフトウェアです。投資助言、証券会社への発注、自動売買は行いません。取得できないデータを0や推測値で補いません。

![Dexter JP Demo](docs/demo.png)

## ただのツールではない

よくある金融ツールは「スクリーニングできます」「財務データ見れます」で終わる。Dexter JPは違う。

**「ソニーと任天堂を、財務・バリュエーション・リスクの根拠付きで比較して」** と聞くと:

1. まず計画を立てる — 比較に必要な指標（収益性、成長性、財務健全性、リスク）を自分で決める
2. 複数のツールを自律的に呼び出す — 両社の財務データ、有報のリスク要因、決算短信を並列取得
3. 途中で検証する — 数字とナラティブに矛盾がないか、データが足りているか自分で判断
4. レポートを仕上げる — 比較表、条件付きシナリオ、リスクを含む構造化された分析結果を出力

これを1回の質問で、人間が介在せずにやる。ツールを1つ呼ぶだけの「データ取得」ではなく、複数のデータソースを横断した「分析」が自動で走る。

## 現在の主な分析機能

- Fundamental / Valuation / Peer Comparison
- SMA・ATR・Swing・trendに加え、RSI14・MACD・Bollinger Bandsを含むTechnical
- 信用取引のSupply & Demandと、公開空売り残高報告
- 投資部門別の市場flow、TOPIX / 東証33業種との比較、業種別空売り売買代金
- 実績・会社予想・配当性向と、利用可能な配当eventを扱うAdvanced Dividend
- 日足OHLCVによる推定Volume Profile、POC、VAH、VAL
- source根拠がある場合だけ作るdeterministic Entry / Stop / Target候補
- Canonical AnalysisSnapshot V9、分析履歴、Local Dashboard、Analysis Watchlist

重要な金融・統計計算はTypeScriptのdeterministic Engineが行い、AIはstructured resultを解釈します。Volume Profileは日足OHLCVから作る推定分布であり、実際の投資家取得単価や真のしこり玉を示すものではありません。POC / VAH / VALも自動的な売買signalではありません。

## セットアップ

### 必要なもの

- [Bun](https://bun.sh/)
- LLM APIキー（以下のいずれか1つ）
- [EDINET DB](https://edinetdb.jp) APIキー

J-Quantsを設定すると、株価、Technical、需給、市場・業種比較、空売り、投資部門別、配当、Volume Profileなどの市場データ分析が利用できます。利用可能なendpointと履歴は契約プランやデータ提供状況に依存します。

### 環境変数

`.env`に設定するもの:

```bash
# === 必須 ===

# LLM（いずれか1つ。複数設定してもOK、CLI上で切替可能）
OPENAI_API_KEY=sk-...          # OpenAI（デフォルト）
ANTHROPIC_API_KEY=sk-ant-...   # Claude
GOOGLE_API_KEY=...             # Gemini
XAI_API_KEY=...                # Grok
MOONSHOT_API_KEY=...           # Kimi
DEEPSEEK_API_KEY=...           # DeepSeek
OPENROUTER_API_KEY=...         # OpenRouter（複数モデル利用可）

# 日本株データ
EDINETDB_API_KEY=edb_...       # edinetdb.jp で取得（無料枠あり）

# === オプション ===

# 日本市場データ（利用可能範囲はJ-Quantsの契約プランに依存）
JQUANTS_API_KEY=...            # jpx-jquants.com で取得

# Web検索（設定するとweb_search toolが有効化され、CLIでproviderを選択可能）
EXASEARCH_API_KEY=...
PERPLEXITY_API_KEY=...
TAVILY_API_KEY=...
LANGSEARCH_API_KEY=...

# X/Twitter検索
X_BEARER_TOKEN=...

# ローカルLLM
OLLAMA_BASE_URL=http://127.0.0.1:11434
```

### インストール & 起動

```bash
git clone https://github.com/teriykiumai/dexter-jp.git
cd dexter-jp
bun install
cp env.example .env  # 編集してAPIキーを設定
bun run start
```

詳しい操作、Snapshot互換性、Dashboard、data-dateとunavailableの扱いは[Usage Guide](Usage.md)を参照してください。

## 使い方の例

### 自律的な分析（エージェントの真価）

複雑な問いを投げると、Dexterが自分で計画を立て、複数のデータソースを横断し、レポートを仕上げる:

```
トヨタの競争力を総合分析して。財務データ、有報のリスク要因、最新決算を踏まえてレポートにまとめて

ソニーと任天堂を、財務健全性・収益性・成長性・リスクで比較し、強みと条件付きシナリオを整理して

高ROE・高配当の割安銘柄を探して、トップ3の財務健全性と事業リスクを深掘り分析して

キーエンスのDCFバリュエーションをして。前提と現在の株価水準との差を示して
```

### シンプルな質問もOK

```
トヨタの直近5年の財務推移を見せて

ROE15%以上、自己資本比率50%以上の企業をスクリーニングして

任天堂の有報のリスク要因を読んで

配当利回り4%以上の高配当銘柄を探して
```

### 英語でも動く

```
Analyze Toyota's competitiveness. Cover financials, risk factors from the annual report, and latest earnings.

Compare Sony and Nintendo using financial health, profitability, growth, and risk evidence. State the conditions behind the conclusion.
```

## SnapshotとLocal Dashboard

Standard Agentの総合分析は、structured source/Engine resultからCanonical AnalysisSnapshotを生成し、`.dexter/analysis/`へ履歴とlatestを保存します。現在のwriterはV9で、V1〜V8の既存履歴もreadableかつimmutableです。

```bash
bun run dashboard
```

`http://127.0.0.1:3000/`で、保存済み銘柄のAnalysis Watchlist、最新分析、履歴、Single Stock Dashboardを確認できます。DashboardはSnapshot値を表示するPresentation Layerであり、金融値をBrowserで再計算しません。Snapshot生成は現在Standard Agent runが対象で、Claude Agent SDK modeは未接続です。

## アーキテクチャ

```
ユーザーの質問
    ↓
Standard Agent / Claude Agent SDK
    ↓ 計画 → ツール選択 → 実行 → 検証
┌─────────────────────────────────────────┐
│  get_financials（メタツール）             │
│    → get_financial_statements           │
│    → get_company_info                   │
│    → get_key_ratios                     │
│    → get_analysis                       │
│    → get_earnings                       │
├─────────────────────────────────────────┤
│  read_filings                           │
│    → text-blocks（有報テキスト）          │
│    → shareholders（大量保有報告書）       │
├─────────────────────────────────────────┤
│  company_screener（100+ 指標）           │
├─────────────────────────────────────────┤
│  get_stock_price（J-Quants V2）          │
├─────────────────────────────────────────┤
│  deterministic finance analysis Engines │
├─────────────────────────────────────────┤
│  web_search / browser / skills          │
└─────────────────────────────────────────┘
    ↓
structured result → AIによる解釈 → レポート
    ↓ Standard Agent comprehensive analysis
Canonical AnalysisSnapshot V9
    ↓
Local JSON → Read-only API → Dashboard / Watchlist
```

### メタツールの仕組み

`get_financials`は単なるAPIラッパーではない。内部にLLMを持つ**ルーティングエージェント**:

1. ユーザーの自然言語クエリを受け取る
2. 内部LLMがどのサブツールを呼ぶべきか判断
3. 複数サブツールを並列実行
4. 結果を統合して返す

「ソニーとトヨタの利益率を比較して」→ 内部で4つのAPI呼び出しが自動で走る。

### スキルシステム

複雑な多段階ワークフローは`SKILL.md`で定義。DCFバリュエーションスキルを内蔵:
- 日本国債利回りベースのWACC計算
- 東証PBR1倍割れ問題の文脈
- 円建て分析

### リサーチルール（`.dexter/RULES.md`）

自分の投資スタイルや分析方針をMarkdownで定義できる。設定した内容がシステムプロンプトに自動で反映され、Dexterの行動指針になる。

```bash
mkdir -p .dexter
cp RULES.md.example .dexter/RULES.md
# 自分のルールに書き換える
```

CLIで `/rules` と入力すると現在のルールを確認できる。

設定例:
- 分析時は必ず同業他社5社と比較する
- 財務指標はJPY百万円で表示する
- バリュー投資基準（ROE > 10%、PBR < 1.5）でスクリーニングする

### コンテキスト圧縮

長時間のリサーチセッションで大量のデータを取得した場合、高速LLMが自動的にデータをサマリに圧縮してコンテキストを節約する。単純なデータ削除ではなく、重要な数値・結論を保持した要約を生成するため、セッションを通じた分析の整合性が保たれる。

### メモリ

セッション間で記憶を保持。投資方針、ポートフォリオ情報、過去の分析結果を覚える。

### 対応LLM

`/model`コマンドでCLI上から切替可能です。現在のprovider registryはOpenAI、
Anthropic、Google、xAI、Moonshot、DeepSeek、OpenRouter、Ollama、Claude Agent SDKを
扱います。利用可能な個別modelはprovider側で変更されるため、CLIの選択肢を確認して
ください。

### Claude Agent SDK モード

`@anthropic-ai/claude-agent-sdk` 経由で動く実行モード。エージェントのループを SDK に委譲し、**認証は SDK が解決する**（Dexter は認証フローを実装しない）。

- `/model` で **Claude Agent SDK** プロバイダを選び、モデル（claude-fable-5 / claude-opus-4-8 / claude-sonnet-4-6）を選ぶだけで使える。API キーの入力は求められない。
- 認証は SDK が解決する。**Claude Code のログイン**、`CLAUDE_CODE_OAUTH_TOKEN`、`ANTHROPIC_API_KEY` のいずれでも動作する。どれが使われるかは SDK が環境から判断する。
- Claude プラン（Pro/Max）で Agent SDK を利用できるかの条件は Anthropic の公式ヘルプを参照（[Use the Claude Agent SDK with your Claude plan](https://support.claude.com/en/articles/15036540)）。制度は変更される可能性がある。
- 個人の資格情報でのみ使うこと。マルチユーザー向けサービスとして提供しない。
- **課金経路の確認**: `ANTHROPIC_API_KEY` や `CLAUDE_CODE_USE_BEDROCK` / `CLAUDE_CODE_USE_VERTEX` など従量課金の資格情報が環境にある場合、起動時に検出結果を表示し、意図しない課金経路で走らないよう停止する（fail-loud）。その経路で実行したい場合は `DEXTER_AGENT_SDK_ALLOW_METERED=1` を設定して再実行する。
- コスト上限を設けたい場合は `DEXTER_AGENT_SDK_MAX_BUDGET_USD`（USD）を設定する。SDK 側の見積りがこの値に達すると停止する。
- このモードでは Dexter の財務・データツールを「そのままのデータを返す」形で SDK に渡し、メインモデル自身が解釈する（ツール内部で LLM を再呼び出ししない）。SDK 組み込みのツール（Bash / Write / WebSearch 等）は使わない。

> 注: 本モードの利用可否・料金は Anthropic 側の仕様変更に依存する。ここでは「無料」「追加課金なし」といった断定はしない。実際にどの資格情報が使われるかは起動時の表示で確認できる。

### メッセージング連携

CLIだけでなく、Slack・Discord経由でも使える。`bun run gateway` で起動:

| チャネル | 方式 | 公開URL | 環境変数 |
|---------|------|---------|---------|
| **Slack** | Socket Mode (WebSocket) | 不要 | `SLACK_BOT_TOKEN` + `SLACK_APP_TOKEN` |
| **Discord** | Gateway (WebSocket) | 不要 | `DISCORD_BOT_TOKEN` |
| **LINE** | Webhook (HTTP) | 必要 | `LINE_CHANNEL_SECRET` + `LINE_CHANNEL_ACCESS_TOKEN` |
| WhatsApp | Baileys (WebSocket) | 不要 | QRコードでログイン |

設定された環境変数に応じて、対応するチャネルだけが起動する。複数チャネル同時稼働可能。

#### Slack Bot セットアップ

1. [api.slack.com/apps](https://api.slack.com/apps) → **Create New App** → From scratch
2. **Socket Mode** → Enable → App-Level Token を生成（`xapp-`で始まるトークン）
3. **OAuth & Permissions** → Bot Token Scopes に追加:
   - `chat:write`, `im:history`, `im:read`, `app_mentions:read`
4. **Event Subscriptions** → Enable Events → Subscribe to bot events:
   - `message.im`（DM受信）, `app_mention`（メンション受信）
5. **App Home** → Messages Tab を ON → 「Allow users to send Slash commands and messages from the messages tab」にチェック
6. **Install to Workspace** → Bot Token（`xoxb-`で始まる）をコピー
7. `.env` に設定:
   ```bash
   SLACK_BOT_TOKEN=xoxb-...
   SLACK_APP_TOKEN=xapp-...
   ```

サーバー内ではスレッド返信、DMでは直接返信。

#### Discord Bot セットアップ

1. [discord.com/developers/applications](https://discord.com/developers/applications) → **New Application**
2. **Bot** → Reset Token → Bot Token をコピー
3. **Bot** → Privileged Gateway Intents → **Message Content Intent** を ON
4. **OAuth2** → URL Generator:
   - Scopes: `bot`
   - Bot Permissions: `Send Messages`, `Read Message History`, `Send Messages in Threads`
5. 生成されたURLをブラウザで開いてサーバーに招待
6. `.env` に設定:
   ```bash
   DISCORD_BOT_TOKEN=MTQ4...
   ```

サーバー内では `@Bot名` メンションでスレッド返信、DMでは直接返信。

#### LINE Bot セットアップ

LINEはWebhook方式のため、外部からアクセス可能なURLが必要（Slack/Discordとは異なる）。

1. [LINE Official Account Manager](https://manager.line.biz/) で **LINE公式アカウントを作成**
   - LINE Developersコンソールから直接Messaging APIチャネルは作成できない（2026年時点）
2. LINE Official Account Manager → **設定** → **Messaging API** → **「Messaging APIを利用する」**
   - プロバイダーを選択（既存でOK）
3. [LINE Developersコンソール](https://developers.line.biz/console/) → 該当チャネル → **Messaging API設定** タブ:
   - **チャネルアクセストークン（長期）** → 発行
   - **Webhook URL** → `https://{your-domain}/webhook/line` を設定
   - **Webhookの利用** → ON
   - **Webhookの再送** → OFF（重複処理防止）
4. LINE Official Account Manager → **設定** → **応答設定**:
   - **応答メッセージ** → OFF
   - **あいさつメッセージ** → OFF
5. **チャネル基本設定** タブからChannel Secretを取得
6. `.env` に設定:
   ```bash
   LINE_CHANNEL_SECRET=your-channel-secret
   LINE_CHANNEL_ACCESS_TOKEN=your-channel-access-token
   WEBHOOK_PORT=3000  # デフォルト
   ```

公開URL（Webhook）の用意:
- **ローカルテスト**: `ngrok http 3000` → 生成されたURL + `/webhook/line` をWebhook URLに設定
- **本番運用**: 長寿命プロセスを維持できるサービスにデプロイ（サーバーレス不可）
  - [Railway](https://railway.app/) — `Dockerfile` 追加するだけ。無料枠あり。最も手軽
  - [Fly.io](https://fly.io/) — `fly launch` で数分。無料枠あり
  - [Render](https://render.com/) — Background Worker として起動。無料枠あり
  - Google Cloud Run（min-instances=1）
  - 自前のVPS / VPC
  - **Vercel / Netlify は不可**（サーバーレスのため長寿命プロセスを維持できない）

#### 起動

```bash
bun run gateway    # 設定済みの全チャネルが同時に起動
```

## データソース

| ソース | 内容 | 必須？ |
|--------|------|--------|
| [EDINET DB](https://edinetdb.jp) | 財務データ、有報テキスト、スクリーニング、AI分析（~3,800社） | 必須 |
| [J-Quants](https://jpx-jquants.com/) | 株価・需給・空売り・投資部門別・業種指数・配当等の日本市場データ（plan/history制約あり） | オプション |
| Web検索 | Exa / Perplexity / Tavily / LangSearch | オプション |

## オリジナル版（米国株）との違い

| | Original (US) | JP Version |
|---|---|---|
| データソース | Financial Datasets API | EDINET DB API |
| 市場 | 米国株 | 日本株（~3,800社） |
| 開示書類 | SEC 10-K/10-Q/8-K | 有価証券報告書 (EDINET) |
| 決算 | 8-K earnings | TDNet 決算短信 |
| 株主情報 | SEC Form 4（インサイダー） | 大量保有報告書（5%超） |
| 株価 | Financial Datasets | J-Quants V2（TSE公式） |
| スクリーニング | GICS分類 | 33業種、100+指標 |
| DCF | 米国金利（~4%） | 日本国債（~1%） |
| 言語 | 英語 | 日本語 + 英語 |

## ライセンス

MIT

## クレジット

- オリジナル [Dexter](https://github.com/virattt/dexter) by [@virattt](https://github.com/virattt)
- 財務データ: [EDINET DB](https://edinetdb.jp)
- 株価データ: [J-Quants](https://jpx-jquants.com/)
