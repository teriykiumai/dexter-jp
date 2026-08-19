# 日本株AI分析システム — Codex実装計画

**Version:** 0.2  
**Audience:** Codex / Implementation Agent  
**Base Repository:** `edinetdb/dexter-jp`  
**Target:** Personal-use local application  
**Date:** 2026-08-19

## 1. このファイルの役割

このファイルは **Codexが実装を進めるためのStep定義** だけを扱う。

参照優先順位:

1. `AGENTS.md` — 常に守る開発ルール
2. `docs/SPEC.md` — 何を作るか
3. `docs/MVP_IMPLEMENTATION_PLAN.md` — 今回どの順序で作るか

ユーザー自身の環境準備は `docs/USER_SETUP.md` を参照する。

# Step 0 — Baseline確認

## Goal

変更前のDexter JPがローカル環境で正常に動作することを確認し、以降の実装に必要な構造を把握する。

## Before Editing

**コードを変更しないこと。**

以下を読む。

- `AGENTS.md`
- `README.md`
- `package.json`
- `RULES.md.example`
- `env.example`
- `docs/SPEC.md`
- `docs/MVP_IMPLEMENTATION_PLAN.md`
- `src/tools/finance`
- `src/skills`
- 関連テスト

## Tasks

- repository構造を確認
- package scriptsを確認
- typecheck方法を確認
- test方法を確認
- J-Quants関連コードを確認
- EDINET DB関連コードを確認
- finance tool registryを確認
- Skill loader / registryを確認
- 既存の分析utilityを確認
- 重複実装を避けるための再利用候補を整理

可能なら `bun install` を行い、package scriptsに従ってtypecheck、tests、start / smoke testを行う。

## Do Not

- 新機能を実装しない
- ファイル構造を変更しない
- dependencyを追加しない
- formattingだけの大量diffを作らない

## Report

- baseline commit / branch
- 起動結果
- typecheck結果
- test結果
- 既存失敗の有無
- J-Quants実装箇所
- EDINET DB実装箇所
- Step 1 / 2で再利用すべき箇所
- 注意点

## Done When

変更前baselineが把握され、Step 1へ安全に進める。

# Step 1 — Project / Research Rules整備

## Goal

開発AIとDexter分析AIのルールを明文化する。

## Inputs

- `AGENTS.md`
- `RULES.md.example`
- `docs/SPEC.md`

## Tasks

### Development rules

`AGENTS.md` が既存repo構成と矛盾しないか確認し、必要な場合のみ最小修正する。

### Research rules

既存Dexter JPの仕組みに従って `.dexter/RULES.md` を作成または整備する。

最低限含める:

- no guessing
- data dates
- Fact / Interpretation / Risk separation
- peer comparison
- missing data disclosure
- Entry / Stop / Target require evidence
- Bull / Base / Bear should be conditional
- no look-ahead for historical analysis

## Do Not

- 新規analysis engineを作らない
- API endpointを追加しない
- Agent loopを変更しない

## Validation

既存Rules loaderが `.dexter/RULES.md` を読めることを確認する。

## Done When

Dexterが本プロジェクト固有の分析方針を読み込める。

# Step 2 — J-Quants Client拡張

## Goal

既存のJ-Quants株価取得を最大限再利用しつつ、MVPで必要な以下を扱えるようにする。

- stock OHLCV
- margin data
- TOPIX

## Inspect First

必ず既存の以下を確認する。

- `src/tools/finance/stock-price.ts`
- finance tool exports / registry
- existing J-Quants helpers
- existing tests
- environment configuration

`dexter-kabu-jp` のJQuantsClient / plan設計は参考にできるが、直接コピーを前提としない。

## Implementation

既存構成に自然な最小変更とする。

共通化が実際に重複を減らす場合のみclient抽出を行う。

必要機能:

- API key header
- common GET helper
- query params
- error handling
- plan / endpoint unavailable error
- typed response mapping where practical

## MVP Endpoints

- stock OHLCV
- margin
- TOPIX

## Out of Scope

- short selling
- investor types
- futures
- options
- advanced caching
- general-purpose J-Quants SDK

## Tests

- URL / params
- API key missing
- HTTP error
- response parsing
- endpoint unavailable / plan restriction if implemented
- mocked fetch

## Validation

- relevant tests
- typecheck
- existing finance tests

## Done When

同一のJ-Quants access layer / conventionから、`7203 OHLCV`、`7203 margin data`、`TOPIX` を取得できる。

# Step 3 — Technical Engine

## Goal

OHLCVからLLMなしでTechnical指標を計算する。

## MVP

- SMA
- ATR
- Swing High
- Swing Low
- Trend
- average volume

## Inspect First

既存utility / analysis codeに同等処理がないか検索する。

新しいトップレベルarchitectureを追加する前に、既存配置規則へ合わせる。

## Initial Rules

Swing:
- Swing High: 前後N本より高い高値
- Swing Low: 前後N本より低い安値
- default N: 3を初期候補とする

Trend:
- HH + HL → uptrend
- LH + LL → downtrend
- otherwise → range / transition

## Tests

SMA:
- normal
- insufficient period
- period = 1

ATR:
- normal
- gap
- insufficient history

Swing:
- clear swing high
- clear swing low
- equal values
- insufficient history

Trend:
- HH + HL
- LH + LL
- mixed

## Expected Structured Result

```json
{
  "ma20": 1234.5,
  "atr14": 45.2,
  "trend": "uptrend",
  "latestSwingHigh": 1300,
  "latestSwingLow": 1180
}
```

## Out of Scope

- RSI
- MACD
- supply-demand
- strategy

## Done When

OHLCVのみから決定論的Technical結果を返せる。

# Step 4 — Supply & Demand Engine

## Goal

信用残を過去水準との比較で定量化する。

## Inputs

- J-Quants margin history
- stock volume history

## MVP Metrics

- buying balance
- selling balance
- margin ratio
- weekly change
- 13-week mean
- 52-week mean
- deviation from 52-week mean
- 52-week percentile
- digestion days

データ量が十分で実装が小さい場合のみ:
- 4-week mean
- 26-week mean
- Z-score

## Formulas

Margin ratio:
```text
buying_balance / selling_balance
```

selling balance = 0 must be explicit.

Digestion days:
```text
margin_buying_balance / average_daily_volume
```

52-week deviation:
```text
(current - mean_52w) / mean_52w
```

## Tests

- selling balance = 0
- volume = 0
- < 52 weeks history
- missing values
- mean
- percentile
- deviation

## Expected Result

```json
{
  "marginRatio": 3.2,
  "buyingBalance": 12000000,
  "sellingBalance": 3750000,
  "mean13w": 9000000,
  "mean52w": 7200000,
  "deviation52w": 0.667,
  "percentile52w": 0.94,
  "digestionDays": 8.5
}
```

## Done When

LLMなしで需給統計を生成できる。

# Step 5 — Peer Comparison Engine

## Goal

既存 `company_screener` 等を再利用し、Peer比較を決定論的に行う。

## Peer Rule

1. same TSE 33-sector
2. market cap 0.3x–3x prioritized
3. 5–10 peers
4. include sector leader when useful

## Metrics

- PER
- PBR
- ROE
- ROIC
- operating margin
- revenue growth
- dividend yield

利用可能な指標のみ使用する。

## Statistics

- median
- rank
- percentile

Medianをmeanより優先する。

## Tests

- odd/even median
- missing values
- percentile direction
- too few peers
- target included/excluded consistently

## Done When

対象銘柄について構造化されたPeer positionを返せる。

# Step 6 — Market Correlation Engine

## Goal

個別株とTOPIXの連動性を決定論的に計算する。

## MVP Benchmark

- TOPIX

## Calculations

- daily return
- Pearson correlation
- beta
- alpha
- R²
- volatility
- excess return

## Data Alignment

- join by date
- inner join
- no forward fill
- only common trading dates

## Windows

MVP初期:
- 60 trading days
- 250 trading days

設計が自然なら20 / 120も追加可能だが、不要に範囲を広げない。

## Tests

- perfectly correlated series
- negatively correlated series
- mismatched dates
- insufficient data
- market variance = 0

## Expected Result

```json
{
  "period": 60,
  "correlation": 0.72,
  "beta": 1.14,
  "alphaAnnualized": 0.03,
  "rSquared": 0.52
}
```

## Done When

stock + TOPIX時系列からMarket statisticsを返せる。

# Step 7 — Strategy Engine

## Goal

Entry / Stop / Targetを決定論的に算出する。

## MVP Entry

直近Swing High突破を候補とする。

価格tick処理が必要な場合は、既存の市場ルールや利用可能情報に従う。推測しない。

## Stop Candidates

Swing stop:
- latest Swing Low

ATR stop:
```text
entry - 1.5 * ATR
```

## Target

2R:
```text
target = entry + 2 * (entry - stop)
```

必要なデータがある場合のみResistance targetを候補にする。

## Output

各候補に:
- price
- reason
- risk
- reward
- reward/risk

を持たせる。

## Tests

- normal long setup
- stop >= entry invalid case
- ATR invalid / unavailable
- zero risk
- 2R calculation

## Expected Result

```json
{
  "entry": {
    "price": 4205,
    "reason": "breakout_above_swing_high"
  },
  "stop": {
    "price": 4050,
    "reason": "latest_swing_low"
  },
  "target": {
    "price": 4515,
    "reason": "risk_reward_2R"
  },
  "rewardRisk": 2.0
}
```

## Done When

AIなしでEntry / Stop / Target候補と根拠を生成できる。

# Step 8 — Skills統合

## Goal

決定論EngineをDexter Agentから利用できるようにする。

## Candidate Skills

- technical-analysis
- supply-demand
- peer-comparison
- market-correlation
- comprehensive-analysis

実際のSkill数は、既存Skill loaderと重複を見て最小化する。

## Skill Responsibility

Skillは:

1. 必要データを取得
2. deterministic engine / toolを呼ぶ
3. 構造化結果を受け取る
4. AIが解釈するためのWorkflowを定義
5. 出力を整える

Skill内のMarkdownに金融計算を肩代わりさせない。

## Out of Scope

- shikori
- Monte Carlo
- ISQ
- Evaluator
- PDF

## Done When

Agentが自然言語の質問から各MVP分析を呼び出せる。

# Step 9 — Comprehensive Analysis

## Goal

`7203を分析して` からMVP分析を統合する。

## Workflow

```text
Company
  ↓
Fundamental
  ↓
Valuation
  ↓
Peer
  ↓
Technical
  ↓
Supply & Demand
  ↓
Market Correlation
  ↓
Strategy
  ↓
Bull / Base / Bear
  ↓
Risk
  ↓
Final Report
```

## Output

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

## Rules

- no fabricated data
- no fabricated prices
- scenario prices must derive from calculated/sourced levels
- missing phases must be disclosed
- each important data source should include its date

## Done When

1回の分析依頼からMVP全体が自動的に実行される。

# Step 10 — MVP E2E Validation

## Goal

MVP全体を実データで検証する。

## Candidate Symbols

- 7203
- 6758
- 8306

まず1銘柄で完了させる。

## Checklist

- financials
- valuation
- peer
- stock OHLCV
- margin
- TOPIX
- technical
- supply-demand
- correlation
- strategy
- data dates
- missing-data behavior
- final report

## Validate

- relevant unit tests
- complete test suite appropriate to repo
- typecheck
- smoke run

## Record

少なくとも1件、`7203を分析して` のE2E結果または再現手順をrepo内に残す。

## MVP Done When

`docs/SPEC.md` のMVP完成条件を満たす。

# Post-MVP

MVP中は実装しない。MVP完了後に別計画を作る。

## Phase 2

- RSI / MACD
- short selling
- investor type flows
- sector indices
- shikori / volume profile
- dividend advanced analysis

## Phase 3

- Evaluator
- advanced scoring
- PDF
- radar charts
- historical comparison

## Phase 4

- backtest
- strategy validation
- score validation
- look-ahead validation

## Phase 5

- portfolio
- cross-stock correlation
- VaR
- monitoring
- notifications
