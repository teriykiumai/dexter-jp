# Phase 2A — Technical Expansion Plan

**Version:** 0.1
**Status:** Design / Pre-implementation
**Target:** Personal / Local only
**Base:** Phase 1 + Phase 1.5 completed
**Date:** 2026-08-23

## 1. Purpose

Phase 2 is an umbrella for the post-MVP capabilities already defined in `docs/SPEC.md`.
This document is the implementation plan for its first tranche, **Phase 2A — Technical
Expansion**, and does not remove or replace the remaining Phase 2 scope.

The primary goal is to deepen technical and market-context analysis while preserving the project principle:

> **Code calculates, AI interprets.**

Phase 2A must not turn the Browser Dashboard or LLM into a calculation layer. New
indicators and statistics must be produced by deterministic TypeScript code,
represented by typed results, captured in the canonical `AnalysisSnapshot`, and only
then interpreted or displayed.

Phase 2A begins only after the Phase 1.5 V1–V5 implementation and the Phase 2 design
documents are merged to `main`, and baseline validation is green.

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

Phase 2B–2F require their own source, formula, availability, provenance, and test
contracts before implementation. They are not part of the first Technical tranche,
but they are not removed from Phase 2.

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
`ShrtWithResVa`, and `ShrtNoResVa` as nullable JPY values. It reuses a previously
resolved sector classification when supplied; otherwise it uses the same as-of-safe
P2-D1 resolver. It excludes future rows, never forward-fills a missing/non-trading
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
`shortSellingRatio`. The result preserves `analysisAsOfDate`, the as-of sector code,
name and `classificationDate`, `dataDate`, daily observations, typed unavailable
reasons, and source/calculation provenance.

P2-D5 exposes this structured result and adds the minimum Snapshot V7. V1-V6 schemas
remain immutable/readable, new saves become V7, old files are not rewritten, and
unknown versions are rejected. The optional section does not change existing
complete/partial semantics. Dashboard and comprehensive analysis use Snapshot/Engine
values only and identify them as sector-wide daily selling turnover, not an issuer
position, outstanding short-interest balance, or margin-interest balance. They do
not aggregate dates/sectors, calculate a historical mean or trend, combine the result
with the sector benchmark or another flow source, or create a rank, threshold,
squeeze/crowding label, score, Entry/Stop/Target, or Buy/Sell signal.

Tests fix endpoint/field/parameter mapping, pagination, shared classification reuse,
as-of/future exclusion, missing and empty semantics, deterministic formulas, zero
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

## 24. Recommended Next Codex Task

Phase 2D P2-D0 through P2-D5 are implemented as separate reviewable steps. Preserve
their merged source, deterministic Engine, Snapshot V6/V7, presentation, and
comprehensive-analysis contracts in later work.
