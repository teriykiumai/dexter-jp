# Dexter JP Dashboard Refresh Handoff

**Status:** DR-0, DR-V1, and DR-V2 merged; DR-V3 candidate implementation awaiting
independent review and merge. DR-T0 and later steps have not started.

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

## 3. DR-0 / DR-V1 / DR-V2 merges and current DR-V3 boundary

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

At the DR-V1 boundary, the production Watchlist and six-tab detail retained their
legacy appearance. The new light boundary was not activated around a partially
migrated page, and no public design-preview route was added.

PR #95 received an independent `Mergeable` review for exact head
`523602ebb576a994e6e7fe05210b732ea7f5f5d7`, with zero unresolved BLOCKING/MAJOR
findings and both canonical CI checks green. The reviewer confirmed the earlier
two MAJOR and one MINOR findings were resolved. Following user authorization it
was merged on 2026-09-03 as `d7728d2456e20102c28f7be8ef5f056ea4d3d5f7`. Local `main`
was fast-forwarded to that exact commit before creating:

```text
feat/dashboard-watchlist-step2
```

DR-V2 activates the light boundary for the complete Watchlist, its loading/error/
empty states, the global Market Overview placeholder, and scoped page errors.
The common header links to `保存済み分析` and `市場概況`; the latter always shows
`全市場共通` and an explicit not-yet-available message, without reading market
data or starting a job. All stored Watchlist columns and existing date/sort/zero/
missing semantics are retained. Summary counts appear only after a successful
list read; failed re-entry retains the last valid rows with an explicit warning.

The DR-V1 review's call-site audit applies here: Japanese company/category/status
text uses the UI family; ticker/date/timestamp and available numeric values
explicitly use data roles. Financial column headers and values align right,
identity/explanatory columns align left, and unavailable text stays UI typography.
The complete table remains available in a named keyboard-scrollable region.

The page-level URL guard implements plan section 4.3 before dispatching reads:
global/detail ownership conflicts, orphan owned state, and malformed/duplicate new
enum keys show a scoped error without automatic URL repair. Explicit navigation
preserves unknown query keys and applies the documented selection ownership.
Valid Technical/range keys remain dormant; their controls are not implemented.
Back/Forward, reload, latest-request-wins, cancellation, and focus are covered by
real browser journeys, including a transport that ignores aborts.

The six-tab detail, including its loading/error states, keeps its legacy design
and behavior until DR-V3. No seventh tab, artifact read, refresh API, source fetch,
Snapshot/schema change, dependency, polling, or external asset is added by DR-V2.

PR #96 received an independent `Mergeable` review for exact head
`3eceece85b5c977fd81972ec55db01ae6d5808ef`, with zero unresolved BLOCKING/MAJOR
findings and both canonical CI checks green. Following user authorization it was
merged on 2026-09-03 as `194b54774cf8cc0ef4a4b7bffa75069e7c31782d`. Local `main`
was fast-forwarded to that exact commit before creating:

```text
feat/dashboard-detail-surfaces-step3
```

DR-V3 completes the production Light migration for detail, its loading/error states,
Comparison, Radar, Strategy Validation, glossary, and chart. It reuses the existing
header and primitives. The reviewer-requested document-level Light color-scheme is
now applied; production no longer loads the legacy stylesheet, which remains only
in the isolated migration regression fixture. Root `DESIGN.md` records the detailed
composition, native radio/checkbox/file controls, and chart/table conventions.

The exact seven-tab order is implemented. The new `market-overview / 市場概況` tab
shares the global placeholder, permanently identifies itself as `全市場共通`, owns no
Snapshot sections, and has no fabricated availability counts. Existing market and
investor sections remain in their inherited destinations. Dormant chart/range state,
unknown query keys, History API, reload, race, disclosure, and focus rules remain.

Numeric/ID/date values explicitly select shared data roles; categories and missing
states retain UI typography. Financial table columns align right inside named local
scroll regions. The Technical card adds a permanent exact table of every stored
OHLCV row, including rows that cannot be drawn and valid zero/missing distinctions.
It adds no series calculation, interval control, refresh, source request, API,
artifact, Snapshot/schema change, dependency, or external asset. Chart pane ratios,
Radar geometry, and financial semantics remain inherited; mobile chart height is
aligned from 390px to the approved 384px spacing multiple.

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

## 6. Next step after DR-V3 merge

The next ordered step is **DR-T0 — Technical source and lifetime gate**. It may
start only after:

1. the exact DR-V3 head has no BLOCKING or MAJOR independent-review finding;
2. required CI is green;
3. the user authorizes and completes merge;
4. local `main` is fast-forwarded to the merged `origin/main`; and
5. the next step branch is created from that updated clean main.

DR-T0 must resolve the documented source/lifetime proof before any explicitly
authorized credentialed smoke. It exposes no public route and publishes no Market
Data artifact. Failure to prove continuity within the frozen bounds returns to
design review, not a guessed source adapter. The plan dependency graph also permits
DR-T1 pure chart series after DR-V3 without waiting for DR-T0; each remains its own
reviewed step, and production Technical I/O still requires the DR-T0 gate.

Market Overview remains a placeholder until the corresponding data steps merge.
The Technical source/lifetime gate belongs to DR-T0; shared session/coordinator
ownership, empty-start admission, and the cross-domain recovery guard belong to
DR-C1; the content/receipt repository belongs to DR-A1. DR-O1 supplies the common
Market Data job repository/recovery adapter and generic Overview API before DR-T2
adds Technical source I/O. This dependency does not wait for DR-M0. Market source
modules belong to DR-M1a-c/DR-E1, and user instructions belong to DR-X.

## 7. Candidate validation

| Validation | Result |
| --- | --- |
| `bun test src/dashboard/web` | 99 passed, 0 failed |
| `bun test` | 953 passed, 0 failed |
| `bun run typecheck` | local Bun launcher stopped before TypeScript execution; see below |
| `bun node_modules/typescript/bin/tsc --noEmit` | passed using the same installed compiler |
| `bun run test:dashboard-browser` | all 76 passed (64 inherited + 12 DR-V3 tests) |
| `git diff --check` | passed; Git emitted only the checkout's LF-to-CRLF conversion warning |
| detail visual/contrast/overflow matrix | all seven tabs and glossary at 320, 390, 680, 768, 980, 1024, 1280px; 980px coarse pointer also checked |
| merged DR-V2 main CI | succeeded for `194b54774cf8cc0ef4a4b7bffa75069e7c31782d` |

On this Windows checkout, `bun run typecheck` returned Bun's existing
`could not create process` / local-bin-remap failure. It did not report a TypeScript
diagnostic. The direct command above ran the installed TypeScript compiler to
completion without changing dependencies. The exact DR-V3 PR must still pass the
canonical `bun run typecheck` CI job; the local launcher failure is disclosed, not
treated as a canonical-command pass.

DR-V2's real browser journeys cover initial loading/failure/empty states, retention
of valid rows after a failed re-entry, retry, keyboard sorting, global navigation,
Back/Forward/reload, focus restoration, ownership conflicts, closed-enum errors,
dormant keys, and inherited unknown-tab canonicalization. Abort-ignoring fixtures
prove that delayed list/reload responses cannot replace the current page and that a
cancelled history read cannot start a subsequent Snapshot read. Focus moved by the
user while loading is not stolen on completion. Visual checks exposed and fixed an
absolute screen-reader label escaping the table scroll boundary and short status/
action labels wrapping unnecessarily. The local table has a visible scroll hint.

DR-V3 adds computed contrast/flat-surface checks across every detail tab and glossary
at all seven required widths. It verifies Light loading/error recovery, 48px tabs,
touch-sized native controls, global/detail Market Overview history and dormant state,
complete stored OHLCV including zero/incomplete rows, explicit numeric/category/
missing roles (including category changes without a numeric delta), and escaped
Japanese report text. Populated Comparison and Validation
fixtures cover exact tables and default-No preflight without starting a job.

The full configured suite also retains shared primitive contrast, font-role, field,
keyboard, touch, and reduced-motion checks and the inherited glossary, Snapshot
V1-V9, Comparison, sparse Radar, reload races, and Strategy Validation journeys,
updated only where the approved seven-tab/Light composition changes expectations.
All new journeys reject unexpected API and external requests; all data is synthetic.
These candidate results do not approve DR-V3 or prove any market-data source gate.

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
