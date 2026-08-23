# Dexter JP Usage Guide

Dexter JP の日本株分析機能と、Phase 1.5 で追加した Local Web Visualization を利用するための操作手順です。

このガイドでは、次の一連の流れを扱います。

```text
CLIで日本株を分析
        ↓
Canonical AnalysisSnapshot生成
        ↓
.dexter/analysis/ に自動保存
        ↓
Local Dashboard起動
        ↓
Analysis Watchlist
        ↓
Single Stock Dashboard
```

Phase 1.5 の構成は以下です。

| Version | 機能 |
|---|---|
| V1 | Canonical AnalysisSnapshot |
| V2 | Local JSON Persistence |
| V3 | Local Read-only Web API |
| V4 | Single Stock Dashboard |
| V5 | Analysis Portfolio / Watchlist |

---

# 1. Requirements

## Runtime

- Bun
- Git

## Data API

日本株分析では以下を利用します。

- EDINET DB
- J-Quants

## LLM

Standard Agentでは、対応するLLM providerを1つ以上設定します。

例:

```env
OPENAI_API_KEY=sk-...
```

ほかにAnthropic、Google、xAI、OpenRouter、Ollama等も利用できます。

---

# 2. Setup

リポジトリをcloneします。

```bash
git clone https://github.com/teriykiumai/dexter-jp.git
cd dexter-jp
```

依存関係をinstallします。

```bash
bun install
```

`.env`を作成します。

```bash
cp env.example .env
```

Windows PowerShellの場合:

```powershell
Copy-Item env.example .env
```

最低限、以下を設定します。

```env
OPENAI_API_KEY=sk-...
EDINETDB_API_KEY=edb_...
JQUANTS_API_KEY=...
```

LLM providerはOpenAI以外でも構いません。

ただし、Phase 1.5 のSnapshot / Dashboardを含む日本株総合分析では、EDINET DBとJ-Quantsの両方を使用することを推奨します。

J-Quantsが利用できない場合、以下のようなsectionが取得できず、Snapshotが`partial`になる可能性があります。

- 株価
- Technical
- Supply & Demand
- Market Correlation
- Strategy
- Price History

---

# 3. CLIを起動する

```bash
bun run start
```

Dexter JPのCLIが起動します。

---

# 4. Modelを確認・変更する

CLIで以下を入力します。

```text
/model
```

利用するmodel/providerを選択します。

## Snapshot生成時の注意

現在、Canonical AnalysisSnapshotの生成は **Standard Agent run** を対象としています。

Claude Agent SDKモードでは分析自体を実行できますが、現在のPhase 1.5 Snapshot生成経路には接続されていません。

そのためDashboardへ保存する分析を行う場合は、Standard Agentを使用してください。

```text
Standard Agent
    ↓
comprehensive-analysis
    ↓
Canonical AnalysisSnapshot
    ↓
Local JSON保存
```

Claude Agent SDKについては、現在:

```text
Claude Agent SDK
    ↓
分析レポート
    ↓
Snapshot生成なし
```

となります。

MarkdownからSnapshotを復元するfallbackは行いません。

---

# 5. 日本株を総合分析する

例えばトヨタ自動車を分析する場合:

```text
7203を分析して
```

または:

```text
トヨタ自動車を総合分析して
```

広い企業分析要求では、`comprehensive-analysis` workflowが使用されます。

分析では主に次の項目を取得・計算します。

```text
Fundamental
Valuation
Peer Comparison
Technical
Supply & Demand
Market Correlation
Strategy
Price History
Bull / Base / Bear
Risks
Data Dates
```

重要な金融指標はLLMではなくdeterministic engineが計算します。

基本原則:

```text
Code calculates.
AI interprets.
```

---

# 6. AnalysisSnapshot

Standard Agentによるcomprehensive analysisが正常終了すると、分析結果からCanonical AnalysisSnapshotが生成されます。

保存先:

```text
.dexter/
└─ analysis/
   └─ <ticker>/
      ├─ latest.json
      └─ <snapshotId>.json
```

7203の場合:

```text
.dexter/
└─ analysis/
   └─ 7203/
      ├─ latest.json
      ├─ 2026-08-23T01-02-03-000Z.json
      └─ ...
```

英文字入りJPX証券コードにも対応しています。

例:

```text
130A
```

保存先:

```text
.dexter/analysis/130A/
```

---

# 7. latest.json と history

## latest.json

そのtickerについて最後に正常保存されたSnapshotです。

```text
.dexter/analysis/7203/latest.json
```

Dashboardのdetail画面は基本的にこのSnapshotを表示します。

## History

分析を実行するたびにWindows-safeなtimestamp名で履歴が残ります。

例:

```text
2026-08-23T01-02-03-000Z.json
```

history保存後に`latest.json`が更新されます。

---

# 8. Snapshot status

Snapshotには:

```text
complete
partial
```

の2種類があります。

## complete

V1で必要なdeterministic sectionがすべて取得できた状態です。

対象:

```text
identity
fundamental
valuation
peerComparison
technical
supplyDemand
marketCorrelation
strategy
priceHistory
```

一部metricが利用不可でも、そのsection自体が有効なら`complete`になる場合があります。

例えばtick sizeが取得できずStrategyのexact entryが計算できない場合でも、

```text
Trigger > Swing High
Exact Entry = 利用不可
Reason = missing_tick_size_for_executable_entry
```

というStrategy section自体は有効です。

## partial

必要なsectionそのものが取得できなかった状態です。

例:

```text
technical = null
marketCorrelation = null
```

などです。

---

# 9. `利用不可`と`0`は異なる

Dashboardではmissing valueを`0`へ変換しません。

例えば:

```text
PER = null
```

なら:

```text
利用不可
```

と表示されます。

これは:

```text
PER = 0
```

とは異なります。

同様に:

```text
Exact Entry = 利用不可
```

の場合、DashboardやLLMが勝手に価格を生成することはありません。

---

# 10. Local Dashboardを起動する

別terminalを開きます。

```bash
bun run dashboard
```

Dashboard serverは以下で起動します。

```text
127.0.0.1:3000
```

Browserで開きます。

```text
http://127.0.0.1:3000/
```

または:

```text
http://localhost:3000/
```

---

# 11. Analysis Portfolio / Watchlist

V5ではroot画面がAnalysis Watchlistになっています。

```text
http://127.0.0.1:3000/
```

`.dexter/analysis/`に保存されている各tickerの`latest.json`が一覧表示されます。

表示項目:

```text
Ticker
Company
Price
PER
PBR
ROE
Trend
Margin Percentile
Beta 250
Latest Source Date
Generated At
Status
```

これは実保有Portfolioではありません。

次の情報は保持しません。

```text
保有株数
取得単価
評価額
含み損益
Portfolio allocation
Portfolio risk
証券口座情報
```

あくまで:

```text
Analysis Portfolio
```

です。

---

# 12. Watchlistのsort

Watchlistでは次の2種類でsortできます。

## Source date

```text
Source date
```

最新source data dateが新しい順に並びます。

## Generated

```text
Generated
```

Snapshot生成日時が新しい順に並びます。

missing dateは末尾へ配置されます。

---

# 13. Stale表示

Watchlistではlatest source data dateが古い場合に`Stale`として表示します。

現在のUI threshold:

```text
7 UTC calendar days
```

判定:

```text
7日ちょうど → staleではない
8日以上     → stale
```

例:

```text
Reference Date = 2026-08-23

2026-08-16 → fresh
2026-08-15 → stale
```

`latestSourceDataDate`が存在しない場合は、staleとは推測せず`利用不可`になります。

## 注意

`Latest Source Date`はSnapshot内の各data dateのうち最も新しい日付です。

これは:

```text
「少なくとも1つのsourceがこの日付」
```

というmetadataです。

```text
「すべてのデータがこの日付まで最新」
```

という意味ではありません。

Stale表示はUI上のfreshness indicatorであり、投資判断上の有効期限を保証するものではありません。

---

# 14. Single Stock Dashboardを開く

Watchlistで企業名または`詳細`を選択します。

例えば7203:

```text
http://127.0.0.1:3000/?ticker=7203
```

英文字ticker:

```text
http://127.0.0.1:3000/?ticker=130A
```

detail画面から:

```text
← Analysis Portfolio
```

でWatchlistへ戻れます。

Browserのback / forward操作にも対応しています。

---

# 15. Single Stock Dashboardの表示内容

detail画面ではCanonical AnalysisSnapshotをそのままPresentation Layerへ渡します。

## Header

```text
Ticker
Company Name
Generated At
Status
```

## KPI

```text
Price
PER
PBR
ROE
Trend
```

## Price Structure

Adjusted OHLCVを表示します。

```text
Candlestick
Volume
SMA20
Swing High
Swing Low
```

重要:

SMA20、Swing High、Swing LowはDashboardでは計算しません。

Snapshotに保存されたdeterministic engineの計算結果を水平線として表示します。

```text
Technical Engine
      ↓
Snapshot
      ↓
Dashboard
```

です。

---

# 16. Peer Comparison

以下を表示します。

```text
Target
Peer Median
Rank
Percentile
```

対象metric:

```text
PER
PBR
ROE
ROIC
Operating Margin
Revenue Growth
Dividend Yield
```

Market Cap Priorityも表示します。

```text
適用済み
```

または:

```text
未適用
```

候補企業のmarket capが不足している場合などは、無理に適用済みと表示しません。

---

# 17. Supply & Demand

例:

```text
買残
売残
信用倍率
52週Percentile
消化日数
```

これらはDashboard側では計算しません。

Supply-Demand Engineの結果を表示しています。

---

# 18. Market Correlation

TOPIXとの相関を表示します。

主に:

```text
60日
250日
```

について:

```text
Observations
Correlation
Beta
Alpha annualized
R²
```

を表示します。

250日BetaはWatchlistにも表示されます。

---

# 19. Strategy

Strategyはdeterministic engineの結果だけを表示します。

例:

```text
Trigger
Exact Entry
Stop
Target
Reward / Risk
```

tick sizeが取得できない場合:

```text
Trigger     > ¥3,233
Exact Entry 利用不可
```

のように表示されます。

Dashboardが:

```text
¥3,234
```

などの価格を推測して生成することはありません。

---

# 20. Data Freshness

Single Stock Dashboardではsectionごとのdata dateを確認できます。

例:

```text
企業情報
財務情報
株価
バリュエーション財務
Peer比較
テクニカル
需給
市場相関
Strategy
価格履歴
```

異なるsourceが異なる日付を持つことは正常です。

---

# 21. Unavailable

Snapshotが記録したmissing dataは`Unavailable` sectionに表示されます。

例:

```text
strategy / entry
missing_tick_size_for_executable_entry
```

または:

```text
peerComparison
incomplete_peer_market_cap
```

Missing dataをDashboard側で補完しません。

---

# 22. Bull / Base / Bear / Risks

Dashboardにはstructured narrativeを表示するためのUIがあります。

Snapshotに:

```text
scenarios
risks
```

が存在する場合のみ表示されます。

ただし現在、Standard Agent Snapshot Collectorは通常:

```text
scenarios: null
risks: null
```

としてSnapshotを生成します。

そのため現状ではBull / Base / Bear / Risksのstructured cardは通常表示されません。

これは既知の制約です。

現在の分析レポート自体は:

```text
finalReportMarkdown
```

としてSnapshotに保持され、Dashboardの`Final Report`で確認できます。

Markdownからscenariosやfinancial valuesをparseして復元する処理はありません。

---

# 23. Final Report

Agentの最終分析レポートは:

```text
finalReportMarkdown
```

として保存されます。

Dashboardでは安全なtextとして表示します。

HTMLとして直接injectしません。

つまりSnapshot内にHTML-likeな文字列があっても、unsafe HTMLとして実行しません。

---

# 24. Local Read-only API

Dashboard serverはRead-only APIを提供します。

## Watchlist / latest metadata

```http
GET /api/analyses
```

例:

```bash
curl http://127.0.0.1:3000/api/analyses
```

Watchlist用の軽量metadataだけを返します。

full Snapshotや`finalReportMarkdown`を一覧APIに含めません。

---

## Latest Snapshot

```http
GET /api/analyses/:ticker
```

例:

```bash
curl http://127.0.0.1:3000/api/analyses/7203
```

---

## History一覧

```http
GET /api/analyses/:ticker/history
```

例:

```bash
curl http://127.0.0.1:3000/api/analyses/7203/history
```

History一覧もmetadataだけです。

---

## History detail

```http
GET /api/analyses/:ticker/history/:snapshotId
```

例:

```bash
curl http://127.0.0.1:3000/api/analyses/7203/history/2026-08-23T01-02-03-000Z
```

---

# 25. APIはRead-only

以下は存在しません。

```text
POST
PUT
PATCH
DELETE
```

分析実行やSnapshot変更をBrowserから行うAPIもありません。

分析はCLI側で行います。

```text
CLI
 ↓
Analysis
 ↓
Snapshot保存
```

Dashboardは保存済みSnapshotを読むだけです。

---

# 26. Security

Dashboardはlocal-onlyです。

Server bind:

```text
127.0.0.1
```

外部interface:

```text
0.0.0.0
```

にはbindしません。

Host headerも:

```text
127.0.0.1
localhost
```

のみを許可します。

その他のHostは拒否されます。

また:

- CORS wildcardなし
- `Cache-Control: no-store`
- CSPあり
- filesystem pathをBrowserへ返さない
- stack traceをBrowserへ返さない
- API keyをSnapshotへ保存しない
- raw promptをSnapshotへ保存しない
- raw tool argsをSnapshotへ保存しない
- environment variablesをBrowser bundleへ注入しない

という方針です。

## 注意

このDashboardにはlogin/authenticationを実装していません。

local-only前提なので、reverse proxy、port forwarding、public tunnel等を使って外部公開しないでください。

---

# 27. Snapshotを手動編集しない

`.dexter/analysis/`内のJSONはCanonical AnalysisSnapshotです。

通常は手動で編集しないでください。

Repositoryでは:

```text
ticker directory
snapshot canonicalTicker
snapshotId
generatedAt
```

のidentity整合性を検証します。

例えば:

```text
.dexter/analysis/7203/latest.json
```

の中身を6758のSnapshotへ手動で置き換えた場合、読み込みは拒否されます。

History filenameと`generatedAt`が一致しない場合も拒否されます。

---

# 28. Typical Workflow

通常は以下だけ覚えておけば利用できます。

## Terminal 1

```bash
bun run start
```

CLI:

```text
7203を分析して
```

正常終了後:

```text
.dexter/analysis/7203/latest.json
```

が生成されます。

## Terminal 2

```bash
bun run dashboard
```

Browser:

```text
http://127.0.0.1:3000/
```

Watchlist:

```text
7203 トヨタ自動車株式会社
```

を選択。

Detail:

```text
http://127.0.0.1:3000/?ticker=7203
```

---

# 29. 複数銘柄をWatchlistへ追加する

Watchlistへの専用「追加」操作はありません。

各銘柄をCLIで分析すると、自動的に一覧へ追加されます。

例:

```text
7203を分析して
```

次に:

```text
6758を分析して
```

次に:

```text
7974を分析して
```

保存結果:

```text
.dexter/analysis/
├─ 6758/
│  └─ latest.json
├─ 7203/
│  └─ latest.json
└─ 7974/
   └─ latest.json
```

Dashboardを開くと3銘柄がWatchlistに表示されます。

---

# 30. 分析を更新する

同じtickerを再分析します。

```text
7203を分析して
```

すると新しいhistoryが追加され、

```text
latest.json
```

が新しいSnapshotへ更新されます。

古いhistoryは残ります。

---

# 31. Troubleshooting

## Dashboardに銘柄が表示されない

まず:

```text
.dexter/analysis/
```

を確認してください。

Snapshotがなければ、CLIで総合分析を実行します。

```text
7203を分析して
```

---

## 分析したのにSnapshotが保存されない

確認項目:

1. Standard Agentを使用しているか
2. comprehensive analysisとして実行されたか
3. runが正常終了したか

現在Snapshotは:

```text
success
```

runのみ生成します。

以下の場合は生成しません。

```text
error
interrupted
approval denied
max iteration
```

Claude Agent SDKモードも現在Snapshot生成対象外です。

---

## Snapshotがpartialになる

J-QuantsやEDINET DBのdata/API状態を確認してください。

特に:

```env
EDINETDB_API_KEY
JQUANTS_API_KEY
```

を確認します。

`Unavailable` sectionを見ると欠損理由を確認できます。

---

## Dashboardで404になる

例えば:

```text
/?ticker=7203
```

を開いている場合:

```text
.dexter/analysis/7203/latest.json
```

が存在するか確認します。

---

## Dashboardが403になる

以下からアクセスしてください。

```text
http://127.0.0.1:3000/
```

または:

```text
http://localhost:3000/
```

local-only Host allowlistのため、別Host名では拒否されます。

---

## Port 3000が使用中

現在:

```text
bun run dashboard
```

はdefault port:

```text
3000
```

で起動します。

他processが3000番portを使用している場合、そのprocessを停止してから再起動してください。

---

## JSON corruption / schema error

Snapshot JSONが壊れている場合、APIは内部filesystem pathやstack traceをBrowserへ表示せずgeneric errorを返します。

手動修復より、該当tickerを再分析して新しいSnapshotを作成することを推奨します。

---

## 古いSnapshotがschema errorになる

AnalysisSnapshotには:

```text
schemaVersion
```

があります。

現在のPhase 1.5実装は`schemaVersion = 1`をサポートし、未知のversionを
unsupportedとして拒否します。unsupported versionはmalformed JSONとは別エラーです。

Phase 2Aで`schemaVersion = 2`を導入する場合も、validなV1 historyと
`latest.json`のread compatibilityを維持します。V1ファイルを自動的に書き換えず、
V2 writer有効化後の新規SnapshotだけをV2として保存する計画です。

V1 SnapshotにはPhase 2A indicatorが存在しないため、Dashboardはそれらを`0`とせず
「未収集 / 利用不可」として扱います。未知のschemaVersionは引き続き拒否します。

---

# 32. Validation for Development

コード変更後は以下を実行します。

```bash
bun test
bun run typecheck
git diff --check
```

すべて成功することを確認してからPRを作成します。

---

# 33. Current Limitations

現在のPhase 1.5では以下を行いません。

```text
Realtime market data
WebSocket price streaming
Auto trading
Broker integration
Portfolio holdings
Cost basis
Allocation
Portfolio VaR
Portfolio optimization
Cloud deployment
User login
Multi-user SaaS
Database server
GraphQL
Browserからのanalysis実行
```

また、以下も後続対応です。

```text
Structured Bull / Base / Bear capture
Structured Risks capture
Historical indicator series
Full SMA series
Dated Swing markers
RSI
MACD
Volume Profile
Backtest
```

---

# 34. Architecture Summary

```text
EDINET DB / J-Quants
        ↓
Typed Source Results
        ↓
Deterministic Engines
        ↓
Standard Agent Snapshot Collector
        ↓
AnalysisSnapshotInput
        ↓
AnalysisSnapshotBuilder
        ↓
Canonical AnalysisSnapshot
        ↓
JSON Repository
        ↓
Read-only Local API
        ↓
React Dashboard
        ├─ Analysis Watchlist
        └─ Single Stock Dashboard
```

重要なのは依存方向です。

```text
Dashboard
   ↓ reads
Snapshot
```

であり、

```text
Dashboard
   ↓
Financial Engine
```

ではありません。

Presentation LayerはSnapshotの値を:

```text
format
sort
display
```

するだけです。

金融・統計計算はdeterministic engine側で行います。

---

# 35. Quick Start

最短手順:

```bash
bun install
bun run start
```

CLI:

```text
7203を分析して
```

別terminal:

```bash
bun run dashboard
```

Browser:

```text
http://127.0.0.1:3000/
```

以上で:

```text
Analysis
→ Snapshot
→ Watchlist
→ Single Stock Dashboard
```

まで確認できます。
