# Dexter JP Dashboard Refresh Handoff

**Status:** DR-0 merged; DR-V1 candidate implementation awaiting independent re-review
and merge. DR-V2 and later steps have not started.

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

## 3. DR-0 merge and current DR-V1 boundary

The DR-0 branch was:

```text
feat/dashboard-refresh-contract-step0
```

Its merged diff was limited to:

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

PR #94 received a `Mergeable` independent review for exact head
`01a5b3de0e5a755908ff45cddb399bbaaf2d28c2`, with zero unresolved BLOCKING/MAJOR
findings and both canonical CI checks green. Following user authorization it was
merged on 2026-09-03 as `8e80a02dec04d0b1686623f1e724ba6cc1307c88`. Local `main` was
fast-forwarded to that exact commit before creating:

```text
feat/dashboard-visual-primitives-step1
```

DR-V1 implements `DESIGN.md` tokens and scoped light primitives. The existing
`Card`, `MetricGrid`, `AvailabilityBadges`, `Value`, and `GuidanceButton` move to
`primitives.tsx` while preserving semantic content and interaction ownership.
Native Button variants, labelled statuses, and a keyboard table region provide
reusable foundations. Exact tokens, native field styling, safe targets, focus,
reduced-motion handling, and the migration boundary are covered by unit/browser
tests and a test-only visual composition.

PR #95 review corrections make value content roles explicit: text/state remains UI
typography, numeric/ID/date values opt in through `Value.kind` or
`MetricGridItem.valueKind`, and unavailable values never inherit the data family.
Japanese metadata and compact data metadata are distinct. Tables default to
left-aligned UI text with an explicit numeric-column class on headers and body
cells. Native rectangular-field rules have a text-like input allowlist and do not
restyle checkbox/radio or other non-text controls. `DESIGN.md` records these shared
usage contracts; the corrections do not activate a production surface migration.

The production Watchlist and six-tab detail retain their legacy appearance. The
new light boundary is not activated around a partially migrated page, and no
public design-preview route is added. Watchlist/global navigation belongs to
DR-V2; complex detail/Table/Dialog/Radar/Validation/chart migration and the seven-tab
shell belong to DR-V3. No source, API, Snapshot, dependency, or operation changes
are part of this candidate.

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

## 6. Next step after DR-V1 merge

The next step is **DR-V2 — Watchlist and global navigation**. It may start only after:

1. the exact DR-V1 head has no BLOCKING or MAJOR independent-review finding;
2. required CI is green;
3. the user authorizes and completes merge;
4. local `main` is fast-forwarded to the merged `origin/main`; and
5. the DR-V2 branch is created from that updated clean main.

DR-V2 migrates the Watchlist/loading/error/empty surfaces to the shared visual
system and adds the global Market Overview entry with an explicit not-yet-available
state. It must preserve the current six-tab detail behavior and inherited URL/focus
contracts. The seven-tab navigation change belongs to DR-V3;
the Technical source/lifetime gate belongs to DR-T0; shared session/coordinator
ownership, empty-start admission, and the cross-domain recovery guard belong to
DR-C1; the content/receipt repository belongs to DR-A1. DR-O1 supplies the common
Market Data job repository/recovery adapter and generic Overview API before DR-T2
adds Technical source I/O. This dependency does not wait for DR-M0. Market source
modules belong to DR-M1a-c/DR-E1, and user instructions belong to DR-X.

## 7. Candidate validation

| Validation | Result |
| --- | --- |
| focused `bun test src/dashboard/web/primitives.test.ts` | 11 passed, 0 failed |
| `bun test` | 936 passed, 0 failed |
| `bun run typecheck` | local Bun launcher stopped before TypeScript execution; see below |
| `bun node_modules/typescript/bin/tsc --noEmit` | passed using the same installed compiler |
| `bun run test:dashboard-browser` | all 55 passed (38 inherited + 17 primitive tests) |
| `git diff --check` | passed; Git emitted only the checkout's LF-to-CRLF conversion warning |
| primitive visual QA | 320, 390, 680, 768, 980, 1024, 1280px; no document overflow or overlapping controls |

On this Windows checkout, `bun run typecheck` returned Bun's existing
`could not create process` / local-bin-remap failure. It did not report a TypeScript
diagnostic. The direct command above ran the installed TypeScript compiler to
completion without changing dependencies. The exact DR-V1 PR must still pass the
canonical `bun run typecheck` CI job; the local launcher failure is disclosed, not
treated as a canonical-command pass.

DR-V1 exercises actual React-rendered primitives in a local test-only composition,
including computed color contrast, native disabled behavior, keyboard focus,
associated field help/errors, touch targets on wide coarse-pointer devices, exact
table scrolling, and reduced motion. Review regressions cover computed families
for zero, Japanese states, IDs, dates, and mixed metadata; numeric versus explanatory
header/body alignment; and text-like input inclusion/non-text exclusion in normal,
invalid, disabled, narrow, and coarse-pointer states. The original two MAJOR
findings were reproduced by failing browser tests before their fixes. The full
configured suite separately verifies
the existing six-tab journeys, glossary, Snapshot V1-V9, Comparison, Radar, reload
races, and Strategy Validation behavior. No external provider request is part of
these tests. New-route visual migration is not claimed complete by these results.

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
