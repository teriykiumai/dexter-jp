# Phase 1.5 — Local Web Visualization MVP Plan

**Version:** 0.1
**Status:** Design
**Target:** Personal / Local only
**Date:** 2026-08-23

## 1. 位置付け

Phase 1.5は、Step 10で完成したMVPの完成条件を変更または再度開くものではない。CLI中心だった分析結果へ、保存・可視化・Presentation Layerを追加するPost-MVP拡張である。

目的は、comprehensive analysisで取得・計算した結果をCanonical Analysis Artifactとして確立し、次のconsumerから同じ構造化データを再利用できるようにすることである。

- CLI / LLM report
- local JSON persistence
- Browser Dashboard
- 将来のPDF、過去比較、Portfolio分析

今回は設計のみを行う。Snapshot schema、persistence、Bun server、React components、Chartはまだ実装しない。

## 2. 設計原則

- **Code calculates, AI interprets.**
- **Reuse before Build.**
- **No data means no claim.**
- **Minimal diff.**
- DashboardはPresentation Layerとし、金融・統計計算を行わない
- LLM最終Markdownをparseして数値やscenarioを復元しない
- LLMに金融数値をSnapshotへ再入力させない
- raw promptや偶発的・非保証なAgent tool履歴解析へ依存しない
- source date、provenance、unit、unavailableを失わない
- APIキーやauth tokenをSnapshot、HTTP response、Browser bundleへ含めない
- `127.0.0.1`限定、個人・ローカル・単一ユーザーとする
- Phase 2以降の分析機能や実保有Portfolio管理を先取りしない

## 3. 現状アーキテクチャ

現在の`comprehensive-analysis`は、Standard AgentまたはClaude Agent SDKへMVP分析手順と最終Markdown形式を指示するSkillであり、それ自体がstructured resultを返すapplication serviceではない。

既存の再利用対象:

- Source tools
  - EDINET DB: company、financials、ratios、earnings、filings、screener
  - J-Quants: adjusted OHLCV、margin、TOPIX
- Deterministic engines
  - `FinancialMetricsResult`
  - `TechnicalResult`
  - `SupplyDemandResult`
  - `PeerComparisonResult`
  - `MarketCorrelationResult`
  - `StrategyResult`
- Agent surface
  - Standard Agentは`DoneEvent.toolCalls`へtool resultを保持する
  - `AgentRunnerController`は現在、consumerへ最終answerだけを返す
  - Claude Agent SDKの`DoneEvent.toolCalls`は現在空である

この差異を理由に、V1でAgent loop全体を大規模に統一しない。

## 4. Target Architecture

```text
EDINET DB / J-Quants
         ↓
typed source results
         ↓
deterministic engines
         ↓
provider adapter ──→ AnalysisSnapshotInput / Draft
                           ↓
                AnalysisSnapshotBuilder
                  validation / mapping
                  status / unavailable
                  provenance / units
                           ↓
                 Canonical AnalysisSnapshot
                    ├─→ CLI report
                    ├─→ JSON repository
                    └─→ Read-only API
                              ↓
                         React Dashboard
```

依存方向は一方向とする。SchemaとBuilderはAgent、LLM provider、CLI、filesystem、HTTP、Reactへ依存しない。PersistenceとPresentationはSnapshotを読むだけで、source APIやdeterministic engineを直接呼ばない。

## 5. Snapshot生成境界

### 5.1 禁止する生成方法

AnalysisSnapshotを以下から生成してはならない。

- LLM最終Markdownのparse
- LLMによる金融数値の再入力
- run完了後のscratchpadや任意tool履歴の探索
- raw promptの解析
- Browser側での金融計算

### 5.2 明示的な生成経路

V1では、Standard Agent実行中に既知のsource / analysis toolが完了した時点で、tool名ごとのtyped decoderが結果を検証し、run-scopedな`AnalysisSnapshotInput`へ渡す明示的adapterを設計する。任意の過去履歴を事後探索せず、対象toolとschemaをallowlistする。

collectorは`tool_start`と`tool_end`を`toolCallId`で対応付け、`toolCallId -> { tool, validatedArgs, validatedResult }`を確立してからSnapshot inputへ渡す。result単独、欠損ID、tool名不一致のeventは採用しない。

最初に検証済みcompany identityから4桁`canonicalTicker`を確定し、そのrunのtargetとしてlockする。以後のtarget用source / engine resultが別tickerならcollectorが拒否する。Peer Comparisonの候補tickerだけは明示的な例外とし、Peer targetはlock済みtickerとの一致を必須とする。

Builderは次だけを担当する純粋なapplication layerとする。

- typed inputの整合性検証
- 既存engine resultを変更せずSnapshot sectionへ配置
- provenanceとunit contractの付与
- section-level / metric-level unavailableの正規化
- `complete | partial`の決定
- 保存禁止情報がinput contractへ入らないことの保証

Builderは金融計算、tool実行、LLM呼び出し、filesystem書込を行わない。

### 5.3 Standard Agent

V1の必須範囲はStandard AgentからのSnapshot生成とする。既存tool result wrapperをtoolごとのZod schemaで検証し、Controllerまたは小さな専用adapterからBuilderへ渡す。具体的なhook位置はV1開始時に最小diffを比較して決定する。

候補:

1. `tool_end`を受け取るrun-scoped collectorへ明示的に渡す
2. Agentが生成した既知tool resultをControllerで逐次adapterへ渡す

`DoneEvent.toolCalls`全体を後から推測的に走査する実装は採用しない。

Snapshot生成はStandard Agent runが正常に最終回答を返した場合だけ行う。正常終了したrunで一部sectionを取得できない場合は`partial`とするが、cancel、exception、approval deny、max-iteration等のinterrupted / error runはV1ではSnapshotを生成しない。

### 5.4 Claude Agent SDK

SchemaとBuilderはprovider-neutralとするが、Claude Agent SDK adapterはV1必須範囲外とする。現在はterminal eventにtool resultが保持されないため、V1で対応するとSDK message translationを含む変更が必要になる。

後続adapterは、SDKが返す明示的なtool result eventをtyped inputへ変換できる場合に追加する。Standard Agent専用fieldをSnapshot schemaへ入れない。SDK未対応時はSnapshot未生成を明示し、Markdown parseへfallbackしない。

## 6. Canonical AnalysisSnapshot

### 6.1 Top-level contract

V1で最低限表現するfield:

```text
schemaVersion
status: complete | partial
canonicalTicker
companyName
generatedAt
dataDates
provenance
fundamental
valuation
peerComparison
technical
supplyDemand
marketCorrelation
strategy
priceHistory
scenarios
risks
unavailable
finalReportMarkdown
```

`schemaVersion`はV1では固定値をZod literalとして検証する。`generatedAt`はUTC ISO 8601、永続化用`snapshotId`はそこから生成したWindows-safe文字列とする。`canonicalTicker`はresolverが確定した国内証券コードだけを受け付け、path segmentとして使用する前にallowlist形式で検証する。

### 6.2 Status

- `complete`: V1で必須としたdeterministic sectionがすべて存在し、各sectionの欠損がstructured unavailableとして表現されている
- `partial`: 必須section自体がtool、plan、history、source failure等で取得できない

V1の必須sectionは実装上の定数として`identity / fundamental / valuation / peerComparison / technical / supplyDemand / marketCorrelation / strategy / priceHistory`を明示する。実装者ごとに`complete`判定を変えない。

一部metricが明示的にunavailableでも、section resultが有効なら直ちに`partial`とはしない。例えばsourced tick size欠損によりexact Strategy価格が利用不可でも、strictly-above triggerと理由が有効ならStrategy sectionは成立する。

### 6.3 Section schema

全数値を個別wrapperへせず、section単位で次を保持する。

- `data`: 既存engine resultまたはV1用のnarrow typed source result
- `provenance`: source、as-of date、必要な場合のみsource URL
- `units`: section内fieldとunitの固定mapping
- `unavailable`: 既存engineが返すmetric/candidate単位の理由

初期unit vocabulary:

- `JPY`
- `shares`
- `percent`
- `ratio`
- `multiple`
- `days`
- `count`

unit mappingはBuilderが決定し、LLMやBrowserへ推測させない。percentage pointとdecimal ratioを混同しないよう既存field名とengine contractを優先する。

### 6.4 Fundamental

FundamentalはEDINET DBのtyped source fieldから、V1表示に必要な期間、提出日、売上高、利益、EPS、ROE等のnarrow schemaへmapする。tool内のAI narrativeや最終MarkdownをFactとして保存しない。既存のsource URLとsubmit dateをprovenanceへ保持する。

### 6.5 Valuation and engines

Valuation、Technical、Supply & Demand、Market Correlation、Strategyは既存deterministic result型を可能な限りそのまま再利用する。同じformulaをSnapshot Builderへ再実装しない。

### 6.6 Peer Comparison

Peer sectionは既存`PeerComparisonResult`に加え、時価総額優先を実際に適用できたかを次のような明示状態で保持する。

```text
marketCapPriorityApplied: boolean
marketCapPriorityUnavailableReason: string | null
```

targetまたは候補のmarket capが不足した場合は`false`と理由を保存する。`marketCapPrioritizedPeerCount`だけからDashboardが適用済みと推測してはならない。

### 6.7 Unavailable

Top-level `unavailable`は、Builderがsection結果から正規化するread-only aggregateとする。

```text
section
metric or candidate (optional)
reason
source or plan limitation (optional)
```

callerやLLMから自由記述の金融欠損状態を受け取らず、既存engine reasonとtyped source errorを使う。

## 7. Price and Chart Data

SnapshotにはV4の表示に必要なadjusted OHLCV履歴を`priceHistory`として保持する。sourceの日付順、null、adjusted fieldを維持し、将来日の補完やforward fillを行わない。

Phase 1.5初期のChart表示:

- adjusted OHLC candlestick
- adjusted Volume
- 最新SMA20水準
- 最新Swing High水準
- 最新Swing Low水準

現在の`TechnicalResult`は最新SMA20と最新Swing High / Lowの数値を返すが、SMA全時系列やSwing pointの日付を返さない。初期UIは計算済み最新値を水平線として表示し、Dashboard側でSMA、Swing、ATRを計算しない。

将来全SMA時系列やdated Swing markerが必要になった場合は、Technical Engineまたは別のpure deterministic chart-series layerで生成し、Snapshot schema versionを更新して追加する。

## 8. Scenarios, Risks, and final report

`finalReportMarkdown`は表示・監査用成果物として保存できるが、他fieldを復元するsourceにしない。

将来のstructured narrative候補:

```text
ScenarioResult
- condition
- evidence[]
- invalidation
```

`risks`はstructured listとし、必要に応じてcategory、description、related sectionを持つ。ただし現在のBull / Base / Bear / RisksはLLM最終Markdown内で生成されるため、V1で大規模なAgent response refactorは行わない。

V1では次を許容する。

- `scenarios: null`
- `risks: null`
- structured narrative未取得を`unavailable`へ記録
- `finalReportMarkdown`をそのまま表示用に保存

V4までに、LLMへ金融数値を再入力させず、narrativeだけをtyped resultとして取得する小さなfinalization境界を設計する。Markdown parseへのfallbackは禁止する。

## 9. Local Persistence

保存先:

```text
.dexter/
└─ analysis/
   └─ <canonicalTicker>/
      ├─ latest.json
      └─ <snapshotId>.json
```

既存`.gitignore`の`.dexter/*`により`.dexter/analysis`はGit管理対象外である。`.dexter/RULES.md`の例外には影響しない。

### Save contract

1. Builder済みSnapshotをZodでvalidateする
2. canonical tickerとsnapshotIdをallowlist形式でvalidateする
3. targetと同じdirectoryのtemporary fileへJSONを書き込む
4. temporary fileを再読込し、JSON parseとschema validationを行う
5. Windows-safeなhistory filenameへatomic renameする
6. 同じ方式で`latest.json`を更新する

途中失敗時に壊れた`latest.json`を成功扱いしない。history保存後にlatest更新だけ失敗した場合も、明示的なerrorとして返す。symlinkはWindows互換性のため初期採用しない。

### Read errors

少なくとも次を区別する。

- missing snapshot
- malformed JSON
- schema validation failure
- unsupported schemaVersion
- unsafe ticker / snapshotId
- filesystem error

### 保存禁止情報

- API key
- auth token
- secret
- raw prompt
- raw tool arguments
- full environment
- scratchpad / reasoning
- Snapshot表示に不要なtool result

Snapshotはallowlist schemaでserializeし、任意objectをそのまま保存しない。

## 10. Local Web Server and API

RuntimeはBun、HTTP serverは`Bun.serve()`を第一候補とする。必ず次を明示する。

```text
hostname: "127.0.0.1"
```

hostを`0.0.0.0`へ変更できる一般設定はPhase 1.5で追加しない。DashboardとAPIは同一originから配信する。

### Read-only API

```text
GET /api/analyses
GET /api/analyses/:ticker
GET /api/analyses/:ticker/history
GET /api/analyses/:ticker/history/:snapshotId
```

- `/api/analyses`: 各tickerのlatest metadataのみ
- `/api/analyses/:ticker`: latest full snapshot
- `/history`: snapshotId、generatedAt、status、data freshness等のmetadataのみ
- `/history/:snapshotId`: 指定したfull snapshot

POST、PUT、PATCH、DELETEやDashboardからの分析実行は初期対象外とする。

### Security response contract

- `Access-Control-Allow-Origin: *`を返さず、CORSを有効化しない
- API responseへ`Cache-Control: no-store`を付ける
- tickerとsnapshotIdをroute到達時にvalidateする
- repository root外のpathを解決しない
- secret、raw prompt、raw tool args、environmentを返さない
- internal error stackをBrowserへ返さない
- unsupported methodは明示的に拒否する
- UIはMarkdownをunsafe HTMLとして直接挿入しない
- static responseへ適切なContent-TypeとCSPを設定する

## 11. Frontend

第一候補:

- Runtime / bundler: Bun
- Server: `Bun.serve()`
- Frontend: React + TypeScript
- Validation: existing Zod
- Persistence: JSON files
- Financial Chart: TradingView Lightweight Charts
- Styling: Phase 1.5初期はplain CSS

ReactはSingle StockとWatchlist間のstate、再利用可能なCard / Table / Badgeを扱うためV4で導入する。BunのHTML / TSX / CSS bundlingを利用し、Vite、Next.js、別backend、React Router、Reduxは初期導入しない。

Tailwind CSSは現repoに存在せず、初期UIはplain CSSで十分なため採用を保留する。UIが拡大し、utility classの一貫性が実際に必要になった時点で再評価する。shadcn/uiも導入しない。

Lightweight ChartsはV4でのみ追加し、client-sideでcandlestick、Volume histogram、最新Technical水準を表示する。ライセンスとTradingView attributionを確認して表示へ反映する。

技術判断は、Bun公式の[`Bun.serve()` server / routing](https://bun.sh/docs/runtime/http/server)および[HTML / TSX / CSS bundling](https://bun.sh/docs/bundler/html-static)、Lightweight Charts公式の[client-side要件・TypeScript型・license](https://tradingview.github.io/lightweight-charts/docs)を基準とする。実装開始時にcurrent versionのAPIを再確認し、API仕様を推測しない。

## 12. Dependency Plan

| Phase | Candidate | Reason |
| --- | --- | --- |
| V1〜V3 | 追加なし | Bun、TypeScript、Zod、filesystem APIを再利用できる |
| V4 | `react`, `react-dom` | detail / watchlist UIのcomponentとstate管理 |
| V4 | `@types/react`, `@types/react-dom` | TypeScript開発型 |
| V4 | `lightweight-charts` | candlestick、Volume、価格水準表示 |
| 保留 | `tailwindcss` | plain CSSで不足が確認された場合のみ再検討 |

新規dependencyは必要になるVでのみ追加し、設計段階ではpackage.jsonを変更しない。

## 13. Candidate File Layout

既存upstream差分を小さくするため、可能な限りadditiveなmoduleへ隔離する。

```text
src/
├─ analysis/
│  └─ snapshot/
│     ├─ schema.ts
│     ├─ builder.ts
│     ├─ standard-agent-adapter.ts
│     ├─ repository.ts
│     ├─ errors.ts
│     ├─ index.ts
│     └─ *.test.ts
└─ dashboard/
   ├─ server.ts
   ├─ api.ts
   ├─ *.test.ts
   └─ web/
      ├─ index.html
      ├─ app.tsx
      ├─ styles.css
      └─ components/
```

V1開始時に実装上の責務が小さければfile数を統合する。候補配置を理由に空moduleや将来用interfaceを先行作成しない。

## 14. V1 — Canonical Analysis Snapshot

### Goal

Standard Agentのcomprehensive analysisから、provider-neutral schemaに適合したCanonical AnalysisSnapshotを生成する。

### Candidate changes

- Snapshot Zod schemaとinferred TypeScript types
- Builder input / draft
- pure Builder
- Standard Agent adapterの最小hook
- source / engine result decoder

### Reuse

- `formatToolResult` contract
- resolverが確定したticker / company identity
- 6 deterministic engine result型
- source URLs、data dates、engine unavailable reason
- Standard Agentの明示的tool completion event

### Tests

- valid complete snapshot
- valid partial snapshot
- metric / section unavailable
- provenance and unit mapping
- canonical ticker validation
- malformed builder input
- sourced tick size欠損をexact価格なしで保持
- market cap priority未適用状態
- LLM Markdownをparseしないこと

### Done

- BuilderがLLM、provider、filesystem、UIへ依存しない
- Standard Agentの既知tool resultからSnapshotを生成できる
- 金融数値が既存engine resultと一致する
- partial / unavailable / provenance / unitsが失われない
- Claude Agent SDK未対応が明示され、schemaはprovider-neutralである

## 15. V2 — Local Persistence

### Goal

Snapshotを`.dexter/analysis`へ安全に保存し、latestとhistoryを読めるようにする。

### Candidate changes

- JSON repository
- typed persistence errors
- Windows-safe snapshotId
- save/load/list methods

### Reuse

- `dexterPath()`
- existing Zod schema
- Bun / Node filesystem API
- existing `.gitignore`

### Tests

- save / load round trip
- atomic save and latest consistency
- invalid JSON
- unsupported schemaVersion
- missing snapshot
- Windows-safe filename
- unsafe ticker / snapshotId and path traversal rejection
- secret-like extraneous fieldがschemaから保存されないこと

### Done

- valid Snapshotだけをhistoryとlatestへ保存できる
- failureを成功として扱わない
- historyをgeneratedAt順に列挙できる
- Git管理対象外である

## 16. V3 — Local Web Server

### Goal

保存済みSnapshotを、`127.0.0.1`限定のRead-only APIから取得できるようにする。

### Candidate changes

- `bun run dashboard` script
- Bun server config
- API routes and response helpers
- static frontend entryの最小配信

### Reuse

- Snapshot repository
- Snapshot Zod schema
- Bun runtime and `Bun.serve()`

### Tests

- server configが`127.0.0.1`固定
- list / latest detail API
- history metadata / history detail API
- unknown ticker / snapshot
- unsafe route parameter rejection
- `Cache-Control: no-store`
- CORS wildcardなし
- responseにsecret / prompt / raw argsがない
- unsupported HTTP method

### Done

- `bun run dashboard`でlocal serverを起動できる
- Read-only APIだけが存在する
- BrowserへSnapshot allowlist fieldだけを返す
- external interfaceへbindしない

## 17. V4 — Single Stock Dashboard

### Goal

7203の保存済みSnapshotを、金融計算なしで視覚的に確認できるdetail画面を作る。

### Display

- ticker、company、generatedAt、data dates
- Price、PER、PBR、ROE、Trend KPI
- adjusted OHLC candlestick、Volume
- latest SMA20、Swing High、Swing Low水平線
- target vs Peer median、rank、percentile
- market cap priority applied / unavailable
- Supply & Demand
- 60 / 250日Market Correlation
- Strategy trigger、exact価格またはunavailable reason
- Data freshness、partial / unavailable
- structured narrativeが利用可能な場合のみBull / Base / Bear / Risks
- `finalReportMarkdown`の安全な表示

### Tests

- nullable / unavailable表示helper
- unit-aware formatter
- strategy exact価格を欠損時に生成しない
- market cap priority未適用表示
- presentation mapping
- 過剰なDOM snapshot testやBrowser E2Eを初期追加しない

### Done

- 7203 fixture / saved Snapshotをdetail表示できる
- UIがSnapshot値をformatするだけで金融計算しない
- missing dataを0や空文字に置換しない
- ChartがSnapshotのadjusted OHLCVと計算済み水準だけを使う

## 18. V5 — Analysis Portfolio / Watchlist

### Goal

保存済み複数銘柄のlatest analysisを一覧し、detailへ遷移できるようにする。

これはAnalysis Portfolioであり、実保有資産管理ではない。

### Display

- ticker、company
- latest price、PER、PBR、ROE
- trend、margin percentile、250日beta
- latest source data date、generatedAt、status
- detail navigation

### Tests

- latest metadata mapping
- missing metric / stale data表示
- generatedAt / data date sorting
- detail navigation
- financial calculationをUI testで再検証しない

### Done

- 複数tickerのlatest metadataを一覧できる
- partial / stale / unavailableを誤表示しない
- Single Stock Dashboardへ遷移できる
- 保有株数、取得単価、配分、Portfolio riskを持たない

## 19. Test and Validation Policy

各Vで次を維持する。

```text
bun test
bun run typecheck
git diff --check
```

- Calculation engineの既存unit testを再利用し、UIでformulaを再検証しない
- V1〜V3はpure logicとI/O boundaryのunit / integration testを優先する
- V4〜V5はpresentation mappingとmissing stateを優先する
- Browser E2Eは7203の代表的smokeを必要になった段階で1本から開始する
- CIに実API key、実EDINET DB、実J-Quants、実LLMを要求しない

## 20. Technical Risks

| Risk | Mitigation |
| --- | --- |
| Agent出力とSnapshot生成が密結合になる | provider-neutral Builderと薄いadapterを分離する |
| Standard Agent tool result shapeが変わる | toolごとのZod decoderとfixture testを置く |
| Claude Agent SDKにtool resultがない | V1対象外とし、Markdown parseへfallbackしない |
| LLM narrativeを構造化できない | deterministic sectionを優先し、nullable + unavailableで表す |
| Snapshot schemaが肥大化する | 既存engine result reuseとsection-level metadataを優先する |
| JSON historyが増える | MVPではDBを追加せず、必要性が出るまでretention機能を作らない |
| `latest.json`が部分更新される | same-directory temporary fileとatomic renameを使う |
| routeから任意fileを読まれる | canonical ticker / snapshotId allowlistとroot containmentを検証する |
| Markdown / sourced textによるXSS | unsafe HTML挿入を避け、CSPと安全なrendererを使う |
| Chart要件が金融計算をUIへ漏らす | 初期は最新水準のみ。時系列はdeterministic layerで追加する |
| upstream updateと衝突する | `src/analysis`、`src/dashboard`中心のadditive moduleに隔離する |

## 21. Phase 1.5 Done Conditions

Phase 1.5は次をすべて満たした時に完了する。

- Step 10のMVP behaviorと検証結果が維持される
- Standard Agentからvalid Canonical AnalysisSnapshotを生成できる
- Snapshotがprovider-neutral schema、provenance、units、data dates、unavailableを持つ
- JSON history / latestをatomicに保存・読込できる
- `bun run dashboard`が`127.0.0.1`だけで起動する
- Read-only APIがlist、latest detail、history metadata、history detailを返す
- 7203 Single Stock Dashboardが保存済みSnapshotを表示する
- Analysis Portfolio / Watchlistからdetailへ遷移できる
- Dashboardが金融計算やMarkdown parseを行わない
- secretをSnapshot、API response、Browser bundleへ含めない
- Phase 2以降の機能と実保有Portfolio管理を追加しない
- tests、typecheck、CIが成功する

## 22. Branch Plan

設計文書:

```text
docs/visualization-mvp-plan
```

V1推奨branch:

```text
feat/analysis-snapshot-v1
```

V2以降も1つのVを1つのreviewable branch / pull requestとして扱い、前のVがmainへmergeされた後に次へ進む。
