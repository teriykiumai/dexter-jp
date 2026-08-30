# Phase 3 Handoff

**Purpose:** Non-normative context recovery for the Phase 3 design thread

**Status:** Non-normative; this file records immutable merged baselines but never
substitutes for current approval, PR, CI, checkout, or merge-state verification

**Repository:** `teriykiumai/dexter-jp`

**Phase 3 design baseline:** `b2989cd1f78fc374f433352fd6532a506fb00108`

**Baseline identity:** PR #73 merge; Dashboard UX closeout complete

**Merged implementation baseline before P3-X:**
`656781ae197a4480f90e9be964cebeb37e8449d0` (PR #82 merge; P3-C0 complete)

**Date:** 2026-08-30

## 1. Authority and use

This handoff is not a Source of Truth and never overrides the current checkout,
merged code, tests, or a normative plan. Use documents by authority and subject:

1. `AGENTS.md` — repository operations, safety, validation, and Git/PR rules
2. `docs/SPEC.md` — product scope and invariant behavior
3. `docs/PHASE3_PLAN.md` — the reviewed Phase 3 implementation contract
4. merged code and tests — the implemented baseline
5. `docs/REVIEW_POLICY.md` — Implementer/Reviewer workflow and Merge Gate
6. this handoff — context recovery only

Every implementation task starts from current GitHub `main`, confirms the
predecessor PR is merged, and fast-forwards local `main` from `origin/main`.
If this summary conflicts with an authoritative source, do not preserve the
summary.

## 2. Required context

Before implementing a Phase 3 step, read:

- `AGENTS.md`
- `docs/SPEC.md`
- `docs/REVIEW_POLICY.md`
- `docs/MVP_IMPLEMENTATION_PLAN.md`
- `docs/VISUALIZATION_MVP_PLAN.md`
- `docs/DASHBOARD_UX_PLAN.md`
- the relevant predecessor contracts in `docs/PHASE2_PLAN.md`
- `docs/PHASE3_PLAN.md`
- current Snapshot schema/repository, Dashboard API and URL helpers, LLM runtime,
  and relevant tests

An external reference may inform a later implementation only when its repository,
path, immutable revision, and inspection date are recorded. An unpinned external
example is not a Phase 3 contract.

## 3. Phase 2 baseline

Phase 2A through Phase 2F are complete:

- Technical Expansion and task-aware LLM runtime profiles
- Supply/Demand `mean4w` and the 20-day market-correlation window
- public reported short positions and investor-type market flows
- TSE 33-sector benchmark and sector short-selling flow
- Advanced Dividend analysis
- daily-OHLCV estimated Volume Profile with POC and Value Area

AnalysisSnapshot V9 is the current writer. The read boundary accepts immutable
V1–V9 Snapshots; V1–V8 files are not migrated or rewritten, and unknown versions
are rejected.

The architecture remains one-way:

```text
typed source results
  → deterministic Engines
  → structured Agent Tools
  → Standard Agent Snapshot Collector
  → Canonical AnalysisSnapshot V9
  → local persistence / read-only API
  → Dashboard presentation
```

Dashboard and LLM layers format or interpret stored/calculated values. They do not
reimplement financial or statistical calculations.

## 4. Invariants to preserve

- Code calculates; AI interprets.
- Missing, unavailable, uncollected, and valid zero remain distinct.
- Historical work respects source-specific dates and never introduces look-ahead.
- V1–V9 remain immutable and readable; Phase 3 does not create Snapshot V10.
- History and the dormant P3-E1 sidecar repository use the reviewed cross-process
  no-replace publish contract. Latest state is resolved authoritatively from
  immutable history by validated numeric `generatedAtEpochMs`; raw timestamp strings
  are never sorted and the inherited identity permits no distinct same-millisecond
  tie. Legacy `latest.json` is read only for a ticker with zero history files and is
  never rewritten by Phase 3.
- Browser and LLM consumers do not reconstruct values from presentation text.
- Comparison maps schema-supported nullable fields without a stored metric reason to
  the sole `missing_metric_value` synthetic state and compares only strict canonical
  Gregorian date roles; malformed legacy dates make only that row incomparable.
- Radar trusts stored Engine positions/unavailable state, preserves valid sparse
  per-metric samples, and never replays peer metric eligibility in the Browser.
- P3-E1 Evidence provenance is structurally URL-free; it remains dormant internal
  foundation with no Phase 3 runtime producer or Dashboard consumer.
- Phase 3 creates no Buy/Sell signal, automatic action, or runtime composite score.
- Phase 3 has no Evaluator execution, CLI, provider dispatch, qualification
  attestation, API, URL selector, or Dashboard tab. A failed or pending candidate
  gate never authorizes execution.
- The product remains personal, local, single-user research software.

Detailed formulas and source contracts remain in `docs/SPEC.md`,
`docs/PHASE2_PLAN.md`, and `docs/PHASE3_PLAN.md`; do not copy them from this
summary.

## 5. Merged Phase 3 record before P3-X

The design investigation began from merged `main`
`b2989cd1f78fc374f433352fd6532a506fb00108` after the PR #73 Dashboard UX
closeout. The following predecessor merges are immutable Git-history facts verified
when P3-X began:

| Step | PR | Merge commit | Outcome |
| --- | --- | --- | --- |
| P3-0 | #74 | `938e7c543d316a7463f8cd0102d283b99179888c` | design synchronization merged |
| P3-I0 | #75 | `3b1b88cd84d18aa6e8f4adaa5f27213a6f810cc2` | immutable history/digest/safety merged |
| P3-H1 | #76 | `7f4621827f7d9456596fc214f3c3b0a877380f73` | pure Comparison merged |
| P3-H2 | #77 | `0ad9157fe1df54c5fc8c946a8a710e00475c9f5a` | Comparison API/Dashboard merged |
| P3-R1 | #78 | `23714763a4beb7c44347d8637345895ff3dbdb5e` | Peer Radar merged |
| P3-E1 | #79 | `be218bcbfa60afb6d45ef7ae4f91838e1d66eea9` | dormant evidence/sidecar foundation merged |
| P3-E2 candidate | #80 | — | closed without merge after failed quality gate |
| P3-EF | #81 | `b071a08505401bdacf9e4fcae4a6ab58105abfc9` | Evaluator freeze merged |
| P3-C0 | #82 | `656781ae197a4480f90e9be964cebeb37e8449d0` | score evaluation plan merged |

This table does not assert that a P3-X candidate is approved, passing, or merged.
Resolve the current branch, exact head, PR, checks, independent review, and Merge Gate
from Git/GitHub and `docs/REVIEW_POLICY.md`.

## 6. Phase 3 outcome

Phase 3 adopts:

- deterministic, explicit-registry comparison of two immutable saved Snapshots using
  numeric epoch request/order validation, strict row date comparison, typed nullable
  metric reasons, and typed duplicate-identity outcomes;
- a presentation-only Radar of the seven stored peer percentiles that suppresses its
  polygon for an internally inconsistent stored selected-peer/position state without
  re-running Engine eligibility or imposing a five-peer per-metric threshold;
- a bounded, record-grouped Evidence manifest that preserves exact typed facts
  and their allowlisted non-available reasons through URL-free provenance without
  unbounded scalar expansion;
- a dormant, create-only P3-E1 sidecar/evidence foundation with no Phase 3 producer
  or consumer; and
- a docs-only composite-score evaluation plan whose runtime adoption remains gated
  by Phase 4 validation.

Phase 3 explicitly does not implement:

- PDF or print export, export storage, or a download API;
- Evaluator runtime, CLI, paid quality gate, read API, URL state, or Dashboard tab;
- a runtime composite score or new financial signal;
- collection-level public-short, investor-flow, or sector-flow aggregation;
- automatic Evaluator execution, POST generation endpoints, polling, or WebSocket;
- Snapshot V10, migration, or backfill.

PDF has no numbered target phase. Reconsider it only after a concrete sharing,
immutable-audit, offline-printing, or PDF-accessibility need is documented in a
separate reviewed plan. The existing Playwright/Chromium dependency remains for
Dashboard browser tests and is not a PDF commitment.

The final Dashboard registry keeps five stable tabs:

```text
report         / 概要・レポート
technical      / 株価・テクニカル
fundamentals   / 比較・配当
supply-demand  / 需給・空売り
market         / 市場・セクター
```

Comparison belongs at the start of `report`; Radar belongs in
`fundamentals`. The Dashboard has no Evaluator surface and incurs no Evaluator
provider cost.

## 7. Implementation sequence and next task

Each item is a separate reviewed PR. Do not start a dependent step until its
predecessor is merged and local `main` is fast-forwarded.

1. P3-0 — Source of Truth design synchronization
2. P3-I0 — history immutability, authoritative epoch-ordered latest resolution,
   existing latest/history-consumer integration, canonical digest, and stored-report
   safety
3. P3-H1 — pure saved-analysis comparison
4. P3-H2 — read-only Comparison API and Dashboard
5. P3-R1 — Peer Radar
6. P3-E1 — evidence manifest and evaluator sidecar
7. P3-EF — freeze P3-E2/P3-E3 and synchronize the roadmap without merging the
   failed runtime candidate; remove the unused H2 Evaluation URL reservation
8. P3-C0 — composite-score evaluation plan only
9. P3-X — Usage, setup, handoff, and final validation closeout

Steps P3-0 through P3-C0 are merged at the baseline recorded in Section 5. The only
remaining Phase 3 candidate is:

```text
P3-X — Usage, handoff, and final validation closeout
```

P3-X updates `Usage.md`, `docs/PHASE3_PLAN.md`, and this handoff only.
`docs/USER_SETUP.md` needs no update because the merged Phase 3 scope adds no required
runtime, dependency, credential, environment variable, font, or browser setup.

The candidate must pass full tests, type-check, diff check, Dashboard Playwright,
independent review, CI, and the Merge Gate. Only after its exact head is merged and
local `main` is fast-forwarded may Phase 3 be declared complete. No further Phase 3
feature step follows it.

Phase 4 remains a separate decision. It may execute the protocol in
`docs/PHASE3_SCORE_EVALUATION_PLAN.md` only under a new reviewed implementation plan;
it does not inherit authorization for a runtime score. Evaluator and PDF remain
deferred independent work and do not become Phase 4 requirements automatically.

## 8. Maintenance boundary

This file was updated at P3-0 to establish recovery context, at P3-EF to record the
Evaluator freeze, and at P3-X to record the final predecessor baseline and closeout
boundary. It is not a live status ledger. Current candidate and post-merge status
belong in the relevant PR and current Git history.
