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

After Technical and Supply/Demand changes are stable, consider adding:

- 20 trading days
- 120 trading days

Existing 60-day and 250-day windows remain canonical and must not change semantics.

Future benchmark expansion within Phase 2A is not required. Sector indices remain
planned Phase 2D work and require a separately approved contract.

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

Only after higher-priority work.

Add:

```text
20
120
```

to the existing window set only if needed.

Keep:

```text
60
250
```

unchanged.

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

## 19. Recommended Next Codex Task

Start a new Codex thread and use:

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
