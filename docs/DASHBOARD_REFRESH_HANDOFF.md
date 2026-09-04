# Dexter JP Dashboard Refresh Handoff

**Status:** DR-0, DR-V1-V3, DR-T1, DR-C1, DR-A1, and DR-O1 merged. DR-T0A is the
current docs-only candidate that replaces the unprovable ten-year lifetime contract
with an explicit `current_code_only` history boundary.
No production Technical/source-module codec, source adapter, external Market Data
request, or new chart controls exist yet. With zero registered Overview modules,
the read remains 404 and refresh admission is refused before creating a job.

**Last Updated:** 2026-09-04

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

## 3. Merged predecessor steps and current DR-T0A boundary

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

PR #97 received an independent `Mergeable` review for exact head
`307fdc2ded629f1099ccbe6535260030747b079d`, with zero BLOCKING/MAJOR findings,
two non-blocking MINOR findings, and both canonical CI checks green. With explicit
user authorization it merged on 2026-09-03 as
`2f2aff185e3d9b95db4e2526b5c87f9bd21d188f`; merged-main CI also passed. Local `main`
was fast-forwarded to that commit before creating:

```text
feat/dashboard-technical-series-step1
```

The two MINOR findings remain open: consistent data roles for Validation schema/
version identifiers, and mixed numeric/category Comparison column-header alignment.
They do not block the next pure calculation step and are not silently marked fixed
or bundled into DR-T1.

DR-T1 adds the pure Technical bar/gap parser, normalized adjusted-OHLCV null handling,
exact calendar/window checks, chronological day/week/month candles,
gap-only unavailable periods, RSI/MACD series, and observed cross state. The existing
Phase 2 Engine shares the same single-pass indicator arithmetic; its canonical
251-bar selector, formulas, warm-up/missing precedence, and Snapshot V1-V9 contracts
are unchanged. Arithmetic overflow returns invalid-data failure, not a non-finite
available indicator. Leading/trailing partial candles never enter indicators.

`TechnicalCalculationWindowV1.listingWindow` is structural calculation context from
the superseded pre-production design, not verified identity provenance. DR-T1A must
replace it with `historyBoundary` before any production codec or route exists.
DR-T0/DR-T2 then verify current end-date master identity, adjusted basis, complete
pagination, the exact production maximum-ten-year range, and admission cutoff. The
pure engine deliberately also accepts shorter explicit windows for deterministic
same-window parity tests. Under the amended contract it cannot infer a missing
instrument row: callers omit only sessions before the first returned source row and
fail an absent official-session row after that boundary.
It exposes no full artifact schema, source registry, persistence, job, API, CLI,
UI, or dependency. Dashboard charts still render stored Snapshot values only.

PR #98 received an independent `Mergeable` review for exact head
`07af3dc72e900bad0b1444384175264b03db1d18`, with zero BLOCKING/MAJOR findings and
canonical test/typecheck CI green. Following user authorization it merged on
2026-09-03 as `dd4c593e3538828a843db024b136a36f931905d5`; merged-main CI also passed.
Local `main` was fast-forwarded before creating:

```text
feat/dashboard-coordinator-step1
```

DR-C1 extracts the shared Dashboard session/security helpers and introduces one
process-owned coordinator for all three job kinds. It retains actual-attempt times
across runtime/job boundaries, rejects admission until the log is empty, serializes
native inventory/write/release proofs, and latches uncertain storage until restart.
The native Phase 4 schema and publishing/completed-run reconciliation are retained.
Create/replace results now distinguish definitely-unpublished, strictly proved full-
payload publication, and ambiguous publication. Failed exact-job/cancellation reads
also stop admission rather than allowing an unverified owner to continue.

The two-slot registry uses the real Strategy Validation adapter and an absent/empty
Market Data jobs-directory probe. It does not implement a Market Data job schema,
repository, API, source, artifact, or refresh UI. Combined startup inventory precedes
all native cleanup/reconciliation; multiple or unreadable records preserve evidence.
The existing Validation error surface stops automatic job reads after failure and
labels retained nonterminal content as last-known through tab/ticker remounts until
full reload. Cooldown preserves preflight/confirmation for explicit manual retry.
No visual tokens, financial calculations, Snapshot versions, dependencies, or
standalone CLI behavior change. The DR-V3 MINOR findings remain outside this scope.

PR #99 received an independent `Mergeable` re-review for exact head
`86ae8c38a2bdaf213892b33c9ee6e5641ee7e79e`, with zero BLOCKING/MAJOR findings and
canonical test/typecheck CI green (run `33760251709`). Following user authorization,
it merged on 2026-09-03 as `4d4646c68edb34995f05587b75e8da759974e2df`. Local `main`
was fast-forwarded before creating:

```text
feat/dashboard-artifact-repository-step1
```

DR-A1 implements the strict source-input/root-envelope preimages, all seven closed
calculation/target/role families, original-provenance-preserving content reuse,
immutable observation receipts, exact association reads, receipt-authoritative
latest resolution, bounded warned fallback, and rebuildable cache writes. It reuses
`CanonicalJsonV1`, the existing strict UTF-8/duplicate-key parser, credential/path
safety grammar, and P3-I0 no-replace hard-link publisher. An optional private-temp
writer adds explicit flush/close for Market Data without changing existing Snapshot
callers. Corrupt/colliding canonical files are never overwritten or cleaned up.

The repository requires a full closed module-owned codec and a source-manifest
allowlist/coverage validator; there is no default/open production codec. DR-A1 tests
use explicitly synthetic Technical/Overview payload codecs. Actual Technical
output/provenance schemas and source mappers remain DR-A2/DR-T0/DR-T2-owned; actual
module calculation/output schemas remain DR-M1a-c/DR-E1-owned. The source digest helper
requires the source mapper's closed, ordered normalized-row validator. It does not
claim that a read-time manifest can reconstruct input rows that were not stored.
The lifetime candidate was never promoted and DR-T0A retires it; no post-migration
source has been promoted to approved.

Content publication/reuse precedes a no-replace receipt. Post-link errors are not
treated as absence: only a fully reopened matching file allows progress or a
committed-receipt success. Cache failure cannot hide a committed receipt. A(t1),
corrected B(t2), and re-observed A(t3) select t3 while retaining t1's content bytes;
older-admission completion cannot roll latest backwards. Same-millisecond valid
receipts that name different artifacts fail closed even if one artifact is corrupt.
An unreadable member of an admission group requires prior-group fallback rather
than guessing its missing identity. Exact observation reads never use fallback.

PR #100 received an independent `Mergeable` review for exact head
`cba378b97833ab3f29d741a335abedc0b6512b8c`, with zero BLOCKING/MAJOR findings
and canonical test/typecheck CI green (run `33767226929`). Following user
authorization, it merged on 2026-09-03 as
`268b08660118f50033068d6ba608ebf5792c60ca`. Local `main` was fast-forwarded to
that exact commit before creating:

```text
feat/dashboard-overview-foundation-step1
```

DR-O1 adds the one native Market Data job repository/recovery adapter shared by
future Technical and Overview refreshes, the strict Overview module registry,
per-module publication orchestration, receipt-resolved Overview composition, and
the local read/job API. Production server composition registers both durable job
domains before starting the shared recovery barrier and gives both route adapters
the same Dashboard session. The job repository persists only the closed native job
view and uses the same contained, strict UTF-8/duplicate-key, symlink-resistant
read boundary as Market Data artifacts.

No production source module is registered in DR-O1. Therefore the default
`GET /api/market-data/overview` returns 404 and a valid
`POST /api/market-data/overview/jobs` returns 400
`source_configuration_missing` before lease acquisition, job publication, or
external dispatch. Tests use only closed synthetic codecs and collectors. DR-O1
adds no UI/CSS, credential read, external request, dependency, Snapshot change,
retention deletion, or source-gate waiver.

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

Technical refresh has a separate DR-T0 Standard maximum-ten-year history and current-
code gate. The official listed-issue specification rechecked on 2026-09-04 provides
dated master snapshots but explicitly does not provide listing/delisting dates or
code-change correspondence tables. The user accepted that the Dashboard will not
prove historical instrument identity. DR-T0A makes that limitation explicit before
runtime work: current end-date master identity is verified, earlier bars remain
`current_code_only`, any post-start missing official-session row fails closed, and
the unverified-history warning is permanently visible. Normal CI and Playwright use
fixtures only and must not contact J-Quants.

## 6. Current-code amendment and next-step boundary

Read-only investigation of the official J-Quants master specification did not
establish a continuous listing-segment proof within the planned attempt/time bounds.
A current master row or equal code remains insufficient. No credentialed Technical
smoke was run and no lifetime source ID was frozen. After DR-O1 merged, the user
accepted the explicit product trade-off: retain maximum-ten-year current-code bars,
but do not claim that the full period belongs to one instrument.

DR-T0A is docs-only. It retires the unused lifetime candidate, defines
`CurrentCodeHistoryBoundaryV1`, freezes family-specific current-master predicates and
ETF no-observation artifacts, replaces the Technical/ETF source roles and warning
contract, prohibits current-code history from Phase 4/backtest/score/trading-signal
use, and adds DR-T1A plus DR-A2 before DR-T2. It changes no runtime, dependency,
source request, artifact, route, UI, Usage, or setup.

The normative predicate is in plan section 3.3: Technical accepts `ProdCat=011`
with `Mkt` in `0105/0111/0112/0113`; fixed 1321/2633 accept `ProdCat=014` with
`Mkt=0109`. Codes are exact five-character values. `CoName` is validated and hashed
as the current source label but is not compared with Snapshot or hard-coded text.
For a proved-complete ETF response with no renderable bar, `dataDate` is the expected
`eligibleThrough`; the canonical unavailable artifact commits an authoritative
receipt and does not fall back to an older available value.

After DR-T0A review and merge, DR-T1A, DR-A2, and the revised DR-T0 gate are the next
three independent branches. DR-T0 still requires separate authorization for its
default-No credentialed smoke, but it now verifies bars/calendar/end-date master and
post-start coverage rather than an unavailable lifetime source. DR-T2 remains
blocked until all three predecessors and merged DR-O1 are independently reviewed and
merged. Pure test success does not replace the live source/entitlement gate.

Market Overview remains a placeholder until the corresponding data steps merge.
The Technical source/current-code gate belongs to DR-T0; shared session/coordinator
ownership, empty-start admission, and the cross-domain recovery guard belong to
DR-C1; the content/receipt repository belongs to DR-A1. DR-O1 supplies the common
Market Data job repository/recovery adapter and generic Overview API. DR-T1A changes
the pure calculation window, DR-A2 changes the unused pre-production role/warning
contracts, and DR-T0 freezes the current-code source gate before DR-T2 adds Technical
source I/O. These dependencies do not wait for DR-M0. Market source modules belong
to DR-M1a-c/DR-E1, and user instructions belong to DR-X.

## 7. Validation evidence

### 7.1 Merged DR-V3 predecessor evidence

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
completion without changing dependencies. PR #97 and merged-main CI subsequently
passed the canonical `bun run typecheck` job; the local launcher failure remains
disclosed, not treated as a canonical-command pass.

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
These predecessor results do not prove any market-data source gate.

### 7.2 Merged DR-T1 predecessor evidence

| Validation | Result |
| --- | --- |
| `bun test src/analysis/market-data/technical-series.test.ts src/tools/finance/advanced-technical-engine.test.ts` | 92 passed, 0 failed |
| `bun test` | 1003 passed, 0 failed, across 85 files |
| `bun run typecheck` | same local Bun launcher failure before compiler execution |
| `bun node_modules/typescript/bin/tsc --noEmit` | passed using the installed compiler |
| `bun run test:dashboard-browser` | 76 passed, 0 failed; unchanged UI journeys |
| `git diff --check` | passed; only the checkout's LF-to-CRLF conversion warning |

The new 50 tests cover strict fields/geometry/zero/null/sparse/duplicate/future input,
complete official-calendar envelopes, structural lifetime bounds and IPO clipping,
gap-only periods/all-gap failure, holiday/year/leap boundaries, leading and trailing
partial exclusion, indicator warm-up and exact-prefix parity, cross equality, the
34-month boundary, arithmetic overflow, and non-mutation. All new fixtures are
synthetic and perform no external I/O. Shared Engine regression and existing
Snapshot/API/Strategy tests are retained; no source entitlement was tested.
PR #98 subsequently passed independent review and canonical test/typecheck CI.

### 7.3 Merged DR-C1 predecessor evidence

The synthetic coordinator tests cover all nine job-kind transitions, R=1/2/5 shared
dispatch, exact newest-attempt cooldown boundaries, concurrent manual retries,
preflight revalidation after inventory, stale ownership, monotonic-clock failures,
zero/one/multiple/corrupt startup inventories, and create/replace/queue failure.
Native filesystem fault tests cover errors before and after actual link/rename,
cleanup/final-read failures, strict full-payload mismatch, preserved evidence,
cancel-request writes, and restart after a completed rename. HTTP tests preserve
security/method/body precedence, session availability, safe native codes/messages,
true-idle versus other-kind conflict, and manual preflight reuse without admission.

PR #99 review correction: loss of the currently reserved job file now returns the
sanitized recovery 500 on the first exact GET or DELETE, rather than latching the
server but returning 404. Recovery retains the reserved identity for subsequent
GETs even after worker cleanup; unrelated missing identities remain ordinary 404s.
Regression fixtures remove an accepted job file before worker startup and during
an in-flight fetch, verifying abort, no later dispatch/write/requeue, and no false
idle response. Proved terminal release still removes the reservation.

Browser coverage includes retained confirmation, manual retry and preflight expiry,
cross-kind/initialization failures, last-known state, no automatic mutations, halted
reads through visibility/tab/ticker changes, and explicit full-reload recovery.
All data and requests are local synthetic fixtures, not entitlement/source smoke.

| Validation | Result |
| --- | --- |
| coordinator, native job artifact, shared session and API focused tests | 68 passed, 0 failed |
| `bun test` | 1063 passed, 0 failed, across 87 files |
| `bun run typecheck` | same Windows Bun launcher failure before compiler execution |
| `bun node_modules/typescript/bin/tsc --noEmit` | passed using the installed compiler |
| `bun run test:dashboard-browser` | 80 passed, 0 failed (76 inherited + 4 DR-C1 journeys) |
| `git diff --check` | passed; only the checkout's LF-to-CRLF conversion warning |
| merged DR-T1 main CI | passed for `dd4c593e3538828a843db024b136a36f931905d5` |

PR #99 subsequently passed independent re-review and canonical test/typecheck CI.
Local direct-compiler success does not replace the canonical CI command.

### 7.4 Merged DR-A1 predecessor evidence

The repository suite exercises literal root/input golden preimages and digests,
closed target/calculation/role sets, forbidden volatile fields, date rollover,
maximum-provider fetch time, original-byte reuse, concurrent calculation collisions,
receipt identity/digest/no-replace, A-B-A, delayed completion, and two actual Bun
processes completing in reverse admission order. Strict reads cover unknown fields,
duplicate JSON keys, invalid UTF-8, corruption, orphans, exact receipt associations,
path/junction containment, stale/corrupt/missing caches, pre/post-link failures, and
preservation of unowned private temps. No external API is called.

Enumeration measurements on this Windows checkout were 1.35 ms / 1.47 ms / 19.49 ms
for 1 / 256 / 10,000 receipt filenames respectively (one focused run, not a latency
guarantee). Each latest read enumerated the complete set despite a warm cache, but
read only the newest proved group. This is O(total filenames) enumeration plus
ordering, not a constant-time lookup. With time/byte budgets available, 255 corrupt
references plus one valid receipt recover at exactly 256; 256 corrupt references
before the valid receipt fail with `artifact_recovery_bound_exceeded`. Separate
tests enforce the 256 MiB and two-second bounds. Repeated content references do not
skip receipt validation or conflict checks.

PR #100 subsequently passed independent review and canonical test/typecheck CI for
exact head `cba378b97833ab3f29d741a335abedc0b6512b8c`, then merged as
`268b08660118f50033068d6ba608ebf5792c60ca`. DR-T0 remains unresolved regardless
of these synthetic storage results.

| Validation | Result |
| --- | --- |
| new source-contract/repository tests | 42 passed, 0 failed |
| `bun test` | 1105 passed, 0 failed, across 89 files |
| `bun run typecheck` | same Windows Bun launcher failure before compiler execution |
| `bun node_modules/typescript/bin/tsc --noEmit` | passed using the installed compiler |
| `bun run test:dashboard-browser` | 80 passed, 0 failed; unchanged Dashboard journeys |
| `git diff --check` | passed; only the checkout's LF-to-CRLF conversion warning |

### 7.5 Merged DR-O1 evidence

The merged DR-O1 tests exercise the closed job schema and transitions, 65,536-byte native
record boundary, create/replace proof outcomes, strict inventory/temp cleanup,
single and partial module completion, one root `checkedAt`, prior-observation
retention, valid zero, both ETF persisted-unavailable reasons, job-wide deadline
without publication, cancellation before publication, and single/multiple startup
recovery boundaries without source replay. An ambiguous terminal
record write after a committed receipt retains a validated in-memory completion,
adds `job_record_write_failed`, and keeps the process-wide admission barrier latched.

Independent review of the prior candidate found four MAJOR contract gaps. The
merged implementation derives and canonically orders every persisted module warning,
rejects missing or extra artifact-derived warning codes during startup recovery,
treats proved receipt-free create-only publication failures as ordinary per-module
`artifact_write_failed` results, preserves an earlier module-specific failure when a
later job-wide stop occurs, and distinguishes a deterministic infeasible schedule,
a local attempt ceiling, and a provider-reported rate limit. Synthetic ENOSYS,
EXDEV, and EPERM link failures cover no-receipt failure, partial completion, and
prior-observation retention without performing external I/O.

The next independent review confirmed those four fixes and found four additional
whole-job adjudication gaps. The merged implementation treats valid page, row, and byte
ceiling overruns as job-wide stops, records the first received overrun instead of
understating progress, and publishes no previously prepared module. A real
execution-budget abort is `source_timeout`, while cancellation and recovery retain
their separate paths. Schedule infeasibility now retains any prior authoritative
observation and fallback warning. Schedule-infeasible and all-source-failed terminal
writes reread the durable state under the coordinator lock, so a concurrent DELETE
finishes cancellation rather than becoming a false storage-recovery latch.

Read/API coverage verifies the fixed six-module ordering, `not_implemented` and
`not_collected` distinction, configured-secret rejection, empty-registry GET 404 and
POST 400, shared Host/Origin/CSRF enforcement, strict/size-bounded JSON, exact
methods, active/exact/cancel routes, and unchanged Analysis-domain public error
codes. Default server composition shares one session and registers both native job
adapters before initialization. All module/source behavior is synthetic; no test or
runtime path in DR-O1 contacts J-Quants.

| Validation | Result |
| --- | --- |
| new/extended DR-O1 tests | 56 passed, 0 failed |
| `bun test` | 1162 passed, 0 failed, across 94 files |
| `bun run typecheck` | same Windows Bun launcher failure before compiler execution |
| `bun node_modules/typescript/bin/tsc --noEmit` | passed using the installed compiler |
| `bun run test:dashboard-browser` | 80 passed, 0 failed; unchanged Dashboard journeys |
| `git diff --check` | passed; only the checkout's LF-to-CRLF conversion warning |

PR #101 received an independent `Mergeable` review for exact head
`1a48177bf12987d7ecce82832f5068e64767a9bd`, with zero BLOCKING/MAJOR findings and
canonical test/typecheck CI green. The remaining MINOR noted the stale validation
counts in this handoff and PR text; this DR-T0A candidate corrects the handoff with
the exact-head evidence. Following user authorization PR #101 merged on 2026-09-04
as `6d9f5eda377fa1c474d77904ae111715599d5ac4`, and local `main` was fast-forwarded to
that exact commit before creating:

```text
feat/dashboard-current-code-contract-step0
```

### 7.6 Current DR-T0A candidate

DR-T0A synchronizes `docs/SPEC.md`, the normative Dashboard Refresh plan, and this
handoff around the user-approved `current_code_only` boundary. It adds no source,
runtime, dependency, fixture, credentialed smoke, artifact migration, route, UI,
Usage, or setup change. Its required validation is document consistency, complete
removal of operative lifetime claims, `git diff --check`, the unchanged canonical
unit/typecheck suite, and confirmation that normal tests perform no external I/O.

The first independent review of PR #102 at exact head
`9d6e63896a5ed4e140e45cacd26d8cb5692d9783` found two MAJOR ambiguities and one
MINOR boundary error. The amended candidate resolves them by freezing
`current_master_expectation_v1` with exact Technical/1321/2633 code-product-market
rules, defining `CoName` as a validated source label rather than an equality
predicate, ordering every master rejection, defining the exact ETF empty/all-null/
one-sided/no-common-date artifact and receipt behavior, and moving a February-29
ten-year `queryFrom` to March 1 rather than February 28. It also distinguishes the
prohibited trading/decision signal use from the Technical MACD `signal` series.

The second independent review at exact head
`1a68a1fe5af82174140e9af81395c48563fd6135` confirmed all three earlier fixes and
found one MAJOR warning-digest ambiguity plus one MINOR false-positive boundary. The
relative ETF had two independently available `sourceCoverageFrom` values but only
one singular warning template, and a raw date comparison mislabeled an ordinary
weekend/holiday start as clipped. This candidate resolves both without changing the
warning schema: clipping now requires a proved official session in
`[queryFrom, sourceCoverageFrom)`, and the relative module has one exact fixed-order
message containing both 1321/2633 dates or the exact `観測なし` token. Literal
golden cases cover unequal starts, either side clipped, one side unavailable, neither
side clipped, and non-session query starts so artifact bytes and digests are unique.

| Validation | Result |
| --- | --- |
| source-of-truth consistency search | passed; remaining lifetime terms describe only the retired/superseded contract |
| `bun test` | 1162 passed, 0 failed, across 94 files |
| `bun run typecheck` | same Windows Bun launcher failure before compiler execution |
| `bun node_modules/typescript/bin/tsc --noEmit` | passed using the installed compiler |
| `git diff --check` | passed; only the checkout's LF-to-CRLF conversion warning |

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
- DR-C1's merged shared session/coordinator guarantee is limited to one running
  Dashboard process. A recent
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
- Current-code history deliberately cannot detect a code reuse, relisting, or
  instrument change that leaves no missing official-session row. End-date master
  identity and complete post-start coverage reduce malformed/incomplete-source risk
  but do not prove historical identity. The warning is permanent, and these artifacts
  cannot feed Phase 4 validation, backtests, scores, trading/decision signals, or
  recommendations.
- A whole-Dashboard visual migration can regress focus, overflow, or semantic states;
  the staged V1-V3 split and required width matrix are merge gates.

## 9. Maintenance boundary

Update this handoff only at an explicit Dashboard Refresh recovery or delivery
boundary. Recheck source revisions, migration outcome, plan entitlement, branch, PR,
CI, review, merge, and local `main` directly every time.
