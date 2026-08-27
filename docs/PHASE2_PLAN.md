# Phase 2 — Implementation Plan

**Version:** 1.0
**Status:** Complete
**Target:** Personal / Local only
**Base:** Phase 1 + Phase 1.5 completed
**Date:** 2026-08-27

## 1. Purpose

Phase 2 is the completed umbrella for the post-MVP capabilities defined in
`docs/SPEC.md`. This document began as the implementation plan for **Phase 2A —
Technical Expansion** and was extended with the reviewed source, formula,
availability, provenance, integration, and presentation contracts for Phase 2B–2F.

The primary goal is to deepen technical and market-context analysis while preserving the project principle:

> **Code calculates, AI interprets.**

Phase 2A must not turn the Browser Dashboard or LLM into a calculation layer. New
indicators and statistics must be produced by deterministic TypeScript code,
represented by typed results, captured in the canonical `AnalysisSnapshot`, and only
then interpreted or displayed.

Phase 2 began after the Phase 1.5 V1–V5 implementation and the initial design
documents were merged to `main`. Phase 2A–2F are now implemented and merged; the
completion matrix in Section 5 records the resulting state.

## 2. Source of Truth

Read these files before changing code:

1. `AGENTS.md`
2. `docs/SPEC.md`
3. `docs/MVP_IMPLEMENTATION_PLAN.md`
4. `docs/VISUALIZATION_MVP_PLAN.md`
5. `Usage.md`
6. `docs/PHASE2_PLAN.md`
7. `docs/PHASE2_HANDOFF.md`

Use this precedence when documents conflict:

1. `AGENTS.md` — development and workflow constraints
2. `docs/SPEC.md` — product scope and invariant behavior
3. `docs/MVP_IMPLEMENTATION_PLAN.md` — completed MVP contracts and phase boundaries
4. `docs/VISUALIZATION_MVP_PLAN.md` — inherited Snapshot / persistence / Dashboard contracts
5. `docs/PHASE2_PLAN.md` — Phase 2A implementation details
6. `docs/PHASE2_HANDOFF.md` — non-normative summary for context recovery
7. `Usage.md` — current operational behavior

Merged code and tests define the current implemented behavior. A newer or narrower
document must not silently override `AGENTS.md`, `docs/SPEC.md`, or an existing tested
contract.

## 3. Existing Architecture That Must Be Preserved

```text
EDINET DB / J-Quants
        ↓
typed source results
        ↓
deterministic engines
        ↓
provider adapter / collector
        ↓
AnalysisSnapshotInput
        ↓
AnalysisSnapshotBuilder
        ↓
Canonical AnalysisSnapshot
        ├─ CLI / LLM report
        ├─ JSON persistence
        └─ Read-only local API
                 ↓
            React Dashboard
```

Dependency direction must remain one-way.

The Dashboard must not call deterministic engines directly and must not calculate finance or technical indicators from raw OHLCV.

## 4. Phase 2A Design Principles

### 4.1 Reuse before build

Inspect existing utilities and engines before creating new abstractions.

Do not introduce a generic indicator framework unless at least two or more implemented indicators genuinely benefit from it.

### 4.2 Deterministic calculations only

The following Phase 2A metrics must be calculated in code:

- RSI
- MACD
- Bollinger Bands
- ADX, if implemented
- Supply/Demand Z-score, if implemented
- 4-week / 26-week margin statistics, if implemented
- 20-day / 120-day correlation windows, if implemented

The LLM may explain these values but must not calculate them.

### 4.3 No data means no claim

Insufficient history, invalid values, or unavailable sources must produce typed unavailable states.

Do not:

- fill missing OHLCV values
- forward-fill market dates
- replace unavailable values with zero
- infer signals from incomplete indicator state

### 4.4 No look-ahead

Historical calculations must use only observations available through the analysis date.

Indicator windows must never include future rows.

### 4.5 Minimal diff

Keep upstream mergeability.

Avoid:

- broad refactors
- new frameworks
- database migrations
- routing changes
- unrelated UI redesign
- changes to Phase 1 calculations unless a demonstrated bug requires it

### 4.6 Small reviewable PRs

Do not implement Phase 2 as one large PR.

Each deterministic indicator should have a narrow contract, unit tests, snapshot integration only when needed, and a separately reviewable diff.

## 5. Phase 2 Scope and Tranches

The Phase 2 umbrella preserves the scope defined in `docs/SPEC.md`:

```text
Phase 2A — Technical Expansion
Phase 2B — Short Selling
Phase 2C — Investor Type Flows
Phase 2D — Sector Indices
Phase 2E — Advanced Dividend Analysis
Phase 2F — Shikori / Volume Profile / POC / VAH / VAL
```

Phase 2B–2F each received their own source, formula, availability, provenance, and
test contracts before implementation. They remained separate from the first
Technical tranche while completing the Phase 2 umbrella.

### Phase 2 completion matrix

| Tranche | Completed scope | Snapshot result | Status |
| --- | --- | --- | --- |
| Phase 2A — Technical Expansion | Task-aware LLM profiles; RSI14; MACD 12/26/9; Bollinger 20/2σ; Advanced Technical aggregation and presentation; Supply/Demand `mean4w`; 20-day market-correlation window | V2 Advanced Technical; V3 `mean4w`; existing market-correlation `windows[]` extended without a new schema | **Complete** |
| Phase 2B — Short Selling | Public reported short-position source, deterministic report-level Engine, Snapshot and presentation; sector short-ratio evaluation completed and later implemented with Phase 2D context | V4 reported short positions | **Complete** |
| Phase 2C — Investor Type Flows | Weekly Tokyo/Nagoya market-context source, as-of-safe deterministic Engine, Snapshot and presentation | V5 investor-type flows | **Complete** |
| Phase 2D — Sector Indices | As-of-safe TSE 33-sector benchmark and sector short-selling turnover context, including source, deterministic Engines, Snapshot and presentation | V6 sector benchmark; V7 sector short-selling flow | **Complete** |
| Phase 2E — Advanced Dividend Analysis | As-of-safe fiscal dividend observations, optional event replay, Snapshot and presentation | V8 advanced dividend | **Complete** |
| Phase 2F — Daily OHLCV Volume Profile Proxy | P2-F0 source/contract design through P2-F5 Dashboard and comprehensive-analysis presentation | V9 full volume profile | **Complete** |

Snapshot V9 is the current writer. The read boundary accepts immutable V1–V9
Snapshots; existing V1–V8 files are neither migrated nor rewritten, and unknown
schema versions remain rejected.

Phase 2A is divided into three priority tiers.

### Priority A — Technical Engine Expansion

Required first:

- RSI
- MACD
- Bollinger Bands

Optional after those are stable:

- ADX

These are identified in `docs/SPEC.md` as post-MVP Technical capabilities.

### Priority B — Supply & Demand Expansion

After Technical expansion is stable, consider:

- 4-week average
- 26-week average
- Z-score

Only implement metrics that materially improve interpretation beyond the existing:

- 13-week average
- 52-week average
- deviation52w
- percentile52w
- digestion days

### Priority C — Market Correlation Window Expansion

After Technical and Supply/Demand changes are stable, add:

- 20 trading days

Existing 60-day and 250-day windows remain canonical and must not change semantics.
The 120-day window is rejected because it does not add enough information between
the existing 60-day and 250-day horizons.

Future benchmark expansion within Phase 2A is not required. Sector indices are
handled only under the separately approved Phase 2D contract in Section 23.

## 6. Phase 2A Non-Goals

Do not implement in the Phase 2A Technical tranche unless its separate Phase 2
sub-plan has been approved:

- realtime market data
- intraday / tick indicators
- HFT
- automated trading
- broker integration
- portfolio holdings
- cost basis
- allocation
- VaR
- portfolio optimization
- Volume Profile / POC / VAH / VAL
- backtesting framework
- strategy optimization
- parameter search
- ML price prediction
- AI-generated technical values
- public API / SaaS
- authentication
- cloud deployment
- Postgres / GraphQL / WebSocket
- browser-side financial calculations

Volume Profile remains Phase 2F and needs a dedicated approximation, binning, value
area, provenance, and validation contract. Backtesting remains Phase 4. Neither is
silently absorbed into Phase 2A.

## 7. Indicator Conventions

Exact formulas are fixed by this plan before implementation and must be documented in tests.

Do not rely on ambiguous textbook names alone.

### 7.0 Canonical calculation sequence

RSI and MACD are recursive indicators whose latest value depends on where their seed
sequence starts. To make the integrated Advanced Technical result reproducible for the
same analysis date, Phase 2A fixes the canonical calculation sequence instead of
letting an arbitrary caller-selected `from` date determine the seed.

For `AdvancedTechnicalResult` aggregation:

- input bars must be strictly chronological adjusted OHLCV
- when at least 251 bars are available through the analysis end date, use exactly the latest 251 bars as the canonical calculation sequence
- when fewer than 251 bars are available because of listing history or source coverage, use all available bars
- the 251-bar choice deliberately reuses the existing comprehensive-analysis contract that requests a range long enough for at least 251 common trading closes
- `dataDate` is the date of the latest bar in the canonical calculation sequence
- RSI and MACD are seeded from the beginning of that canonical sequence using the fixed rules below
- Bollinger Bands use the latest 20 closes within that same canonical sequence
- a missing or invalid observation inside the relevant calculation sequence/window is never skipped, forward-filled, interpolated, or used as a point at which to restart a recursive indicator
- indicator-specific minimum-history rules still apply after the canonical sequence is selected

The narrow RSI/MACD helpers may operate on an explicitly supplied sequence, but the
aggregate `AdvancedTechnicalResult` is responsible for selecting the canonical latest
251-bar sequence. This keeps helper behavior simple while making the integrated result
stable against arbitrary extra history before that boundary.

The aggregate-engine test plan must include a regression case where two inputs have the
same latest 251 bars but one input contains additional older bars. Latest RSI and MACD
must be identical for both inputs.

### 7.1 RSI

Initial implementation contract:

- period: 14
- source: strictly chronological adjusted close
- formula-helper minimum history: 15 positive finite closes
- initial average gain / loss: arithmetic mean of the first 14 price changes
- subsequent average gain / loss: Wilder smoothing
- a `null` close in the supplied calculation sequence => `missing_data`
- a non-finite or non-positive close => `invalid_data`
- do not skip, forward-fill, interpolate, or restart across an invalid observation
- positive average gain and zero average loss => `100`
- zero average gain and positive average loss => `0`
- zero average gain and zero average loss => `50`
- clamp only floating-point drift outside the mathematical `[0, 100]` range
- insufficient history => `insufficient_history`

Expected result example:

```ts
{
  rsi14: number | null,
  unavailable: [...]
}
```

Do not add overbought / oversold investment conclusions to the engine. Those are interpretation.

RSI is a dimensionless 0–100 oscillator, not a percentage. Snapshot V2 should use
an `index` unit rather than `percent`.

### 7.2 MACD

Initial implementation contract:

- source: adjusted close
- fast EMA: 12
- slow EMA: 26
- signal EMA: 9
- EMA seed: arithmetic mean of the first `period` values
- subsequent EMA: `value * (2 / (period + 1)) + previousEma * (1 - 2 / (period + 1))`
- MACD series begins when the 26-period slow EMA is available
- signal seed: arithmetic mean of the first 9 MACD values
- formula-helper minimum history for MACD + signal + histogram: 34 positive finite closes
- histogram: `macd - signal`
- `null` in the supplied recursive sequence => `missing_data`
- non-finite or non-positive close => `invalid_data`
- do not skip or restart the recursive sequence across missing data

Expected outputs:

```text
macd
signal
histogram
```

The engine returns values, not Buy/Sell signals.

### 7.3 Bollinger Bands

Initial implementation contract:

- source: adjusted close
- moving average: 20
- standard deviation window: 20
- upper/lower: ±2 standard deviations
- population standard deviation with divisor `20`
- minimum history: latest 20 positive finite closes
- only the latest 20-close window participates in the latest-value calculation
- a `null` inside that window => `missing_data`
- a non-finite or non-positive close inside that window => `invalid_data`

Expected outputs:

```text
middle
upper
lower
bandwidth (optional, only if explicitly approved)
```

Do not add bandwidth merely because it is easy to calculate.

MACD, signal, histogram, and Bollinger price levels inherit the adjusted-price unit
`JPY` in the current Japanese-stock-only scope.

### 7.4 ADX

ADX is optional in the first Phase 2 implementation.

If implemented:

- period: 14
- Wilder smoothing
- outputs should be narrowly scoped
- avoid building a full generic DMI subsystem unless needed

Potential outputs:

```text
adx14
plusDi14
minusDi14
```

Do not implement until RSI/MACD/Bollinger are stable.

## 8. Technical Result Contract Strategy

Keep the existing Phase 1 `TechnicalResult` and `analyze_technical` contract unchanged
through P2-T4. The current Snapshot collector validates the exact V1 technical
`unavailable` vocabulary, so adding Phase 2 metric names before Snapshot integration
could cause an otherwise valid comprehensive run to lose its Technical section.
P2-T5 may add an exposure envelope while keeping `TechnicalResult` and
`AdvancedTechnicalResult` as separate typed calculation results.

### Deferred through P2-T4 — Extend the existing tool result surface

Example:

```ts
{
  ma20,
  atr14,
  averageVolume20,
  trend,
  latestSwingHigh,
  latestSwingLow,
  rsi14,
  macd,
  bollinger,
  unavailable
}
```

Do not use this sequence in P2-T1–T4 while Snapshot V1 still validates the old result
contract. P2-T5 may compose the separate `AdvancedTechnicalResult` into the existing
`analyze_technical` tool output only after comparing it with a separate tool and
proving collector compatibility at the versioned Snapshot boundary.

### Adopted — Add an AdvancedTechnicalResult

Use an additive pure module such as:

```text
src/tools/finance/advanced-technical-engine.ts
src/tools/finance/advanced-technical-engine.test.ts
```

The module may expose narrow calculation helpers first and later aggregate them into:

```ts
{
  dataDate,
  rsi14,
  macd: { value, signal, histogram } | null,
  bollinger20: { middle, upper, lower } | null,
  unavailable: Array<{ metric, reason }>,
}
```

Do not register a new Agent tool or alter `TechnicalResult` in the RSI, MACD,
Bollinger, or aggregate-engine PRs. Aggregate the stable result only after all three
calculation contracts are merged.

At the Tool + Snapshot V2 integration step, compare these two consumer boundaries
before changing the Agent tool surface:

- **A. Existing tool integration:** preserve the existing `analyze_technical` identity and expose the Advanced Technical result through a version-aware extension/companion field without changing Phase 1 `TechnicalResult` semantics.
- **B. Separate tool integration:** register a dedicated `analyze_advanced_technical` tool that delegates to the pure module.

Choose between A and B based on concrete code evidence at that time: duplicate
J-Quants retrieval, Agent tool-surface complexity, Standard Agent collector/schema
compatibility, Skill changes, and minimal diff. A separate Agent tool is not a fixed
Phase 2A requirement.

This is a concrete compatibility boundary, not a generic indicator framework or an
abstraction added for symmetry.

## 9. Snapshot Evolution

Phase 1.5 established `AnalysisSnapshot.schemaVersion = 1`.

Phase 2A uses a versioned contract because new persisted fields would otherwise
silently change the canonical schema. The two possible approaches were:

1. backward-compatible optional additions, or
2. a schema-breaking contract requiring a new schema version

Do not silently mutate the persisted canonical schema.

### Adopted approach

When Phase 2A adds persisted structured fields, introduce:

```text
schemaVersion = 2
```

and preserve the immutable V1 contract:

```text
AnalysisSnapshotV1Schema — existing persisted contract, read-only compatibility
AnalysisSnapshotV2Schema — new snapshots with AdvancedTechnicalResult
```

Repository policy:

- continue to read valid V1 history and `latest.json`
- read valid V2 snapshots
- save only V2 after the V2 writer is enabled
- continue rejecting unknown schema versions
- do not rewrite or automatically migrate existing JSON files
- preserve ticker, generatedAt, snapshotId, containment, and atomic-save checks for both versions

Dashboard and API policy:

- accept the supported V1 / V2 union at the read boundary
- show Phase 2A values as not collected for V1 rather than treating them as zero
- never recover new values from `finalReportMarkdown`

A version-aware reader is required compatibility behavior, not a filesystem migration
layer added for convenience.

The existing top-level `complete | partial` status retains its Phase 1.5 required-section
meaning. Missing Phase 2A metrics must be represented by the Advanced Technical
section and typed unavailable reasons; they must not silently turn an otherwise
complete V1 analysis into `partial`.

### Snapshot integration rule

New indicator values must come from deterministic engine results.

Never derive Phase 2 snapshot fields from:

- final Markdown
- browser calculations
- prompt parsing
- LLM re-entry of numbers

Snapshot V2 unit additions:

```text
rsi14                          index
macd.value/signal/histogram    JPY
bollinger20.middle/upper/lower JPY
```

Add `index` to the V2 metric-unit vocabulary. Do not label RSI as `percent`.

## 10. Dashboard Strategy

The Phase 2 Dashboard should remain a Presentation Layer.

Initial rule:

> Implement and validate engine + typed contract first. Add UI only after the data contract is stable.

Possible Technical panel additions:

```text
RSI 14
MACD
MACD Signal
MACD Histogram
Bollinger Upper
Bollinger Middle
Bollinger Lower
ADX 14 (later)
```

Do not add full indicator time-series charts unless the deterministic data layer explicitly produces those series.

If only the latest indicator values exist, display only the latest values.

Do not reconstruct historical RSI/MACD/Bollinger series in React.

## 11. Suggested Implementation Sequence

### P2-D0 — Phase 2 Baseline / Compatibility Verification

**Goal:** No code changes. Verify that the fixed Phase 2A contracts can be implemented
against current `main` without reopening design decisions unnecessarily.

Tasks:

- confirm Phase 1.5 V1–V5 are merged
- run baseline tests/typecheck
- inspect Technical Engine and tests
- inspect Snapshot schema/builder/collector
- inspect Dashboard presentation mapping
- search for existing EMA/RSI/std-dev utilities
- verify that the fixed RSI/MACD/Bollinger contracts do not conflict with current code
- verify that the adopted AdvancedTechnicalResult and Snapshot V2/V1-read-compatibility boundaries are implementable with minimal diff
- identify any concrete compatibility risks before coding

Deliverable:

- confirmation of fixed-contract compatibility, or a concrete incompatibility with code/test evidence
- existing utility reuse candidates
- files likely to change
- implementation-focused test plan
- Snapshot V2 compatibility/implementation risks

Do not propose replacement formulas, a different schema version, or a different
Snapshot evolution strategy unless current merged code exposes a concrete
incompatibility that makes the fixed contract unsafe or impossible. In that case,
report the evidence before changing the plan.

**Done when:** the fixed contracts are verified against current `main`, implementation
risks are understood, and no unresolved incompatibility blocks P2-L0 or P2-T1.

### P2-L0 — Task-aware LLM Runtime Profiles

**Goal:** Add a provider-neutral runtime policy between P2-D0 and Technical
implementation. This is a cross-cutting runtime PR and must remain independent of
P2-T1–T7.

Profiles express orchestration intent, not provider parameters:

```text
deep_analysis   = quality-first
balanced        = normal
fast_structured = latency/cost-sensitive structured task
```

`taskProfile` is optional. When omitted, preserve legacy behavior exactly: keep the
selected model, do not select `fastModel`, and do not add a reasoning effort. Explicit
profile assignments are:

- Standard Agent multi-turn loop: `deep_analysis`
- company screener natural-language parsing: `fast_structured`
- get_financials routing: `fast_structured`
- context compaction: `fast_structured`
- LLM-based Web extraction and summarization: `fast_structured`
- chat-history summarization: `fast_structured`
- memory flush: `balanced`
- deterministic calculations, HTTP fetches, and parsing: no profile

Resolve in this fixed order:

```text
selected model
→ task profile
→ effective model
→ effective provider/model capability
→ optional reasoning effort
→ immutable ResolvedLlmRuntime
```

`fast_structured` selects the selected provider's configured `fastModel`, falling back
to the selected model when no fast model exists. This selection is the central
resolver's exclusive responsibility. Remove manual fast-model routing from compaction,
Web extraction, and any other migrated call site.

For the current OpenAI Responses API path, only the explicit `gpt-5.6`,
`gpt-5.6-sol`, `gpt-5.6-terra`, and `gpt-5.6-luna` capability allowlist receives
reasoning effort: deep=`high`, balanced=`medium`, fast=`low`. Apply capability checks
to the effective model, not the selected model. Do not send OpenAI reasoning
parameters to unsupported providers. Preserve DeepSeek V4's existing high-effort
thinking configuration and leave Claude Agent SDK unchanged.

For each Standard Agent model turn, resolve once and pass the same immutable runtime
object to both streaming and blocking fallback. A fallback must not re-resolve or
change model/provider/effort. Single-shot `callLlm()` may resolve its explicit model +
profile internally and must return the effective runtime as invocation metadata.

Tests cover resolver determinism, legacy behavior, fast-model fallback, capability
filtering, effort propagation, structured output/tool binding, shared
streaming/fallback runtime, `/model` preservation, DeepSeek behavior, and unchanged
Claude Agent SDK dispatch. Real-output quality comparisons belong to external API
evals, not exact-output unit tests.

Out of scope: Pro mode, `xhigh`, `max`, `/effort` UI, prompt classification, model
auto-upgrade, fast-model registry changes, and Phase 2A indicator code.

Suggested branch:

```text
feat/llm-task-profiles-step0
```

**Done when:** profile resolution is centralized, all assigned boundaries are explicit,
streaming/fallback share one runtime, legacy calls remain unchanged, and tests and
typecheck pass without Technical changes.

### P2-T1 — RSI 14

**Goal:** Add deterministic RSI only.

Tasks:

- pure calculation helper
- narrow typed calculation result / reason
- unit tests
- no changes to existing `TechnicalResult`
- no Agent tool, Snapshot, or Dashboard changes

Tests should include:

- normal rising/falling series
- flat series
- insufficient history
- zero-loss case
- zero-gain case
- missing value inside window
- no future-row use

**Do not implement MACD in this PR.**

Suggested branch:

```text
feat/technical-rsi-phase2-step1
```

### P2-T2 — MACD

**Goal:** Add deterministic MACD 12/26/9.

Tasks:

- EMA helper only if reuse is real
- MACD / signal / histogram
- narrow typed calculation result / reason
- unit tests
- no changes to existing `TechnicalResult`
- no Agent tool, Snapshot, or Dashboard changes

Tests:

- deterministic fixture
- constant series
- insufficient history
- missing data
- stable equality against hand-checked expected values

Suggested branch:

```text
feat/technical-macd-phase2-step2
```

### P2-T3 — Bollinger Bands

**Goal:** Add deterministic Bollinger 20 / 2σ.

Tasks:

- middle / upper / lower
- narrow typed calculation result / reason
- tests
- no changes to existing `TechnicalResult`
- no Agent tool, Snapshot, or Dashboard changes

Tests:

- constant series
- known variable series
- insufficient history
- missing data

Suggested branch:

```text
feat/technical-bollinger-phase2-step3
```

### P2-T4 — Advanced Technical Result

**Goal:** Aggregate the three stable helpers into one deterministic
`AdvancedTechnicalResult` without changing consumers yet.

Tasks:

- select the canonical latest-251-bar calculation sequence defined in Section 7.0
- aggregate RSI, MACD, and Bollinger latest values
- one `dataDate`
- typed metric-level unavailable reasons
- preserve chronological validation and source arrays
- aggregate-engine unit tests
- no Agent tool, Snapshot, or Dashboard changes

Tests:

- all three indicators available
- one indicator unavailable without hiding the others
- empty / insufficient history
- missing and invalid close behavior
- existing Phase 1 Technical result unchanged
- two inputs with identical latest 251 bars but different additional older history produce identical latest RSI and MACD

Suggested branch:

```text
feat/advanced-technical-phase2-step4
```

### P2-T5 — Tool and Snapshot V2 Integration

**Goal:** Expose the stable Advanced Technical result through the Agent and Canonical
Snapshot without breaking V1 persistence.

Before changing the tool surface, compare:

```text
A. existing analyze_technical integration
B. separate analyze_advanced_technical tool
```

Evaluate duplicate J-Quants retrieval, tool-surface complexity, collector/schema
compatibility, Skill changes, and minimal diff. Choose the smaller safe integration;
a new Agent tool is not mandatory.

Tasks after that boundary is selected:

- expose AdvancedTechnicalResult through the selected deterministic analysis-tool boundary
- update the relevant Skill instructions minimally
- add Snapshot V1 / V2 schemas and supported-version read boundary
- update Builder units, data dates, provenance, and unavailable aggregation
- update Standard Agent collector / decoder with ticker lock as required by the selected boundary
- preserve V1 read behavior and save V2 only
- verify persistence round trip and API output
- keep the Phase 1 `TechnicalResult` semantics unchanged

Tests:

- complete and metric-unavailable Advanced Technical results
- exact engine-to-Snapshot numeric equality
- V1 and V2 repository reads
- V2 save / load round trip
- unknown schema version rejection
- old required-section status semantics unchanged
- no Markdown parsing or secret-like extraneous fields
- selected tool boundary does not cause redundant market-history retrieval in the normal comprehensive-analysis path

Suggested branch:

```text
feat/technical-snapshot-phase2-step5
```

### P2-T6 — Dashboard Technical Presentation

**Goal:** Display Phase 2 Technical values only.

Tasks:

- extend presentation view model
- unit-aware formatting
- unavailable states
- no recalculation
- no new routing/state library

Tests:

- latest values are passed through exactly
- unavailable is not shown as zero
- no derived Buy/Sell signal
- V4 chart remains unchanged unless separately planned

Suggested branch:

```text
feat/technical-dashboard-phase2-step6
```

### P2-T7 — ADX Evaluation

**Goal:** Decide whether ADX adds enough value for current analysis.

Before coding:

- review overlap with existing HH/HL trend classification
- determine whether ADX changes actual interpretation quality
- avoid feature accumulation for its own sake

If approved, implement in a separate PR.

### P2-S1 — Supply/Demand Extension

Only after Phase 2A Technical is stable.

Candidates:

- 4-week mean — adopted as `mean4w`
- 26-week mean — rejected for overlap with existing 13w/52w horizons
- Z-score — deferred pending evidence that it improves interpretation beyond
  `deviation52w` and `percentile52w`

Do not alter current 13w/52w semantics.

`mean4w` uses the latest four weekly `longBalance` observations and reuses the
existing arithmetic-mean helper. Snapshot V1 and V2 remain immutable; Snapshot V3
adds the structured `mean4w` field with unit `shares`. Repositories read V1/V2/V3,
write V3 only, and do not rewrite older snapshots.

Tests must include:

- insufficient history
- zero standard deviation
- missing weekly balance
- no forward filling
- chronological validation

### P2-M1 — Correlation Window Extension

Add the adopted short-horizon window:

```text
20
```

Keep:

```text
60
250
```

unchanged.

The fixed output order is `20 → 60 → 250`. The 20-day result requires 20 return
observations from the latest 21 closes selected after the existing stock/TOPIX
date inner join. It preserves the current sample-statistics, annualization,
zero-variance, and no-forward-fill contracts and does not trigger another fetch.
Snapshot V3 stores it through the existing `windows[]` shape; no schema change is
required. The 120-day window is not implemented.

Tests must ensure:

- inner-join date alignment
- no forward fill
- exact window observations
- unavailable behavior for insufficient history

## 12. AI Interpretation Changes

After new deterministic values are available, update analysis instructions minimally.

The AI may say, for example:

```text
RSI is elevated relative to its recent range.
MACD is above its signal line.
Price is near the upper Bollinger Band.
```

provided the exact facts exist in structured results.

The AI must not say:

```text
RSI > 70 means the stock will fall.
MACD crossover guarantees upside.
```

Interpretation must remain probabilistic and contextual.

Do not add new deterministic labels such as `buySignal: true` unless a separate strategy contract explicitly defines them.

## 13. Strategy Interaction

Existing Strategy remains based on:

- Swing High breakout
- Swing Low stop
- ATR stop
- sourced tick size
- deterministic targets

Phase 2 indicators do not automatically change Entry / Stop / Target.

RSI/MACD/Bollinger may be used by the AI as supporting interpretation only.

Any future strategy that directly depends on Phase 2 indicators requires:

1. a separate deterministic strategy specification
2. explicit rules
3. tests
4. separate approval

Do not quietly modify the current Strategy Engine.

## 14. Test Policy

Every non-trivial deterministic calculation must have unit tests.

Required commands for each PR:

```bash
bun test
bun run typecheck
git diff --check
```

Prefer narrow test fixtures with hand-verifiable expected values.

Do not test only that a value is "not null".

Tests should verify exact or tolerance-bounded numeric outputs.

Use tolerance only where floating-point behavior requires it.

## 15. Performance

Phase 2 indicators operate on daily OHLCV histories and do not require special optimization initially.

Avoid:

- premature caching layers
- workers
- WASM
- native dependencies

Pure TypeScript/Bun remains preferred.

If several indicators consume the same validated close series, small local reuse is acceptable, but do not mutate source arrays.

## 16. Error / Unavailable Semantics

Each indicator must distinguish at least these expected-unavailability reasons:

```text
insufficient_history
missing_data
invalid_data
```

Availability is represented by a valid numeric result and no corresponding
unavailable item. Do not add `available` to the unavailable-reason vocabulary.

Use the narrowest typed reason practical.

Do not use free-form error text as the primary machine contract.

Unexpected programmer errors may throw; expected data absence should be represented structurally.

## 17. Data Dates and Provenance

Phase 2 indicators inherit their as-of date from the underlying price history.

Snapshot provenance should continue to distinguish:

```text
J-Quants → price_data
Technical Engine → calculation
```

Do not add fake source URLs for calculated indicators.

## 18. Phase 2A Completion Criteria

Phase 2A Technical is complete when:

- RSI 14 is deterministic and tested
- MACD 12/26/9 is deterministic and tested
- Bollinger 20/2σ is deterministic and tested
- recursive indicators use the fixed canonical calculation-sequence contract
- typed unavailable states exist
- canonical snapshot carries the stable values
- Standard Agent analysis can interpret them
- Dashboard displays them without recalculation
- persisted snapshots remain explicit about schema version
- existing Phase 1/1.5 calculations are unchanged
- no existing tests regress
- no look-ahead or missing-value fabrication exists

Optional Supply/Demand and correlation-window expansions require separate approval and
do not replace Phase 2B–2F.

ADX is not required for the first Phase 2 completion unless explicitly approved.

## 19. Historical Phase 2A Codex Task

The following prompt records the original Phase 2A implementation handoff:

```text
dexter-jp Phase 2A Technical ExpansionのP2-T1を実装します。

以下を読んでください。

- AGENTS.md
- docs/SPEC.md
- docs/MVP_IMPLEMENTATION_PLAN.md
- docs/VISUALIZATION_MVP_PLAN.md
- Usage.md
- docs/PHASE2_PLAN.md
- docs/PHASE2_HANDOFF.md

mainの現在状態と直近のmerged PRを確認し、P2-D0とP2-L0が完了済みであることを
確認してください。

Phase 1 / Phase 1.5の既存contractを維持したまま、P2-T1 RSI 14だけを実装して
ください。RSI helperはdocs/PHASE2_PLAN.mdのfixed formula、missing-data contract、
latest calculation sequence contractに従うpure deterministic calculationにします。

既存TechnicalResult、Agent tool、Snapshot、Dashboard、MACD、Bollingerは変更しないで
ください。normal、flat、insufficient history、zero loss、zero gain、missing value、
no future-row useのunit testsを追加してください。

Code calculates, AI interprets.
No data means no claim.
Reuse before build.
Minimal diff.
```

## 20. Final Rule

Phase 2A is not a feature-count exercise.

Prefer:

```text
few indicators
+ explicit formulas
+ deterministic tests
+ clean snapshot contract
+ useful interpretation
```

over:

```text
many indicators
+ ambiguous formulas
+ duplicated calculations
+ large UI
```

## 21. Phase 2B — Short Selling

Phase 2B starts with a docs-only source and contract design step. Do not add a
source tool, deterministic engine, Snapshot field, collector integration, or
Dashboard presentation in P2-B0.

### P2-B0 — Source / Contract Design

Phase 2B must keep these concepts separate:

```text
margin interest / 信用売残
    weekly margin-trading outstanding balance

short-sale report / 空売り残高報告
    publicly disclosed reported short positions
```

The existing `get_margin_data` and `SupplyDemandResult.sellingBalance` remain
unchanged. They must not be relabeled or reused as institutional short-sale
reports.

#### Source choice

The first individual-stock source is J-Quants V2:

```text
GET /v2/markets/short-sale-report
```

Reuse the existing J-Quants API-key authentication, pagination, securities-code
resolution, and typed plan/error behavior. Do not build a second J-Quants client.

The official source contract publishes reports for short-position ratios of 0.5%
or more. An absent row is not evidence that the position is zero, that no short
seller exists, or that no position below 0.5% exists.

Official references:

- <https://jpx-jquants.com/ja/spec/mkt-short-sale>
- <https://jpx-jquants.com/ja/spec/data-spec>

The sector-level endpoint below is not part of P2-B1 through P2-B4:

```text
GET /v2/markets/short-ratio
```

It requires a separate P2-B5 evaluation because it describes a 33-sector context,
not an individual company's reported position.

#### Fixed report shape

P2-B2 uses a source-report-level array and does not create an issue-level total:

```ts
interface ReportedShortPosition {
  disclosedDate: string;
  calculatedDate: string;

  reporterName: string | null;
  discretionaryManagerName: string | null;
  fundName: string | null;

  shortPositionRatio: number;
  shortPositionShares: number;

  previousCalculatedDate: string | null;
  previousReportedRatio: number | null;

  ratioDelta: number | null;
}

type ReportedShortPositionUnavailableReason =
  | 'no_public_disclosure_data'
  | 'invalid_data';

interface ReportedShortPositionResult {
  dataDate: string | null;
  reports: readonly ReportedShortPosition[];
  unavailable: readonly {
    reason: ReportedShortPositionUnavailableReason;
  }[];
}
```

The final implementation may adapt naming to current project conventions only
when that reduces the diff without changing these semantics.

`dataDate` is the latest included `disclosedDate`, not the latest `calculatedDate`.
An empty available report set has `dataDate: null`, an empty `reports` array, and
the typed `no_public_disclosure_data` reason. Callers must not infer availability
or zero from array length alone.

J-Quants field mapping is fixed as follows:

| J-Quants field | Typed field |
| --- | --- |
| `DiscDate` | `disclosedDate` |
| `CalcDate` | `calculatedDate` |
| `SSName` | `reporterName` |
| `DICName` | `discretionaryManagerName` |
| `FundName` | `fundName` |
| `ShrtPosToSO` | `shortPositionRatio` |
| `ShrtPosShares` | `shortPositionShares` |
| `PrevRptDate` | `previousCalculatedDate` |
| `PrevRptRatio` | `previousReportedRatio` |

`PrevRptDate` is the previous position calculation date, not a disclosure date.
An empty source string for an optional identity or previous-calculation-date field may map to
`null`. Every non-empty `SSName`, `DICName`, and `FundName` must otherwise remain
the exact source string. Do not trim into a canonical identity, normalize case or
language, fuzzy-match, or merge entities.

Addresses and other analysis-unnecessary identity details are not part of the
typed result or persisted Snapshot contract.

#### As-of and no-look-ahead contract

The two source dates have different meanings:

```text
DiscDate = information availability date
CalcDate = position reference date
```

For historical analysis, include a report only when:

```text
disclosedDate <= analysisAsOfDate
```

Apply this availability boundary before validating or calculating the selected
as-of result. A report with `CalcDate <= analysisAsOfDate` but a later `DiscDate`
must not be used. `CalcDate` alone never establishes historical availability.

Preserve both dates in every result. Do not backdate a disclosure to its position
reference date.

#### Previous-report and calculation contract

Preserve the source-provided `PrevRptDate` as `previousCalculatedDate` and
`PrevRptRatio` as `previousReportedRatio`. Do not reinterpret the previous
calculation date as a disclosure date. The only new deterministic calculation in
the initial engine is:

```text
ratioDelta = shortPositionRatio - previousReportedRatio
```

If `previousReportedRatio` is absent, `ratioDelta` is `null`. Do not search for,
match, forward-fill, or infer a previous report. In particular, do not use
`SSName`, `DICName`, or `FundName` to reconstruct report history.

#### No inferred aggregation

The initial result preserves `ReportedShortPosition[]`. It must not:

- sum reports from different reporters or funds
- add ratios with different `CalcDate` values
- forward-fill a reporter's older value into a date with no report
- construct an issue-level total short-position ratio or share count
- interpret a missing reporter or missing date as zero

Even reports sharing the same `CalcDate` remain separate source reports.

#### Empty and invalid data semantics

An empty source response uses the typed reason:

```text
no_public_disclosure_data
```

This means only that no public report for a short-position ratio of 0.5% or more
was obtained for the request and as-of boundary. It must not support any of these
claims:

- short position is zero
- no short sellers exist
- every short position was covered
- no position below 0.5% exists

Expected source absence and invalid fields use narrow typed states rather than a
fabricated default. Non-finite or negative ratios/shares are invalid; do not skip,
repair, or interpolate an invalid report into an available result.

#### Units

```text
shortPositionRatio     = ratio
previousReportedRatio  = ratio
ratioDelta             = ratio
shortPositionShares    = shares
```

The deterministic engine must not convert ratios to percent. Presentation may
format a ratio as a percentage using the declared unit, without recalculating it.

### P2-B1 — J-Quants Source Tool

Add only the narrow `/markets/short-sale-report` source tool. Reuse
`jquantsGetAll()` and `resolveJQuantsCode()`. Preserve the source dates, report
fields required by the fixed shape, pagination, and plan-unavailable errors.

Tests must cover endpoint and parameter mapping, API-key use without exposing it,
pagination, ticker resolution, nullable source fields, empty response, and current
J-Quants error behavior.

### P2-B2 — Deterministic Reported-position Engine

Add a pure engine that applies the `DiscDate` as-of boundary and calculates only
the source-provided previous-ratio delta. Keep reports separate and preserve input
arrays.

Tests must cover:

- hand-verifiable `ratioDelta`
- missing previous ratio produces `null`
- a future `DiscDate` is excluded
- an earlier `CalcDate` does not bypass a future `DiscDate`
- multiple reporters/funds remain separate
- reports with different calculation dates are never summed
- exact identity strings are preserved
- empty response uses `no_public_disclosure_data`
- invalid numeric data remains unavailable rather than becoming zero
- input non-mutation

### P2-B3 — Tool Exposure + Snapshot V4

Expose the deterministic result without changing existing margin-interest or
Supply/Demand semantics. Snapshot V1, V2, and V3 remain immutable and readable;
new saves become V4 only after this step is approved and implemented. Do not
rewrite older snapshots. Preserve report-level dates, typed unavailable reasons,
provenance, and units. Do not persist source addresses.

### P2-B4 — Dashboard + Comprehensive Analysis

The Dashboard displays Snapshot values only. It may format ratio units as percent
but must not calculate deltas, aggregate reporters, forward-fill reports, or infer
a squeeze/signal. Analysis instructions must distinguish public reports from
total market short interest and carry the disclosure threshold and missing-data
limitations into narrative interpretation.

### P2-B5 — Sector Short-ratio Evaluation

Decision after P2-D0 re-evaluation: **IMPLEMENT** in P2-D5.

`GET /v2/markets/short-ratio` returns daily 33-sector selling-turnover components
in JPY: non-short selling, short selling with price restrictions, and short selling
without price restrictions. Despite the endpoint name, it is a sector-level trading
flow source, not an issuer position source and not an outstanding-balance source.
It must never be presented as an individual company's short position, combined with
issuer-level `ReportedShortPosition[]`, or relabeled as weekly margin interest.

The source can add sector-wide short-selling-flow context: it can help distinguish a
broad sector move from an issuer-specific public report. That context has limited
standalone value for the current individual-stock analysis, however. A standalone
daily sector observation provides no contextual baseline unless historical sector
observations are deliberately retrieved and analyzed. It also contains credit-margin
short sales as part of the sector total and cannot support a company-level claim.
Meaningful use requires comparison with those historical observations and the
corresponding sector index. Phase 2D now fixes that shared sector context, but the
short-ratio source remains a separately approved follow-up after the core sector
benchmark is presented. Persisting it would require a later Snapshot version and must
not be bundled into the sector-index integration.

The current runtime has no authoritative ticker-to-`S33` resolution path. A future
re-evaluation must source the security's 33-sector code from J-Quants equity master
data at the applicable as-of boundary. Do not derive it by fuzzy-matching the EDINET
sector name or by treating a current classification as historical fact.

The endpoint requires Standard plan or higher. The current plan table provides up to
10 years on Standard and all available source history on Premium.
`Date` is the trading/aggregation date, not proof that the row was already available
at every point during that date. Historical use must select only rows known to have
been published by the analysis as-of boundary, must not forward-fill a non-trading or
missing date, and must not use a future sector classification. The official endpoint
notes that non-trading dates return empty data and that no data exists for the
2020-10-01 exchange outage; neither case is a zero observation.

Source amounts use `JPY`. If revisited, any displayed ratio would require a narrow
deterministic calculation from the three source values:

```text
totalSellingValue = nonShortSellingValue
                  + restrictedShortSellingValue
                  + unrestrictedShortSellingValue

shortSellingRatio = (restrictedShortSellingValue
                   + unrestrictedShortSellingValue)
                  / totalSellingValue
```

A zero denominator, invalid source value, unresolved sector, or empty response must
remain typed unavailable. An empty response means only that no sector row was
obtained for the requested source boundary; it is not zero short selling. Do not add
thresholds, squeeze labels, Buy/Sell signals, cross-sector aggregation, or inferred
issuer values.

P2-D5 implements the source, deterministic result, Snapshot V7, Dashboard, and
comprehensive-analysis integration only after Phase 2D establishes the concrete
sector context. It reuses the shared S33 resolver and availability boundary fixed by
P2-D0; the implementation contract is fixed below in the Phase 2D section.

### Phase 2B Sequence

```text
P2-B0 Source / Contract Design
  → P2-B1 J-Quants short-sale-report source tool
  → P2-B2 deterministic reported-position engine
  → P2-B3 Tool exposure + Snapshot V4
  → P2-B4 Dashboard + comprehensive-analysis
  → P2-B5 sector short-ratio evaluation
```

P2-B0 is docs-only. Each later step requires a separate, reviewable PR and must not
be implemented before the preceding contract it depends on is merged.

## 22. Phase 2C — Investor Type Flows

Phase 2C begins with this docs-only source and contract design. Do not add a source
tool, deterministic engine, Snapshot field, collector integration, Dashboard
presentation, or skill instruction in P2-C0.

### P2-C0 — Source / Contract Design

#### Source choice and analytical boundary

The primary official source is J-Quants V2:

```text
GET /v2/equities/investor-types
```

It provides weekly stock trading **value** by market section and investor type. It
does not accept a securities code and does not identify which investor type bought
or sold a specific issuer or sector. Despite the `/equities/` path, every result is
market context, not issuer evidence.

The initial analysis section is fixed to the source-provided `TokyoNagoya` aggregate.
Do not infer an issuer flow from its listing market, fetch every section to create an
ad hoc market total, or merge legacy and current sections. Other exact source
sections remain available to the narrow source tool but are deferred from the
initial deterministic result and Snapshot:

```text
TSE1st | TSE2nd | TSEMothers | TSEJASDAQ
TSEPrime | TSEStandard | TSEGrowth | TokyoNagoya
```

The combined section's coverage changes with the exchange regimes documented by
JPX. Do not describe its long history as a composition-constant series.

Official references:

- <https://jpx-jquants.com/ja/spec/eq-investor-types>
- <https://jpx-jquants.com/ja/spec/eq-investor-types/section>
- <https://jpx-jquants.com/ja/spec/mkt-cal>
- <https://jpx-jquants.com/ja/spec/mkt-cal/holiday-division>
- <https://jpx-jquants.com/ja/spec/data-update>
- <https://jpx-jquants.com/ja/spec/data-spec>
- <https://www.jpx.co.jp/markets/statistics-equities/investor-type/07.html>

Reuse `jquantsGetAll()` for API-key authentication, pagination, typed plan/error
behavior, and response-shape handling. Do not build another J-Quants client. The
source-tool query uses exact `section`, `from`, and `to` parameters; `from` and `to`
are publication-date boundaries. It has no ticker parameter.

#### Frequency, dates, availability, and corrections

The source unit is `thousand_JPY` for every numeric trading-value field. The data is
weekly and the J-Quants API normally updates around 18:00 JST on the fourth business
day of the following week. That time is an operational guideline, not a guaranteed
availability timestamp. The dates have distinct meanings:

```text
PubDate = information publication date
StDate  = trading-period start date
EnDate  = trading-period end date
```

`PubDate` and J-Quants API availability are not interchangeable. Historical as-of
selection uses one date-only, source-reproducible eligibility contract:

```text
ordinary weekly vintage:
  eligibleDate = publishedDate

correction vintage published on or after 2023-04-03:
  eligibleDate = next official business day after publishedDate

eligibleDate <= analysisAsOfDate
```

Resolve the correction `eligibleDate` as the first J-Quants `/v2/markets/calendar`
`Date` after `publishedDate` whose `HolDiv` is `1` (business day) or `2` (TSE
half-day session). The pure engine receives the required official calendar rows as
explicit input; it does not fetch them or approximate the next business day with
calendar-day or weekdays-only arithmetic. The engine does not infer intraday
eligibility from the normal 18:00 update guideline. A live query can use only rows
actually returned by J-Quants. Never use `StDate` or `EnDate` as the eligibility
boundary.

For corrections published on or after 2023-04-03, J-Quants can return both old and
corrected records with the same `Section`, `StDate`, and `EnDate` and different
`PubDate` values. On a correction's `PubDate`, keep the previously eligible vintage;
the correction becomes eligible on the following official business day. After
applying that boundary, select the greatest eligible `PubDate` for the exact key. A
future correction must not replace the version eligible at a historical as-of date.
Corrections published before 2023-04-03 are supplied only in corrected form, so the
original historical vintage cannot be reconstructed and that limitation must be
disclosed.

The dataset is unavailable on Free, available for 5 years on Light, 10 years on
Standard, and 20 years on Premium. Source storage begins on 2008-01-16. A plan limit
is a typed source error, not an empty successful result.

#### Exact source hierarchy and categories

Each source category provides four required source values:

```ts
interface InvestorTypeTradingValue {
  sell: number;
  buy: number;
  total: number;
  balance: number;
}
```

All four values remain in `thousand_JPY`. `total` and `balance` are source-provided;
they are not replaced by LLM or presentation calculations.

The summary hierarchy is fixed:

| Prefix | Typed category | Exact meaning |
| --- | --- | --- |
| `Prop` | `proprietary` | surveyed trading participants' own-account trading |
| `Brk` | `brokerage` | client-order trading handled by surveyed participants |
| `Tot` | `total` | source total of proprietary and brokerage trading |

The following prefixes are the source-provided brokerage breakdown. Keep every
category separate and in this order:

| Prefix | Typed category | JPX source category |
| --- | --- | --- |
| `Ind` | `individuals` | 個人 |
| `Frgn` | `foreignInvestors` | 海外投資家; defined principally by non-resident status, including the documented foreign securities-company branch case |
| `SecCo` | `securitiesCompanies` | 証券会社; eligible other-company client orders, not a surveyed participant's proprietary trading |
| `InvTr` | `investmentTrusts` | 投資信託委託会社 and asset-management companies under the source definition |
| `BusCo` | `businessCorporations` | 事業法人, including holding companies under the source definition |
| `OthCo` | `otherCorporations` | その他法人等 |
| `InsCo` | `insuranceCompanies` | 生保・損保 |
| `Bank` | `banks` | 都銀・地銀等; domestic ordinary banks |
| `TrstBnk` | `trustBanks` | 信託銀行 |
| `OthFin` | `otherFinancialInstitutions` | その他金融機関 |

Suffix mapping is fixed:

```text
Sell → sell
Buy  → buy
Tot  → total
Bal  → balance
```

Do not create a new `institutions`, `domestic`, `retail`, or `smart money` category.
Do not treat the summary categories and brokerage breakdown as independent additive
peers. In particular, `proprietary` is not the same as `securitiesCompanies`, and the
source `individuals` value must not be split into cash and margin trading because the
V2 endpoint does not provide that split.

#### Fixed typed result

```ts
type InvestorTypeSection =
  | 'TSE1st'
  | 'TSE2nd'
  | 'TSEMothers'
  | 'TSEJASDAQ'
  | 'TSEPrime'
  | 'TSEStandard'
  | 'TSEGrowth'
  | 'TokyoNagoya';

interface InvestorTypeFlowPeriod {
  publishedDate: string;
  periodStartDate: string;
  periodEndDate: string;
  section: InvestorTypeSection;
  summary: {
    proprietary: InvestorTypeTradingValue;
    brokerage: InvestorTypeTradingValue;
    total: InvestorTypeTradingValue;
  };
  brokerageBreakdown: {
    individuals: InvestorTypeTradingValue;
    foreignInvestors: InvestorTypeTradingValue;
    securitiesCompanies: InvestorTypeTradingValue;
    investmentTrusts: InvestorTypeTradingValue;
    businessCorporations: InvestorTypeTradingValue;
    otherCorporations: InvestorTypeTradingValue;
    insuranceCompanies: InvestorTypeTradingValue;
    banks: InvestorTypeTradingValue;
    trustBanks: InvestorTypeTradingValue;
    otherFinancialInstitutions: InvestorTypeTradingValue;
  };
}

type InvestorTypeFlowUnavailableReason =
  | 'no_investor_type_flow_data'
  | 'invalid_data';

interface InvestorTypeFlowResult {
  dataDate: string | null;
  section: 'TokyoNagoya';
  period: InvestorTypeFlowPeriod | null;
  unavailable: readonly {
    reason: InvestorTypeFlowUnavailableReason;
  }[];
}
```

`dataDate` is the selected `publishedDate`. The result contains only the latest
correction-resolved `TokyoNagoya` period available at the as-of boundary. It retains
the period start/end dates and does not relabel the value as an issuer data date.

#### Deterministic engine contract

The initial pure engine performs selection and validation only. It does not add a
new flow metric. For the selected row, require finite source values, nonnegative
`sell`, `buy`, and `total`, and a signed finite `balance`. Validate without replacing
the source values:

```text
category.total   = category.sell + category.buy
category.balance = category.buy - category.sell

summary.total = summary.proprietary + summary.brokerage
brokerage       = sum(exact source brokerage-breakdown categories)
```

Apply the two summary invariants component-wise to `sell`, `buy`, `total`, and
`balance`.

Apply the date-only eligibility filter before correction selection and validation.
Then choose the correction-resolved period with the greatest `periodEndDate`. An
invalid latest eligible row makes the result `invalid_data`; do not silently fall
back to an older valid period. Equal-key/equal-publication-date duplicates are
invalid rather than guessed or merged. Preserve input arrays.

An empty response or no eligible row is `no_investor_type_flow_data`. It means only
that no qualifying market-section record was obtained for the source/as-of boundary.
It does not mean zero buying, selling, or balance. Do not forward-fill a missing week.

Rolling sums, moving averages, net-flow ratios, shares of market turnover, category
ranks, and cross-section comparisons are deferred. If later adopted, they must be
separate deterministic contracts with unit and denominator tests; the LLM and
Dashboard must not calculate them.

#### Provenance and integration boundary

The result provenance must preserve:

- `source = jquants`
- endpoint `/v2/equities/investor-types`
- exact `section = TokyoNagoya`
- `publishedDate`, `periodStartDate`, and `periodEndDate`
- `source unit = thousand_JPY`
- engine calculation/validation provenance separately from source provenance

Do not persist API keys, pagination keys, or raw tool arguments.

Snapshot integration is adopted because the same structured market-context result
must be shared by CLI/LLM, persistence, API, and Dashboard. P2-C3 adds the minimum
Snapshot V5; V1-V4 remain immutable and readable, new saves become V5, older JSON is
not rewritten, and unknown versions remain rejected. Investor-type availability is
optional market context and must not change existing `complete | partial` semantics.

The Dashboard may format `thousand_JPY` and display the source hierarchy, but must
not recalculate balances/totals, aggregate categories, rank investors, or attribute
the market row to the issuer. Comprehensive analysis may interpret the latest weekly
market context while explicitly stating the section and all three dates. It must not
claim that any category bought or sold the analyzed company.

#### Relationship to existing data

- Supply/Demand is issuer-level weekly margin outstanding balance in shares.
- Reported short positions are issuer/report-level disclosed outstanding positions.
- Sector short ratio is a deferred daily sector selling-flow source.
- Investor Type Flows is weekly market-section trading value in thousand JPY.

These sources answer different questions. Do not add, net, normalize, or reconcile
them with one another. They may be interpreted side by side only with their scope,
frequency, dates, and units visible.

### P2-C1 — J-Quants Investor-type Source Tool

Add only the narrow `/equities/investor-types` source tool. Reuse `jquantsGetAll()`;
preserve every official category, source value, section, and date. Do not deduplicate
corrections or calculate metrics in the source tool.

Tests must cover endpoint/parameter mapping, API-key use without disclosure,
pagination, exact section/category mapping, signed balances, publication-date range,
correction rows remaining separate, empty response, invalid response, the documented
Light-or-higher requirement, and existing typed plan-unavailable behavior.

### P2-C2 — Deterministic Investor-type Engine

Add the pure correction-aware, as-of-safe latest-period selector and integrity
validator defined above. Tests must cover:

- future `PubDate` exclusion before validation
- `StDate`/`EnDate` never bypassing a future publication date
- correction `PubDate` date retaining the old vintage
- corrected vintage becoming eligible on the following official business day
- official calendar input handling without calendar-day or weekdays-only inference
- latest eligible correction as of the analysis date
- future correction not rewriting a historical result
- latest period selection after correction resolution
- summary and brokerage-breakdown invariants
- signed negative/zero/positive balances
- invalid numeric/invariant data without fallback
- empty/unavailable distinct from zero
- exact category and section preservation
- input non-mutation and no forward fill

### P2-C3 — Tool Exposure + Snapshot V5

Expose a structured `analyze_investor_type_flows` result. Direct source mode uses the
fixed `TokyoNagoya` section and explicit `analysisAsOfDate`; explicit source rows are
allowed for deterministic tests. Avoid duplicate J-Quants retrieval and keep the
source tool independently callable.

Add Snapshot V5 with the result, three dates, provenance, `thousand_JPY` units, and
typed unavailable reasons. Test V1-V4 reads, V5 write/read, no legacy rewrite,
unknown-version rejection, structured collector capture, optional-section status
compatibility, and direct-mode fetch count.

### P2-C4 — Dashboard + Comprehensive Analysis

Display Snapshot V5 values only, preserving summary versus brokerage-breakdown
hierarchy and unavailable states. Add the structured analysis tool to comprehensive
analysis with explicit market-context and publication-lag language. Tests must show
that the Browser and LLM instructions do not calculate, reclassify, attribute the
flow to an issuer, create a threshold, or produce a Buy/Sell signal.

### Phase 2C Sequence

```text
P2-C0 Source / Contract Design
  → P2-C1 J-Quants investor-type source tool
  → P2-C2 deterministic correction/as-of engine
  → P2-C3 Tool exposure + Snapshot V5
  → P2-C4 Dashboard + comprehensive-analysis
```

Each step is a separate reviewable PR and must not implement a later step early.

#### Deferred / rejected from initial Phase 2C

- issuer-level or sector-level attribution — rejected; absent from the source
- category merging/reclassification and `smart money` labels — rejected
- ratios, rolling/cumulative flows, Z-scores, ranks, thresholds, and signals — deferred
- cash/margin splits for individuals or proprietary trading — deferred; absent from this V2 endpoint
- share-volume data, ETF, REIT, regional foreign-investor, monthly, and annual datasets — deferred
- cross-market summation or artificial continuity across market restructurings — rejected
- Buy/Sell, crowding, risk-on/off, or regime classifications — rejected

## 23. Phase 2D — Sector Indices

Phase 2D adds an as-of-safe Tokyo Stock Exchange 33-sector price-index benchmark
for issuer analysis. It reuses the existing market-correlation calculation contract;
it does not create sector ranks, scores, signals, or issuer-level sector flows.

### P2-D0 — Source / Contract Design

P2-D0 fixes the following contract from the official J-Quants/JPX specifications.
It is documentation only; no source, Engine, tool, Snapshot, Dashboard, or
comprehensive-analysis code changes belong in this step.

#### Official sources

Use three J-Quants V2 sources with the existing API-key, pagination, plan-error, and
invalid-response handling:

| Purpose | Endpoint | Initial parameters | Required fields |
| --- | --- | --- | --- |
| issuer classification | `GET /v2/equities/master` | exact normalized `code`, exact classification `date` | `Date`, `Code`, `S33`, `S33Nm` |
| sector index history | `GET /v2/indices/bars/daily` | exact sector-index `code`, `from`, `to`, `pagination_key` when returned | `Date`, `Code`, `O`, `H`, `L`, `C` |
| business-day boundary | `GET /v2/markets/calendar` | the required date range | `Date`, `HolDiv` |

The index source is daily. `O`, `H`, and `L` may be `null` for close-only indices;
the initial benchmark calculation uses only finite positive `C`. The values are
official index points, not equity prices, and have no equity adjustment-factor
semantics or adjusted/unadjusted response flag. Do not rebase or manually adjust them.
Equity-master `Date` is the classification's applicability date, not an API
publication timestamp.

Use the regular price-return TSE 33-sector indices, not the Premium total-return
series. These indices expose `O/H/L/C` and have official storage from 2008-05-07.
The explicit authoritative mapping is:

| S33 | Sector index | S33 | Sector index | S33 | Sector index |
| --- | --- | --- | --- | --- | --- |
| `0050` | `0040` | `1050` | `0041` | `2050` | `0042` |
| `3050` | `0043` | `3100` | `0044` | `3150` | `0045` |
| `3200` | `0046` | `3250` | `0047` | `3300` | `0048` |
| `3350` | `0049` | `3400` | `004A` | `3450` | `004B` |
| `3500` | `004C` | `3550` | `004D` | `3600` | `004E` |
| `3650` | `004F` | `3700` | `0050` | `3750` | `0051` |
| `3800` | `0052` | `4050` | `0053` | `5050` | `0054` |
| `5100` | `0055` | `5150` | `0056` | `5200` | `0057` |
| `5250` | `0058` | `6050` | `0059` | `6100` | `005A` |
| `7050` | `005B` | `7100` | `005C` | `7150` | `005D` |
| `7200` | `005E` | `8050` | `005F` | `9050` | `0060` |

`S33 = 9999` (`Other`) has no corresponding TSE 33-sector price index and is
`unsupported_sector`; do not guess a benchmark. Do not derive this mapping from
names or arithmetic. Preserve the exact source `S33Nm` as the sector name.

`/indices/bars/daily` and `/equities/master` support pagination through
`pagination_key`; use the existing `jquantsGetAll()` loop. General index data is not
available on Free or Light and is available for 10 years on Standard and 20 years
on Premium. Equity master history is 2/5/10/20 years on Free/Light/Standard/Premium.
Both sources store data from 2008-05-07, subject to the subscription history limit.
An empty response means only that no qualifying official row was obtained. It is not
a zero index value or proof that an issuer has no sector.

J-Quants normally updates equity master around 17:30 JST, with a possible 8:00 JST
refresh, and general index OHLC around 16:30 JST. These are approximate,
non-guaranteed times. Live analysis may use only rows actually returned by the API.
An index `Date` is the trading/observation date; there is no separate guaranteed
publication timestamp in this endpoint. J-Quants corrections overwrite stored rows
and do not expose historical vintages.

Official specification references:

- `https://jpx-jquants.com/ja/spec/eq-master`
- `https://jpx-jquants.com/ja/spec/eq-master/sector33code`
- `https://jpx-jquants.com/ja/spec/idx-bars-daily`
- `https://jpx-jquants.com/ja/spec/idx-bars-daily/indexcodes`
- `https://jpx-jquants.com/ja/spec/mkt-cal`
- `https://jpx-jquants.com/ja/data-spec`
- `https://jpx-jquants.com/ja/data-update`
- `https://www.jpx.co.jp/markets/indices/line-up/`

#### Ticker to S33 resolution

Reuse the existing JPX-code normalization contract. Do not fuzzy-match EDINET
industry text, company names, or sector names.

For an explicit date-only `analysisAsOfDate`:

1. From official calendar rows, select the latest `Date <= analysisAsOfDate` whose
   `HolDiv` is `1` or `2`; this is `classificationDate`.
2. Query equity master with the normalized code and that exact date. This avoids the
   endpoint's documented behavior of returning the next business day's information
   when a non-trading date is supplied.
3. Require an exact code match and `row.Date = classificationDate`. Reject a future,
   conflicting, malformed, or missing row instead of using current classification.
4. Preserve the source `S33` and `S33Nm`, then map `S33` to the explicit index code
   above.

Do not accept the endpoint's 2008-05-07 fallback row for an earlier requested date.
At a historical date, a later sector change must not alter the selected classification.
A delisted issuer may resolve while it was listed; an empty post-delisting response is
unavailable rather than evidence of its former classification. Persist the resolved
classification date and benchmark identity in the eventual structured result so a
saved analysis is not re-resolved against current master data.

The source does not expose correction vintages. A future source correction may change
a fresh rerun for the same historical date; reproducing overwritten vintages requires
a separately designed local archive and is deferred. This limitation must be reported,
not hidden by applying current classification unconditionally.

The same resolver is the authoritative `S33` boundary for a later sector short-ratio
integration. It must not be duplicated or replaced with name matching.

#### Sector benchmark calculation

Treat TOPIX and the selected sector price index as separate benchmark identities over
the same deterministic calculation semantics. Preserve the existing TOPIX public
contract and all existing 20/60/250-window results.

Resolve the sector benchmark identity once from the issuer's `S33` at
`analysisAsOfDate`, and fix that one sector price index for the full 20-, 60-, and
250-return lookback windows. This is a historical comparison with the sector selected
at the analysis as-of boundary; it does not claim that the issuer belonged to that
sector throughout every lookback window. If the issuer changed sectors during a
window, do not stitch multiple sector indices or switch benchmark identity inside the
calculation. The existing rule against applying current classification to an earlier
historical `analysisAsOfDate` remains unchanged.

The initial sector comparison reuses:

- stock adjusted closes and official sector-index closes in strict chronological order
- date inner join before window selection
- exactly 20, 60, and 250 return observations, requiring 21, 61, and 251 aligned closes
- daily log returns
- sample variance/covariance with divisor `n - 1`
- annualization factor 245
- correlation, beta, `alphaAnnualized`, `rSquared`, stock/benchmark annualized
  volatility, and excess return
- existing insufficient-history and zero-variance semantics

Filter stock, benchmark, master, and calendar rows to their applicable
`Date <= analysisAsOfDate` before validation, alignment, and latest-window selection.
Never forward-fill either series. Missing or non-trading dates participate only
through the existing date inner join; do not create zero returns. The official price
index is used because stock adjusted closes are a price-return series; total-return
sector indices are deferred rather than mixing dividend semantics.

Avoid a duplicate calculation Engine. P2-D2 may extract the narrow benchmark-agnostic
calculation core already inside the market-correlation Engine, while retaining
`analyzeMarketCorrelation()` as an unchanged TOPIX wrapper and adding a separate
sector wrapper. Do not turn it into an arbitrary benchmark framework.

#### Historical and availability boundary

- `analysisAsOfDate` is the inclusive date-only boundary for both classification and
  price rows. It represents end-of-day eligibility; intraday live analysis still uses
  only rows actually returned at call time.
- `classificationDate` is resolved independently as the latest official business day
  on or before the boundary; current classification is never a historical default.
- Same-day index data is eligible only if J-Quants actually returns it. The approximate
  update time does not authorize fabrication or an intraday availability claim.
- Future rows are excluded before validation. Missing trading dates and non-trading
  days are not filled.
- Historical constituent changes inside the official sector index are already part of
  that official index series; Dexter JP does not reconstruct index membership.
- A persisted result keeps its resolved identity and values. Reconstructing overwritten
  J-Quants correction vintages remains explicitly unsupported without a local archive.

#### Minimum result contract

The exact TypeScript placement may follow current conventions, but the structured
boundary must preserve at least:

```ts
type SectorBenchmarkUnavailableReason =
  | 'sector_classification_unavailable'
  | 'unsupported_sector'
  | 'no_sector_index_data'
  | 'invalid_data';

interface SectorBenchmarkIdentity {
  type: 'TSE33_SECTOR_PRICE_INDEX';
  sectorCode: string;
  sectorName: string;
  indexCode: string;
  classificationDate: string;
}

interface SectorBenchmarkResult {
  analysisAsOfDate: string;
  benchmark: SectorBenchmarkIdentity | null;
  dataDate: string | null;
  alignedPriceCount: number;
  windows: readonly MarketCorrelationWindowResult[];
  unavailable: readonly { reason: SectorBenchmarkUnavailableReason }[];
  provenance: {
    classification: {
      source: 'jquants';
      endpoint: '/v2/equities/master';
    };
    index: {
      source: 'jquants';
      endpoint: '/v2/indices/bars/daily';
    };
    calculation: { source: 'market_correlation_engine' };
  };
  units: {
    indexLevel: 'index_points';
    observations: 'count';
    correlation: 'ratio';
    beta: 'ratio';
    alphaAnnualized: 'ratio';
    rSquared: 'ratio';
    stockVolatilityAnnualized: 'ratio';
    benchmarkVolatilityAnnualized: 'ratio';
    excessReturn: 'ratio';
  };
}
```

Metric-level unavailability continues to use the existing market-correlation window
reasons. Source authentication, transport, plan, and invalid-response failures remain
the existing typed J-Quants errors; do not relabel a plan error as market data zero.
`dataDate` is the latest aligned close date used by the result. No Snapshot version is
created in P2-D0.

#### P2-B5 re-evaluation

Decision: **IMPLEMENT** as P2-D5, after the core sector benchmark is presented. The
sector index supplies price behavior while `/v2/markets/short-ratio`
supplies daily sector selling-turnover components in JPY, so it can add distinct
sector-flow context once an authoritative sector identity is already visible.

The later step must reuse the same as-of-safe `S33` resolver and apply
`Date <= analysisAsOfDate` to rows actually returned by J-Quants. Its approximately
16:30 update is not guaranteed. Do not combine the flow with the price index into a
score, attribute it to the issuer, aggregate it with issuer reported positions or
margin balances, or add thresholds, squeeze labels, or Buy/Sell signals.

#### P2-D5 implementation contract

The source tool calls `GET /v2/markets/short-ratio` with the authoritative as-of S33,
`from`, and `to = analysisAsOfDate`, following existing pagination. It preserves one
daily row per returned `Date` and the official fields `SellExShortVa`,
`ShrtWithResVa`, and `ShrtNoResVa` as nullable JPY values. It accepts a previously
resolved classification only as the structured `sectorIdentity` envelope emitted by
`get_sector_index`; the same as-of-safe P2-D1 resolver still verifies it. The
envelope preserves source `analysisAsOfDate`, normalized `issuerCode`,
`classificationDate`, sector code/name, index code, and J-Quants equity-master
provenance. A bare classification is never accepted, and literal provenance fields
are not authentication. Before an envelope is used, the source re-resolves the
normalized target ticker and requested `analysisAsOfDate` through the P2-D1 resolver
and requires exact `issuerCode`, `classificationDate`, sector code/name, and index-code
agreement. A supplied sector-source result must also match the target issuer and source
as-of boundary.
It excludes future rows, never forward-fills a missing/non-trading
date, rejects conflicting S33 or duplicate dates, and keeps an empty response as
`no_sector_short_ratio_data`, not zero. J-Quants plan/authentication/transport errors
retain the existing typed source semantics.

The pure Engine emits chronological daily observations and calculates only:

```text
shortSellingValue = restrictedShortSellingValue
                  + unrestrictedShortSellingValue

totalSellingValue = nonShortSellingValue + shortSellingValue

shortSellingRatio = shortSellingValue / totalSellingValue
```

A source null makes that observation `missing_data`; a non-finite or negative source
value makes it `invalid_data`; a zero `totalSellingValue` makes only the ratio
`zero_total_selling_value`. Values are not skipped, filled, interpolated, or rolled
into a baseline. Units remain JPY for every value and ratio for
`shortSellingRatio`. The result preserves `analysisAsOfDate`, `issuerCode`, the as-of
sector code/name and `classificationDate`, `dataDate`, daily observations, typed
unavailable reasons, and source/calculation provenance.

P2-D5 exposes this structured result and adds the minimum Snapshot V7. V1-V6 schemas
remain immutable/readable, new saves become V7, old files are not rewritten, and
unknown versions are rejected. The optional section does not change existing
complete/partial semantics. Dashboard and comprehensive analysis use Snapshot/Engine
values only and identify them as sector-wide daily selling turnover, not an issuer
position, outstanding short-interest balance, or margin-interest balance. They do
not aggregate dates/sectors, calculate a historical mean or trend, combine the result
with the sector benchmark or another flow source, or create a rank, threshold,
squeeze/crowding label, score, Entry/Stop/Target, or Buy/Sell signal.

The Snapshot collector independently verifies the Engine result `issuerCode` against
the run's locked ticker. A mismatch is rejected and cannot persist either the sector
result or J-Quants classification provenance.

Tests fix endpoint/field/parameter mapping, pagination, authoritative identity
reverification, same-issuer wrong-S33 rejection before the flow fetch, issuer/as-of
rejection, as-of/future exclusion, missing and empty semantics, deterministic formulas, zero
denominator and invalid values, ordering/non-mutation, structured tool/collector
pass-through, V1-V6 read compatibility and V7 write, Dashboard unavailable-versus-
zero presentation, and comprehensive-analysis non-attribution/non-calculation rules.

#### Phase 2D sequence

```text
P2-D0 Source / Contract Design
  → P2-D1 J-Quants sector master/index source
  → P2-D2 deterministic sector benchmark integration
  → P2-D3 Tool exposure + Snapshot V6
  → P2-D4 Dashboard + comprehensive-analysis
  → P2-D5 sector short-ratio integration
```

P2-D1 adds only the calendar-backed S33 resolver, explicit mapping, and sector-index
source. Tests cover endpoint/parameter mapping, pagination, exact 33-sector mapping,
holiday/as-of selection, sector changes, delisting/empty responses, the pre-storage
fallback rejection, plan errors, and source non-mutation.

P2-D2 reuses the market-correlation calculation core without changing TOPIX results.
Tests cover 20/60/250 boundaries, exact latest aligned windows, future exclusion,
inner join/no forward fill, non-trading and invalid rows, zero variance, input
non-mutation, stable results when older history is prepended, a sector change inside
the lookback still using the single as-of sector index for every window without
stitching, and exact TOPIX regression.

P2-D3 exposes one structured result without duplicate price/master fetches and adds
the minimum Snapshot V6. V1-V5 remain immutable/readable, new saves become V6, old
files are not rewritten, unknown versions remain rejected, and optional sector data
does not change existing complete/partial semantics.

P2-D4 displays Snapshot values and updates comprehensive analysis to interpret sector
context without Browser/LLM calculation, issuer attribution, ranks, scores, signals,
or silent claims from unavailable data. P2-D5 adds only the separately approved daily
sector short-selling-flow context under the contract above.

#### Deferred / rejected from initial Phase 2D

- total-return sector indices and dividend-relative attribution — deferred
- a local archive for overwritten J-Quants classification/index vintages — deferred
- arbitrary-index benchmark framework and duplicate sector calculation Engine — rejected
- current-classification backfill, EDINET text matching, and fuzzy identity merge — rejected
- sector rotation, ranking, momentum, composite/crowding/risk-on-off scores — rejected
- Buy/Sell, Entry/Stop/Target, threshold, and squeeze classifications — rejected
- LLM or Browser numerical calculation — rejected
- Snapshot V6, tools, runtime, and presentation changes in P2-D0 — deferred to their steps

## 24. Phase 2E — Advanced Dividend Analysis

P2-E0 through P2-E5 are complete. At Phase 2E completion, Snapshot V8 was the writer
while V1-V7 remained readable and immutable. Snapshot V9 is now the current writer.
The Dashboard and comprehensive-analysis paths present the structured
advanced-dividend result without recalculation.

### P2-E0 — Source / Contract Design

P2-E0 is documentation only. It fixes the minimum source, availability, result, and
step contracts before any source tool, Engine, Snapshot, Dashboard, or skill change.
The objective is to add forward-looking dividend amount and sustainability context
without duplicating the current dividend-yield calculation or treating every cash
distribution as recurring ordinary dividend.

#### Existing capability and boundary

The merged baseline already provides:

- EDINET DB annual/quarterly financial history, including a sourced
  `dividendPerShare` value for up to six fiscal years
- `analyze_financial_metrics`, which deterministically calculates the current
  `dividendYieldPercent = dividendPerShare / currentPrice * 100`
- the current dividend yield in the canonical Snapshot valuation section and peer
  comparison
- EDINET DB screening by source-provided `dividend-yield` and `payout-ratio`
- comprehensive-analysis instructions that prohibit LLM calculation of dividend
  yield and payout ratio

The current result does not distinguish actual from company-forecast annual dividend,
does not preserve a disclosure/as-of vintage for that distinction, and does not carry
an annual payout-ratio series or explicit special/commemorative-dividend events.
Phase 2E adds only those missing structured facts. It does not replace or recalculate
the existing valuation dividend yield.

#### Official sources

The core source is J-Quants V2
[`GET /v2/fins/summary`](https://jpx-jquants.com/ja/spec/fin-summary). It provides
`DiscDate`, `DiscTime`, `DiscNo`, fiscal-period dates, actual annual dividend per share
(`DivAnn`), company forecast annual dividend per share (`FDivAnn`), next-fiscal-year
forecast annual dividend per share (`NxFDivAnn`), and their source-provided payout
ratios (`PayoutRatioAnn`, `FPayoutRatioAnn`, `NxFPayoutRatioAnn`). The endpoint is
queried by normalized five-digit JPX code and follows the existing J-Quants pagination
contract.

Financial summary data is disclosure-driven and daily. Premium API data is updated as
disclosures arrive; other plans are updated daily, approximately at 18:00 for速報 and
24:30 for確報. These times are not guarantees and must not be used as synthetic
availability timestamps. Storage begins 2008-07-07. The current plan limits are Free:
the two-year range excluding the latest twelve weeks, Light: five years, Standard:
ten years, and Premium: twenty years. Plan/authentication/transport failures remain
typed J-Quants errors and are never converted to zero dividend.
These plan/history limits govern rows available to the runtime; they do not change the
plan-independent `sourceEligibleDate` of a row that exists.

The optional event-detail source is J-Quants V2
[`GET /v2/fins/dividend`](https://jpx-jquants.com/ja/spec/fin-dividend). It preserves
notification date/time (`PubDate`, `PubTime`), unique/reference identity (`RefNo`,
`CARefNo`), update status (`StatCode`), interim/fiscal-year-end and forecast/decision
codes, per-share amount, record-date year/month (`IFTerm`), record date (`RecDate`),
rights record date (`ActRecDate`), ex date, payment date, and
`CommSpecCode`, `CommDivRate`, and `SpecDivRate`. It is Premium-only, TSE-listed-issue
only, and stored from 2013-02-20. The explicit commemorative/special component amounts
exist only from 2022-06-06. It updates daily at approximately hourly intervals from
12:00 through 19:00; the schedule is not guaranteed. An unavailable Premium plan is
an explicit `event_source_plan_unavailable` enrichment reason and does not invalidate
an otherwise available financial-summary result. Other source failures are not
swallowed.

Historical canonical eligibility also uses J-Quants V2
[`GET /v2/markets/calendar`](https://jpx-jquants.com/ja/spec/mkt-cal) with the merged
`HolDiv = 1` or `2` business-day convention. Calendar access remains subject to the
official plan/history range, including Free's delayed historical window. A missing or
plan-unavailable calendar is explicit and is not replaced with weekday arithmetic.

The official J-Quants
[`data-period`](https://jpx-jquants.com/ja/spec/data-spec),
[`update-timing`](https://jpx-jquants.com/ja/spec/data-update), and
[`correction`](https://jpx-jquants.com/ja/spec/fix-data-info) rules are part of this
contract. Empty responses mean only that no eligible record was returned. They do not
mean a zero dividend, no dividend policy, or no shareholder return.

TDnet/EDINET filings are authoritative candidates for payout-policy narrative and
share-repurchase disclosures, but those are document-level sources without a merged,
normalized lifecycle in the current repository. They are not source inputs to the
initial Phase 2E result.

#### As-of and no-look-ahead contract

Publication/notification time and J-Quants API availability are separate facts:

```text
financial summary publication:  DiscDate + DiscTime
dividend event notification:     PubDate + PubTime
historical source eligibility:   sourceEligibleDate
```

The initial boundary is date-only and canonical. `analysisAsOfDate` is the inclusive
cutoff for the plan-independent modelled source-eligibility rule below. It does not
assert that the row was obtainable under the configured subscription by the end of
that date in Japan time. Intraday historical availability is not claimed.

J-Quants does not expose first-available timestamps or historical delivery vintages,
and its update clocks are approximate. To avoid inferring delivery from those clocks,
use one conservative plan-independent rule for historical replay:

```text
/v2/fins/summary:
  sourceEligibleDate = next official business day after DiscDate

/v2/fins/dividend:
  sourceEligibleDate = next official business day after PubDate

eligible only when sourceEligibleDate <= analysisAsOfDate
```

`sourceEligibleDate` is this canonical/modelled boundary only. It is neither the
configured plan's actual first-delivery date nor evidence that a particular run
observed the row.

Resolve `sourceEligibleDate` as the first later J-Quants `/v2/markets/calendar` row
whose `HolDiv` is `1` (business day) or `2` (TSE half-day session). The pure resolver
receives official calendar rows explicitly and never substitutes calendar-day,
weekdays-only, locale-holiday, or approximate-clock arithmetic. If a potentially
eligible row lacks sufficient calendar coverage, return
`availability_calendar_unavailable`; do not assume same-day or next-day availability.

This boundary deliberately delays even Premium rows that may actually arrive on the
publication date so that the canonical eligibility of the same returned row does not
vary by configured plan. Runtime availability remains separate: every run obeys its
configured plan/history coverage, uses only rows actually returned, and preserves
existing typed `plan_unavailable` and other source errors. Exact delivery-time
reconstruction is impossible without a locally retained first-observed archive,
which is outside this phase. Persisted Snapshots remain the evidence of what a
particular run actually observed.

For the same `/v2/fins/summary` disclosure on date D with
`analysisAsOfDate = D + 1 official business day`:

- Premium, when the row and required calendar coverage are returned: the row is
  canonically eligible
- Free, while the row is excluded by the official latest-twelve-weeks delay: the
  runtime result is `no_eligible_dividend_disclosure_data`; do not fabricate the row
  or move its canonical `sourceEligibleDate`

If a candidate row is returned but the configured plan does not return enough
calendar coverage to resolve its boundary, use `availability_calendar_unavailable`.
A successful empty response cannot prove whether no disclosure exists or plan/history
coverage omitted it; it claims only that no usable returned row was available.

- `DiscDate`/`DiscTime` and `PubDate`/`PubTime` remain the issuer/source publication or
  notification facts; neither pair is renamed to API availability
- `DiscTime`/`PubTime` and then `DiscNo`/`RefNo` provide deterministic ordering within
  a source date; period-end, record, ex, board, and payment dates are never used as
  availability dates
- a row on its `DiscDate`/`PubDate` is not yet source-eligible; it becomes eligible only
  on the fixed following official business day
- live analysis may use only rows actually returned by J-Quants and must still apply
  the canonical `sourceEligibleDate` filter; an approximate schedule never makes an
  absent or same-day row eligible
- future disclosures, forecasts, corrections, and deletions are excluded before
  validation and selection
- the current company forecast is never back-applied to an earlier historical as-of
  date

For financial summary, select the latest eligible disclosure for each exact target
fiscal-year end and actual/forecast kind. `DivAnn` and `FDivAnn` target `CurFYEn`;
`NxFDivAnn` targets `NxtFYEn`. Do not map a next-year forecast to the current fiscal
year. A blank value in the selected disclosure stays unavailable; do not recover it by
forward-filling another period or by asking the LLM to infer it.

For dividend events, resolve source eligibility first, then replay eligible
notifications in `PubDate`, `PubTime`, `RefNo`
order. `StatCode = 1` creates the state identified by its `CARefNo`; `2` replaces that
state; `3` removes it. A correction or deletion whose `sourceEligibleDate` is after
the as-of boundary must not change the earlier result. Do not match events by
company/fund text or
heuristics when the source supplies reference identity.

J-Quants generally applies data corrections by overwriting source data and does not
provide an old vintage, version number, or ETag. Therefore a new run for an old as-of
date cannot guarantee reproduction of a source-side retroactive overwrite that did
not arrive as a separately dated disclosure/event. Persisted Snapshots are immutable
historical evidence and must record collection time and source identity; a later
source correction never rewrites an existing Snapshot.

#### Value, units, and unavailable semantics

- annual/event dividend per share uses `JPY_per_share`
- annual and event amounts remain on the source-disclosed per-share basis; the initial
  Engine does not retroactively split-adjust them or compare them as growth
- J-Quants payout-ratio fields are ratios as delivered (for example `0.321`), not
  percentages; presentation may format `0.321` as `32.1%`
- source `0` is a valid zero dividend or payout ratio
- empty string, null, or `-` means missing/undetermined according to the source and is
  never coerced to zero
- a non-finite or negative dividend amount is `invalid_data`
- a non-finite payout ratio is `invalid_data`; a finite source ratio is preserved
  without recalculation or capping, and negative/profit-distorted ratios must not be
  presented as a sustainability claim
- no eligible core row is `no_eligible_dividend_disclosure_data`; this includes a
  successful source response that omits recent rows under plan/history coverage and
  does not identify the cause as no issuer disclosure
- a selected row with no usable requested field is `missing_data`
- no eligible event row is `no_eligible_dividend_event_data`, distinct from a zero
  amount
- missing pre-2022 component detail is `component_breakdown_unavailable`, not ordinary
  dividend of zero

Do not convert the J-Quants ratio to percent in the source or Engine. Do not combine a
dividend amount and a yield under the same field or unit.

#### Adopted deterministic behavior

The core Engine deterministically filters/validates as-of rows, resolves the target
fiscal year, and selects the latest eligible actual and company forecast observations.
It preserves source-provided payout ratios rather than implementing a second payout
formula that could disagree with the issuer's disclosed basis.

The optional event Engine only replays source update identity and derives an ordinary
component when the source makes that derivation complete:

```text
CommSpecCode = 0:
  ordinaryDividendPerShare = DivRate

CommSpecCode = 1 and CommDivRate is available:
  ordinaryDividendPerShare = DivRate - CommDivRate

CommSpecCode = 2 and SpecDivRate is available:
  ordinaryDividendPerShare = DivRate - SpecDivRate

CommSpecCode = 3 and both component amounts are available:
  ordinaryDividendPerShare = DivRate - CommDivRate - SpecDivRate
```

Missing component amounts make the ordinary component unavailable; they are not
treated as zero. A negative derived value is `invalid_data`. The event result remains
event-level: do not aggregate interim and year-end events into a new annual amount or
merge them with the financial-summary annual amount.

The Engine does not calculate dividend yield, forecast revision rate, dividend-growth
rate/CAGR, increase/cut streak, DOE, total shareholder yield, or a capital-return
score in the initial tranche.

#### Candidate decisions

| Candidate | Decision | Reason |
| --- | --- | --- |
| Actual annual dividend per share | **IMPLEMENT** | Separates a disclosed cash amount from yield and supplies an as-of-safe actual history absent from the canonical result. |
| Company-forecast annual dividend per share | **IMPLEMENT** | Adds forward-looking issuer guidance with an explicit disclosure boundary; it is never back-applied. |
| Source-provided actual/forecast payout ratio | **IMPLEMENT** | Adds sustainability context without duplicating a potentially different formula; keep the J-Quants ratio unit. |
| Event-level commemorative/special classification | **IMPLEMENT** as optional Premium enrichment | Prevents one-off payments from being silently described as ordinary; keep report identity and do not aggregate events. |
| Dividend yield | **REJECT** as a new Phase 2E metric | The current deterministic Engine/Snapshot already calculates and stores it. Forecast yield is deferred rather than creating a second ambiguous yield. |
| Dividend growth rate/CAGR | **DEFER** | Annual totals are not safely comparable across splits and one-off distributions without a complete per-event/share-basis contract; special components begin only in 2022. |
| Consecutive increases/cuts | **DEFER** | It inherits the same split, special-dividend, missing-year, and zero-versus-no-data problems as CAGR. |
| DOE | **DEFER** | J-Quants has no direct DOE field; a future formula needs same-basis total dividend and average shareholders' equity/BPS across eligible periods. |
| Payout/dividend policy narrative | **DEFER** | EDINET/TDnet documents are authoritative but unstructured and time-varying; extraction, provenance, and evaluation need a separate contract. |
| Share repurchases and combined capital return | **DEFER** | A decision/authorization is not an executed buyback; a complete event-to-execution/cancellation lifecycle and cash basis are not in the current result. |
| Total-return score, threshold, or Buy/Sell signal | **REJECT** | It adds unsupported judgment and violates the product boundary. |

Deferred growth work must not apply the current J-Quants cumulative price adjustment
factor blindly to annual DPS. That factor includes splits, consolidations, and rights
issues and is defined for price bars; an annual dividend can span multiple record
dates/share bases. A later proposal must establish event-level adjustment dates and
complete special-component coverage before calculating a comparable series.

#### Minimum result contract

Exact file/type placement follows the merged conventions, but the structured boundary
must preserve at least:

```ts
type AdvancedDividendUnavailableReason =
  | 'no_eligible_dividend_disclosure_data'
  | 'no_eligible_dividend_event_data'
  | 'event_source_plan_unavailable'
  | 'availability_calendar_unavailable'
  | 'component_breakdown_unavailable'
  | 'missing_data'
  | 'invalid_data';

interface DividendFiscalObservation {
  kind: 'actual' | 'company_forecast';
  fiscalYearEndDate: string;
  disclosedDate: string;
  disclosedTime: string | null;
  sourceEligibleDate: string;
  disclosureNumber: string;
  sourceField: 'DivAnn' | 'FDivAnn' | 'NxFDivAnn';
  payoutRatioSourceField:
    | 'PayoutRatioAnn'
    | 'FPayoutRatioAnn'
    | 'NxFPayoutRatioAnn';
  annualDividendPerShare: number | null;
  payoutRatio: number | null;
}

interface DividendEvent {
  notifiedDate: string;
  notifiedTime: string | null;
  sourceEligibleDate: string;
  referenceNumber: string;
  corporateActionReferenceNumber: string;
  kind: 'interim' | 'fiscal_year_end';
  decision: 'decided' | 'forecast';
  recordDateYearMonth: string;
  dividendPerShare: number | null;
  ordinaryDividendPerShare: number | null;
  commemorativeDividendPerShare: number | null;
  specialDividendPerShare: number | null;
  recordDate: string | null;
  rightsRecordDate: string | null;
  exDate: string | null;
  paymentDate: string | null;
}

interface AdvancedDividendResult {
  analysisAsOfDate: string;
  collectedAt: string;
  issuerCode: string;
  dataDate: string | null;
  observations: readonly DividendFiscalObservation[];
  events: readonly DividendEvent[] | null;
  unavailable: readonly {
    scope: 'core' | 'event' | 'component';
    reason: AdvancedDividendUnavailableReason;
  }[];
  provenance: {
    financialSummary: { source: 'jquants'; endpoint: '/v2/fins/summary' };
    dividendEvents: { source: 'jquants'; endpoint: '/v2/fins/dividend' } | null;
    availabilityCalendar: { source: 'jquants'; endpoint: '/v2/markets/calendar' };
    calculation: { source: 'advanced_dividend_engine' };
  };
  units: {
    dividendPerShare: 'JPY_per_share';
    payoutRatio: 'ratio';
  };
}
```

Observations are chronological by target fiscal-year end and then disclosure order.
Actual and forecast observations stay distinct. `events = null` plus a typed event
reason means unavailable/not collected; it never means no special dividend or zero
dividend. The result must retain only source/report identity required for analysis and
must not copy issuer addresses or unrelated disclosure metadata.
`issuerCode` is the normalized five-digit JPX code. `recordDateYearMonth`,
`recordDate`, and `rightsRecordDate` map `IFTerm`, `RecDate`, and `ActRecDate`
respectively and must not be conflated. `dataDate` is the greatest eligible source
publication/notification date consumed by fiscal selection or event replay. It
includes an applied correction or deletion notification even when replay removes the
affected event from the final `events` array. It is never a source-eligibility,
fiscal, record, ex, or payment date. Keep `sourceEligibleDate` explicit so publication
and J-Quants eligibility cannot be conflated downstream.

No Snapshot schema is changed in P2-E0.

#### Phase 2E sequence

```text
P2-E0 Source / Contract Design
  → P2-E1 J-Quants financial-summary dividend source
  → P2-E2 deterministic fiscal observation Engine
  → P2-E3 optional dividend-event source and event replay
  → P2-E4 Tool exposure + Snapshot V8
  → P2-E5 Dashboard + comprehensive-analysis
```

P2-E1 adds only `/v2/fins/summary` mapping, pagination, ticker normalization, raw
source validation, and the narrow pure official-calendar eligibility resolver reused
by P2-E2/P2-E3. It reuses the merged J-Quants calendar row convention without changing
the Phase 2C Engine. Tests fix endpoint/parameters, field and ratio-unit mapping,
pagination, plan/history/calendar boundaries, zero-versus-empty, invalid values,
ordering, input non-mutation, and a disclosure on date D being ineligible on D but
eligible on the following official business day. For that same row and D+1 boundary,
tests also fix Premium returned-row eligibility versus Free latest-twelve-weeks
runtime omission, while proving that the canonical `sourceEligibleDate` itself does
not become plan-aware.

P2-E2 adds the pure as-of selector and result core. Tests fix current/next fiscal-year
mapping, actual/forecast separation, latest eligible disclosure, same-day ordering,
source-date versus source-eligibility preservation, future exclusion, blank latest
field without forward fill, insufficient official-calendar coverage, valid zero,
missing/invalid reasons, issuer identity/data-date provenance, stable historical
results when future rows are appended, and non-mutation.

P2-E3 adds the independently optional Premium `/v2/fins/dividend` source and pure
event replay. Tests fix mapping, pagination, TSE/plan limitations, new/correction/
deletion replay, future-event exclusion, special/commemorative component availability,
ordinary-component formula, pre-2022 unavailable semantics, empty versus zero, no
annual aggregation, input non-mutation, and a notification on date D remaining
ineligible on D before becoming eligible on the following official business day. It
also fixes distinct `IFTerm`/`RecDate`/`ActRecDate` mapping and a new-then-deletion
case whose final event array is empty while `dataDate` remains the deletion
notification date.

P2-E4 exposes one structured result and adds the minimum Snapshot V8. V1-V7 schemas
remain immutable/readable, new saves become V8, existing files are not rewritten,
unknown versions remain rejected, and optional dividend/event unavailability does not
change existing complete/partial semantics. The collector uses only the structured
result and verifies the locked issuer identity; no Markdown recovery is added.

P2-E5 presents Snapshot values and updates comprehensive analysis. Dashboard and LLM
must distinguish amount, ratio, and existing yield; actual and forecast; and ordinary,
special, and commemorative components. They do not recalculate values, aggregate
events, infer missing policy, claim that unavailable event detail means ordinary-only,
or create a threshold, score, Entry/Stop/Target, or Buy/Sell signal.

#### Deferred/rejected from initial Phase 2E

- split/special-aware dividend CAGR and increase/cut streak — deferred
- forecast yield and forecast-revision percentages — deferred
- DOE and total-payout/total-shareholder-yield formulas — deferred
- payout-policy narrative extraction and classification — deferred
- buyback authorization/execution/cancellation lifecycle — deferred
- using current forecasts in historical analysis or source period dates as availability — rejected
- treating blank, `-`, empty responses, or unavailable Premium data as zero — rejected
- LLM/Browser financial calculation, composite scores, thresholds, and signals — rejected

## 25. Phase 2F — Daily OHLCV Volume Profile Proxy

### P2-F0 — Source / Contract Design

P2-F0 is documentation only. It fixes the source, approximation, calculation,
availability, result, and implementation-step contracts before any runtime, Tool,
Snapshot V9, collector, Dashboard, or comprehensive-analysis change.

The initial feature is a **daily-OHLCV estimated volume-at-price distribution proxy**.
Daily bars do not expose executed volume at each price, current holder quantities,
investor cost bases, or whether a position remains open. Therefore this result is not
actual holder cost basis, true `shikori`, or measured overhead supply. POC, VAH, and
VAL are descriptive outputs of the fixed proxy methodology only. They must not be
converted automatically into support, resistance, Entry, Stop, Target, a score,
threshold, or Buy/Sell signal.

#### Official source and source limitations

Reuse the existing J-Quants V2 client and ticker normalization with:

```text
GET /v2/equities/bars/daily
parameters: code, from, to, pagination_key

GET /v2/markets/calendar
parameters: from, to
```

The official J-Quants schema provides `Date`, `Code`, raw `O/H/L/C/Vo`,
`AdjFactor`, adjusted `AdjO/AdjH/AdjL/AdjC/AdjVo`, and `ExRT`. `ExRT = 3` identifies
a rights issue. The initial profile uses adjusted OHLC and adjusted volume together
only when the source envelope establishes a common basis. It never combines raw
prices with adjusted volume, adjusted prices with raw volume, or independently
reconstructs the adjustment. `AdjFactor` and `ExRT` remain source metadata used to
establish methodology and provenance; neither is a new calculation input.

Primary references checked for P2-F0:

- [J-Quants API data specification](https://jpx-jquants.com/spec/data-spec)
- [J-Quants adjusted-price calculation](https://jpx-jquants.com/ja/spec/eq-bars-daily/adj)
- [J-Quants daily-bar specification](https://jpx-jquants.com/ja/spec/eq-bars-daily)
- [official J-Quants CLI daily-bar schema](https://github.com/J-Quants/jquants-cli/blob/main/src/schema.rs)
- [official J-Quants API client](https://github.com/J-Quants/jquants-api-client-python)
- [JPXI Stock Prices dataset description](https://pro.jpx-jquants.com/datasets/9)
- [J-Quants plan and history table](https://jpx-jquants.com/)

The source is daily. Treat only `null`, `'1'`, `'2'`, and `'3'` as known `ExRT`
metadata. Any other value, including numeric `3` or an arbitrary string, is unknown
metadata and cannot be interpreted as the absence of an ex-rights event. A null
`AdjFactor` is known only for a source-returned no-sale row whose complete adjusted
OHLCV payload is null; malformed, non-finite, non-positive, or wrong-typed values do
not become a valid no-sale null. Unknown or malformed corporate-action metadata makes
the affected audit basis unavailable rather than being repaired or coerced.

Official dataset material describes stock prices before and
after corporate-action adjustment and states that adjusted prices are retroactively
adjusted. The daily-bar specification also states that rights-issue price adjustment
does not adjust `Vo` or `AdjVo`. Its rights-issue price-adjustment coverage excludes
foreign stocks and TOKYO PRO Market issues, and the source does not support every
possible corporate action. Therefore the `Adj*` prefix alone does not prove a common
adjusted price/volume basis.

J-Quants calculates an older adjusted price by accumulating `AdjFactor` values from
newer dates. A rights issue after `analysisAsOfDate` can therefore be reflected
retroactively in the selected adjusted prices even though its row is excluded from
the calculation window, while `AdjVo` remains unadjusted for that event. Inspecting
only canonical `ExRT` values cannot establish a common basis.

Adopt `collection_horizon_rights_audit_v1`. For a direct source call, retrieve the
complete paginated issuer series needed for the calculation **and** corporate-action
basis audit through the latest daily-bar horizon available to that call at
`collectedAt`; do not cap source retrieval at `analysisAsOfDate`. After selecting the
canonical window, audit `AdjFactor` and `ExRT` from `windowStartDate` through
`basisAuditThroughDate`, inclusive. `basisAuditThroughDate` is the latest row date in
the complete source envelope and can be later than `analysisAsOfDate`.

Make audit completeness mechanical with the existing official J-Quants calendar.
`basisAuditRequiredThroughDate` is the latest full or half trading date strictly before
the Asia/Tokyo calendar date of `collectedAt`; if a same-date issuer row is actually
returned, use that later date instead. A listed issuer's daily endpoint returns a row
with null OHLCV on an issue-specific no-sale date, so absence of the required row is
not silently treated as no event. The audit is complete only when the fully paginated
issuer response covers `basisAuditRequiredThroughDate`, every row retains `AdjFactor`
and `ExRT`, and there is no unexplained gap in the official full/half trading dates.
Do not infer weekdays or forward-fill calendar or issuer rows.

If any audited row has `ExRT = 3`, including a row after `analysisAsOfDate`, return
`corporate_action_basis_unavailable` with no bins, POC, or Value Area. Apply the same
reason when the audit horizon is truncated or delayed in a way that cannot establish
which adjustments the returned `Adj*` values incorporate, or when an unsupported
corporate action, mixed basis, missing metadata, or another source condition prevents
the common price/volume basis from being established. This means endpoint access on
Free or another delayed plan does not by itself make the profile available; inability
to prove a complete adjustment horizon is typed basis unavailability. Do not derive a
volume conversion or fall back to raw or apparently adjusted fields.

Rows after `analysisAsOfDate` are source-integrity metadata only. Their OHLCV values
must never enter canonical selection, validation, bins, POC, Value Area, `dataDate`,
or any investment interpretation. Do not expose their event dates or values as an
analysis claim. A pre-canonical rights-issue row is irrelevant only when the complete
audit proves that it predates `windowStartDate`; a post-as-of rights issue is never
ignored merely because it lies outside the latest-120 calculation window.

P2-F2 must define one typed source envelope that retains `AdjFactor` and `ExRT` for
every supplied row and records the exact J-Quants field mapping in provenance. P2-F3
must make its direct source mapper produce that envelope. The existing range-mode
`get_stock_price` result maps adjusted OHLCV to generic fields and omits both metadata
fields; generic supplied OHLCV rows therefore cannot prove the basis and must not be
accepted as reusable volume-profile source input. Supplied-row mode may avoid a
duplicate fetch only when it receives and validates the complete typed envelope from
that mapping path; a bare generic row array or `priceBasis` literal is insufficient.

The minimum reusable source boundary is:

```ts
declare const verifiedVolumeProfileSource: unique symbol;

type VolumeProfileSource = Readonly<{
  readonly [verifiedVolumeProfileSource]: true;
  issuerCode: string;
  collectedAt: string;
  basisAuditRequiredThroughDate: string | null;
  basisAuditThroughDate: string | null;
  rows: readonly Readonly<{
    Date: string;
    Code: string;
    AdjO: number | null;
    AdjH: number | null;
    AdjL: number | null;
    AdjC: number | null;
    AdjVo: number | null;
    AdjFactor: number | null;
    ExRT: '1' | '2' | '3' | null;
  }>[];
  provenance: Readonly<{
    source: 'jquants';
    endpoint: '/v2/equities/bars/daily';
    availabilityCalendarEndpoint: '/v2/markets/calendar';
    mapping: 'jquants_adjusted_ohlcv_with_corporate_actions_v1';
    basisAudit: 'collection_horizon_rights_audit_v1';
  }>;
}>;
```

This envelope is evidence of source identity and retained metadata, not proof that a
rights-issue window is usable; the Engine still applies the canonical-window basis
audit above. The brand is internal and non-serializable. A pure source validator adds
it only after checking issuer identity, official calendar coverage, row chronology,
retained fields, pagination completeness, and both audit dates; Tool JSON cannot
self-attest a boolean or construct the verified type. P2-F3 direct mode maps fetched
rows through this validator. Any supplied raw mode must pass the same validator with
the complete official calendar and source provenance before the Engine receives it;
generic OHLCV remains insufficient. Source metadata still cannot prove
the absence of a corporate action that J-Quants does not support or identify. A valid
profile therefore establishes the common basis only for the source-supported and
identified adjustment scope; it is not a claim that every possible historical event
was observable. If an unsupported event is otherwise known or the mapping cannot
establish its scope, return `corporate_action_basis_unavailable`.

The current personal plans expose daily OHLC on Free or higher: Free has two years
with a latest-twelve-weeks delay, Light five years, Standard ten years, and Premium
the offered history up to twenty years. Runtime uses only rows actually returned for
the configured plan and follows every `pagination_key`. An empty successful response
is `no_price_data`; it is not zero volume.

Published update times are operational schedules, not historical-vintage evidence or
a guarantee that a row was available at a particular instant. `analysisAsOfDate` is
an inclusive date-only end-of-day boundary. A same-day daily bar is usable only when
J-Quants actually returned it. Intraday analysis must not fabricate the current daily
bar or treat an incomplete session as a completed bar.

Because adjusted historical rows can be retroactively changed by later corporate
actions, a fresh current API response cannot reproduce every earlier source vintage.
The Engine guarantees row-date no-look-ahead for numerical inputs and separately
audits later metadata only to reject a basis that the current response cannot support.
`collectedAt`, `basisAuditThroughDate`, the exact source/method identity, and an
immutable persisted Snapshot are evidence of what a run observed. A later source
adjustment must not rewrite an existing Snapshot. When supplied input cannot establish
the same complete audit and common J-Quants adjusted basis, return
`corporate_action_basis_unavailable`; do not fall back to raw or mixed values.

Minute OHLC and tick data are deferred. The official client identifies minute bars as
a separate Minute Bar add-on path, with different access/history and adjustment
questions. Adding it would introduce a second source contract and still would not
prove current holdings or investor cost basis. Phase 2F v1 remains a daily proxy.

#### Canonical window and validation order

Use at most the latest 120 eligible trading bars and require at least 60 bars:

```text
calculationEligible = source rows where Date <= analysisAsOfDate
require calculationEligible dates to be unique and strictly chronological
canonical = latest min(calculationEligible.length, 120) rows
require canonical.length >= 60
require a complete basis audit from canonical[0].Date through basisAuditThroughDate
reject any ExRT = 3 in that audit range, including Date > analysisAsOfDate
validate prices, volume, and bar geometry only inside canonical
```

The latest 120 trading bars provide an approximately six-month medium-term profile
while bounding output size and avoiding an automatic one-year carryover from the
Technical 251-bar contract. The existing generic comprehensive-analysis price result
does not satisfy the source-envelope requirement and does not make 251 bars part of
this metric's meaning. With 60-119 eligible bars, use every available bar. With 120 or
more, use exactly the latest 120.

Exclude future rows from every numerical calculation before validation. Appending
future OHLCV cannot change a previously valid numeric profile; the only permitted
historical effect is changing the result to basis-unavailable when audit-only metadata
reveals a rights issue or incomplete basis. Do not sort, deduplicate, skip, forward-
fill, interpolate, or restart a sequence. Duplicate, malformed, or non-ascending dates
in the calculation or audit range are `invalid_chronology`. Value validation occurs
after canonical selection, so missing or invalid observations before the latest 120
do not affect the result. Exchange-closed dates are absent and do not count toward the
60/120 bars. By contrast, an issue-specific no-sale day returned by J-Quants is an
observation and does count when it is calculation-eligible; it must not be dropped.
Its null OHLC and volume produce `missing_price_data` and `missing_volume_data` when
the row is inside the canonical window, rather than zero volume or a shorter sequence.
Future audit-only rows are not subject to OHLCV value validation.

For every canonical bar:

- adjusted open/high/low/close must be present, finite, and greater than zero
- adjusted volume must be present, finite, and non-negative
- high must be greater than or equal to low
- open and close must be within the inclusive low-high range
- a zero-volume bar is a valid observation and contributes zero
- missing or invalid observations invalidate the profile; none are skipped

If every canonical bar has zero adjusted volume, return `zero_total_volume` and do
not create POC, VAH, or VAL.

#### Adopted volume-allocation method

Adopt `uniform_range_overlap_v1`. For a non-flat bar, model volume density as uniform
over its observed adjusted low-high interval and allocate to each intersected bin by
price overlap:

```text
overlap(bar, bin) = max(0, min(bar.high, bin.upper) - max(bar.low, bin.lower))

allocatedVolume(bar, bin)
  = bar.adjustedVolume * overlap(bar, bin) / (bar.high - bar.low)
```

For each non-flat bar, compute intersected bins in ascending order. Allocate the
formula amount to every intersected bin except the final one, then assign the final
bin the remaining `bar.adjustedVolume - alreadyAllocated` amount. This fixes binary
floating-point residuals while conserving the source bar's full adjusted volume.

For a flat bar (`high === low`), allocate all adjusted volume to the one bin whose
already-constructed edges contain that price under the lower-inclusive / upper-
exclusive rule, with the final upper edge inclusive. Do not derive a separate
arithmetic bin index, because its floating-point boundary can disagree with the
constructed bin edges. A flat limit-move bar uses the same rule. Gaps between bars
receive no inferred volume: volume is allocated only within each bar's own low-high
interval. Open and close validate bar integrity but do not alter the uniform density;
the daily source does not reveal an intraday path that would justify such weighting.

Rejected initial alternatives:

- all volume at close — rejects the observed daily range and creates a point mass at
  one non-price-level-volume observation
- all volume at typical price — introduces a derived point estimate while still
  discarding the range
- equal volume per touched bin — overweights bins touched by an arbitrarily small
  boundary overlap
- intraday-path or holder-cost reconstruction — not observable from daily OHLCV

#### Fixed price bins and numerical rules

Adopt `fixed_count_linear_v1` with 50 equal-width bins over the canonical adjusted
range:

```text
minPrice = min(canonical adjusted lows)
maxPrice = max(canonical adjusted highs)
binWidth = (maxPrice - minPrice) / 50
```

- bins 0-48 are `[lowerPrice, upperPrice)`
- bin 49 is `[lowerPrice, upperPrice]`, so `maxPrice` always belongs to the last bin
- `representativePrice = (lowerPrice + upperPrice) / 2`
- use JavaScript `number` calculations without exchange-tick or presentation rounding
- derive boundaries as `minPrice + index * binWidth`; set the final upper edge exactly
  to source `maxPrice`
- clamp a calculated bin index to `[0, 49]` to contain binary boundary drift
- normalize negative zero on public numeric output; otherwise preserve calculation
  values rather than applying financial rounding

If `minPrice === maxPrice`, create one effective degenerate bin rather than fifty
zero-width bins. Its lower, upper, and representative prices all equal the source
price, and every positive volume observation is allocated to it.

The profile conserves adjusted volume when:

```text
abs(sum(bin.allocatedVolume) - sum(bar.adjustedVolume))
  <= max(1e-8, sum(bar.adjustedVolume) * 1e-12)
```

Use the same tolerance when deciding whether two allocated volumes are tied. Bin
volume is stored as `adjusted_shares`; it may be fractional after source adjustment
or proxy allocation. Bin `volumeShare` is a ratio from 0 to 1.

#### POC, VAH, and VAL

POC is the bin with maximum allocated volume. First determine the global maximum over
all bins. Then select the lowest-priced bin whose allocated volume is within the fixed
volume tolerance of that global maximum. Do not carry a tolerance-based winner through
sequential pairwise comparisons. This tie-break is only deterministic ordering and
carries no support/resistance interpretation.

The Value Area target share is 0.70. Calculate one contiguous region as follows:

```text
included = { POC bin }
accumulated = POC allocated volume

while accumulated / totalVolume < 0.70:
  lower = unused bin immediately below included range, if any
  upper = unused bin immediately above included range, if any
  add the neighbor with greater allocated volume
  if tied within tolerance, add lower first
  if only one neighbor exists, add it
  add the selected bin's full volume
```

Stop immediately at an exact target. Never split the final bin; include it in full
and allow target overshoot. Return:

- POC price as the POC bin representative price
- `VAL` as the lower edge of the lowest included bin
- `VAH` as the upper edge of the highest included bin
- `achievedVolumeShare = includedVolume / totalVolume`

If the POC bin alone reaches the target, it is the complete Value Area. A positive-
volume one-bin or all-same-price profile is valid: POC, VAL, and VAH equal the one
source price and achieved share is 1. Zero total volume is unavailable rather than a
50-way POC tie.

#### Minimum result and unavailable contract

Exact module placement follows merged conventions. The structured boundary must
preserve at least:

```ts
type VolumeProfileUnavailableReason =
  | 'insufficient_history'
  | 'missing_price_data'
  | 'missing_volume_data'
  | 'invalid_price_data'
  | 'invalid_volume_data'
  | 'invalid_bar_geometry'
  | 'invalid_chronology'
  | 'zero_total_volume'
  | 'no_price_data'
  | 'corporate_action_basis_unavailable'
  | 'invalid_input';

interface VolumeProfileBin {
  index: number;
  lowerPrice: number;
  upperPrice: number;
  representativePrice: number;
  allocatedVolume: number;
  volumeShare: number;
}

interface VolumeProfileResult {
  analysisAsOfDate: string;
  collectedAt: string;
  issuerCode: string;
  dataDate: string | null;
  windowStartDate: string | null;
  windowEndDate: string | null;
  inputBarCount: number;
  priceBasis: 'jquants_corporate_action_adjusted' | null;
  volumeBasis: 'jquants_corporate_action_adjusted' | null;
  allocationMethod: 'uniform_range_overlap_v1';
  binningMethod: {
    id: 'fixed_count_linear_v1';
    requestedBinCount: 50;
    effectiveBinCount: number;
    minPrice: number | null;
    maxPrice: number | null;
  };
  bins: readonly VolumeProfileBin[] | null;
  poc: {
    binIndex: number;
    price: number;
    allocatedVolume: number;
    volumeShare: number;
  } | null;
  valueArea: {
    targetVolumeShare: 0.7;
    achievedVolumeShare: number;
    val: number;
    vah: number;
    firstBinIndex: number;
    lastBinIndex: number;
  } | null;
  unavailable: readonly {
    scope: 'profile';
    reason: VolumeProfileUnavailableReason;
  }[];
  methodology: {
    id: 'daily_ohlcv_volume_profile_proxy_v1';
    approximation: 'uniform_daily_range';
    actualHolderCostBasis: false;
  };
  provenance: {
    source: 'jquants';
    endpoint: '/v2/equities/bars/daily';
    availabilityCalendarEndpoint: '/v2/markets/calendar';
    sourceMapping: 'jquants_adjusted_ohlcv_with_corporate_actions_v1';
    adjustmentFactorField: 'AdjFactor';
    exRightsField: 'ExRT';
    basisAudit: 'collection_horizon_rights_audit_v1';
    basisAuditRequiredThroughDate: string | null;
    basisAuditThroughDate: string | null;
    corporateActionBasisStatus:
      | 'not_evaluated'
      | 'supported_common_basis_established'
      | 'rights_issue_unavailable'
      | 'unknown_basis_unavailable';
    calculation: 'volume_profile_engine';
  };
  units: {
    price: 'JPY';
    allocatedVolume: 'adjusted_shares';
    volumeShare: 'ratio';
  };
}
```

`dataDate`, `windowStartDate`, and `windowEndDate` are dates from the canonical rows
actually used, never the request date or a plan-implied date. `inputBarCount` is the
canonical bar count, at most 120. `collectedAt` is the UTC collection timestamp.
`priceBasis` and `volumeBasis` use the adjusted literal only when the common source
basis was established; they are null for source/basis unavailability. Missing price
and missing volume remain separate. `corporateActionBasisStatus = 'not_evaluated'`
applies when no canonical basis check occurred, such as successful empty data or
insufficient history. `basisAuditRequiredThroughDate` and `basisAuditThroughDate` are
provenance for audit completeness and source reproducibility, not calculation data
dates or investment facts, and Dashboard/LLM must not interpret audit-only future
metadata.
Non-finite or non-positive prices, non-finite or negative volume, and invalid bar
geometry remain distinct invalid reasons. Zero volume is not missing.

Every validated positive-volume profile must produce bins, POC, and Value Area
together. Failure after those preconditions is an implementation invariant violation,
not data unavailability; throw an explicit internal error and do not emit or persist a
partial successful result. Source/auth/plan/network/HTTP/response failures remain the
existing typed `JQuantsApiError` and propagate unchanged. They are not members of
`VolumeProfileUnavailableReason`, are not serialized as deterministic result
unavailability, and are never relabelled as an empty or zero profile.

Before a valid profile exists, return `bins = null`, `poc = null`,
`valueArea = null`, `effectiveBinCount = 0`, and null min/max prices. Preserve known
request identity, retained corporate-action provenance, and any canonical dates/count
already established. Never choose a substitute POC or preserve partial core metrics.

P2-F0 did not change Snapshot schema. P2-F4 added Snapshot V9 and persists the bounded
full bin distribution as well as POC and Value Area. Saving only aggregates is
rejected because the Dashboard could not display the distribution without Browser recalculation. Do
not duplicate the raw OHLCV payload solely for this metric; retain method identity,
dates, units, and source/calculation provenance.

#### Adopted, deferred, and rejected

| Candidate | Decision | Reason |
| --- | --- | --- |
| Daily adjusted-OHLCV price-distribution proxy | **IMPLEMENT** | Reuses the authoritative source and makes the approximation explicit. |
| Uniform low-high overlap allocation | **IMPLEMENT** | Uses the observed daily range, preserves volume, and makes the one unobservable density assumption explicit. |
| Fixed 50-bin linear range | **IMPLEMENT** | Bounds Snapshot/UI size and avoids issuer-price- and historical-tick-specific widths. |
| 120-bar maximum / 60-bar minimum | **IMPLEMENT** | Gives medium-term context without inheriting the unrelated 251-bar Technical contract. |
| Collection-horizon rights-issue basis audit | **IMPLEMENT** | Detects later rights issues that can be retroactively reflected in pre-as-of adjusted prices without using future OHLCV numerically. |
| POC and contiguous 70% Value Area | **IMPLEMENT** | Deterministic descriptive summary with fixed tie and overshoot behavior. |
| Full 50-bin distribution in Snapshot V9 | **IMPLEMENTED** in P2-F4 | Required for pass-through visualization without Browser calculation. |
| Rights-issue-window common-basis conversion | **DEFER** | J-Quants adjusts rights-issue prices but not volume; v1 returns typed unavailability instead of inventing a conversion. |
| Minute/tick profile | **DEFER** | Separate add-on, coverage, adjustment, and as-of contract; not needed for the initial daily proxy. |
| Close/typical-price point allocation or equal touched-bin allocation | **REJECT** | Discards range information or introduces boundary distortion. |
| Actual holder cost basis, retained-position amount, or true shikori | **REJECT** | Not observable from daily OHLCV. |
| Support/resistance, Entry/Stop/Target, score, threshold, or Buy/Sell derivation | **REJECT** | Adds unsupported interpretation to an approximate descriptive distribution. |
| LLM or Browser calculation | **REJECT** | Violates the canonical deterministic-result boundary. |

#### Phase 2F implementation sequence and tests

P2-F0 through P2-F5 are complete.

```text
P2-F0 docs-only contract
  → P2-F1 pure fixed-bin / uniform-range allocation helper
  → P2-F2 deterministic canonical-window / POC / Value Area Engine
  → P2-F3 structured analyze_volume_profile Tool
  → P2-F4 Snapshot V9 + Standard Agent collector
  → P2-F5 Dashboard + comprehensive-analysis
```

P2-F1 adds only the narrow pure binning and per-bar allocation helper. It does not add
the aggregate Engine, Tool, Snapshot, collector, Dashboard, or skill. Tests fix a
hand-verifiable normal profile, per-bar and total volume conservation, exact bin
edges, the maximum-price bin, prices on boundaries, flat/limit bars, all-same-price
input, gaps, zero volume, missing/invalid prices and volume, invalid high-low/open/
close geometry, non-mutation, and the floating-point tolerance/residual rule.

P2-F2 adds canonical selection, validation, POC, Value Area, result metadata, units,
and typed unavailable semantics. Tests fix 59 unavailable / 60 available bars,
60-119 all-history behavior, exactly latest 120 bars, canonical-window-old-row
invariance, future OHLCV exclusion, duplicate/non-chronological calculation or audit
dates, POC ties, Value Area lower tie, exact target, whole-bin overshoot, one-bin
behavior, zero total volume, and returned no-sale rows as counted missing observations.
Corporate-action cases fix a rights issue inside the canonical window, the documented
foreign-stock/TOKYO PRO Market exceptions, a pre-canonical rights issue as irrelevant,
mixed/unknown or incomplete adjustment basis, pure source-validator branding, rejection
of a caller-asserted completeness flag, and the required regression:

```text
canonical window end = analysisAsOfDate D
later audit row D+n has ExRT = 3
current source has retroactively adjusted pre-D prices
→ corporate_action_basis_unavailable
```

A future non-rights row or future invalid OHLCV must not change the valid historical
numbers. Tests also fix all-or-nothing bins/POC/Value Area invariants, basis-audit
provenance, and non-mutation.

P2-F3 exposes a separate `analyze_volume_profile` structured tool so the existing
Phase 1 `TechnicalResult` and `analyze_technical` semantics remain unchanged. It
reuses already-fetched data only through the typed `VolumeProfileSource` envelope and
uses the existing J-Quants client for direct ticker mode. Generic `get_stock_price`
OHLCV is not reusable basis proof. It must not fetch the same price history twice in
one path. Tests fix pagination, numeric and alphanumeric JPX codes, retention of
`AdjFactor`/`ExRT`, exact source field/basis mapping, rejection of bare generic OHLCV,
unchanged typed `JQuantsApiError` propagation for plan/auth/network/HTTP/invalid-
response failures, successful empty data, and corporate-action-basis unavailability.
Direct-mode tests also fix retrieval through the collection-time source horizon rather
than `analysisAsOfDate`, pagination of post-as-of audit metadata, incomplete/delayed
audit-horizon rejection, official full/half trading-day coverage without weekday
inference or forward fill, a returned null no-sale row versus a missing required row,
later `ExRT = 3` detection, no numerical use or exposure of future OHLCV, no duplicate
fetch when the complete typed envelope is supplied, and structured-only output.

P2-F4 adds the minimum Snapshot V9 and collector integration. V1-V8 remain immutable
and readable, new saves become V9, existing files are not migrated or rewritten, and
unknown versions remain rejected. Full bins, aggregate metrics, method identity,
units, calculation dates, basis-audit method/horizon, corporate-action basis status,
and provenance pass through from the structured result. Volume-profile
unavailability alone does not change existing complete/partial semantics. The
collector locks issuer identity and never reconstructs values from Markdown.

P2-F5 presents only Snapshot V9 values and updates comprehensive-analysis to interpret
only the structured result. Tests fix full-bin/POC/VA pass-through, unavailable and
valid-zero distinction, V1-V8 `not_collected`, no Browser or LLM recalculation, the
daily-proxy limitation, audit-only future metadata never being presented or interpreted
as an issuer event, and absence of support/resistance, Entry/Stop/Target, score,
threshold, or Buy/Sell instructions.

## 26. Recommended Next Codex Task

Phase 2A through Phase 2F are complete, and Snapshot V9 is the current writer. After
the Phase 2 closeout and public overview documentation PRs are reviewed and merged,
start a new Codex thread with **P3-0 — Source / Formula / Architecture Design** as a
docs-only task. Re-read current `main`, the repository Source of Truth, merged code,
and tests rather than relying on prior conversation.

P3-0 must not implement runtime code, an Independent Evaluator, composite scores or
weights, Snapshot V10, PDF generation, Radar charts, or past-analysis diff. This
Phase 2 closeout does not decide Phase 3 formulas, score architecture, Radar axes, PDF
structure, or diff semantics.
