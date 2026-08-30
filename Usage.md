# Dexter JP Usage Guide

Dexter JPの日本株総合分析、Canonical AnalysisSnapshot、Local Dashboard、
Analysis Watchlistを利用するための操作手順です。

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
        ├─ 保存済み分析の比較
        └─ 保存済みPeer percentileのRadar
```

Phase 1.5ではSnapshot、JSON persistence、Read-only API、Single Stock Dashboard、
Analysis Watchlistを順に追加しました。これは実装stepの呼称であり、現在の
`schemaVersion`とは別です。

Phase 3では、同一銘柄のimmutableな保存済みSnapshot 2件を比較する機能と、既存の
7つのPeer percentileを表示するRadarを追加しました。どちらも保存済み値を読む
Dashboard機能であり、外部sourceの再取得、再分析、Snapshot変更、売買判断は行いません。
総合スコアは評価計画だけを定義し、runtime scoreは実装していません。

現在のSnapshot compatibilityは以下です。

| Snapshot schema | 主な追加section | 状態 |
|---|---|---|
| V1 | Phase 1 deterministic analysis | read-only compatibility |
| V2 | Advanced Technical | read-only compatibility |
| V3 | Supply/Demand `mean4w` | read-only compatibility |
| V4 | Reported Short Positions | read-only compatibility |
| V5 | Investor Type Flows | read-only compatibility |
| V6 | Sector Benchmark | read-only compatibility |
| V7 | Sector Short-selling Flow | read-only compatibility |
| V8 | Advanced Dividend | read-only compatibility |
| V9 | Volume Profile | current writer / readable |

V1〜V8は読み取り可能なimmutable historyとして維持され、自動migrationや
rewriteは行われません。未知のschema versionは拒否されます。

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

Snapshot / Dashboardを含む日本株総合分析では、EDINET DBとJ-Quantsの両方を
使用することを推奨します。J-Quantsの契約プラン、履歴範囲、データ提供状況に
より、一部sourceが利用できない場合があります。利用不可は0として扱われません。

J-Quantsが利用できない場合、以下のようなsectionが取得できず、Snapshotが`partial`になる可能性があります。

- 株価
- Technical
- Supply & Demand
- Market Correlation
- Strategy
- Price History
- Advanced Technical
- Advanced Dividend
- Volume Profile
- Reported Short Positions
- Investor Type Flows
- Sector Benchmark
- Sector Short-selling Flow

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

現在、Canonical AnalysisSnapshot V9の生成は **Standard Agent run** を対象としています。

Claude Agent SDKモードでは分析自体を実行できますが、現在のSnapshot生成経路には
接続されていません。

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
Advanced Dividend
Peer Comparison
Technical
  └─ Advanced Technical companion
Volume Profile
Supply & Demand
Reported Short Positions
Investor Type Flows
Market Correlation
Sector Benchmark
Sector Short-selling Flow
Entry / Stop / Target
Bull / Base / Bear
Risks
Data Dates
```

`comprehensive-analysis`の最終reportでは、Advanced Technicalは`Technical`
sectionで解釈されます。Dashboardでは確認しやすいよう独立したAdvanced Technical
cardとして表示されます。

重要な金融指標はLLMではなくdeterministic engineが計算します。

基本原則:

```text
Code calculates.
AI interprets.
```

---

# 6. AnalysisSnapshot

Standard Agentによるcomprehensive analysisが正常終了すると、分析結果からCanonical AnalysisSnapshotが生成されます。

新規保存は`schemaVersion = 9`です。Repositoryのread boundaryはV1〜V9を受け入れ、
古いSnapshotを新versionへ自動変換しません。

保存先:

```text
.dexter/
└─ analysis/
   └─ <ticker>/
      ├─ <snapshotId>.json
      └─ ...
```

7203の場合:

```text
.dexter/
└─ analysis/
   └─ 7203/
      ├─ 2026-08-23T01-02-03-000Z.json
      ├─ 2026-08-30T01-02-03-000Z.json
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

# 7. authoritative latest と immutable history

## Authoritative latest

そのtickerの最新Snapshotは、validなhistory全件から`generatedAtEpochMs`が最大の
ものを選んで解決します。filename文字列やdirectory列挙順では決めません。

新しいV9 saveはhistory fileだけをcreate-onlyで公開し、`latest.json`を書きません。
既存環境にlegacy `latest.json`があっても、historyが1件以上あるtickerではlatest
選択に使用しません。historyが0件のlegacy tickerに限りread fallbackとして使います。

Dashboard detail、Watchlist、latest GETは同じauthoritative resolutionを使用します。

## Immutable history

分析を実行するたびにWindows-safeなtimestamp名で履歴が残ります。

例:

```text
2026-08-23T01-02-03-000Z.json
```

historyはcreate-onlyです。同一Snapshot ID・同一canonical payloadの再saveだけは
idempotentですが、同一IDに異なるpayloadを保存しようとするとcollisionとして拒否
され、既存fileは上書きされません。古いV1〜V8 historyもrewrite/backfillしません。

---

# 8. Snapshot status

Snapshotには:

```text
complete
partial
```

の2種類があります。

## complete

Phase 1から継承したrequired deterministic sectionがすべて取得できた状態です。

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

Advanced Technical、Advanced Dividend、Volume Profileなどの後続optional sectionが
未収集またはmetric-level unavailableであることだけでは、既存の`complete`を
`partial`へ変更しません。

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

`.dexter/analysis/`に保存されている各tickerについて、immutable historyから解決した
authoritative latestが一覧表示されます。historyがないlegacy tickerだけは
`latest.json` fallbackを使用します。

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

## 保存済みSnapshotを再読み込みする

detail画面の`保存済みSnapshotを再読み込み`は、ローカルのimmutable historyから
authoritative latest Snapshotを解決してGET APIから読み直すだけです。外部ソースからの
最新データ取得、Agent／LLMの実行、再分析、Snapshot保存は行いません。

Comparisonを使用していない場合は、CLIで同じ銘柄を再分析して新しいSnapshotを保存した
後、そのauthoritative latestを現在のタブへ反映するために使用できます。再読み込みに
失敗した場合も、現在表示中のSnapshotは維持されます。

Comparison中は、URLで選択した基準・対象Snapshotを固定したまま再読み込みします。
より新しいauthoritative latestが見つかっても自動では切り替えず、
`新しい保存済み分析があります`と表示します。`新しい保存済み分析を対象にする`を明示的に
選んだときだけ、そのSnapshotを新しい対象とし、validatedな`generatedAtEpochMs`順で
直前にあるSnapshotを基準としてpair全体を切り替えます。

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

## 5つのタブとURL state

detail画面は次の5タブで構成されます。

| tab ID | 表示label | 主な内容 |
| --- | --- | --- |
| `report` | 概要・レポート | 保存済み分析の比較、Final Report |
| `technical` | 株価・テクニカル | 価格、テクニカル、Strategy |
| `fundamentals` | 比較・配当 | Peer Comparison / Radar、Advanced Dividend |
| `supply-demand` | 需給・空売り | 信用需給、公開空売り残高報告 |
| `market` | 市場・セクター | 投資部門別、市場相関、sector分析 |

選択中のtickerとtabはURLへ保存されます。

```text
http://127.0.0.1:3000/?ticker=7203&tab=fundamentals
```

BrowserのBack / Forwardとreloadでも同じ画面を復元します。`tab`がない、または未知の
値の場合は`report`へ戻ります。V1〜V9のどのSnapshotでも5タブは維持され、古いschemaに
存在しないsectionをvalid zeroとして扱いません。

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

## Phase 2 analysis cards

Snapshot versionと収集結果に応じて、以下のstructured sectionも表示します。

```text
Advanced Technical
Advanced Dividend
Volume Profile
Reported Short Positions
Investor Type Flows
Sector Benchmark
Sector Short-selling Flow
```

V1〜V8など、そのsectionがまだ存在しないschemaでは`not_collected`として扱い、
0とは表示しません。収集を試みた結果が利用不能だった場合はtyped `unavailable`、
source/resultが実際に0だった場合はvalid zeroとして区別します。

Advanced TechnicalはRSI14、MACD 12/26/9、Bollinger Bands 20/2σの最新値を表示します。
Advanced Dividendはactual/forecast amount、source payout context、および利用可能な
event情報を表示します。Reported Short Positionsはreporter/fund単位を維持し、
Investor Type FlowsはTokyo/Nagoya市場全体のweekly contextとして表示します。
Sector BenchmarkとSector Short-selling FlowはTSE 33-sector contextであり、個別銘柄
自身のflowではありません。

Volume Profileは日足OHLCVから作る推定出来高価格分布proxyです。実際の投資家取得
単価、現在残る真のしこり玉、測定済みoverhead supplyを示すものではありません。
POC / VAH / VALはdescriptive outputであり、自動的なsupport/resistanceや売買signal
ではありません。計算・availability・corporate-action契約の詳細は
`docs/PHASE2_PLAN.md`を参照してください。

## 保存済み分析の比較

`report / 概要・レポート`の先頭に`保存済み分析の比較`があります。同一tickerに
保存済みhistoryが2件以上ある場合、`比較を開始`を選ぶと表示中のSnapshotを対象、
validatedな`generatedAtEpochMs`順で対象の直前にあるSnapshotを基準として比較します。
fileの保存・書き込み完了順やdirectory列挙順は使用しません。開始後は基準・対象の
selectorで別の組み合わせを選べますが、基準は必ず対象より古いSnapshotでなければ
なりません。

比較中の組み合わせはURLに保存されます。

```text
http://127.0.0.1:3000/?ticker=7203&tab=report&base=<snapshotId>&target=<snapshotId>
```

結果表は`指標 / 基準値 / 対象値 / 差分 / 状態`を表示します。差分は`対象値 − 基準値`
であり、相対変化や良否を判定しません。表示は`変化・要確認 / すべて / 値の変化 /
要確認`とsectionで絞り込めます。単位、期間、method、benchmark、identity、data dateが
比較できない行は無理に差分を作らず、行ごとの状態と`日付・比較条件`を表示します。

この機能は明示registryで定義した保存済みscalar/categoryと同一性を定義できる観測だけを
比較します。JSON全体の再帰diff、collection-level record diff、外部source取得、再分析、
Snapshot変更は行いません。

---

# 16. Peer Comparison / Peer Radar

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

## Peer Radar

`fundamentals / 比較・配当`では、同じ7指標についてSnapshotに保存済みの
direction-normalized percentileをRadarと正確な表で表示します。表には対象企業、
同業中央値、順位、percentile、有効Peer数、方向、data date、状態を表示します。

Radarは表示専用です。Browserでpercentileを再計算したり、値を0〜1へclampしたり、
Peer eligibilityを再判定したりしません。1軸でも欠損、範囲外、direction mismatch、
sample/cohort/rank不整合がある場合はpolygon全体を表示せず、partial polygonも作りません。
SVGの色は良否を示さず、正確な値と利用状態は常設の表をauthorityとして確認します。

---

# 17. Supply & Demand

例:

```text
買残
売残
信用倍率
4週平均
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
20日
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
Advanced Technical
Advanced Dividend
Volume Profile
需給
公開空売り残高報告
投資部門別
市場相関
Sector Benchmark
Sector Short-selling Flow
Strategy
価格履歴
```

異なるsourceが異なる日付を持つことは正常です。

`Data Dates`では、sourceの情報利用可能日と、計算対象期間・参照日を混同しません。
例えば公開空売り残高報告ではdisclosed dateとcalculated date、投資部門別では
publication dateとtrading period、Advanced Dividendではdisclosure/notificationと
source eligibility、Volume Profileではanalysis as-of、data date、window datesを
区別します。

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

状態の意味:

```text
not_collected  そのSnapshot version/runではsectionを収集していない
unavailable    収集・計算したが、source/history/validation上の理由で利用できない
0              sourceまたはdeterministic resultが返した有効な数値0
```

これらを相互に変換したり、missing observationをforward-fillしたりしません。

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

## 保存済みSnapshotの比較

```http
GET /api/analyses/:ticker/comparison?baseSnapshotId=<id>&targetSnapshotId=<id>
```

例:

```bash
curl "http://127.0.0.1:3000/api/analyses/7203/comparison?baseSnapshotId=<old-id>&targetSnapshotId=<new-id>"
```

同一tickerのhistoryを、古い基準から新しい対象の順で明示的に指定します。自動swap、
latest代替、外部source fetchは行いません。成功は200、malformed・同一ID・逆順・ticker
mismatchは400、Snapshot missingは404、corrupt/schema/filesystem failureは500です。

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

例えば`.dexter/analysis/7203/<snapshotId>.json`の中身を6758のSnapshotへ手動で
置き換えた場合、読み込みは拒否されます。History filenameと`generatedAt`が一致しない
場合も拒否されます。1件でもhistoryがあるtickerではlegacy `latest.json`へ変更しても
authoritative latestにはなりません。

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
.dexter/analysis/7203/<snapshotId>.json
```

がcreate-onlyで生成されます。

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
│  └─ <snapshotId>.json
├─ 7203/
│  └─ <snapshotId>.json
└─ 7974/
   └─ <snapshotId>.json
```

Dashboardを開くと3銘柄がWatchlistに表示されます。

---

# 30. 分析を更新する

同じtickerを再分析します。

```text
7203を分析して
```

すると新しいhistoryがcreate-onlyで追加されます。古いhistoryは残り、validなhistory
全件から`generatedAtEpochMs`が最大のSnapshotがauthoritative latestとして自動的に
解決されます。`latest.json`は更新されません。

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

を開いている場合、`.dexter/analysis/7203/`にvalidなhistory JSONが1件以上あるか確認
します。historyが0件のlegacy tickerだけは`latest.json`がread fallbackになります。

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

現在のwriterは`schemaVersion = 9`です。RepositoryはvalidなV1〜V9 historyを読み取り、
historyが0件のlegacy tickerに限り`latest.json`も読み取れます。V1〜V8ファイルを
自動的に書き換えず、新規saveだけをV9として保存します。

古いSnapshotに後続sectionが存在しない場合、Dashboardはそれを`0`ではなく
`not_collected`として扱います。未知のschemaVersionはunsupportedとして拒否し、
malformed JSONやschema validation failureとは区別します。

---

# 32. Validation for Development

コード変更後は以下を実行します。

```bash
bun test
bun run typecheck
git diff --check
```

Dashboardのinteraction、History API、focus、responsive表示を変更した場合は、さらに:

```bash
bun run test:dashboard-browser
```

を実行します。すべて成功することを確認してからPRを作成します。通常CIは外部AI
providerへ接続しません。

---

# 33. Current Limitations

現在も以下を行いません。

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

また、以下も後続検討です。

```text
Structured Bull / Base / Bear capture
Structured Risks capture
Historical indicator series
Full SMA series
Dated Swing markers
Backtest
PDF / print view / export storage / download API
Evaluator runtime / CLI / API / Dashboard tab
Runtime composite score / score field / Dashboard score
Collection-level record diff / cross-ticker comparison
```

Phase 2のformula、source availability、no-look-ahead、Snapshot evolution、deferred/
rejected scopeの詳細は`docs/PHASE2_PLAN.md`を参照してください。
Phase 3のComparison、Radar、Evaluator freeze、score evaluation boundaryは
`docs/PHASE3_PLAN.md`、scoreの検証設計は`docs/PHASE3_SCORE_EVALUATION_PLAN.md`を参照して
ください。EvaluatorのP3-E1 foundationは内部に保持されていますが、runtime producerや
Dashboard consumerはありません。Score採用はPhase 4の検証後に別途判断します。

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
             ├─ 2 Snapshots → deterministic Comparison → report tab
             └─ stored Peer percentiles → Radar / exact table → fundamentals tab
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

まで確認できます。同じtickerを2回以上分析してhistoryを保存すると、`report`タブで
保存済み分析の比較も確認できます。
