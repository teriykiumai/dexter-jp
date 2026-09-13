# Stock Workspace Contract and Migration Plan

**Contract:** `stock_workspace_plan_v1`

**Date:** 2026-09-12

**Status:** Step 0 merged in PR #113; Step 1 SQLite foundation merged in PR #114; Step 2A library merged in PR #115 with its cross-date identity gate still open. Step 3 is an implementation candidate; later steps require their own implementation, validation, review and merge.

## 1. Authority and migration boundary

This plan makes a Snapshot-independent Stock Workspace the primary local Dashboard.
It follows `AGENTS.md`, `SPEC.md`, root `DESIGN.md`, and `REVIEW_POLICY.md` in their
respective domains. It supersedes only the presentation, data ownership, and new-job
contracts explicitly listed below; inherited financial, source, security, and
historical contracts remain binding. The implementation baseline is main
`32e5ff0571fc19c16b8cf2a6979647fa282de802` (DR-E2).

| Existing contract | Workspace change | Preserved boundary |
| --- | --- | --- |
| Phase 1.5 Snapshot-fed/read-only Dashboard | Independent Workspace reads and guarded state/data/AI mutations | Snapshot V9 writer, V1-V9 readers, identifiers/digests, saved history and GET-only `/api/analyses/*` |
| Dashboard Refresh seven tabs, Market Overview and Market/Sector | Chart-first Workspace with supply/demand, financial/dividend and AI supporting regions | Reuse source adapters, artifacts/receipts, exact-data access and financial engines |
| Peer Comparison/Radar UI | Remove from new Workspace and its AI inputs | Existing CLI, Snapshot fields and historical readers remain compatible |
| Strategy Validation UI | Retire its Dashboard entry during cutover | Engine, CLI, run/history readers, API and shared job safety until dependencies are explicitly detached |
| No Dashboard DB in Dashboard Refresh | Add local `bun:sqlite` for mutable Workspace state | EOD artifacts and auditable analysis remain immutable; no ORM/server/new runtime |
| Snapshot analysis output for Dashboard | New `AnalysisRunArtifactV1` for Workspace AI | No Snapshot V10, rewrite, backfill or reinterpretation of historical snapshots |

These are target contracts, activated by their owning runtime steps. Step 0 changes
only `SPEC.md`, `DESIGN.md`, `DASHBOARD_REFRESH_PLAN.md`, and this file. It changes no
AGENTS, review policy, source code, DB, executable migration, dependency, UI or live
source. Historical plans retain their meaning for legacy compatibility; their old
UI requirements do not require restoring retired surfaces in the new Workspace.

## 2. Responsibilities and reuse

```text
explicit catalog/data action -> existing bounded source clients / job coordinator
                            -> typed normalized inputs -> deterministic engines
                            -> immutable artifact + observation receipt
                            -> identity-checked SQLite binding commit
local search / open          -> instrumentId Workspace + preferences / Drawings
Workspace GET                -> eligible exact saved references -> chart / metrics
explicit AI action           -> freeze exact typed saved input -> restricted Agent
                            -> immutable AnalysisRunArtifactV1 -> saved history
```

The Browser presents server-calculated financial data. Drawing coordinate transforms
are presentation operations, not financial calculation. Search/open/interval change,
navigation, restore and metric recalculation never fetch market data or invoke an
LLM. Polling is limited to active local jobs, subject to existing visibility rules.
Data and AI failures do not disable reading charts or saving Drawings.

| Existing module | Disposition |
| --- | --- |
| `src/analysis/market-data/repository.ts`, `repository-files.ts`, `artifact-codec.ts`, `contracts.ts` | Reuse create-only publication, canonical digests, exact receipts and bounded recovery; extend via versioned codecs |
| `src/analysis/market-data/technical-source.ts`, `technical-source-gate.ts`, `technical-series.ts` | Reuse transport, official-session validation and calculations; add V2 identity/basis evidence |
| `src/analysis/dashboard-jobs/coordinator.ts`, Market Data job service/repository | Reuse rate/admission, cancellation and ambiguous-publication safety; extend Workspace jobs explicitly |
| `src/dashboard/web/technical-panel.tsx`, chart components, primitives and design tokens | Adapt Snapshot-independent composition; reuse installed Lightweight Charts and accessible exact tables |
| `src/tools/finance/*short*`, `supply-demand-engine.ts`, `advanced-dividend-engine.ts` | Reuse typed source and calculation semantics; add saved Workspace inputs, no LLM meta-tool fetch path |
| `src/agent/agent.ts`, model connection | Reuse loop/connection with frozen-input profile and restricted tools; no general research collector |
| `src/analysis/snapshot/*`, `src/analysis/strategy-validation/*` | Preserve legacy writer/readers, CLI and audit engines/history |
| New Workspace persistence/API/Drawing and AnalysisRun modules | Add in owning steps; no parallel EOD repository or duplicate indicator formulas |

`market_short_ratio` exists as a Market Data contract, not a production collector.
Market-wide short selling is new mandatory later work (SW-M0/M1), not a relocation
of an already implemented module.

## 3. Instrument identity, Artifact scope and binding

### 3.1 Catalog and identity episodes

`instrumentId` is an opaque stable local identity, not a ticker-derived primary key.
Provider codes have dated mapping episodes, revision and evidence. Names are display
labels, not identity proof. Code reuse, delisting/relisting or unproved continuity
must not merge identities. Preserve `current_code_only` and
`historical_identity_unverified` whenever only a dated current master is verified.
Neither a current name nor the first available price proves an instrument's lifetime.

Catalog refreshes get a durable monotonic requested generation. Stage and validate
the complete result before activation. Activate only the still-desired generation,
with a nondecreasing source effective date, in one transaction. Late older jobs are
superseded; they cannot revert labels, mappings or active/deleted state. A failed
new refresh preserves the last accepted catalog and exposes failure. Never infer
delisting from an incomplete master response.

On explicit collection acceptance, persist the exact `instrumentId`, provider/code,
mapping revision, catalog generation, master evidence and requested coverage in the
job. Recheck dated source identity before accepting bars and before publication.
Clip known conflicting identity episodes out of both displayed prices and indicator
inputs before calculation. Where continuity is unproved, a conservative eligibility
floor is the first verified episode observation, not an invented listing date.

### 3.2 Scope is ownership, not a Workspace selection

| Scope | Scope identity | Examples and allowed references |
| --- | --- | --- |
| `instrument-owned` | exact instrumentId and verified provider mapping episode | OHLCV, company fundamentals, issuer/public institutional short positions, dividend; no automatic assignment to another instrument |
| `sector-scoped` | provider/classification scheme + sector code + definition version | Sector short-selling turnover/ratio; multiple companies may reference the same exact artifact |
| `market-scoped` | named market universe + coverage registry/definition version | Total-market short-selling turnover/ratio; multiple Workspaces may reference the same exact artifact |

Shared references must match scope identity, effective date/period, source definition
and calculation version (including exact coverage-registry digest). A sector link
also records dated membership evidence for the selected instrument. A company moving
sector does not rewrite a previous analysis or relabel historical context as current.
Unknown membership is unavailable. References to shared context never transfer
artifact ownership to the company; shared artifacts have no fabricated instrumentId.

For instrument-owned artifacts, both receipt and artifact identity are protected
against automatic assignment to different instrumentIds. For shared artifacts,
deduplication is by the shared scope contract; many Workspace reference edges are
allowed. Scope validation is mandatory in readers, writers and restore validation.

### 3.3 Legacy eligibility and exact reference resolution

An exact reference includes artifact kind/version, root-relative identity and digest,
and the exact receipt identity/digest where applicable. A digest alone without its
required immutable input is not reproducible provenance. Never implement Workspace
resolution as `instrumentId -> ticker -> ticker latest`.

Legacy V1 files remain unchanged. A separate binding may adopt a V1 artifact only
when retained dated master evidence can reproduce its canonical source identity and
stored `security_master` input digest, uniquely identifies the instrument episode,
and its coverage does not conflict with another identity. Missing evidence means
`identity_unverified`/unbound legacy data, not guessed adoption. Apply the same
eligibility boundary to historical analysis inputs; ticker-matched Snapshot/AI
history is never automatically imported into a Workspace. Original legacy readers
continue to read it in its original context.

Workspace current data resolves only among accepted, scope-correct eligible bindings,
using the inherited receipt ordering and tie/corruption rules within that set. A
later catalog observation does not rewrite accepted history; a newly identified
identity conflict makes the affected current selection require review. It never
retargets an accepted binding to another identity.

### 3.4 Binding commit is an identity transaction

The file repository and SQLite are not one atomic transaction. Use this sequence:

```text
persist frozen job identity -> source validation -> pre-publication revalidation
-> publish immutable artifact and exact receipt
-> verify exact publication proof
-> BEGIN IMMEDIATE SQLite transaction
-> compare frozen instrumentId / provider code / mapping revision / catalog generation
   with the current active mapping, and validate scope, coverage and job ownership
-> insert binding and update the job/current-data state only if all predicates match
-> COMMIT
```

All catalog/mapping writers use the same database transaction discipline, so a
writer cannot change the mapping between the in-transaction check and commit. Use
an equivalent guarded insert/CAS if needed and require the expected affected-row
count. A pre-transaction check alone is insufficient. No network or LLM call is made
inside the transaction. Shared-context reference commits apply the corresponding
scope predicate and dated membership evidence, rather than issuer ownership.

On mismatch, do not confirm a binding/current pointer. Preserve the immutable files,
do not rewrite them, reassign to another instrument, or fall back to ticker latest.
Expose `identity_review_required` with catalog-refresh/identity-review guidance.
Durably record the unsuccessful finalization without fabricating data success.

Normal finalization and crash recovery use the same predicate and the same frozen
job identity; never resolve instrumentId anew from ticker on completion. Recovery
first checks for an already committed exact binding, including its immutable dataset:
an exact match is idempotent, a conflicting record is an error. The same artifact /
receipt pair cannot be acknowledged for a different dataset. Same-dataset replay
does not move a newer current pointer backwards. For an uncommitted binding, reapply the current
mapping predicate. Ambiguous receipt publication must be reconciled by exact proof
before binding. Unbound published files may remain orphaned; no automatic deletion,
external refetch or LLM replay is implied by recovery.

## 4. SQLite foundation and persistence lifecycle

Use `bun:sqlite`, local single-user/single-writer operation, FK enforcement, bounded
transactions and optimistic revisions. Use WAL with `synchronous=FULL`; verify the
runtime SQLite version and applicable durability fixes in Step 1 rather than relying
on package metadata or an in-memory probe. No ORM or dependency change is required
by this contract. Storage is under the existing local-only `.dexter/` boundary.

The following are logical tables; Step 1 supplies reviewed DDL and migrations.

| Table | Key / important fields / indexes | Lifecycle |
| --- | --- | --- |
| `instruments` | instrumentId PK; type/status/current label | Stable identity; referenced identities are not cascade-deleted |
| catalog generations/observations | generation PK; requested/active state, effective date, exact master evidence | Staged activation; preserve evidence used by mappings |
| instrument mappings | mapping ID PK; instrumentId FK, provider/code, episode dates, revision, evidence ref; provider/code/date index | Revisioned episodes; no ticker-based merging |
| `workspaces` | instrumentId PK/FK; lastOpenedAt, favorite, revision; recent index | Created on open, never on search suggestion |
| `chart_preferences` | instrumentId + chart family PK/FK; interval, indicators, panes, revision | Versioned supported settings; URL interval has navigation precedence |
| `drawings` | drawingId PK; instrumentId FK, swing/intraday family, kind, market anchors, levels, basis/evidence refs, revision; owner index | Durable user work; no deletion by data refresh or instrument disappearance |
| `artifact_bindings` | bindingId PK; scope identity, exact artifact/receipt refs, frozen mapping/job evidence; scope/date index | Append-only accepted identity evidence; issuer uniqueness applies only to instrument-owned scope |
| Workspace shared-context links | instrumentId + role + context selection; exact binding and membership refs | Reference shared ownership, never issuer reparenting |
| `data_sync_state` | scope + dataset PK; current binding/ref, status, checkedAt, dataDate, failure | Queryable projection with explicit unavailable/uncollected states |
| `analysis_jobs` and history index | jobId/runId PK; instrumentId, profile, frozen input refs/digest, state, exact result ref; owner/time index | Durable job evidence and immutable result index; no automatic LLM retry |
| Workspace data jobs | jobId PK; frozen identity and publication references | Cooperate with existing job authority; do not create competing completion truth |
| minute day revisions / `minute_bars` (Step 10) | immutable revisionId; bars PK(revisionId, timestamp), instrument/date and range indexes | Versioned canonical 1-minute batches; see section 9 |

FK and reference validators cover polymorphic external references as well as SQL
FKs. Cross-instrument mutation is rejected. Writes carry the expected revision;
conflicts return 409 and never silently overwrite a newer Drawing/preference.
Uncommitted edit/save-failure state remains visible and recoverable in the UI.
Undo/redo writes use the same revision checks; they cannot overwrite another tab.

### 4.1 Backup reference closure

Backup scope is **the dependency closure of every persistent reference retained in
the restored DB**, not just Drawings and saved AI analyses. Roots include all retained
records in `artifact_bindings`, `data_sync_state`, `analysis_jobs`, catalog/mapping
evidence, shared-context links, Drawings, preferences with references, and any other
exact artifact/receipt/input reference introduced by the schema.

For each root, recursively include every required exact artifact, receipt and
immutable typed input, including receipt-to-artifact edges, analysis frozen inputs,
Drawing basis evidence, identity/membership evidence, and referenced minute revisions.
Include the actual stored payload as well as digest/version; copying only the latest
artifact or a digest is insufficient. Deduplicate shared objects by exact identity.
Only retained normalized non-secret input is eligible; never package credentials or
raw authenticated requests as provenance.

The backup manifest records schema/backup policy versions, DB digest, root/reference
inventory, each included object's kind/relative identity/digest and dependency edges,
and any permitted omission/restore transformation. Each new persistent-reference
field must join this inventory before its schema can be backed up. Unknown versions,
unclassified reference fields, absent required objects or digest/scope mismatches
fail the backup/restore check; do not report a complete backup.

Initial policy includes all bound EOD data and all Drawing/AI dependencies, even if
there are no Drawings or analyses. Disposable derived caches (`latest.json`, search
indexes or reproducible projections) may be omitted. An omitted referenced cache
requires a versioned transformation on the exported/restored DB copy that clears its
live reference and marks the dependent availability `unavailable` with an omission
reason, or `uncollected` when it has not been collected. An audit identifier may be
retained only as explicitly non-resolvable omission metadata, not a live reference.
Do not silently replace it with another latest artifact. Never omit a dependency
needed to reproduce durable Drawing or saved AI history. Do not mutate the source
DB/history to make a backup pass.

### 4.2 Backup/restore operation and recovery

Initial backup uses explicit offline maintenance with the server stopped and all
writers quiesced. Export to a new staging DB using a SQLite-consistent snapshot
operation (`VACUUM INTO`), validate integrity/FKs/schema, copy the closure and verify
the manifest before marking the package complete. Never specify copying only the
main file of a live WAL database. Partial copies are not successful backups.

Restore is also offline: validate package paths/digests, schema, SQL FKs, complete
external-reference closure and scope/identity in staging, apply only declared cache
transformations, then activate with rollback/recovery retaining the previous DB.
Interruption must leave either the old installation or a fully validated restored
installation recoverable, never silently mix their references. Restore preserves
instrumentIds, Drawing IDs/anchors/revisions and exact analysis inputs/results.
It does not reassociate by ticker, search global latest, fetch missing objects or
resume LLM jobs. Restored jobs follow the normal local reconciliation contract.

Step 1 must test real file create -> write -> close -> reopen -> identical records;
transaction rollback/FKs/revision conflicts; migration failure without loss of the
previous DB; child-process crash/restart before and after commit; backup/restore
with a WAL-resident committed write; and missing/corrupt dependency rejection.
Committed Drawings/preferences survive process crashes. Uncommitted writes must not
appear committed. Filesystem/hardware durability assumptions are recorded; do not
claim that an in-memory probe proves disk recovery. Protect irreplaceable Drawings
ahead of replaceable market caches.

### 4.3 Step 1 implementation boundary

`src/analysis/workspace/` supplies schema V1, the local repository, explicit codec
registration, reference inventory and offline backup/restore. V1 implements the
ordinary-stock/daily storage primitives; source job orchestration, full Drawing
operations/basis comparison, AI execution and intraday fields belong to their later
steps and versioned schema changes. It does not connect a Dashboard route or fetch
data. Root directories and codec implementations are trusted local caller inputs,
not accepted from HTTP requests or backup contents.

Object references authenticate exact stored file bytes with SHA-256. They do not
replace the existing Market Data artifact/receipt semantic digests. Reviewed,
source-specific codecs must validate those formats and enumerate their complete
dependencies before Step 2A can register real source data; Step 1 tests use a closed
fixture codec. There is no permissive default codec. Backup policy V1 includes every
registered object and permits no referenced-cache omissions or transformations.

Every persistent object resolves through one Workspace-relative archive:
`objects/<objectKey hex>.json`, with layout `object-key-v1` persisted in
`workspace_meta`. Registration imports verified exact bytes into this archive before
committing their registry rows. Source-relative `path` remains part of the exact
reference/provenance, not an external root locator; different references with the same
source-relative path have different object keys. Normal resolution, backup and restore
use this layout without caller-supplied root mappings. After relocation, new imports
may depend on archived old inputs without needing the old source directory. Missing
registered bytes fail closed, even if the original source still has a copy.

Archive publication writes and fsyncs a private file in the destination directory
before taking the SQLite writer lock. Under that lock, an exact existing final is
idempotent; a corrupt final with a registered row fails closed; only an unregistered
incomplete final may be renamed to a unique quarantine path. Atomically rename the
complete private file to final before committing registry references. All importers
use this guard. Crashed private/quarantined files are unbound inspection material,
never canonical input or backup roots, and are not automatically garbage-collected.
Shared-context `role` is the binding dataset in V1: link writes and backup/restore
validation require equality. No arbitrary role/dataset mapping is supported.

This is generic dependency retention for persistent references, not a parallel EOD
repository: existing Market Data collectors, artifact/receipt formats and publish
authority remain unchanged. The archive has no fetch, recomputation or ticker/latest
selection. Step 2A supplies the reviewed codecs and imports only exact published input.

Reference registration is awaited and bounded: yield during file/codec/dependency
validation and archival copying, then commit dependency-ordered batches of at most
16 objects. Each committed row has durable bytes and committed dependency closure.
Interrupted ingestion may retain verified unbound objects; it cannot activate a
partial catalog or binding. The responsiveness fixture measures registration of new
10,000-row evidence sets through catalog activation alongside foreground operations.
Offline full-package validation remains synchronous under the maintenance contract.
These are pre-merge schema V1 refinements; earlier PR prototype DBs/packages fail the
fingerprint/layout check instead of guessing missing dataset or storage associations.

Maintenance requires all Workspace connections to be closed and the local server
stopped. The implementation uses `VACUUM INTO`, a completion manifest, staged restore,
an exclusive maintenance marker and a preserved previous installation. A failed
marker publication leaves only private staging: the marker at
`<workspace>.maintenance.json` is a directory atomically published with a complete,
fsynced `state.json`. Admission cannot replace an existing nonempty marker directory.
Release first renames the whole marker to a private retired directory, then cleans
up; a crash never exposes a partial live marker. This refines the pre-merge prototype
marker layout; legacy/unreadable marker files fail closed. A failed
restore requires explicit local reconciliation; it never fetches/replays jobs or
silently falls back to another latest object. SQLite files/backup payloads are fsynced;
directory fsync is used where Node exposes it. Windows does not provide directory
fsync through this API. Process-kill recovery tests therefore prove process-crash
behavior on the tested local filesystem, not power-loss/hardware durability on every
filesystem. Network filesystems and concurrent unmanaged SQLite writers are outside
the offline maintenance contract.

## 5. EOD chart and Drawing basis

Step 2A implementation boundary: ordinary-stock catalog/EOD server library, without
Dashboard routes/UI (Step 3) or Drawing interaction (Step 4A). An optional Workspace
domain joins the same Dashboard coordinator before initialization; existing two-domain
servers remain valid. Native jobs persist frozen identities and exact retained inputs
in SQLite schema V2. Validate the V1 fingerprint before additive migration; V1 backup
packages remain readable and restored DBs migrate on writable open. Reference closure
includes all Workspace job object columns. An unresolved `publishing` job blocks a
complete backup until exact publication reconciliation, never triggers a source replay.

The initial ten-year EOD/10,000-Drawing experiment measured a 17,587.54 ms maximum
server event-loop wait, failing the <1s acceptance. Accordingly the implementation
uses one sequential, short-lived Bun worker for EOD calculation, strict codec
validation and native Market Data publication. Main-thread source dispatch still
uses the shared coordinator; workers do not fetch market data. Job state, admission,
identity revalidation and final binding remain under the main authority. Worker
failure during publication leaves `publishing` for exact recovery, not a retry of
external collection. Offline Backup/Restore still requires all writers quiesced.
The worker returns validated canonical artifact bytes and a small publication proof;
the main writer archives those bytes and commits Workspace references. Large parsed
Technical objects are not cloned back into the main event loop, and the main path does
not reparse the Technical V2 before publication.
The worker opens Workspace SQLite read-only; all Workspace mutation belongs to the
main writer, with the existing 100ms busy bound and no background-writer exception.
The worker experiment passed on Windows/Bun 1.3.14/SQLite 3.53.0 (i7-9700,
15.92 GiB RAM): two ten-year ingestions alongside 10,000 saved Drawings, 59,694
foreground samples; event-loop maximum 50.65 ms, Drawing-save p95/max 3.53/326.64 ms,
search p95/max 0.26/20.93 ms. These are fixture-load measurements, not API latency.

Technical V2 uses the existing Market Data repository and receipt V1 implementation
under `market-data/workspace-v2`, so legacy ticker-latest readers never select V2.
The V2 payload retains normalized raw/adjusted rows, calendar, master and frozen episode
evidence, plus the strict V1 source result for inherited provenance. Only the separately
recomputed eligible result is a Workspace chart projection; retained pre-eligibility
source observations are not chart/indicator inputs. The Workspace receipt envelope
retains the complete exact native receipt and its artifact dependency. Cross-object
validators check that receipt identity, artifact identity and frozen issuer agree.

The initial catalog importer establishes new opaque IDs at the first verified master
observation; it never guesses an earlier listing date. Same-date refresh can update
labels using existing episodes. Its immutable catalog includes the accepted cutoff,
normalized calendar, dated ordinary-master rows and complete source page/count/time
evidence; offline validation recomputes the eligible session from these retained inputs.
Catalog and episode registry metadata use `jquants_dated_ordinary_master_v1` as their
source definition. Their calculation-version field denotes the validated evidence
format (`workspace_catalog_v1` / `workspace_episode_v1`), not a Technical calculation.
Technical input/V2/receipt metadata retain `workspace_jquants_eod_v1` and
`technical_chart_calculation_v2`. Catalog metadata takes its source definition directly
from the payload; episode evidence derives from the exact referenced dated catalog.
A later master date does not by itself prove episode
continuity: until independently evidenced continuity is available, such refreshes
return `identity_review_required` and preserve the accepted catalog. This is an explicit
source-identity limitation, not automatic creation/merging of a replacement issuer.
No unverified V1 artifact or ticker-matched history is imported. Subsequent work must
provide reviewed continuity evidence before enabling automatic cross-date catalog
adoption; the first ordinary-stock M1 journey does not require such adoption.
EOD likewise rejects a fetched dated master that differs from its frozen episode
observation. This candidate therefore does not yet enable routine next-session EOD
updates or historical prices before the first verified observation: resolving that
source-identity gate is required before calling Step 2A fully operational.

Reuse the existing EOD source gate, official calendar, cutoff, coverage and technical
calculations. Add Technical Artifact V2 rather than changing V1 bytes. V2 holds exact
instrument/episode/source evidence; raw and adjusted OHLCV with units; dated provider
adjustment-factor/event observations and their semantics; adjustment method/version;
normalized per-session price/basis evidence digests; coverage/calendar input refs;
and calculation version. Do not label provider daily factors as cumulative factors.
Keep the immutable evidence needed for comparison, not only a whole-artifact digest.

Drawing anchors use market time and price, never screen pixels or candle-array
indices. Store creation and last accepted basis/evidence references, adjustment
mode, instrumentId, chart family and evidence window. For a horizontal line or a
ray, the evidence window still includes the period used to establish its basis;
future extension alone does not expand it retrospectively. Swing Drawings share
day/week/month only when compatible; intraday is a separate family.

| Change | Compatibility rule |
| --- | --- |
| New ordinary daily bar; prior price/adjustment evidence unchanged | Keep Drawing, even though artifact digest changes |
| Volume-only correction | Keep price anchors |
| Split or changed historical adjustment basis | Require review when the stored basis is affected; never silently rescale anchors |
| Historical price correction with unchanged basis | Compare affected dates with Drawing anchors/evidence window; disjoint correction keeps Drawing, intersecting correction requires review |
| Evidence absent, overlap unavailable, or old/new basis incomparable | `basis_review_required`; no guessed compatibility |

Save, restore and chart projection validate identity/basis from Step 4A onward.
Review handling in Step 4C adds the complete review UX, not the first safety check.
Until resolved, retain the saved Drawing and expose its review state, but do not
render it as a compatible active overlay on a different basis. User acceptance is
revisioned; original evidence remains auditable. Automatic price conversion is out
of the initial scope.

### 5.1 Ongoing candles and indicators

Show current week/month OHLCV as explicitly unconfirmed ongoing candles. Compute and
display SMA/RSI/MACD only through confirmed complete candles; do not forward-fill the
last indicator into an ongoing candle or show a provisional value as confirmed.
Expose the indicator's own date. Preserve current conservative Gregorian period
closure, including the existing boundary/calendar policy; no exchange-session-end
shortcut is invented in the Browser.

Separate `ongoing` from `history_coverage_clipped`/leading partial and from source
gaps. Completion and coverage are separate state dimensions and may coexist.
Source/schema/calendar failure does not become a normal ongoing candle. Preserve
the existing explicit-gap/unavailable-period rules and fail-closed collection for
unexpected missing sessions, invalid rows or calendar data. Failed refresh retains
the last valid eligible data with a visible warning.

### 5.2 Interaction and preferences

Use installed Lightweight Charts primitives and coordinate conversion APIs with
React-managed edit state; reuse existing series/calculations. Horizontal first,
then trendline, then Fibonacci. Persist canonical anchors once; week/month projection
uses the containing period without rewriting the original daily anchor. Multiple
anchors in one aggregated period may be unrenderable; disclose this and retain the
Drawing rather than inventing endpoint positions. Create/select/edit/delete, drag,
cancel, keyboard numeric editing and touch equivalents arrive in each owning step.
Undo/redo is session-local initially; saved Drawing state survives restart.

## 6. Financial and supply/demand contracts

### 6.1 Dividend and single-company financials

Keep single-company financial/valuation summaries backed by existing typed sources
and deterministic engines. Do not introduce Peer inputs or a dividend history UI.
Display two distinct labels:

- `予想配当利回り`: valid company-forecast annual dividend per share divided by the
  latest eligible **daily close**, multiplied by 100 for percent display.
- `実績配当性向（対象年度）`: source-reported latest eligible full-year actual payout
  ratio, with year/unit/date/provenance. Do not substitute forecast payout or derive
  it from EPS/dividend when the source value is missing.

Yield is a server-side deterministic projection keyed by the exact valid forecast
reference/digest, latest eligible daily price reference/digest, cutoff and policy
version. Use raw daily close on the same currency/share basis as the forecast;
incompatible or unproved split basis is unavailable. Do not divide a current per-share
forecast by an incompatible historical-adjusted close. Respect forecast fiscal year,
disclosure eligibility and replacement/withdrawal; never fill missing annual forecast
from actual dividends or a guessed sum of interim/final values.

Recalculate when daily close, forecast eligibility, correction or basis changes,
without external API/LLM calls. A financial artifact must not freeze the current
display yield. Week/month switching keeps the daily denominator. Valid zero dividend
gives zero yield with a valid positive close; missing/nonfinite inputs or a nonpositive
close give typed unavailable. Preserve source-reported unusual actual payout values
and their warnings, rather than clamping them. Frozen AI analysis retains its original
projection inputs/result, even when the current projection changes.

### 6.2 Three distinct short-selling scopes

| Region | Initial release / later boundary |
| --- | --- |
| Individual instrument: public reported short positions and institutions | Step 5; reuse existing reported-position source/engine; disclosure thresholds and cadence remain explicit |
| Member sector: short-selling turnover and ratio | Step 5; reuse sector source/engine with dated membership and shared scope |
| Whole market: short-selling turnover and ratio | New mandatory SW-M0 source gate -> SW-M1 implementation after initial release; never marked delivered by Step 5 |

Credit long/short balances, ratio, change and days-to-cover reuse their typed source
contracts only where eligible. Unknown current entitlement/changed source schema is
gated; do not silently scrape or manufacture an old cadence. Refresh only explicitly
selected datasets, not every retired Market Overview module.

For market aggregation, freeze the non-overlapping coverage registry, source
definition, effective period and calculation version in SW-M0. Establish whether
special categories (including 9999/ETF/REIT) belong; do not guess them. The numerator
S is the sum of eligible short-selling turnover across that exact universe; the
denominator T is the sum of its short and non-short turnover, with identical date,
units and scope; ratio = 100 * S / T. Never average sector ratios. Missing required
coverage/duplicate constituents produce canonical unavailable, not a subset labelled
whole market. Unrecognized schema/category, incomplete pages, invalid/nonfinite or
negative source amounts fail collection. For T=0, preserve observed turnover and
mark the ratio unavailable. Do not add totals that overlap constituent rows.

## 7. Workspace API, navigation and AI

New routes live in a Workspace domain; legacy `/api/analyses/*` stays GET-only.
Logical operations are local instrument search, Workspace open/load/preferences,
eligible EOD reads, Drawing CRUD, saved financial/supply reads, explicit catalog/data
jobs, explicit AI jobs and exact history reads. Step-specific handlers use versioned
typed request/response schemas, bounded pagination/ranges and revision conflicts.
No GET performs an external fetch or creates a Workspace. Explicit open may create
the Workspace; merely listing a suggestion does not.

Use the canonical instrumentId URL (`/workspace?instrument=<instrumentId>&interval=day|week|month`, superseding the earlier `/stock/:instrumentId` proposal),
with names/codes as labels. URL navigation overrides saved defaults; preferences
supply omitted values. Back/reload/bookmark never retarget a reused ticker. Legacy
ticker links need explicit identity resolution or remain legacy, never silent
redirect to a different security. Recent/favorite, panes and indicators live in DB;
hover, drag preview, dialogs and undo stacks are transient. Browser request races
must not replace another instrument's state.

Initial AI profiles are exactly `fundamental` and `supply_demand`. A new Workspace
AI job **interprets saved input**. Only a user action starts it. At execution start,
atomically select and freeze an exact typed input bundle (including missing states,
scope/membership evidence, data dates, calculation versions and exact dependencies)
before invoking the model; persist it durably. Explicitly expose insufficient inputs
without launching background collection.

Reuse Standard Agent model connection/loop with a restricted profile/tool allowlist.
The job cannot fetch additional market data, invoke the general financial meta-router
or comprehensive research skill, add Peer Comparison, or automatically read Drawings.
No automatic fallback to the unrestricted Standard collector is allowed. Step 7
defines the profile schema/prompt and output validation within these fixed boundaries.

`AnalysisRunArtifactV1` is create-only, provider-neutral and owns runId, instrumentId,
profile/version, frozen input reference/digest, as-of dates, safe model metadata,
interpretation and validated result provenance. Do not persist credentials or raw
secret-bearing prompts/tool arguments. Current chart updates never recalculate old
analysis. History lookup is by exact identity, not ticker. Future explicit Drawing
input is outside the initial profiles.

Persist publication phases. After crash/ambiguous result publication, reconcile the
exact result locally; never automatically repeat an LLM invocation. A model result
that cannot be proven durable remains interrupted/ambiguous, not successful. Another
LLM attempt requires a new explicit user action and a distinct run. AI busy/failure
does not block chart navigation or Drawing writes.

## 8. Security and receipt compatibility

Keep `127.0.0.1` binding, single-user/local-only storage, existing Host/Origin/CSRF,
method/content-type/path containment and safe error contracts. Browser receives no
credential, raw request header or absolute filesystem path. No CORS/public service,
automatic trading, realtime feed, score or Buy/Sell signal is introduced.

Workspace mutations inherit applicable Dashboard admission, bounded external jobs,
rate coordinator, cancellation and ambiguous-publication recovery. Removing Strategy
UI does not remove coordinator checks for existing persisted jobs or relax the
one-external-J-Quants-process restriction. Retain the existing legacy job schemas and
Phase 4 point-in-time rules; do not use current-code-only history for backtesting.

`256` is the latest-recovery **receipt inspection budget**, not a total storage cap.
Receipt count is not capped at 256. A normal valid newest group returns early;
corruption requiring deep traversal may exhaust recovery budgets. Filename enumeration
and sort cost is a separate performance concern. Step 0/initial migration neither
deletes receipts nor increases that budget. Mutable latest caches remain disposable;
create-only content/observation publication, exact digests, tie rejection and visible
corruption fallback semantics remain intact. Workspace identity eligibility further
restricts candidate selection; it never weakens receipt validation.

## 9. Intraday deferred contract (Steps 9-10)

Intraday does not block daily Workspace release. Step 9 must establish official
availability/entitlement, timestamp/timezone, session/lunch/auction semantics,
adjustment and correction/deletion behavior with a separately authorized bounded
source gate. Use only completed sessions, not a realtime feed. Initial requested
range is five trading days, maximum twenty; no all-instrument background collection.

Step 10 stores canonical 1-minute bars and deterministically resamples 5/10/30-minute
bars on the server, respecting session boundaries; do not persist three duplicate
derived series. Opening an uncached range only reports uncollected; fetching requires
an explicit action.

Correction collection is an atomic whole-trading-day replacement of the current
pointer: stage a complete immutable day revision, validate completeness and digest,
then swap current in one transaction. Bars are keyed by (revisionId, timestamp),
not UPSERTed destructively under an instrument/time key. A provider-deleted minute
must disappear from the current revision. An empty day is accepted only under a
verified complete-empty source contract, not from an interrupted response.

Retain actual normalized old bars plus source/calendar/basis definitions, not merely
batch digests. Drawing/analysis pin exact revision sets; a multi-day read freezes that
set so concurrent correction cannot mix generations. Old referenced revisions stay
reproducible and join backup closure. Initial implementation has no automatic GC;
future retention may remove only proven-unreferenced revisions under a reviewed policy.

## 10. Delivery sequence and first milestone

Step 3 adds `/workspace?instrument=<instrumentId>&interval=day|week|month` and a
common-header link. The legacy landing/history routes stay accessible until Step 8.
Unknown/duplicate route selectors fail explicitly; Back and reload preserve the exact
instrument and interval. Candidate search and Workspace GET do not create a recent:
the explicit open POST records it. Favorites use the existing Workspace revision.

The guarded `/api/workspace` adapter shares the process session and coordinator.
GET covers search, recents, session, active/exact jobs and saved instrument charts;
POST covers explicit open, revision-checked favorites and catalog/EOD admission.
DELETE `/api/workspace/jobs/:id` requests cancellation with an empty body. Queued/
running jobs accept cancellation (202) while publication remains preventable;
publishing, terminal or already-activated catalog jobs reject it (409), without
undoing publication. Cancellation invalidates a pending catalog generation even
during yielded import and settles in the inherited `failed` state. The UI exposes
a keyboard/touch-accessible cancel button.
After Host validation, exact-route method matching returns 405 with `Allow` before
mutation authentication or payload validation. Supported mutations then require
Origin/CSRF, query validation and bounded body validation before any side effect.
Host/Origin/CSRF, JSON media type, strict bounded bodies and safe error mapping apply.
All responses use strict versioned runtime DTOs, parsed at producer and Browser
boundaries: `workspace_search_v1`, `workspace_recents_v1`, `workspace_item_v1`,
`workspace_view_v1`, `workspace_chart_v1`, `workspace_job_v1`, `workspace_active_v1`,
`workspace_error_v1`, and the inherited `dashboard_session_v1`. Chart DTO fields are
an explicit projection, independent of the internal Technical Artifact schema.
Unknown fields/versions and malformed nested data fail closed; Browser validation
does not recalculate financial values.
No Drawing API is added before 4A. Interval/pane changes are presentation-only in
Step 3; URL preserves interval, while saved chart-control preferences are deferred.

Chart reads pin the current binding's exact artifact and receipt. A read-only worker
validates both and their evidence closure before returning the eligible projection;
at most one chart-read worker runs with eight admitted reads including the active
read. Errors leave data unavailable without source/latest fallback. Data jobs remain
under the main writer; reads, navigation and polling never initiate external fetch.
Active-job polling runs once per second while visible and latches uncertain reads
until full reload. Late read/open responses cannot redirect or replace a new selection.
Definite 4xx admission refusals preserve status/code and reconcile active state by
GET before enabling a manual retry. They never replay POST automatically. Network,
5xx, malformed/mismatched admission results or failed reconciliation retain the
reload-only latch. Cancellation uses the same ambiguity rule.
Exact-value tables expose all rows in bounded 100-row pages, separate from the full
canvas series. A 2,600-candle browser fixture covers interval/Back navigation and
table reachability; it is a presentation stress fixture, not historical source proof.
Any week/month containing a source-all-null session is typed as `source_gap` and is
excluded from confirmed OHLCV indicator seeds. It is never treated as a normal
ongoing `partial_period`; Browser only renders the deterministic unavailable state.

Each step has its own reviewable diff and inherited regression checks. New names
below identify module responsibilities, not Step 0 runtime additions.

| Step | Deliverable / affected modules | Main risk and acceptance evidence |
| --- | --- | --- |
| 0 | Four contract documents only | Authority/conflict resolution and acceptance mapping; no executable change |
| 1 | Workspace SQLite repository, schema/versioning, catalog/mapping repository, reference inventory, backup/restore foundation | Real-file persistence, migration rollback, crash recovery, FK/revision isolation and full reference-closure fixtures; no live source needed |
| 2A | Ordinary-stock catalog/EOD jobs, V2 codec, binding finalizer; reuse Market Data/coordinator | Dated identity verification, late catalog completion and binding-commit races, original receipt semantics, basis comparator before Drawing |
| 3 | Snapshot-independent search/open/URL/React chart composition | No-key/no-Snapshot startup, day/week/month OHLCV, ongoing/confirmed distinction; keyboard/touch/back/reload/race browser tests |
| 4A | Horizontal Drawing primitive/repository/API | Create/select/edit/delete, save/restart restore, revision conflict and visible save failure; accessible controls and fail-closed basis handling |
| M1 | First ordinary-stock end-to-end functional milestone after 4A | Exact journey below; ETF/REIT and LLM are not blockers |
| 2B | ETF/REIT capability and source gates | May run alongside/after ordinary-stock work; do not generalize 1321/2633 evidence to all funds; explicit unavailable financial/AI capabilities |
| 4B | Trendline, endpoint edit/drag and undo/redo | Coordinate/selection/cancel roundtrips, revision-safe writes, keyboard and touch parity |
| 4C | Fibonacci, day/week/month projection and full basis-review interaction | Levels/anchor projection and correction/split acceptance, no silent coordinate rewrites; accessibility in this step |
| 5 | Saved supply/demand and issuer/sector short inputs/API/UI | No cross-scope contamination; source cadence/missing/zero/provenance tests |
| 6 | Saved single-company financials and dynamic dividend projection | Daily-only refresh changes yield without fetching dividend; source actual payout; split/missing/zero cases |
| 7 | Frozen-input AI jobs, AnalysisRunArtifactV1 and history UI | Profile isolation, no hidden fetch/Peer/Drawing, immutable history and no automatic replay after crash |
| 8 | Initial release/cutover and compatibility cleanup | Ordinary stock + gated ETF/REIT scope, complete browser/visual/security/regression checks; preserve legacy history/CLI/Strategy engines |
| SW-M0 -> SW-M1 | Mandatory post-initial-release whole-market short source gate -> module | Freeze coverage, then validate weighted turnover calculation/shared ownership; not replaced by sector-only display |
| 9 -> 10 | Intraday source gate -> immutable minute cache and chart family | Atomic day replacement, deleted-row correction, old-input reproduction and bounded responsive queries |

M1 must succeed with **no LLM API key and no Snapshot** (EOD credentials/explicit
source action are still required):

```text
Dashboard start -> explicitly fetch catalog if needed -> search ordinary stock
-> open Workspace -> explicitly fetch EOD -> day / week / month
-> Candlestick + Volume -> save Horizontal line
-> server restart -> restore the same Drawing and instrument association
```

Final initial asset scope remains stocks, ETF and REIT; their feature capabilities
are gated separately. Unsupported data is explicit, never inferred from another
asset class. M1 is deliberately ordinary-stock first.

Retire Peer, Market Overview, Market/Sector and Strategy top-level UI in Step 8,
after Workspace replacements are validated. Preserve legacy Snapshot history access
without making it the new landing/input path. First remove navigation/dependencies;
only then remove demonstrably dead UI code. Do not delete shared source/receipt,
Strategy job coordination/API, engine/history or CLI as a side effect of tab removal.

## 11. Acceptance and validation

The following are required runtime acceptance tests, **not claims of Step 0 proof**.

| ID | Required evidence | Owning step |
| --- | --- | --- |
| ID-1 | Same ticker with different instrumentIds never automatically mixes price, Drawing or AI history; unproved V1 stays unbound | 1/2A/7 |
| ID-2 | Insert a mapping-revision change after final pre-publication validation and before binding commit: no wrong binding; also prove that a mapping writer after the in-transaction check is serialized until commit; same predicate on crash recovery | 1 predicate fixtures / 2A integration |
| ID-3 | Older master job completes last: newer active catalog is not rolled back | 1/2A |
| SC-1 | Companies A/B in the same dated sector can reference one sector artifact; A's price/fundamental/issuer-short artifact cannot enter B | 1/2A/5/6 |
| BK-1 | EOD collected, no Drawing, no AI: backup/restore preserves artifact binding, current technical data and instrument association | 1 fixture / 2A end-to-end |
| BK-2 | Backup includes closure from every retained DB reference, including jobs and shared evidence; missing/corrupt dependency fails safely | 1, extended with every reference schema |
| BK-3 | Permitted cache omission clears live pointers and shows unavailable/uncollected; never switches latest; Drawing/AI dependencies cannot be omitted | 1/7/10 |
| DB-1 | Actual file write/close/reopen; before/after-commit crash; failed migration; FKs; revision conflict; WAL-consistent backup and staged restore | 1 |
| DY-1 | Daily price-only update changes forecast yield; week/month denominator remains latest eligible daily close; no API/LLM recalculation | 6 |
| DR-1 | Normal append/volume correction preserves Drawing; split, affected correction or incomparable basis invokes required review | 2A/4A/4C |
| CH-1 | Ongoing weekly/monthly candles visible, indicators only confirmed; source shortage and ongoing are distinguishable | 2A/3 |
| AI-1 | Exact frozen typed inputs, two profiles, no hidden fetch/Peer/Drawing; current update leaves history unchanged; crash never replays LLM | 7 |
| MN-1 | Corrected day removes deleted rows from current, keeps old referenced batches reproducible and backup-complete | 10 |
| RC-1 | More than 256 receipts are stored normally; valid newest resolution returns early; deep corruption budget and enumeration cost tested separately | 2A/8 |
| M1-1 | Complete no-key/no-Snapshot ordinary-stock journey including server restart and Drawing restore | 4A |

Use unit tests for deterministic calculation, identity/scope/basis predicates and
missing/zero/invalid boundaries; repository tests for real-file transactions and
closure; API tests for security/races/explicit actions; browser tests for chart state,
navigation, keyboard/touch, save failure and restart restoration. Run broad inherited
Snapshot/Market Data/Strategy regressions and typechecking for shared contract changes.
Step 0 runs baseline regression/typechecking and checks document scope/references;
these do not prove the future SQLite or UI behavior. Required CI/independent review
remains governed by AGENTS/Review Policy. Each UI step has affected browser tests;
Step 8 additionally requires full Dashboard browser and DESIGN visual QA.

Responsiveness acceptance measures catalog update with concurrent search, Data Job
with Drawing save, indicator calculation with navigation, and (Step 10) large minute
range queries. Initial fixture envelope: 10,000 catalog rows, 10,000 Drawings, ten
years EOD; minute stress: 1,000,000 cached bars with a bounded twenty-session query.
Record hardware, runtime versions, dataset, repetitions and latency distribution.
Warm search/preferences/Drawing-save p95 target <=250ms and max <=1s; minute range
query <=1s; no >=1s chart/navigation stall. These are acceptance targets, not existing
measurements. Bound queries and batch staging/CPU work to yield between chunks;
avoid heavy work inside synchronous SQLite transactions. Introduce workers/processes
only if measurements show the current process cannot meet the targets.

## 12. Remaining evidence gates and Step 1 readiness

Step 2A's diagnostic `src/analysis/workspace/source-smoke.ts` checks the incremental
catalog/raw-price field boundary before production registration. It reuses the
existing bounded Technical smoke transport: three logical queries (calendar from
the first day of the preceding month through the inherited calendar end; all-master
at the resolved eligible session; 7203 daily bars from that first day through the
eligible session), at most 20 requests/pages, 8,000 rows, 32 MiB, 180 seconds total,
30 seconds per request, no retries. Pagination shares those total limits. Run only
with separately authorized `--confirm-external-fetch`; no artifact, receipt, job or
Workspace DB is written. Output is counts, dates and normalized-input digests,
not raw responses or credentials. This proves neither historical instrument
continuity nor a past adjustment vintage, and does not re-prove ten-year entitlement.
Official field references checked 2026-09-12: [master](https://jpx-jquants.com/ja/spec/eq-master)
and [daily bars](https://jpx-jquants.com/en/spec/eq-bars-daily). The master supplies
dated snapshots, not listing/delisting dates or old/new code correspondence.

Authorized live field smoke on 2026-09-12 passed with eligible date 2026-09-11:
3 requests/pages, 4,537 total rows, 1,467,011 bytes; 3,887 ordinary-stock catalog
entries and 29 daily rows for 7203 from 2026-08-01. No non-unit adjustment factor
occurred in that sample. The normalized catalog digest was
`sha256:eb9ce58f3d1a68fbfef3841e7dbe342288a84f6fa734fe81ff582e701970849b`,
daily digest `sha256:88f0e256b84a34d8c75adf41c1dbd8fc7020401dfd2b50b6fcf8d7f98c81882e`.
This closes the incremental field/pagination gate only; it is not historical
identity or adjustment-vintage evidence, and no production Workspace DB was created.

The architecture decisions are closed by Step 0; further general Plan review is not
a prerequisite. Step 1 has the required identity, ownership, revision, reference and
durability contracts and can implement the foundation after Step 0 review/merge under
the existing repository workflow. No live source or LLM key is required for Step 1.

Step 1's repository/backup tests provide on-disk SQLite, migration, process-crash,
WAL backup and closure fixtures; its responsiveness fixture covers 10,000 catalog
rows and Drawings with concurrent local operations. The Step 1 PR records actual
runtime/test results and limitations; merge still requires CI and independent review.

Remaining evidence is scoped to its owning work: Step 2A real-source identity/binding
finalization and V2 basis source evidence; Step 2B ETF/REIT capabilities; source-field/cadence eligibility before
Step 5/6 collectors; Step 7 frozen-input/no-replay tests; SW-M0 exact market coverage;
Step 9 intraday entitlement/timestamp/correction semantics; and the owning runtime
steps' responsiveness/accessibility tests. Existing gates may be reused only for
the exact verified contract/entitlement, never generalized. External smokes require
separate explicit authorization and bounded request/retry budgets. None of those
future source gates is a blocker to beginning the offline SQLite foundation.
