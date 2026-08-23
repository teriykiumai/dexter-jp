# Phase 2 Handoff

**Purpose:** Context handoff for a new Codex thread
**Repository:** `teriykiumai/dexter-jp`
**Target:** Personal-use local Japanese-stock analysis AI
**Date:** 2026-08-23

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
```

- Repository reads valid V1 and V2 snapshots.
- After V2 is enabled, new saves use V2.
- Existing V1 JSON is not automatically rewritten.
- Unknown versions remain unsupported.
- V1 history and Watchlist entries must remain readable.
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

## 15. Phase 2 Scope and Phase 2A Objective

The full Phase 2 scope remains:

```text
Phase 2A — Technical Expansion
Phase 2B — Short Selling
Phase 2C — Investor Type Flows
Phase 2D — Sector Indices
Phase 2E — Advanced Dividend Analysis
Phase 2F — Shikori / Volume Profile / POC / VAH / VAL
```

Each Phase 2B–2F tranche requires its own detailed plan. The active first tranche is
Phase 2A.

Start with deterministic Technical expansion.

Primary sequence:

```text
P2-D0 Contract Review
        ↓
RSI 14
        ↓
MACD 12/26/9
        ↓
Bollinger 20 / 2σ
        ↓
AdvancedTechnicalResult
        ↓
Tool + Snapshot V2 integration
        ↓
Dashboard presentation
        ↓
Optional ADX
```

After Phase 2A Technical is stable:

```text
Supply/Demand:
- 4w mean
- 26w mean
- Z-score

Market Correlation:
- optional 20d
- optional 120d
```

Fixed Phase 2A indicator contracts:

```text
RSI14
- adjusted close
- 15 minimum closes
- first 14 changes use arithmetic-mean gain/loss seeds
- Wilder smoothing thereafter
- zero loss → 100, zero gain → 0, both zero → 50

MACD 12/26/9
- adjusted close
- EMA seeds use the first period's arithmetic mean
- signal seed uses the first 9 MACD values' arithmetic mean
- 34 minimum closes
- histogram = MACD - signal

Bollinger 20 / 2σ
- adjusted close
- latest 20 closes
- population standard deviation, divisor 20
- no bandwidth in the initial contract
```

Do not skip or fill missing observations. Use typed
`insufficient_history | missing_data | invalid_data` reasons. RSI uses the Snapshot
unit `index`; MACD and Bollinger price values use `JPY`.

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

## 19. Recommended New Codex Thread Prompt

```text
dexter-jp Phase 2A Technical Expansion専用threadです。

まずコードを変更しないでください。

以下を読んでください。

- AGENTS.md
- docs/SPEC.md
- docs/MVP_IMPLEMENTATION_PLAN.md
- docs/VISUALIZATION_MVP_PLAN.md
- Usage.md
- docs/PHASE2_PLAN.md
- docs/PHASE2_HANDOFF.md

現在のmain、直近のmerged PR、Technical Engine、Snapshot schema、
Builder、Standard Agent collector、Dashboard presentationを確認してください。

Phase 1 / Phase 1.5のcontractを変更しないことを最優先に、
P2-D0の設計レビューだけを行ってください。

RSI 14、MACD 12/26/9、Bollinger 20/2σについて、
正確なformula、初期化、必要history、missing-data semantics、
既存utility再利用候補、Snapshot V1/V2 read compatibility、
PR分割案を報告してください。

まだ実装しないでください。

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
