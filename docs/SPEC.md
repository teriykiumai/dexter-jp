# 日本株AI分析システム 仕様書

**Version:** 0.4
**Status:** Draft  
**Base Project:** `edinetdb/dexter-jp`  
**Use:** Personal / Local only  
**Last Updated:** 2026-08-31

## 1. 目的

`edinetdb/dexter-jp` を基盤として、日本株について以下を横断的に分析する個人向けAI分析システムを構築する。

- ファンダメンタル
- バリュエーション
- Peer比較
- テクニカル
- 需給
- 市場・指数連動性
- 株主・イベント
- Entry / Stop / Target
- Bull / Base / Bear シナリオ

基本原則:

> **Code calculates, AI interprets.**

金融計算・統計計算は決定論的なコードで実行し、AIは取得済み事実と計算結果の解釈・比較・統合・説明を担当する。

## 2. 利用形態

本システムは **完全な個人利用** を目的とする。

### 必須条件

- ローカルPC上で実行できればよい
- CLIまたはローカルUIで利用できればよい
- 単一ユーザーを前提とする
- 外部公開を前提としない

### 非目標

MVPでは以下を実装しない。

- 公開Webサービス / SaaS
- マルチユーザー
- ログイン / OAuth / ユーザーDB
- 課金
- 外部向けAPI
- 第三者へのデータ配布
- 自動売買 / 証券会社への発注
- リアルタイム秒足 / HFT
- クラウド常時稼働

個人・ローカル用途に不要なインフラは追加しない。

## 3. ベースプロジェクト

### 3.1 `edinetdb/dexter-jp`

以下は原則として再実装しない。

- Agent loop
- LLM接続
- Tool calling
- Skill system
- EDINET DB連携
- 財務諸表取得
- Key ratios
- 有価証券報告書取得
- 大量保有報告
- Company screener
- J-Quants株価取得
- DCF
- Research Rules
- Memory
- Context compression
- CLI / レポート基盤

### 3.2 `raditrejp/dexter-kabu-jp`

以下の設計・分析手順を参考にする。

- supply-demand
- peer-comparison
- dow-theory
- correlation
- shikori
- comprehensive-analysis
- Evaluator
- J-Quants client abstraction
- plan capability management

分析思想・Workflowは参考にするが、数値計算は本プロジェクト側で決定論的コードとして実装する。コードを直接移植する場合は、ライセンス・依存関係・現行API仕様を別途確認する。

## 4. 設計原則

### Reuse before Build
Dexter JPに存在する機能を再実装しない。

### Code calculates, AI interprets
以下はLLMではなくコードで計算する。

- CAGR
- 移動平均
- ATR
- RSI / MACD
- Swing High / Low
- Correlation / Beta / Alpha / R²
- Percentile / Z-score
- 信用消化日数
- Peer中央値 / ランク
- Risk / Reward

### No data means no claim
データがない場合は推測しない。

### Data freshness
主要データには基準日または取得日を持たせる。

### Minimal diff
本家 `edinetdb/dexter-jp` との差分を小さく保つ。

### No look-ahead
過去時点分析・将来バックテストでは、その時点で未公表だった情報を使わない。

## 5. 分析機能

### 5.1 Fundamental

対象:
- 売上高 / 営業利益 / 経常利益 / 純利益
- EPS
- 営業利益率
- ROE / ROA
- 自己資本比率
- 営業CF / FCF
- YoY / QoQ / CAGR

原則として既存Dexter JP / EDINET DBを再利用する。

### 5.2 Valuation

候補:
- PER / PBR
- PSR
- EV/EBITDA
- 配当利回り / 配当性向 / DOE
- FCF Yield

可能な範囲で `現在値 vs 自社過去 vs Peer vs 業界中央値` を比較する。

### 5.3 Peer Comparison

初期ルール:
1. 同一東証33業種
2. 時価総額0.3～3倍を優先
3. 5～10社
4. 必要なら業界リーダーを含める

比較候補:
- PER / PBR / ROE / ROIC
- 営業利益率
- 売上成長率
- 配当利回り

統計:
- Median
- Rank
- Percentile

平均値より中央値を優先する。

### 5.4 Technical

MVP:
- SMA
- ATR
- Swing High / Low
- Trend
- 出来高平均

Trend初期定義:
- HH + HL → Uptrend
- LH + LL → Downtrend
- その他 → Range / Transition

MVP後:
- RSI
- MACD
- Bollinger Bands
- ADX 等

### 5.5 Supply & Demand

MVP:
- 信用買残 / 信用売残
- 信用倍率
- 前週比
- 13週平均 / 52週平均
- 52週平均との差
- 52週Percentile
- 信用消化日数

可能なら:
- 4週平均
- 26週平均
- Z-score

信用倍率:
```text
margin_ratio = buying_balance / selling_balance
```

信用消化日数:
```text
digestion_days = margin_buying_balance / average_daily_volume
```

### 5.6 Market Correlation

MVP Benchmark:
- TOPIX

将来:
- 日経平均
- 業種指数

計算:
- Daily return
- Pearson correlation
- Beta
- Alpha
- R²
- Volatility
- Excess return

日付はinner joinし、欠損日をforward fillしない。

分析期間候補:
- 20 / 60 / 120 / 250営業日

### 5.7 Strategy

Entry / Stop / TargetはAIの任意生成を禁止する。

Entry:
- 直近Swing High Breakout

Stop:
- 直近Swing Low
- Entry - 1.5 × ATR

Target:
- Risk : Reward = 1 : 2
- 必要に応じ過去Resistance

Risk / Reward:
```text
risk = entry - stop
reward = target - entry
reward_risk = reward / risk
```

各価格には根拠を持たせる。

### 5.8 Scenario

原則として単純なBuy/Sellではなく、Bull / Base / Bearを条件付きで提示する。シナリオ価格は計算済みのTechnical / Strategy結果を根拠とし、LLM単独で価格を生成しない。

### 5.9 Shareholders / Events

既存Dexter JPを利用し、上位株主、大量保有報告、決算、業績修正、配当、自社株買い、株式分割等を将来的に統合する。MVPでは既存取得機能の再利用を優先し、新規イベント基盤は作らない。

## 6. AIの役割

AIは以下を担当する。

- 分析計画
- Tool選択
- 計算済み数値の解釈
- 複数分析結果の統合
- Fact / Interpretation / Risk の整理
- Bull / Base / Bear の文章化
- リスク説明
- 最終レポート生成

## 7. AIが行ってはいけないこと

- 存在しない数値を推測する
- API仕様を推測する
- 重要金融計算をLLMのみで行う
- 根拠のないEntry / Stop / Targetを生成する
- 欠損値を暗黙補完する
- 過去分析で未来情報を使う

## 8. 出力

```markdown
# Summary
# Data Dates
# Fundamental
# Valuation
# Peer Comparison
# Technical
# Supply & Demand
# Market Correlation
# Entry / Stop / Target
# Bull / Base / Bear
# Risks
# Conclusion
```

## 9. MVP完成条件

`7203を分析して` に対し、自動的に以下を実行できる。

1. 財務取得
2. Valuation確認
3. Peer比較
4. OHLCV取得
5. Technical計算
6. 信用分析
7. TOPIX分析
8. Swing HighからEntry triggerを計算し、sourced tickSizeがある場合はexact Entry / Stop / Targetも計算
9. exact価格を計算できる場合はRisk / Rewardを計算し、できない場合は利用不可理由を明示
10. Bull / Base / Bear生成
11. リスク説明
12. データ基準日表示

## 10. MVP後

### Phase 1.5 — Local Web Visualization MVP

Phase 1.5は、Step 10で満たしたMVP完成条件を変更または再度開くものではない。MVP完了後に、分析結果の保存・可視化・Presentation Layerを追加する拡張である。

目的は、CLI中心の分析結果を、CLI、ローカルDashboard、過去比較、Portfolio分析、および具体的需要が確認された場合の将来のexportから再利用できるCanonical Analysis Artifactへ変換することにある。

依存方向:

```text
EDINET DB / J-Quants
         ↓
typed source results
         ↓
deterministic engines
         ↓
provider-neutral AnalysisSnapshotBuilder
         ↓
Canonical AnalysisSnapshot
         ├─→ CLI / LLM report
         ├─→ local JSON persistence
         └─→ local read-only Dashboard
```

原則:

- DashboardはPresentation Layerとし、金融・統計計算を再実装しない
- LLM最終Markdown、raw prompt、偶発的なtool履歴解析から金融数値を復元しない
- Snapshotはtyped source resultとdeterministic engine resultからコードで構築する
- source date、provenance、unit、partial / unavailable状態を保持する
- APIキー、auth token、raw tool argumentsをSnapshotやBrowserへ渡さない
- Local Web Serverは`127.0.0.1`のみにbindし、Read-onlyとする
- 個人・ローカル・単一ユーザー用途を維持し、外部公開しない
- Phase 2以降の分析機能を先取りしない

実施順序:

1. V1 — Canonical Analysis Snapshot
2. V2 — Local Persistence
3. V3 — Local Web Server
4. V4 — Single Stock Dashboard
5. V5 — Analysis Portfolio / Watchlist

Phase 1.5初期の価格Chartは、adjusted OHLC、Volume、計算済みの最新SMA20、Swing High、Swing Low水準を表示対象とする。全SMA時系列等が必要になった場合は、Dashboardではなく決定論的analysis / chart-series layerで生成する。

Phase 1.5完了条件の概要:

- Standard Agentの分析から、provider-neutral schemaに適合するSnapshotを生成できる
- 欠損を推測せず、provenance、unit、data date、unavailable理由を保持できる
- SnapshotをローカルJSONへ安全に保存・読込できる
- `bun run dashboard`で保存済み分析を`127.0.0.1`からRead-only表示できる
- 7203のSingle Stock Dashboardと保存済み銘柄一覧を表示できる
- Browserへsecretを返さず、既存のCLI分析と金融計算結果を変更しない

Phase 1.5の非目標:

- Phase 2以降の指標、Evaluator、総合score、Radar chart、Backtest
- 実保有株数、平均取得単価、資産配分、Portfolio Beta、VaR、銘柄間相関
- 証券口座連携、自動売買、リアルタイム配信、WebSocket
- Login、OAuth、SaaS、Cloud deployment、外部公開API
- PostgreSQL、Prisma、GraphQL、別backend

詳細は `docs/VISUALIZATION_MVP_PLAN.md` を参照する。

### Phase 2
- RSI / MACD
- 空売り
- 投資部門別
- 業種指数
- 配当高度分析
- しこり玉 / Volume Profile / POC / VAH / VAL

### Phase 3
- Radar chart
- 過去分析との差分
- 総合スコアの評価計画（runtime scoreは実装しない）

### Phase 4
- 保存済みSnapshotに事前記録されたEntry / Stop / Targetのoutcome監査
- manifestで指定した過去基準日のEntry / Stop / Target再構成・outcome検証
- official session、source-eligibility、as-of cutoff、corporate-action、tick-sizeを
  明示するpoint-in-time / no-look-ahead共通基盤
- 検証runを明示選択して閲覧するlocal Dashboard

Phase 4の結果はresearch-onlyであり、`precommitted`（保存済みSnapshot監査）と
`reconstructed_251_as_of`（exact 251-sessionのversioned policyによる過去時点
再構成）を混同または合算しない。後者は、complete retrieved historyを渡す現在の
production Technical / Strategy経路の再現・検証でも、過去に配信されていた訂正前
vintageの完全再現でもない。Phase 4ではportfolio backtest、取引コストを含む損益、
Strategyの合否、Buy / Sell signal、runtime composite scoreを実装しない。詳細は
`docs/PHASE4_PLAN.md` を参照する。

複数銘柄を含む再構成campaignの集計はrun全体だけを母集団とし、単一銘柄
Dashboardで銘柄別成績として表示またはBrowser再計算しない。現在銘柄はrun候補を
membershipで絞り、選択run内ではcase一覧・詳細だけを絞り込む。candidate identityは
run/case UUIDや時刻に依存しないversioned canonical digestとし、同一入力の再実行で
安定させる。

`docs/PHASE3_SCORE_EVALUATION_PLAN.md` のscore検証はPhase 4の自動的な要件では
なく、runtime採用も許可しない。point-in-time基盤の適用範囲をscoreへ広げる
場合は、Strategy outcome検証とは別のreviewed planと明示的な採否判断を必要とする。

PDF exportはPhase 3の対象としない。Dashboard外共有、immutableな監査提出、
定常的なoffline保存・印刷、またはPDF固有のaccessibility要件が具体化した
場合に、Phase番号を先に割り当てず独立した計画で再評価する。

Independent Evaluatorのruntime、CLI、API、Dashboard表示、gold-set gateは
Phase 3の対象としない。保存済み分析に対する具体的なレビュー需要、許容する
誤検出率、継続評価予算が定義された場合に、使用済みholdoutを再利用せず、
新しいversioned gold setとgate IDを含む独立した計画で再評価する。

### Phase 5
- Portfolio分析
- 銘柄間相関
- VaR
- 定期監視 / 通知
