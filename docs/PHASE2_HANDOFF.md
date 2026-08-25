# Phase 2 Handoff

**Purpose:** Context handoff for a new Codex thread
**Repository:** `teriykiumai/dexter-jp`
**Target:** Personal-use local Japanese-stock analysis AI
**Date:** 2026-08-24

## 1. Read This First

This document summarizes the implementation decisions that must be preserved when starting Phase 2 in a new Codex chat.

It is not a replacement for the repository source.

Use the current `main` branch and the following precedence:

1. `AGENTS.md`
2. `docs/SPEC.md`
3. `docs/MVP_IMPLEMENTATION_PLAN.md`
4. `docs/VISUALIZATION_MVP_PLAN.md`
5. `docs/PHASE2_PLAN.md`
6. this file as a non-normative summary
7. `Usage.md`

Merged code and tests define current implemented behavior. This handoff must not
override `AGENTS.md`, `docs/SPEC.md`, or an existing tested contract.

Before starting Phase 2A, ensure the Phase 1.5 V1–V5 PRs, `Usage.md`,
`docs/PHASE2_PLAN.md`, and this handoff are merged to `main`.

## 2. Project Goal

Dexter JP is a local, personal Japanese-stock analysis system.

Primary analysis domains:

- Fundamental
- Valuation
- Peer Comparison
- Technical
- Supply & Demand
- Market Correlation
- Shareholders / Events
- Entry / Stop / Target
- Bull / Base / Bear
- Risks
- Data Dates

Core principle:

> **Code calculates, AI interprets.**

Important calculations must be deterministic and testable.

## 3. Data Sources

Primary data:

- EDINET DB
- J-Quants

Do not guess API behavior or unavailable data.

J-Quants currently supplies the main daily market-data path used by:

- stock adjusted OHLCV
- margin data
- TOPIX

## 4. Existing Deterministic Engines

Phase 1 already includes deterministic implementations for:

### Financial Metrics

- PER
- PBR
- dividend yield
- revenue CAGR

### Technical

- SMA
- ATR
- average volume
- Swing High
- Swing Low
- trend classification

Trend contract:

```text
HH + HL → uptrend
LH + LL → downtrend
otherwise → range_or_transition
```

### Supply & Demand

- buying balance
- selling balance
- margin ratio
- weekly change
- 13-week mean
- 52-week mean
- 52-week deviation
- 52-week percentile
- average daily volume
- digestion days

### Peer Comparison

- same-sector cohort
- market-cap prioritization where data permits
- median
- rank
- percentile

Important:

Market-cap priority must not be claimed when the target or any relevant candidate market cap is incomplete.

### Market Correlation

Benchmark:

```text
TOPIX
```

Current primary windows:

```text
20
60
250
```

Calculations include:

- correlation
- beta
- alpha
- R²
- volatility
- excess return

Dates are inner-joined.

No forward fill.

### Strategy

Entry:

```text
strictly above recent Swing High
```

Stops:

```text
latest Swing Low
Entry - 1.5 × ATR
```

Targets:

```text
2R
sourced resistance, when available
```

Exact executable prices require sourced tick size.

If tick size is unavailable:

```text
trigger exists
exact entry = unavailable
```

Never fabricate `Swing High + 1 yen`.

## 5. Phase 1.5 Architecture

Phase 1.5 added a canonical data path for persistence and visualization.

```text
deterministic engines
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
```

### V1 — Canonical AnalysisSnapshot

Important top-level fields:

```text
schemaVersion
status
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

Current schema version is V1 at the Phase 1.5 boundary.

Do not silently change persisted schema semantics in Phase 2.

Phase 2A Snapshot evolution contract:

```text
AnalysisSnapshotV1Schema → immutable read compatibility
AnalysisSnapshotV2Schema → new Advanced Technical fields
AnalysisSnapshotV3Schema → Supply/Demand mean4w
```

- Repository reads valid V1, V2, and V3 snapshots.
- After V3 is enabled, new saves use V3 only.
- Existing V1/V2 JSON is not automatically rewritten.
- Unknown versions remain unsupported.
- V1/V2 history and Watchlist entries must remain readable.
- Existing `complete | partial` semantics remain based on Phase 1.5 required sections.

### Snapshot generation boundary

The Snapshot is generated from explicit typed tool completion events.

It is NOT generated from:

- final Markdown parsing
- prompt parsing
- scratchpad
- arbitrary historical tool-call scanning
- LLM re-entry of financial numbers

### Standard Agent

Standard Agent comprehensive-analysis runs can generate Snapshot data.

Interrupted / failed runs do not generate Snapshot artifacts.

### Claude Agent SDK

Schema and Builder are provider-neutral, but the Claude Agent SDK path is not currently wired to canonical Snapshot capture.

Do not use Markdown parsing as a fallback.

## 6. Persistence

Saved under:

```text
.dexter/
└─ analysis/
   └─ <canonicalTicker>/
      ├─ latest.json
      └─ <snapshotId>.json
```

Snapshot IDs are Windows-safe UTC timestamps.

Repository rules include:

- Zod validation before save
- temporary same-directory write
- reread + parse + schema validation
- atomic rename
- history then latest update
- explicit persistence error categories
- path traversal protection
- symlink / junction containment protection
- ticker / Snapshot identity validation
- history filename / generatedAt identity validation

Do not weaken these contracts.

## 7. Local Web API

Dashboard server:

```text
127.0.0.1:3000
```

Read-only endpoints:

```text
GET /api/analyses
GET /api/analyses/:ticker
GET /api/analyses/:ticker/history
GET /api/analyses/:ticker/history/:snapshotId
```

Security contract:

- loopback bind only
- Host allowlist: localhost / 127.0.0.1
- no wildcard CORS
- `Cache-Control: no-store`
- CSP
- unsupported methods rejected
- internal filesystem paths / stack traces not exposed
- no secrets in browser responses
- no browser write API

Do not add POST/PUT/PATCH/DELETE for Phase 2.

## 8. Dashboard

### Single Stock Dashboard

Displays:

- ticker / company / generatedAt / status
- Price / PER / PBR / ROE / Trend
- adjusted OHLC candles
- Volume
- latest SMA20 level
- latest Swing High level
- latest Swing Low level
- Peer median/rank/percentile
- market-cap priority status
- Supply & Demand
- TOPIX correlation
- Strategy
- Data Dates
- unavailable states
- final report

The Dashboard does not calculate SMA, Swing, ATR, PER, beta, etc.

### Analysis Watchlist

Displays latest metadata for saved stocks:

- ticker / company
- latest price
- PER
- PBR
- ROE
- trend
- margin percentile
- beta250
- latest source date
- generatedAt
- status
- stale indicator

This is an **Analysis Portfolio**, not an actual holdings portfolio.

It must not contain:

- shares held
- cost basis
- allocation
- P/L
- portfolio risk

## 9. Dashboard Presentation Rules

Missing values:

```text
null → 利用不可
```

Do not convert missing to zero.

Simple presentation transformations are allowed:

- unit formatting
- ratio → percentage display
- sorting
- stale-date comparison
- count of watchlist rows

Financial calculations are not allowed in the Browser.

## 10. Structured Narrative Status

The Snapshot schema has typed locations for:

```text
scenarios
risks
```

The Dashboard conditionally displays them when present.

However, Standard Agent Snapshot capture currently normally stores:

```text
scenarios: null
risks: null
```

Typed structured narrative capture is intentionally deferred.

The final report is stored as:

```text
finalReportMarkdown
```

Do not parse it to recover finance numbers, scenarios, or risks.

## 11. Phase 1.5 Technology Choices

Runtime / backend:

- Bun
- TypeScript
- Zod
- JSON persistence

Frontend:

- React
- React DOM
- TradingView Lightweight Charts
- plain CSS

Intentionally not used:

- Next.js
- SSR
- Vite as a separate app framework
- React Router
- Redux
- Zustand
- TanStack Query
- Tailwind
- shadcn
- Postgres
- GraphQL
- WebSocket

Do not add these in Phase 2 without a concrete requirement.

## 12. TradingView Lightweight Charts

The V4 implementation uses Lightweight Charts.

Keep the required TradingView attribution / NOTICE display intact.

Do not remove attribution while changing Technical UI.

## 13. JPX Security Codes

Canonical ticker handling supports:

```text
7203
130A
```

and normalizes corresponding J-Quants 5-character codes.

Do not regress alphanumeric JPX code support.

Ticker route/path validation must remain strict.

## 14. Important Existing Safety / Correctness Contracts

Preserve all of these:

### No guessing

Missing source data means unavailable.

### Exact strategy price

No sourced tick size => no executable entry.

### Peer completeness

Do not claim market-cap prioritization with incomplete market-cap evidence.

### Market dates

Inner join only.

No forward fill.

### Historical analysis

No future information.

### Snapshot identity

Route/path ticker must match `snapshot.canonicalTicker`.

History snapshot ID must match `generatedAt`.

### Browser

Presentation only.

## 15. Phase 2 Scope and Current Objective

The full Phase 2 scope remains:

```text
Phase 2A — Technical Expansion
Phase 2B — Short Selling
Phase 2C — Investor Type Flows
Phase 2D — Sector Indices
Phase 2E — Advanced Dividend Analysis
Phase 2F — Shikori / Volume Profile / POC / VAH / VAL
```

Each Phase 2B–2F tranche requires its own detailed plan. Phase 2A is complete;
Phase 2B implementation through P2-B4 is complete and P2-B5 is deferred after
evaluation. Phase 2C Investor Type Flows now begins with its docs-only P2-C0 design.

The Phase 2A sequence below is retained as implemented historical context.

Primary sequence:

```text
P2-D0 Baseline / Compatibility Verification
        ↓
P2-L0 Task-aware LLM Runtime Profiles
        ↓
RSI 14
        ↓
MACD 12/26/9
        ↓
Bollinger 20 / 2σ
        ↓
AdvancedTechnicalResult
        ↓
Exposure choice + Snapshot V2 integration
        ↓
Dashboard presentation
        ↓
Optional ADX
```

P2-L0 is a separate cross-cutting runtime PR before P2-T1. Its provider-neutral
profiles are `deep_analysis` (quality-first), `balanced` (normal), and
`fast_structured` (latency/cost-sensitive structured work). An omitted profile is the
legacy sentinel: preserve the selected `/model` choice, do not switch to `fastModel`,
and do not add reasoning parameters.

Resolve `selected model → task profile → effective model → effective capability →
optional effort` exactly once. Standard Agent uses `deep_analysis` and passes the same
immutable resolved runtime to streaming and blocking fallback. Internal screening,
routing, compaction, Web extraction, and summarization use `fast_structured`; memory
flush uses `balanced`. Deterministic code, HTTP fetches, and parsers have no profile.

The central resolver is the only code allowed to select provider `fastModel` values;
do not leave manual fast-model routing at call sites. OpenAI reasoning effort is
limited to the explicit GPT-5.6 Responses capability allowlist and is checked after
effective-model selection. Unsupported providers receive no OpenAI parameter;
DeepSeek V4 thinking and Claude Agent SDK behavior remain unchanged.

After Phase 2A Technical is stable:

```text
Supply/Demand:
- 4w mean — adopted as `mean4w`; latest four weekly buying-balance observations
- 26w mean — rejected
- Z-score — deferred

Market Correlation:
- 20d — adopted; 20 returns from the latest 21 closes after date inner join
- 120d — rejected
```

Fixed Phase 2A indicator contracts:

```text
RSI14
- adjusted close
- 15-close formula-helper minimum
- first 14 changes use arithmetic-mean gain/loss seeds
- Wilder smoothing thereafter
- zero loss → 100, zero gain → 0, both zero → 50

MACD 12/26/9
- adjusted close
- EMA seeds use the first period's arithmetic mean
- signal seed uses the first 9 MACD values' arithmetic mean
- 34-close formula-helper minimum
- histogram = MACD - signal

Bollinger 20 / 2σ
- adjusted close
- latest 20 closes
- population standard deviation, divisor 20
- no bandwidth in the initial contract

Production recursive range
- with at least 251 stock OHLCV bars, AdvancedTechnicalResult uses exactly the latest 251
- with fewer than 251 bars, it uses all available bars and applies the helper minimums
- selection occurs before adjusted-close validation; do not filter bars first
- prepending older bars cannot change results when the latest 251 bars are identical
- stock bars are not inner-joined with TOPIX for Technical calculation
```

Do not skip or fill missing observations. Use typed
`insufficient_history | missing_data | invalid_data` reasons. RSI uses the Snapshot
unit `index`; MACD and Bollinger price values use `JPY`.

Keep `AdvancedTechnicalResult` as a separate pure module. P2-T1–T4 must not change
the existing `TechnicalResult` or Agent tool surface. In P2-T5, compare returning the
separate result alongside the current result from `analyze_technical` with adding
`analyze_advanced_technical`;
choose using duplicate J-Quants retrieval, tool surface, collector compatibility, and
minimal diff rather than assuming a new tool is required.

See `docs/PHASE2_PLAN.md` for full details.

## 16. What Phase 2A Must Not Do

Do not:

- rewrite the existing Technical Engine wholesale
- change existing indicator semantics without a bug
- modify current Strategy rules just because RSI/MACD exist
- calculate indicators in React
- derive indicators in the LLM
- build a generic TA library without demonstrated need
- implement backtesting yet
- implement Phase 2F Volume Profile inside the Technical tranche
- add live data
- add actual portfolio management
- add a public server
- add authentication
- add cloud infrastructure

## 17. Expected Development Workflow

For every Phase 2A PR:

```text
main
 ↓
small feature branch
 ↓
implementation + tests
 ↓
bun test
bun run typecheck
git diff --check
 ↓
Draft PR
 ↓
review
 ↓
merge
```

Recommended early branches:

```text
feat/technical-rsi-phase2-step1
feat/technical-macd-phase2-step2
feat/technical-bollinger-phase2-step3
feat/advanced-technical-phase2-step4
feat/technical-snapshot-phase2-step5
feat/technical-dashboard-phase2-step6
```

Do not create later branches before the preceding contract is merged if they depend on it.

## 18. Baseline Validation

Before Phase 2 changes:

```bash
git switch main
git pull origin main
bun install
bun test
bun run typecheck
git diff --check
```

Record:

- current main SHA
- test count
- existing failures, if any
- current Snapshot schema version

Do not attribute a pre-existing failure to Phase 2.

## 19. Historical Phase 2A Codex Thread Prompt

The following prompt records the original Phase 2A implementation handoff:

```text
dexter-jp Phase 2A Technical ExpansionのP2-T1専用threadです。

以下を読んでください。

- AGENTS.md
- docs/SPEC.md
- docs/MVP_IMPLEMENTATION_PLAN.md
- docs/VISUALIZATION_MVP_PLAN.md
- Usage.md
- docs/PHASE2_PLAN.md
- docs/PHASE2_HANDOFF.md

現在のmainと直近のmerged PRを確認し、P2-D0とP2-L0が完了済みであることを
確認してください。

Phase 1 / Phase 1.5のcontractを変更しないことを最優先に、P2-T1 RSI 14だけを
実装してください。docs/PHASE2_PLAN.mdのfixed RSI formula、missing-data contract、
latest calculation sequence contractを変更しないでください。

既存TechnicalResult、Agent tool、Snapshot、Dashboard、MACD、Bollingerは変更せず、
nontrivial deterministic calculationに必要なunit testsを追加してください。

Code calculates, AI interprets.
No data means no claim.
Reuse before build.
Minimal diff.
```

## 20. Final Handoff Note

Do not try to reconstruct prior chat history.

The correct Phase 2 context is:

```text
current main code
+ committed design documents
+ tests
```

If prior conversation and repository code disagree, inspect the merged code and update the design document if necessary.

The purpose of this handoff is to make the new Codex thread independent of the old conversation while preserving the actual implemented contracts.

## 21. Active Phase 2B Handoff

Phase 2B begins with a docs-only P2-B0 source and contract design. The fixed
sequence is:

```text
P2-B0 Source / Contract Design
  → P2-B1 J-Quants short-sale-report source tool
  → P2-B2 deterministic reported-position engine
  → P2-B3 Tool exposure + Snapshot V4
  → P2-B4 Dashboard + comprehensive-analysis
  → P2-B5 sector short-ratio evaluation
```

### Source boundary

Keep weekly margin interest and public short-sale reports separate. Existing
`sellingBalance` is a margin-trading balance and must not be presented as a
short-sale report.

The first Phase 2B source is the individual-stock J-Quants V2 endpoint:

```text
GET /v2/markets/short-sale-report
```

It publishes reports for short-position ratios of 0.5% or more.

The 33-sector `/markets/short-ratio` endpoint is deferred to P2-B5 evaluation.

P2-B5 has now been evaluated with decision **DEFER**. The endpoint supplies daily
33-sector selling-turnover components in JPY, not issuer-level short positions or
outstanding balances. It can provide sector-wide short-selling-flow context, but a
standalone daily value does not justify Snapshot V5 or a new Dashboard section before
Phase 2D supplies a concrete sector-index/history consumer.

Future re-evaluation must resolve `S33` from authoritative J-Quants equity-master
data at the analysis as-of boundary, preserve the distinction between trading date
and information availability, and treat empty/non-trading responses as unavailable
rather than zero. Any sector short-selling ratio must be calculated deterministically
from the three source turnover values. Never attribute the sector result to the
issuer, combine it with `ReportedShortPosition[]` or margin interest, or derive a
threshold, squeeze classification, or Buy/Sell signal.

### No-look-ahead

```text
DiscDate = information availability date
CalcDate = position reference date
```

Historical analysis requires `DiscDate <= analysisAsOfDate`. Never use `CalcDate`
alone to admit a report into an earlier analysis.

### Report-level contract

Preserve a `ReportedShortPosition[]` with source-provided:

- disclosure and calculation dates
- exact `SSName`, `DICName`, and `FundName` strings
- short-position ratio and shares
- `PrevRptDate` (the previous calculation date) and `PrevRptRatio`

Map `PrevRptDate` to `previousCalculatedDate`; it is not a previous disclosure
date.

The only initial deterministic calculation is:

```text
ratioDelta = shortPositionRatio - previousReportedRatio
```

If the previous ratio is absent, the delta is `null`. Do not locate or infer a
previous report, normalize identities, fuzzy-match entities, or merge reports.

Do not aggregate reporters or funds into an issue-level total. Do not add ratios
with different calculation dates and do not forward-fill a silent reporter.

### Missing-data and units

An empty response is `no_public_disclosure_data`; it means only that no public
report for a short-position ratio of 0.5% or more was obtained. It does not mean
zero short interest, no short sellers, complete covering, or absence of positions
below 0.5%.

```text
shortPositionRatio     = ratio
previousReportedRatio  = ratio
ratioDelta             = ratio
shortPositionShares    = shares
```

Do not convert ratios to percent in the Engine. Do not persist addresses or other
analysis-unnecessary identity details. Do not add Buy/Sell labels, squeeze
classification, thresholds, or inferred aggregation.

See `docs/PHASE2_PLAN.md` for the full source mapping, result shape, step boundaries,
and test requirements. P2-B0 changes documentation only; runtime, Snapshot, and
Dashboard remain unchanged until their separately approved steps.

## 22. Active Phase 2C Handoff

Phase 2C uses J-Quants V2 `GET /v2/equities/investor-types`. It is weekly
market-section trading-value context in `thousand_JPY`, not issuer or sector flow.
The initial deterministic and Snapshot section is fixed to the exact source aggregate
`TokyoNagoya`; never claim that an investor category traded the analyzed company.

The source preserves `PubDate`, `StDate`, and `EnDate` separately. `PubDate` is the
publication date, not the J-Quants API availability date; the other two dates describe
the trading period. Historical selection uses one date-only eligibility contract:

```text
ordinary weekly vintage:
  eligibleDate = publishedDate

correction vintage published on or after 2023-04-03:
  eligibleDate = next official business day after publishedDate

eligibleDate <= analysisAsOfDate
```

The API normally updates around 18:00 JST on the fourth business day of the following
week, but that time is not guaranteed and does not define intraday eligibility. Live
analysis uses only rows actually returned by J-Quants. Resolve a correction's next
business day as the first later J-Quants `/v2/markets/calendar` date with `HolDiv`
`1` or `2`; pass calendar rows into the pure engine and do not use calendar-day or
weekdays-only arithmetic. Do not use period dates to bypass publication lag.

For post-2023-04-03 corrections, retain source rows and let the pure engine choose the
greatest eligible `PubDate` for exact `Section + StDate + EnDate`. Keep the old vintage
on the correction `PubDate`; use the corrected vintage only from the following
official business day. A future correction must not rewrite a historical as-of result.
Pre-2023 correction vintages cannot be reconstructed because the source supplies
corrected data only.

Keep the source hierarchy exact:

```text
summary: proprietary | brokerage | total
brokerage breakdown:
  individuals | foreignInvestors | securitiesCompanies | investmentTrusts
  businessCorporations | otherCorporations | insuranceCompanies | banks
  trustBanks | otherFinancialInstitutions
```

Every category preserves source `sell`, `buy`, `total`, and signed `balance` in
`thousand_JPY`. The engine validates source arithmetic and hierarchy but does not
replace source-provided totals/balances or add a new metric. Empty/no eligible data is
`no_investor_type_flow_data`; invalid fields or relationships are `invalid_data`.
Unavailable is never zero, and missing weeks are not forward-filled.

The source is unavailable on Free and available for 5/10/20 years on Light/Standard/
Premium; storage begins 2008-01-16. Plan restrictions remain typed source errors.

Snapshot integration is adopted in P2-C3 as V5, with V1-V4 immutable/readable and
existing complete/partial semantics unchanged. Dashboard and comprehensive analysis
remain presentation/interpretation layers and must not calculate, merge categories,
attribute market flows to an issuer, or add thresholds and Buy/Sell signals.

The fixed sequence is:

```text
P2-C0 Source / Contract Design
  → P2-C1 J-Quants investor-type source tool
  → P2-C2 deterministic correction/as-of engine
  → P2-C3 Tool exposure + Snapshot V5
  → P2-C4 Dashboard + comprehensive-analysis
```

P2-C0 is documentation only. See `docs/PHASE2_PLAN.md` for exact category meanings,
typed shape, invariants, provenance, deferred scope, and per-step tests.
