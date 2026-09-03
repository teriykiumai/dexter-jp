# Dexter JP Dashboard Refresh Handoff

**Status:** DR-0 candidate; no Dashboard Refresh runtime work is approved until this
exact contract passes independent review, is merged, and local `main` is
fast-forwarded

**Last Updated:** 2026-09-03

## 1. How to use this file

This handoff restores context only. It does not approve work, override `AGENTS.md`,
`docs/SPEC.md`, root `DESIGN.md`, or `docs/DASHBOARD_REFRESH_PLAN.md`, replace merged
code/tests, or prove a PR passed review. Resolve conflicts in favor of the applicable
Source of Truth and exact merged implementation.

Before acting, verify the current checkout, `origin/main`, candidate PR head, CI,
independent review, and Merge Gate. Do not infer current Git, GitHub, source,
entitlement, or migration state from this file.

## 2. Verified predecessor baseline

DR-0 was started from clean local `main` and `origin/main` at:

```text
25a31ac0f927bedff19ea49889ef26af01fab658
Merge pull request #93 from teriykiumai/feat/phase4-closeout-step9
```

That commit contains the merged Phase 4 closeout. The older
`docs/PHASE4_HANDOFF.md` still describes its then-candidate state and is historical
recovery context, not evidence of current repository state.

The implemented baseline includes:

- Analysis Snapshot V9 as the only writer and V1-V9 readers;
- the Watchlist and six-tab Single Stock Dashboard;
- Snapshot Comparison, Radar, and Strategy Validation surfaces;
- a local `GET /api/session`, same-origin/Host/CSRF checks, and one Strategy
  Validation background job; and
- bounded J-Quants request/cancellation behavior for Strategy Validation.

No Dashboard Refresh Technical artifact, Market Overview artifact, refresh route,
new visual token system, or seventh tab exists at this baseline.

## 3. DR-0 candidate boundary

The candidate branch is:

```text
feat/dashboard-refresh-contract-step0
```

Its intended diff is limited to:

- `AGENTS.md` — require root `DESIGN.md` for every user-facing UI design task;
- root `DESIGN.md` — sole visual Source of Truth for the Dashboard Refresh;
- `docs/SPEC.md` — independent pre-Phase-5 roadmap and invariants;
- `docs/MVP_IMPLEMENTATION_PLAN.md` — current Post-MVP roadmap alignment;
- `docs/DASHBOARD_REFRESH_PLAN.md` — normative implementation contract with explicit
  source-feasibility gates; and
- this handoff — non-normative recovery context.

DR-0 adds no code, CSS, test fixture, dependency, environment setting, API route,
external request, local artifact, Usage instruction, or setup instruction. Historical
UX and Phase 2-4 plan/handoff files remain unchanged.

## 4. Adopted product boundary

Dashboard Refresh is independent from Phase 5 and must finish first. It adopts:

- the accessible visual system defined only by root `DESIGN.md`;
- a seven-tab shell with `market-overview / 市場概況` before the existing `market`
  tab and `validation` last;
- explicit EOD Technical and Market Overview refresh from J-Quants Standard or
  higher;
- separate immutable create-only JSON content artifacts and observation receipts
  under `.dexter/market-data/`, with `latest.json` only a rebuildable cache;
- server-side pure TypeScript calculation and Browser presentation only; and
- separate Technical/Overview buttons using one shared Dashboard session and one
  coordinator inside the running Dashboard server process across existing Strategy
  Validation and both new job kinds.

The coordinator does not claim account-global control over the standalone Phase 4
CLI or another Dashboard process. External J-Quants processes must not be run
concurrently. Immutable receipt ordering protects latest-artifact selection if two
processes are accidentally run, but it does not coordinate their request rates.

Dashboard admission uses `dashboard_empty_start_admission_v1`: after an earlier job,
the process attempt log must become empty before a new job can be accepted. Cooldown
returns immediate 409 plus `Retry-After`, without a job, preflight consumption,
`acceptedAt`, or automatic retry. A manual retry revalidates before acceptance. This
keeps Phase 4's empty-start `rolling_attempt_log_v1` estimate and execution deadline
unchanged; DR-C1 explicitly adds this admission behavior and warning/error copy.

`dashboard_job_recovery_v1` also guards both durable job repositories. Create and
replace distinguish definitely-unpublished, proved-published, and ambiguous results;
an exception after final promotion cannot imply absence. Unproved publication or
terminal state keeps a sticky global admission blocker, even if Market Data can
show a validated in-memory completed result. Restart performs one combined inventory
before native reconciliation: zero/valid may open admission, one valid nonterminal
uses its domain's local recovery, and multiple/corrupt/unreadable records fail closed
without choosing a winner or deleting evidence. No live force-unlock or automatic
external retry is added. See the source plan for the exact HTTP/read contract.

It does not adopt Python, a Dashboard DB, realtime data, automatic market-data
refresh/polling (active-job status polling is allowed), Snapshot V10, total-return
claims, score, signal, Buy/Sell advice, or Phase 5 Portfolio work.

## 5. Source state and blocking gates

As of 2026-09-02, the TSE states that the margin-publication change is scheduled for
2026-09-28 and is conditional on successful migration on 2026-09-27. That future
event has not occurred at this handoff date. Individual J-Quants Standard entitlement,
the exact post-migration V2 schema, full-population pagination, units, and correction
behavior therefore remain unverified.

JPX Market Innovation & Research's 2026-07-29 notice describes the new daily
distribution for a TMI/J-Quants Pro contract. It does not prove individual Standard
availability. The plan therefore registers the post-migration margin source as a
candidate owned by DR-M0, not as an approved production source.

DR-M0 is a hard gate. Do not implement or expose the TSE aggregate/1570 live adapter
from a press release, J-Quants Pro schema, unofficial scraper, guessed fields, or a
lower-coverage substitute. The gate requires:

1. the official migration-success announcement;
2. updated individual J-Quants documentation for Standard; and
3. an explicitly authorized, bounded, secret-safe one-date schema/reconciliation
   smoke with the actual configured Standard credential; and
4. a separately bounded production-shape bootstrap smoke proving that the exact 26-
   observation window for all four initial modules fits frozen request/page/row/byte/
   attempt/deadline limits.

Technical refresh has a separate DR-T0 Standard ten-year-history and effective-dated
instrument-lifetime gate. The official listed-issue specification rechecked on
2026-09-03 provides dated master snapshots but explicitly does not provide listing/
delisting dates or code-change correspondence tables. The exact bounded proof of
one continuous current listing segment remains unverified. DR-T0 must establish a
documented proof method before a credentialed smoke and freeze that
contract and fail closed for IPO, delist/relist, or code-reuse ambiguity before a
production adapter or UI is exposed. Normal CI and Playwright use fixtures only and
must not contact J-Quants.

## 6. Next step after merge

The next step is **DR-V1 — visual tokens and primitives**. It may start only after:

1. the exact DR-0 head has no BLOCKING or MAJOR independent-review finding;
2. required CI is green;
3. the user authorizes and completes merge;
4. local `main` is fast-forwarded to the merged `origin/main`; and
5. the DR-V1 branch is created from that updated clean main.

DR-V1 implements root `DESIGN.md` tokens and shared primitives only. It must preserve
the current six-tab behavior. The seven-tab navigation change belongs to DR-V3;
the Technical source/lifetime gate belongs to DR-T0; shared session/coordinator
ownership, empty-start admission, and the cross-domain recovery guard belong to
DR-C1; the content/receipt repository belongs to DR-A1. DR-O1 supplies the common
Market Data job repository/recovery adapter and generic Overview API before DR-T2
adds Technical source I/O. This dependency does not wait for DR-M0. Market source
modules belong to DR-M1a-c/DR-E1, and user instructions belong to DR-X.

## 7. Candidate validation

| Validation | Result |
| --- | --- |
| `bun test` | 925 passed, 0 failed |
| `bun run typecheck` | local Bun launcher stopped before TypeScript execution; see below |
| `bun node_modules/typescript/bin/tsc --noEmit` | passed using the same installed compiler |
| `git diff --check` | passed; Git emitted only the checkout's LF-to-CRLF conversion warning |

On this Windows checkout, `bun run typecheck` returned Bun's existing
`could not create process` / local-bin-remap failure. It did not report a TypeScript
diagnostic. The direct command above ran the installed TypeScript compiler to
completion without changing dependencies. The exact DR-0 PR must still pass the
canonical `bun run typecheck` CI job; the local launcher failure is disclosed, not
treated as a canonical-command pass.

DR-0 has no Browser-output change, so it does not rerun Playwright merely to restate
the merged Phase 4 baseline. Browser-affecting DR-V1 onward must run the applicable
configured suite, and DR-X must run the full suite and responsive visual QA.

## 8. Remaining risks

- The 2026-09 margin migration or individual Standard availability can be delayed,
  changed, or fail the bounded smoke.
- J-Quants corrected historical rows do not prove the exact originally delivered
  vintage; every content artifact stores its original `fetchedAt`, source revision,
  and digest, while a separate receipt stores each later successful `checkedAt`.
  Latest is ordered by receipt admission, not content creation or completion time;
  `calculationDate` is hashed semantic context, so a date rollover is a new revision.
- Adjusted ETF price is not distribution-reinvested total return.
- Unadjusted margin quantities can have a unit-basis break at a split and must not be
  drawn as one continuous comparable series.
- The existing session token and request limiter are currently owned by narrower
  Strategy Validation components; DR-C1 must extract shared Dashboard-process
  ownership while preserving empty-start accepted-job timing and security. A recent
  dispatch can refuse new admission for up to 60 seconds even after job completion;
  the client must retry explicitly. CLI/second-process account-level coordination
  remains explicitly unsupported.
- A post-promotion job cleanup/read error can require a Dashboard restart even when
  the final file was written. The sticky recovery guard favors safety over live
  self-repair. Persistent corruption or multiple nonterminal records require
  investigation and separately authorized repair; restarting does not bypass them.
  Published market receipts remain visible independently of job-record recovery.
- Every successful refresh adds a receipt. V1 latest reads enumerate all receipt
  filenames, and the 256-receipt fallback limit can prevent reaching an older valid
  artifact after repeated references to corrupt content. These are explicit local-
  use limitations, not solved by `latest.json`; sharding/indexing/group skipping
  require a separate reviewed storage/order contract.
- The exact individual-Standard request shape needed to prove a continuous current
  instrument lifetime is unresolved until DR-T0; bars or a latest master row alone
  are insufficient.
- A whole-Dashboard visual migration can regress focus, overflow, or semantic states;
  the staged V1-V3 split and required width matrix are merge gates.

## 9. Maintenance boundary

Update this handoff only at an explicit Dashboard Refresh recovery or delivery
boundary. Recheck source revisions, migration outcome, plan entitlement, branch, PR,
CI, review, merge, and local `main` directly every time.
