# Phase 3 Handoff

**Purpose:** Non-normative context recovery for the Phase 3 design thread

**Repository:** `teriykiumai/dexter-jp`

**Phase 3 design baseline:** `b2989cd1f78fc374f433352fd6532a506fb00108`

**Baseline identity:** PR #73 merge; Dashboard UX closeout complete

**Date:** 2026-08-29

## 1. How to use this handoff

This file is a compact starting point, not a Source of Truth. The normative Phase 3
contract is `docs/PHASE3_PLAN.md`. Every implementation task must still start from
the current GitHub `main` branch and verify merged code and tests. The baseline SHA
above identifies the tree used for P3-0; it is not a promise that `main` still points
to that commit.

Use repository documents by their authority and subject:

1. `AGENTS.md` — repository operations, safety, validation, and Git/PR rules
2. `docs/SPEC.md` — product scope and invariant behavior
3. `docs/PHASE3_PLAN.md` — Phase 3 contracts and approved implementation sequence
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

## 6. Phase 3 design outcome and next task

P3-0 fixes the normative details in `docs/PHASE3_PLAN.md`. In summary only:

- saved-analysis comparison is an explicit-registry deterministic result derived
  from two immutable persisted Snapshots;
- Radar renders the seven existing direction-normalized peer percentiles and creates
  no new score;
- Independent Evaluator output is optional qualitative AI judgment stored in a
  separate versioned sidecar, never in the financial Snapshot;
- PDF is an explicit local export from one selected persisted Snapshot and initially
  reuses the installed Playwright/Chromium path; and
- the advanced composite investment score is deferred to Phase 4 validation.

Snapshot V9 remains the current writer. Phase 3 results do not by themselves require
Snapshot V10. Dashboard placement keeps the existing five tabs: Peer Radar belongs
with fundamentals/comparison; history diff, Evaluator, and PDF belong with
Report/Data.

After the reviewed P3-0 plan is merged, the next task is:

```text
P3-H1 — Pure saved-analysis comparison
```

P3-H1 adds only the allowlisted metric registry, typed transient comparison result,
deterministic delta rules, and focused unit tests. It must not add the API, Dashboard,
Evaluator, Radar, PDF, Snapshot change, score, or source fetch.
