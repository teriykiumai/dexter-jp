# Phase 3 Handoff

**Purpose:** Non-normative context recovery for the Phase 3 design thread

**Status:** Candidate; not approved until independent review and merge

**Repository:** `teriykiumai/dexter-jp`

**Phase 3 design baseline:** `b2989cd1f78fc374f433352fd6532a506fb00108`

**Baseline identity:** PR #73 merge; Dashboard UX closeout complete

**Date:** 2026-08-29

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
- Browser and LLM consumers do not reconstruct values from presentation text.
- Phase 3 creates no Buy/Sell signal, automatic action, or runtime composite score.
- The product remains personal, local, single-user research software.

Detailed formulas and source contracts remain in `docs/SPEC.md`,
`docs/PHASE2_PLAN.md`, and `docs/PHASE3_PLAN.md`; do not copy them from this
summary.

## 5. P3-0 candidate state

At the 2026-08-29 inspection point:

- branch: `docs/phase3-architecture-design-step0`
- reviewed predecessor head: `6eafc4e50803ca2061e21453fb6c6059c04367c8`
- base `main` / `origin/main`:
  `b2989cd1f78fc374f433352fd6532a506fb00108`
- PR #74: Draft, open, merge state clean
- review feedback on the immutable `6eafc4e` head: one submitted PR review comment
  and one adversarial issue comment, both with a stated Changes Required verdict;
  GitHub `reviewDecision` remains empty
- CI on that head: `bun test` and `bun run typecheck` successful
- the PR branch now contains P3-0 plan corrections responding to both reviews;
  the corrected head is not yet re-reviewed or approved

These facts describe an inspection point, not approval. Recheck the exact PR head,
reviews, CI, and merge state before relying on them.

P3-0 changes the following Source of Truth documents together:

- `docs/SPEC.md`
- `docs/MVP_IMPLEMENTATION_PLAN.md`
- `docs/PHASE3_PLAN.md`
- `docs/PHASE3_HANDOFF.md` as non-normative recovery context

## 6. Phase 3 outcome

Phase 3 adopts:

- deterministic, explicit-registry comparison of two immutable saved Snapshots;
- a presentation-only Radar of the seven stored peer percentiles;
- an explicitly invoked qualitative Independent Evaluator whose result is stored in
  a separate versioned sidecar; and
- a docs-only composite-score evaluation plan whose runtime adoption remains gated
  by Phase 4 validation.

Phase 3 explicitly does not implement:

- PDF or print export, export storage, or a download API;
- a runtime composite score or new financial signal;
- collection-level public-short, investor-flow, or sector-flow aggregation;
- automatic Evaluator execution, POST generation endpoints, polling, or WebSocket;
- Snapshot V10, migration, or backfill.

PDF has no numbered target phase. Reconsider it only after a concrete sharing,
immutable-audit, offline-printing, or PDF-accessibility need is documented in a
separate reviewed plan. The existing Playwright/Chromium dependency remains for
Dashboard browser tests and is not a PDF commitment.

The final Dashboard registry has six stable tabs:

```text
report         / 概要・レポート
evaluation     / AIレビュー
technical      / 株価・テクニカル
fundamentals   / 比較・配当
supply-demand  / 需給・空売り
market         / 市場・セクター
```

Comparison belongs at the start of `report`; Radar belongs in
`fundamentals`; stored Evaluator results belong in `evaluation`. The Dashboard
does not invoke an Evaluator or incur provider cost.

## 7. Implementation sequence and next task

Each item is a separate reviewed PR. Do not start a dependent step until its
predecessor is merged and local `main` is fast-forwarded.

1. P3-0 — Source of Truth design synchronization
2. P3-I0 — history immutability, canonical digest, and stored-report safety
3. P3-H1 — pure saved-analysis comparison
4. P3-H2 — read-only Comparison API and Dashboard
5. P3-R1 — Peer Radar
6. P3-E1 — evidence manifest and evaluator sidecar
7. P3-E2 — explicit evaluator runtime, CLI, and manual gold-set gate
8. P3-E3 — evaluator read API and `evaluation` tab
9. P3-C0 — composite-score evaluation plan only
10. P3-X — Usage, setup, handoff, and final validation closeout

After P3-0 passes independent review and is merged, the next task is:

```text
P3-I0 — History immutability, CanonicalJsonV1 digest, and stored-report safety gate
```

P3-I0 must not add Comparison calculation, API/UI, Radar, Evaluator runtime,
PDF, score, Snapshot V10, or source fetch.

## 8. Maintenance boundary

This file is updated at P3-0 to establish recovery context and at P3-X to record
the final merged state. It is not a per-PR progress ledger. Intermediate status
belongs in the relevant PR and current Git history.
