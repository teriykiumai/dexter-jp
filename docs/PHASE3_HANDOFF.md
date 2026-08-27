# Phase 3 Handoff

**Purpose:** Non-normative context recovery for the Phase 3 design thread

**Repository:** `teriykiumai/dexter-jp`

**Phase 2 implementation baseline:** `5639b9cd940a14ae19f101c3cb4571c3c3415d9a`

**Baseline identity:** PR #58 merge, before the Phase 2 closeout documentation commits

**Date:** 2026-08-27

## 1. How to use this handoff

This file is a compact starting point, not a Source of Truth and not a Phase 3 design.
The Phase 3 thread must start from the current GitHub `main` branch and verify merged
code and tests. The baseline SHA above identifies the audited Phase 2 implementation
tree; it is not a promise that `main` will still point to that commit after the
closeout PRs merge.

Use repository documents by their authority and subject:

1. `AGENTS.md` — repository operations, safety, validation, and Git/PR rules
2. `docs/SPEC.md` — product scope and invariant behavior
3. the applicable reviewed plan — phase/step contracts and approved changes
4. merged code and tests — current implemented baseline
5. `docs/REVIEW_POLICY.md` — Implementer/Reviewer workflow and Merge Gate
6. this handoff — non-normative context recovery only

If this summary conflicts with a Source of Truth, current merged code, or tests, do
not preserve the summary. Use the authoritative source and document the conflict.

## 2. Phase 2 closeout state

Phase 2A through Phase 2F are complete:

- Technical Expansion, task-aware LLM runtime profiles, Supply/Demand `mean4w`, and
  the 20-day market-correlation window
- public reported short positions
- investor-type market flows
- TSE 33-sector benchmark and sector short-selling flow
- Advanced Dividend analysis
- daily-OHLCV estimated Volume Profile with POC and Value Area

Snapshot V9 is the current writer. The read boundary accepts immutable V1–V9
Snapshots; V1–V8 files are not migrated or rewritten, and unknown versions are
rejected.

## 3. Current deterministic boundary

Important deterministic Engines include:

- Fundamental, Valuation, and Peer Comparison calculations
- Technical SMA/ATR/swing/trend and Advanced Technical RSI/MACD/Bollinger
- Supply/Demand and market-correlation windows
- Strategy Entry/Stop/Target candidates with sourced tick/resistance constraints
- report-level public short positions
- investor-type market flows
- sector benchmark and sector short-selling turnover
- fiscal/event-level Advanced Dividend analysis
- daily-OHLCV estimated Volume Profile allocation, POC, and Value Area

The architecture remains one-way:

```text
typed source results
  → deterministic Engines
  → structured Agent Tools
  → Standard Agent Snapshot Collector
  → Canonical AnalysisSnapshot V9
  → local persistence / read-only API
  → Dashboard presentation

structured Tool results
  → comprehensive-analysis interpretation
```

The Standard Agent collector consumes structured tool results and does not recover
financial values from prompts or final Markdown. The Claude Agent SDK remains a
separate execution path and is not connected to Snapshot generation. Dashboard and
LLM layers format or interpret stored/calculated values; they do not reimplement
financial or statistical calculations.

## 4. Invariants to preserve

- **Code calculates, AI interprets.** Important financial/statistical calculations
  remain deterministic and tested.
- **No data means no claim.** Missing, unavailable, or uncollected data is not zero
  and cannot support a substitute claim.
- **No look-ahead.** Historical analysis respects source-specific publication,
  eligibility, classification, and row-date boundaries.
- Typed unavailable states, `not_collected`, and valid numeric zero remain distinct.
- Snapshot evolution is additive and versioned. Old schemas remain immutable and
  readable unless an explicitly approved migration says otherwise.
- Browser and LLM consumers do not reconstruct calculations from raw data or
  presentation text.
- The system remains personal, local, single-user research software rather than an
  automated trading or public advisory service.

See `docs/SPEC.md` and `docs/PHASE2_PLAN.md` for the normative product and Phase 2
contracts. Do not copy detailed formulas from this summary.

## 5. Representative deferred Phase 2 scope

Deferred items remain unimplemented unless a later reviewed plan adopts them:

- optional ADX and Supply/Demand Z-score
- investor-flow rolling/cumulative ratios, Z-scores, ranks, and classifications
- local archives for overwritten source vintages
- split/special-aware dividend CAGR and increase/cut streaks
- DOE, payout-policy extraction, and buyback lifecycle integration
- rights-issue price/volume common-basis conversion
- minute/tick Volume Profile

Rejected Phase 2 boundaries remain rejected where specified in the plan, including
unsupported issuer attribution or aggregation, actual-holder/true-shikori claims,
Browser/LLM calculation, and automatic thresholds, composite signals, or Buy/Sell
derivation from descriptive source results.

## 6. Phase 3 candidates and next task

`docs/SPEC.md` currently lists these Phase 3 candidates:

- Independent Evaluator
- advanced composite score
- PDF
- Radar chart
- past-analysis diff

Start Phase 3 in a new Codex thread with:

```text
P3-0 — Source / Formula / Architecture Design
```

P3-0 is docs-only. It must determine scope and architecture from current `main`, the
Source of Truth, merged code, and tests without assuming this thread's conversation
can be reconstructed.

P3-0 must not implement runtime code, an Evaluator, score calculations, weights,
Snapshot V10, PDF generation, Radar charts, or past-analysis diff. This handoff does
not decide evaluation formulas, score weights, Radar axes, PDF structure, diff
semantics, or the implementation sequence beyond requiring a reviewed docs-only
design first.
