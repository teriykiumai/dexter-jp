# Dexter JP Dashboard Refresh & Market Context Implementation Plan

**Plan version:** `dashboard_refresh_plan_v1`

**Status:** Candidate — requires independent review and merge before runtime work

**Last Updated:** 2026-09-02

## 1. Purpose and authority

This plan refreshes the local Dashboard before Phase 5 without reopening the
completed MVP or Phase 1.5-4 contracts. It has three bounded goals:

1. apply the coherent, accessible visual system defined by root `DESIGN.md` to the
   existing Dashboard;
2. add dated daily, weekly, and monthly technical chart series that the user may
   refresh explicitly from J-Quants; and
3. add a ticker-independent Market Overview built from persisted, source-labelled
   market observations.

The design combines dense analytical layout inspired by Glassnode with restrained
light surfaces inspired by Seline. Those names describe visual direction only. No
Refero, Glassnode, or Seline font, image, code, token, icon, or other proprietary
asset is copied or requested at runtime.

This plan inherits and does not weaken:

- `AGENTS.md` for repository operation, safety, validation, source priority, and
  review;
- `docs/SPEC.md` for deterministic calculation, missing-data, freshness,
  no-look-ahead, AI responsibility, and local-use invariants;
- root `DESIGN.md` as the sole authority for user-facing color, typography, spacing,
  border radius, component styling, and visual hierarchy;
- `docs/MVP_IMPLEMENTATION_PLAN.md` for the completed MVP baseline;
- `docs/VISUALIZATION_MVP_PLAN.md` and `docs/DASHBOARD_UX_PLAN.md` for Snapshot,
  repository, History API, accessibility, and responsive contracts;
- `docs/PHASE2_PLAN.md` for existing technical and market-source semantics;
- `docs/PHASE3_PLAN.md` for Snapshot immutability, canonical JSON/digests,
  Comparison, Radar, and URL-state behavior;
- `docs/PHASE4_PLAN.md` for point-in-time rules, J-Quants runtime bounds,
  same-origin mutation security, job cancellation, and the Validation tab; and
- `docs/REVIEW_POLICY.md` for independent review and the Merge Gate.

This file is the normative plan for Dashboard Refresh. Historical plans are not
rewritten. Where this plan deliberately changes the current six-tab shell or adds a
guarded market-data mutation surface, the change is explicit and applies only after
the corresponding step is reviewed and merged.

## 2. Scope and preserved baseline

### 2.1 Adopted scope

Dashboard Refresh implements only:

- the root `DESIGN.md` visual system and shared primitives across the whole
  Dashboard;
- a seven-tab detail shell and a global Market Overview entry from the Watchlist;
- a pure TypeScript daily/weekly/monthly technical-series engine;
- immutable Technical and Market Overview JSON artifacts outside AnalysisSnapshot;
- explicit, user-initiated J-Quants refresh jobs with persisted results;
- four initial supply/demand Market Overview modules;
- two later ETF price-context modules; and
- setup, usage, handoff, and final validation for those surfaces.

"Latest" in this plan means the latest EOD or published observation available to the
configured source and entitlement. It never means realtime, intraday, streaming, or
an exchange current value.

### 2.2 Preserved baseline

- Analysis Snapshot V9 remains the only Snapshot writer. V1-V9 remain readable.
- There is no Snapshot V10, migration, backfill, or overwrite.
- Existing Snapshot identifiers, canonical digests, `latest.json`, Comparison,
  Radar, Strategy Validation runs, and Analysis API semantics remain unchanged.
- `/api/analyses/*` remains GET-only. Market-data mutations use a separate domain.
- The Browser remains a Presentation Layer. It does not aggregate OHLCV, calculate
  RSI/MACD, normalize ETF prices, calculate market ratios, or repair missing data.
- Existing `analyzeTechnical`, `analyzeStrategy`, and production Snapshot generation
  are not changed by this plan.
- The existing Snapshot reload operation continues to mean local Snapshot reread; it
  is not renamed or repurposed as an external refresh.
- Bun and TypeScript remain the runtime. No Python runtime, Dashboard database,
  framework, or new infrastructure is introduced.
- The server remains local-only on `127.0.0.1`; no login, CORS, cloud deployment,
  or public API is added.
- Normal CI and Playwright make zero external requests.

### 2.3 Interpretation boundary

The new charts and cards report observations. They do not:

- issue Buy / Sell / Hold advice, a new signal, a score, or a general instrument/
  country ranking; the exact ETF label in section 7.8 is only a descriptive sign of
  the selected-period market-price return difference;
- claim that an RSI/MACD event predicts a future return;
- turn an ETF price comparison into a country allocation recommendation;
- represent 1321 as the Nikkei 225 cash index;
- represent adjusted J-Quants prices as total return; or
- combine refreshed current data with a historical Snapshot Comparison as if they
  shared one as-of boundary.

## 3. Source contracts and feasibility gates

### 3.1 Versioned source registry and gate status

Only these versioned source inputs are in scope. `approved` means that an inherited
adapter/source contract exists; it does not waive the step-specific live smoke.
`candidate` means that the source must not be used by a production adapter or public
UI until the named gate replaces the unknown contract with verified facts.

| Source ID | Module / role | Primary endpoint / definition | Registry status | Product gate |
| --- | --- | --- | --- | --- |
| `jquants_v2_equities_bars_daily` | Technical and 1321/2633 EOD bars | J-Quants `/v2/equities/bars/daily` | approved, reverified in DR-T2/DR-E1 | configured Standard-or-higher account |
| `jquants_v2_markets_calendar` | Technical session envelope | J-Quants `/v2/markets/calendar` | approved inherited source, reverified in DR-T2 | configured Standard-or-higher account |
| `jquants_v2_equities_master` | ticker/security identity and instrument basis | the existing J-Quants security-master contract | approved inherited source, reverified in DR-T2/DR-E1 | configured Standard-or-higher account |
| `jquants_v2_margin_tse_aggregate_candidate` | TSE aggregate and 1570 margin quantities | post-migration individual J-Quants margin-outstanding contract | **candidate; DR-M0 only** | individual Standard entitlement is unverified until DR-M0 |
| `jquants_v2_market_short_ratio` | TSE short-selling turnover ratio | J-Quants `/v2/markets/short-ratio` | approved inherited source, exact coverage frozen in DR-M0 | configured Standard-or-higher account |
| `jquants_v2_tokyo_nagoya_foreign_flow` | foreign-investor flow | J-Quants `/v2/equities/investor-types`, `TokyoNagoya` | approved inherited source | configured Standard-or-higher account |
| `next_funds_corporate_action_events_v1` | 1321/1570/2633 basis-event identity | versioned issuer-primary-source registry | approved reference input; changes require review | no provider entitlement |

The whole refresh feature requires a configured J-Quants Standard-or-higher account,
even where an individual endpoint may be available on a lower plan. This is the
product gate, not a claim about each endpoint's minimum subscription. The UI states
the operational requirement next to both refresh buttons. A 403 entitlement failure
is not mapped to missing market data. In particular, a Pro data-catalog description
is not evidence that an individual Standard account can access the new daily margin
source.

Source descriptions and adapters pin the accessed API version, field mapping, unit,
eligibility rule, and source-document revision. Endpoint names, fields, primary keys,
issue-type enums, coverage, or entitlement must not be guessed from a press release
or from J-Quants Pro documentation.

Every artifact carries an ordered `sourceInputs: SourceInputV1[]`. It is a strict
union; provider-only fields are never filled with `N/A` for a static registry:

```text
ProviderSourceInputV1 = {
  kind: "provider", role, sourceId,
  sourceContractVersion, sourceMappingVersion, sourceRevisionIds[],
  endpoint, entitlementClass, entitlementVerifiedAt,
  normalizedQueryIdentity, asOfCutoff, dataDateOrEffectiveRange,
  publishedDate: date | null, publishedAt: instant | null, fetchedAt,
  cadence, unitAndCoverageBasis,
  pagination: { complete: true, pageCount, rowCount }, inputDigest
}

RegistrySourceInputV1 = {
  kind: "registry", role, sourceId,
  sourceContractVersion, registryVersion, sourceRevisionIds[],
  registryId, asOfCutoff, effectiveRange, unitAndCoverageBasis, inputDigest
}

SourceInputV1 = ProviderSourceInputV1 | RegistrySourceInputV1
```

`inputDigest` is `sha256:<64 lowercase hex>` over `CanonicalJsonV1` of that input's
strict sanitized observations plus source/mapping/revision/query/unit identities. It
excludes `fetchedAt`, credentials, headers, cursors, request IDs, absolute paths, and
raw envelopes. `sourceInputs` is sorted by `role`, `sourceId`, then provider
`normalizedQueryIdentity` or registry `registryId`. Duplicate roles or inputs are
invalid. A date-only source publication is stored in `publishedDate`; it is never
converted to midnight and stored as `publishedAt`. `publishedAt` is non-null only
when the source directly proves an instant.

Technical has exactly the roles `security_master`, `trading_calendar`, and
`daily_bars`. The 1321 EOD module has exactly `security_master_1321`,
`daily_bars_1321`, and `corporate_action_registry_1321`. The relative ETF module has
exactly those three roles plus `security_master_2633`, `daily_bars_2633`, and
`corporate_action_registry_2633`. A correction to any input therefore changes the
root source digest even if the bar or margin rows are unchanged.

After DR-M0 replaces the candidate mapping, the TSE aggregate uses
`security_master_population`, `trading_calendar`, `margin_cadence_registry`, and
`margin_rows`. 1570 uses exactly `security_master_1570`, `trading_calendar`,
`margin_cadence_registry`, the same job-level `margin_rows` digest, and
`corporate_action_registry_1570`. Market short ratio uses `trading_calendar`,
`short_ratio_schedule_registry`, `sector_coverage_registry`, and `short_ratio_rows`;
foreign flow uses `trading_calendar`, `investor_type_schedule_registry`, and
`investor_type_rows`. These role sets are closed for V1.

The artifact-level `sourcePayloadDigest` hashes `CanonicalJsonV1` of the artifact
identity, calculation version, and the complete ordered `{ role, inputDigest }`
manifest. `sourceRevisionIds` refer to an allowlisted code registry whose entries pin
the official URL/title/revision/retrieval date in code; artifacts do not accept or
persist arbitrary URLs. Provider `fetchedAt` is the actual fetch instant and is never
backdated. Pagination can only be stored with `complete: true`; an incomplete result
cannot be an input to a canonical artifact.

### 3.2 Primary references

DR-T2 and DR-M0 reverify, rather than merely quote, these official references:

- J-Quants daily adjusted bars and availability:
  <https://jpx-jquants.com/ja/spec/eq-bars-daily> and
  <https://jpx-jquants.com/ja/spec/data-spec>, plus the official update-time guide
  <https://jpx-jquants.com/ja/spec/data-update>;
- J-Quants margin-outstanding migration specification:
  <https://jpx-jquants.com/ja/spec/mkt-margin-int-daily>;
- TSE's conditional effective date for the new margin publication:
  <https://www.jpx.co.jp/english/news/1032/20260706-01.html>;
- JPX Market Innovation & Research's 2026-07-29 contract notice for the new daily
  distribution, which is evidence for a TMI/J-Quants Pro offering but not for an
  individual Standard entitlement:
  <https://www.jpx.co.jp/corporate/news/news-releases/6020/20260729-01.html>;
- TSE's February 2026 change definition:
  <https://www.jpx.co.jp/english/markets/statistics-equities/margin/tvdivq0000001r92-att/vk0khi000000tjvm.pdf>;
- the official J-Quants 33-sector registry, whose exact response coverage still has
  to be frozen by DR-M0:
  <https://jpx-jquants.com/ja/spec/eq-master/sector33code>;
- the issuer definitions for 1321 and unhedged 2633:
  <https://nextfunds.jp/lineup/1321/> and
  <https://nextfunds.jp/en/lineup/2633/>; and
- the issuer's announced 1321 and 1570 split/unit-change events used to seed the
  reviewed corporate-action registry:
  <https://nextfunds.jp/data/2026/td_260825a.pdf>; and
- the issuer's 2633 1:10 beneficial-interest split, effective 2023-12-08:
  <https://nextfunds.jp/en/data/2023/td_en_231031a.pdf>.

### 3.3 DR-T2 Technical source gate

Before Technical refresh is exposed, a manual bounded smoke must prove with the
configured credential that:

1. `/v2/equities/bars/daily` accepts the intended ten-year range on the actual plan;
2. the inherited `/v2/markets/calendar` mapper supplies the exact calendar envelope
   needed to distinguish an elapsed from an in-progress week/month;
3. the security-master mapper proves the ticker/code/instrument identity;
4. pagination for all three inputs is complete and bounded;
5. the strict mapper recognizes the current V2 fields and adjustment semantics;
6. the documented update-time/source revision still supports the exact
   `jquants_daily_bars_eligibility_v1` cutoff;
7. data dates are EOD dates and no future row is accepted; and
8. logs, errors, fixtures, artifacts, and PR text contain no credential, request
   header, request ID, or raw response body.

The smoke is manual, default-No, does not write a canonical artifact unless the user
explicitly chose the real refresh path, and is not a substitute for fixture tests.
It allows at most ten actual HTTP attempts and 180 seconds, with one 30-second
attempt per page and no retry.

### 3.4 DR-M0 margin migration gate

The 2026 margin change is scheduled, not assumed. DR-M0 is a blocking gate and may
merge only after all of the following are recorded from primary sources and a bounded
credentialed smoke:

1. the TSE announces that the 2026-09-27 system migration succeeded;
2. the individual J-Quants Standard specification publishes the exact production
   endpoint, fields, units, pagination, correction, and entitlement behavior;
3. rows dated through 2026-09-24 are verified as the old weekly cadence and rows
   dated from 2026-09-25 as the new daily cadence;
4. the complete TSE population and issue-type meanings are verified against actual
   responses;
5. 1570's unit and identity are verified; and
6. one bounded full-pagination response proves that completeness can be detected.

Until all six pass, the live adapters and public Market Overview cards for modules 1
and 3 stay disabled. Failure of the gate does not permit an unofficial scraper,
J-Quants Pro assumption, synthetic production value, or silent reduction to the old
weekly endpoint. DR-M0 returns the unresolved contract to review and reschedules
DR-M1/DR-M2.

The API's money fields remain out of scope even if a JPX publication includes them.
They may be enabled only after the individual J-Quants response and entitlement are
verified in a separate reviewed change.

DR-M0 uses two separately authorized, default-No live smokes no earlier than the first
scheduled post-migration delivery. The first is a schema/reconciliation smoke: at
most three logical queries, 20 actual attempts including cursors, 10,000 accepted
rows, 32 MiB response bytes, and 180 seconds total, with one 15-second attempt per
page and no retry. It checks one ordinary equity across the 2026-09-24/25 boundary,
1570 across the same boundary, and one complete 2026-09-25 TSE-universe retrieval.
The full-universe unique issue count and long/short totals must reconcile to the
same-date official TSE publication.

The second is a production-shape bootstrap smoke for exactly the latest 26 expected
published observation identities needed by modules 1-4. It fetches the full verified
TSE population for every required margin date, the complete short-ratio coverage for
every required date, and the 26 Tokyo/Nagoya foreign-flow periods. The aggregate and
1570 modules reuse the same full-universe margin input; they must not duplicate the
request. Its hard ceilings are 250 actual attempts including pagination/retries,
150,000 accepted rows, 256 MiB response bytes, and 90 minutes. Each attempt, retry,
and delay uses the Phase 4 coordinator/rate-limit policy, and the first exceeded
ceiling fails the smoke. It does not publish production artifacts.

A 401/403/plan failure, schema mismatch, unknown or duplicate source identity,
missing 1570 row, incomplete cursor chain, unknown sector/issue type, unit ambiguity,
coverage gap, or reconciliation mismatch fails either smoke. If the exact 26-window
bootstrap does not fit its bounds, the gate fails and returns to design review; it
must not shorten the window, reduce the population, or silently seed only the latest
observation.

The gate distinguishes these dates exactly:

```text
last weekly dataDate:       2026-09-24
first daily dataDate:       2026-09-25
conditional migration:     2026-09-27
first scheduled delivery:  2026-09-28
```

The delivery date is not rewritten as the observation `dataDate`. DR-M0 records a
sanitized smoke manifest containing only source-revision IDs, execution time,
entitlement class, normalized request identities, counts, response digests, and check
results. No credential, account ID, header, raw body, or request ID is recorded.

Because the post-migration contract is not yet an observable individual-Standard
fact, DR-M0 must replace the candidate source ID and update this plan in the same
independently reviewed gate PR with: exact endpoint and field mappings; source row
primary key; issue-type enum/population allowlist; short-ratio sector allowlist and
the treatment of `9999`/ETP/REIT rows; aggregate display-unit convention; correction
and vintage rules; the versioned margin/short-ratio/foreign-flow observation-schedule
resolvers including short-week exceptions and the 2026-09-24/25 boundary; complete
pagination proof; and measured production
request/page/row/byte/attempt/deadline caps. That amendment must also prove whether
the source convention permits the stock/ETP/REIT quantity aggregation described in
section 7.2. DR-M1 cannot start until the exact amendment is merged. These are source-
dependent decisions, not discretion left to the DR-M1 implementer.

## 4. Visual and navigation contract

### 4.1 Authoritative design system

Root `DESIGN.md` is the sole Source of Truth for all Dashboard Refresh color,
typography, spacing, border radius, component styling, and visual hierarchy. This
plan intentionally does not duplicate their exact values. External reference sites
describe direction only and never override `DESIGN.md`.

DR-V1 implements the exact tokens and primitives in `DESIGN.md`. Later UI steps reuse
those primitives rather than defining local variants. If measured contrast,
accessibility, usability, or functional correctness requires a visual change, that
step updates `DESIGN.md` in the same reviewed PR before using the changed value; it
does not record an exception only in CSS or this plan.

WCAG 2.2 AA text contrast, 3:1 meaningful non-text contrast, visible focus, safe
coarse-pointer targets, non-color state communication, exact-value access, and no
document-level overflow remain merge gates under `DESIGN.md` and this plan.

### 4.2 Stable tabs

DR-V3 deliberately replaces the current six-tab order with exactly seven tabs:

```text
report          / 概要・レポート
technical       / 株価・テクニカル
fundamentals    / 比較・配当
supply-demand   / 需給・空売り
market-overview / 市場概況
market          / 市場・セクター
validation      / 戦略検証
```

`report` remains the default and `validation` remains the last tab. The first four
existing IDs retain their order; the new global tab is inserted immediately before
the existing `market` tab. Existing Snapshot section ownership does not move:
`investorTypeFlows`, sector data, and all other current sections keep their current
destination. `market-overview` owns no Snapshot section, so its Snapshot availability
badge is always zero unavailable and zero uncollected.

Tab Arrow navigation, Home/End, roving `tabindex`, focus restoration, selected-tab
visibility on mobile, and accessible names use this exact order and label set.

### 4.3 Global route and URL state

The Watchlist/common header links directly to:

```text
/?view=market-overview
```

The Single Stock detail shell uses:

```text
?ticker=<ticker>&tab=market-overview
```

The data rendered by both forms is identical and ticker-independent. The detail
route retains `ticker` only as the current navigation identity and never filters,
labels, or fetches Market Overview by that ticker. The surface always displays
`全市場共通`.

The ETF range is URL-backed on either route:

```text
&marketRange=3m|6m|1y|3y|max
```

`1y` is the default and may be omitted. Range selection pushes History state;
Back/Forward and reload restore the exact valid range.

The route precedence and transition matrix is normative:

| State / action | Recognized-key result | History operation |
| --- | --- | --- |
| valid `view=market-overview` with no detail key | global Market Overview; remove `ticker`, `tab`, `base`, `target`, `validationRun`, `validationCase`, `chartSource`, and `interval` | entry link pushes |
| `view=market-overview` combined with any detail key | scoped route error; dispatch no read/fetch | none |
| valid `ticker` with `view` absent | detail shell; omitted/unknown `tab` resolves to `report` | unknown `tab` canonicalizes with replace |
| neither `view` nor `ticker`, with no orphan owned key | Watchlist | recognized detail/global keys removed on an explicit return-to-list action |
| neither owner, but `tab`/comparison/validation/Technical/range key exists | scoped route error; dispatch no read/fetch | none |
| detail tab change | preserve dormant `chartSource`, `interval`, and `marketRange`; existing comparison/validation helpers retain their inherited ownership | inherited replace |
| ticker change | reset `tab=report`, `chartSource=auto`, comparison, and validation selection; retain `interval`; remove `marketRange` | push |
| interval/source/range selection | update only its owned valid key | push |
| successful matching Technical refresh | set `chartSource=latest` without creating a second navigation step | replace |

In this table, detail keys are `ticker`, `tab`, `base`, `target`, `validationRun`,
`validationCase`, `chartSource`, and `interval`; `marketRange` is valid with the global
owner. Unknown keys are never treated as ownership conflicts.

`chartSource` and `interval` are effective only on `tab=technical`, but remain dormant
through detail-tab changes. `marketRange` is effective only on global or detail Market
Overview and remains dormant through detail-tab changes. Snapshot Comparison keeps
valid Technical keys dormant, fixes the rendered chart to the target Snapshot, and
restores those keys when Comparison ends. Returning to Watchlist or the global route
removes ticker-specific Technical keys. All transitions preserve unknown query keys.

The inherited parsers for `ticker`, `base`, `target`, `validationRun`, and
`validationCase` remain unchanged. The inherited unknown-`tab` behavior also remains:
it resolves to `report` and canonicalizes with `replaceState`, rather than displaying
an error. Only the new `view`, `marketRange`, `chartSource`, and `interval` keys use a
closed enum; duplicates or malformed values produce a scoped error and dispatch no
artifact read or external request. Omitted optional defaults are canonical defaults.
No Router is introduced.

Responsive acceptance widths are 320, 390, 680, 768, 980, 1024, and 1280 px. The
document never gains horizontal overflow; intentionally wide exact tables use a
labelled, keyboard-scrollable region instead.

## 5. Artifact and repository contract

### 5.1 Storage layout

Dashboard Refresh persists normalized data separately from AnalysisSnapshot:

```text
.dexter/market-data/
  technical/<ticker>/<dataDate>/<sourcePayloadDigestHex>.json
  technical/<ticker>/latest.json
  overview/<sourceId>/<dataDate>/<sourcePayloadDigestHex>.json
  overview/<sourceId>/latest.json
```

`sourcePayloadDigestHex` is only the 64-character lowercase hexadecimal portion of
the JSON field `sourcePayloadDigest`; the `sha256:` prefix is never part of a Windows
filename. Ticker, date, source ID, and digest hex are parsed through exact
allowlists/patterns before path construction. Every resolved path must remain under
the configured market-data root. Symlink/reparse-point escapes and absolute/user-
supplied paths fail closed.

The six storage `sourceId` values, in display order, are exactly
`tse_margin_quantities_v1`, `market_short_ratio_v1`, `margin_1570_v1`,
`tokyo_nagoya_foreign_flow_v1`, `etf_1321_eod_v1`, and
`etf_1321_2633_relative_v1`. They identify derived module contracts; external inputs
remain separately identified in `sourceInputs`.

### 5.2 Canonical identity and digest

All canonical files are strict UTF-8 JSON, create-only, and atomically published by
write-to-private-temp, flush/close, and no-replace promotion. A partial temp file is
never a valid revision and is cleaned on failure or startup reconciliation.

`sourcePayloadDigest` is:

```text
sha256:<64 lowercase hexadecimal characters>
```

It is SHA-256 over the complete ordered input manifest defined in section 3.1. It
therefore changes when any bars, calendar, master, corporate-action registry,
mapping/source revision, query identity, unit basis, or calculation version changes.
It excludes `fetchedAt`, credentials, headers, pagination tokens, request IDs,
absolute paths, raw envelopes, and derived display values. The canonical artifact
also carries its own `artifactDigest`, calculated with the inherited canonical-
digest convention over the complete artifact payload excluding only that digest
field.

An equal source payload maps to the same path and is idempotent. `fetchedAt` and
`entitlementVerifiedAt` in the canonical artifact are the instants of its first
successful publication/verification. Before constructing a replacement, a later
equal fetch reopens and fully validates the existing path, confirms its input/root
digests and calculation version, and reuses its original volatile timestamps. The
job view alone reports the new `checkedAt` and `idempotentReuse: true`. A path whose
existing canonical identity/digest/bytes fail those invariants is a typed collision
or corruption; it is never overwritten. A corrected input on the same `dataDate`
receives a different source digest and therefore a new immutable revision. V1
transformation changes that would alter output for an equal source payload require a
separately reviewed storage version; they must not overwrite a V1 path.

### 5.3 Latest pointer

`latest.json` is a mutable atomic pointer, never a canonical artifact. It contains
only schema version, ticker or source ID, dataDate, sourcePayloadDigest,
artifactDigest, fetchedAt, and the root-relative canonical identity. It contains no
absolute path.

The pointer advances only after the target canonical file has been reopened and
validated. Selection order is `dataDate desc`, then `fetchedAt desc`, then
`sourcePayloadDigest asc` as a deterministic final tie-break. An older refresh never
rolls the pointer backward. Rewriting an equal pointer is idempotent.

There is no automatic retention deletion, compaction, or backfill. The initial UI
selects only the latest valid revision; historical revision browsing is deferred.

### 5.4 Strict artifacts and fallback

`TechnicalChartDatasetV1` and every Market Overview module are closed strict schemas.
Unknown fields, invalid dates, non-finite values, inconsistent units, duplicate
canonical output identities, incomplete-pagination claims, digest mismatch, and path
mismatch are corruption, not unavailable market observations. A unique canonical
observation that explicitly records `duplicate_identity` or `missing_expected_row`
detected in a proved-complete source response is valid; it does not persist duplicate
canonical identities.

Repository reads never silently skip corruption:

1. if neither a pointer nor any contained canonical candidate exists, return 404;
2. validate the pointer and pointed artifact when present;
3. if the pointer is absent/invalid while candidates exist, scan only contained
   canonical candidates in deterministic recency
   order and select the first fully valid prior revision, reading at most the newest
   32 date directories, eight revisions per date, 256 MiB total, and two seconds;
4. return that revision with a typed `artifact_corrupt_fallback` warning that names
   only the sanitized artifact identity; or
5. return a typed 500 if candidates/pointer exist but no valid canonical revision
   remains, or the repository itself
   cannot be read safely. Exhausting a scan limit before proving a valid candidate is
   `artifact_recovery_bound_exceeded`; it never returns an unvalidated older file.

For Technical data, explicit `latest` remains an error, while `auto` must display a
valid Snapshot with the same visible warning when no artifact survives; if Snapshot
is also invalid, `auto` is an error. For Market Overview, each unaffected source module
remains available while the failed module retains its prior valid revision and
warning. Fallback is never labelled latest without its actual `dataDate` and
`fetchedAt`.

The Overview endpoint applies that read independently per module. With no canonical
candidate for any implemented module it returns 404. With at least one valid/fallback
module it returns 200: a never-collected sibling is `unavailable/not_collected`, and a
corrupt sibling with no fallback is `unavailable/artifact_corrupt`; neither has an
artifact identity. If every existing implemented module is corrupt and none validates,
the endpoint returns 500 rather than laundering the repository failure as ordinary
unavailability.

Raw API responses, credentials, request headers, request IDs, environment values,
absolute paths, and secret-like values are neither stored nor returned.

## 6. Technical chart contract

### 6.1 `TechnicalChartDatasetV1`

The strict wire shape is conceptually:

```text
TechnicalDailyObservationV1 =
  { kind: "bar", date, open, high, low, close, volume }
| { kind: "gap", date,
    reason: "source_all_null" | "missing_in_complete_envelope" }

IndicatorValueV1 =
  { state: "available", value }
| { state: "unavailable",
    reason: "warmup" | "partial_period" }

TechnicalCrossStateV1 =
  { state: "available", value: "golden_cross" | "none" }
| { state: "unavailable", reason: "warmup" | "partial_period" }

TechnicalCandleV1 = {
  interval: "day" | "week" | "month",
  identity, periodStart, periodEnd, displayDate,
  firstSessionDate, lastSessionDate, partial,
  open, high, low, close, volume,
  rsi, macd, signal, histogram, cross
}

TechnicalUnavailablePeriodV1 = {
  interval: "day" | "week" | "month",
  identity, periodStart, periodEnd, reason: "source_gap"
}

TechnicalChartDatasetV1 = {
  schemaVersion: "technical_chart_dataset_v1",
  ticker, jquantsCode, instrumentName, priceUnit: "JPY", volumeUnit,
  acceptedAt, asOfCutoff, queryFrom, queryTo, eligibleThrough,
  dataDate, fetchedAt, adjustmentBasis,
  sourceInputs: SourceInputV1[3], sourcePayloadDigest, artifactDigest,
  indicatorMethods: {
    rsi: "rsi_wilder_14_v1", macd: "macd_ema_12_26_9_v1"
  },
  dailyObservations: TechnicalDailyObservationV1[],
  series: { day: TechnicalCandleV1[], week: ..., month: ... },
  unavailablePeriods: TechnicalUnavailablePeriodV1[],
  warnings: MarketDataWarningV1[]
}
```

Every omitted ellipsis above means the same closed `TechnicalCandleV1[]` type, not an
open object. Dates are strict ISO calendar dates; instants are UTC ISO instants;
numbers are finite; ticker/code/source/digest/unit values use closed validators.
Warning and unavailable-reason enums are closed and versioned.

The mapper accepts strictly positive adjusted open/high/low/close values with
`low <= open/close <= high`, finite non-negative adjusted volume, a valid official-
session date, and one row per `(code,date)`. Valid volume zero is retained. A source
row whose entire adjusted OHLCV set is null becomes `source_all_null`; a partially
null row is invalid. An absent instrument row may become
`missing_in_complete_envelope` only when the pinned endpoint contract plus completed
pagination proves the queried code/date envelope is complete. Otherwise it is
`source_pagination_incomplete` or `source_invalid_response`, not a gap. Duplicate
rows, a future date, zero/negative price, negative volume, impossible price ordering,
or incomplete source/calendar coverage fails the whole refresh before publication.

`acceptedAt` and `asOfCutoff` are frozen at successful job admission. The source-
eligibility rule is `jquants_daily_bars_eligibility_v1`: when the Tokyo calendar date
is an official TSE session and admission is at or after 16:30:00 JST,
`eligibleThrough` is that date; otherwise it is the latest official session strictly
before the Tokyo calendar date. This boundary is based on the documented target
update time, not a guarantee of completion, and is reverified in DR-T2. If the latest
eligible session is neither a proved gap under the pinned contract nor a valid bar,
the job fails `source_not_yet_updated` and retains the previous pointer.

`queryTo = eligibleThrough`. `queryFrom` is the same calendar date ten Gregorian
years earlier, inclusive, with February 29 clamped to February 28. The daily-bars
query remains exactly the inclusive range `[queryFrom, queryTo]`.
`calendarCoverageFrom` is the earlier of the Gregorian Monday containing
`queryFrom` and the first day of `queryFrom`'s Gregorian month;
`calendarCoverageTo` is the later of the Gregorian Sunday containing `queryTo` and
the last day of `queryTo`'s Gregorian month. The calendar input covers that exact
inclusive range so both leading and trailing partial status can be proved.

`dataDate` is the last actual renderable bar date, never the request end, fetch date,
or a gap date. Publication requires at least one renderable bar in
`[queryFrom, queryTo]`. A proved-complete response containing only gaps fails the
Technical job with `source_no_observation`, publishes no artifact, and leaves an
existing pointer unchanged; when no prior artifact exists, the latest GET remains
404. A gap-only subperiod remains valid when at least one renderable bar exists
elsewhere in the dataset. If the provider cannot satisfy the exact requested ranges
within the DR-T2 bounds, the job fails rather than shortening them.

J-Quants adjusted OHLCV is described as corporate-action-adjusted market price data,
not total return. Source eligibility and the adjustment basis are stored explicitly.

### 6.2 Interval aggregation

Interval IDs and order are exactly:

```text
day | week | month
```

`day` is the default. Each daily `bar` observation is one candle; a `gap` produces
only the exact unavailable-period row defined below. Weekly identity is the Gregorian
Monday date of its Monday-Sunday period; monthly identity is `YYYY-MM`. The candle
display date is the last actual trading session included in that period. A weekly or
monthly candle is aggregated after sorting daily rows ascending:

For `day`, `periodStart = periodEnd = displayDate = firstSessionDate =
lastSessionDate = date` and every admitted daily bar has `partial: false`. V1 never
stores an intraday or partial daily candle. A daily gap has no candle.

```text
open   = first open
high   = maximum high
low    = minimum low
close  = last close
volume = sum of finite volume values
```

No calendar-day bar, forward fill, or zero-price/zero-volume placeholder is inserted.
A period with at least one valid bar produces one candle from only its bars; gaps do
not enter OHLCV or indicators. A day or week/month containing only proved gaps
produces no candle and instead adds one exact `unavailablePeriods` row with
`source_gap`. This keeps a suspension/no-trade interval visible in the exact table
without fabricating a chart point.

A week/month is complete only when its Gregorian period has ended before the Tokyo
calendar date of `asOfCutoff`, the calendar envelope contains every official session
in the period, and its final session is no later than `eligibleThrough`. If the
calendar proves that the first weekly/monthly period contains an official session
before `queryFrom`, the candle formed only from in-range bars is deliberately
`partial: true`; every indicator and cross field is `unavailable/partial_period`, and
that candle is excluded from indicator inputs. This leading-range truncation is not
a source/calendar coverage failure. If no earlier official session exists, the
normal completeness rules apply. A trailing in-progress candle is likewise
`partial: true`, displayed, and excluded from every RSI, MACD, signal, histogram,
and cross calculation. A proved instrument-level gap does not by itself invalidate
a period with another valid bar. Source-envelope or calendar coverage incompleteness
is invalid and is distinct from a proved gap.

### 6.3 RSI and MACD series

Indicators are calculated independently after aggregation for each interval. Daily
indicator values are never resampled into weekly/monthly values.

- RSI is `RSI 14`, using the same Wilder smoothing and edge semantics as the existing
  Phase 2 Engine.
- MACD is EMA 12 minus EMA 26, signal is EMA 9 of MACD, and histogram is MACD minus
  signal, using the same EMA seed and zero semantics as the existing Engine.
- Indicator inputs are completed candle closes only, ascending by candle identity.
- Values are attached to the input candle whose close produces them; warm-up uses the
  strict unavailable union, never `0` or an omitted field.
- With zero-based completed-candle indexing, RSI first becomes available at index 14
  (the 15th candle). MACD, signal, and histogram are one bundle and first become
  available at index 33 (the 34th candle); earlier bundle fields are all
  `unavailable/warmup`.
- Cross state is evaluated only when both current and immediately preceding completed
  MACD/signal bundles exist, so the first possible result is index 34. Equality is
  `none`; `golden_cross` requires previous `MACD <= signal` and current
  `MACD > signal`. A death-cross label is not part of V1.

The method identifiers are `rsi_wilder_14_v1` and `macd_ema_12_26_9_v1`. DR-T1 must
factor or reuse the current Engine implementation so a complete daily suffix gives
the same latest RSI/MACD as the current Engine for the same exact input window and
basis. If the current 251-row production window and the ten-year series yield
different EMA warm-up history, parity is tested on the same explicit 251-row suffix;
the full-series chart remains labelled by its own input range and is not claimed to
be the stored Snapshot value.

### 6.4 Display windows and panes

Default visible windows are:

| Interval | Default visible range |
| --- | --- |
| day | 1 year |
| week | 3 years |
| month | 5 years |

The artifact retains sufficient earlier completed candles for indicator warm-up;
changing the visible range never changes indicator values. Price is always visible.
Volume, RSI, and MACD are initially expanded and may be collapsed independently.
Collapse state is session UI state, not a query parameter and not persisted in the
artifact.

One keyboard-operable shared crosshair selects a candle identity and exposes exact
date/period, partial state, open, high, low, close, volume, RSI, MACD, signal, and
histogram values. A permanently available semantic exact table contains the same
values and does not require pointer hover. SVG/canvas descriptions point users to
that table.

DR-T3 extends the already installed `lightweight-charts` integration and preserves
its existing attribution/notice. It does not add another chart dependency, Python,
or Browser-side indicator logic. Price, volume, RSI, and MACD panes share one time
scale and synchronized selected identity; collapsing a pane does not create a second
independent selection.

### 6.5 Technical URL and source precedence

The canonical parameters are:

```text
?ticker=<ticker>
&tab=technical
&chartSource=auto|snapshot|latest
&interval=day|week|month
```

`chartSource=auto` and `interval=day` are canonical defaults and may be omitted.

- `snapshot` preserves the existing AnalysisSnapshot chart: stored daily price
  history and stored latest indicator/reference values only. It performs no new
  aggregation, indicator calculation, source request, or persistence. Its eligible
  comparison date is `snapshot.dataDates.priceHistory` only when that date equals the
  last renderable stored price-history row; otherwise the Snapshot chart source is
  invalid. Week/month and dated RSI/MACD panes are
  `source_interval_unavailable` / `series_not_collected` in this mode; they are not
  reconstructed in the Browser.
- `latest` requires a validated persisted Technical artifact whose `dataDate` equals
  its last renderable bar. No artifact is 404; corruption without the bounded valid
  fallback is 500. Neither case silently substitutes Snapshot in explicit `latest`
  mode.
- `auto` follows this closed matrix: both valid -> later `dataDate` wins and a tie
  selects the V1 artifact; artifact only -> artifact; Snapshot only -> Snapshot;
  neither -> scoped unavailable. If artifact reading returns a typed prior-revision
  fallback, that valid revision participates with its real date and warning. If the
  read fails 500 and Snapshot is valid, the UI must display Snapshot with the
  corruption warning; it must not call that result latest.
- Every selected source displays its actual `dataDate`, `fetchedAt` where applicable,
  source label, and fallback state.

Source precedence is evaluated before interval availability. If a newer Snapshot wins
`auto` while week/month is requested, the scoped unavailable state offers an explicit
switch to `latest`; it does not silently choose the older artifact or calculate a
series from Snapshot rows.

After a successful Technical job, only the still-current ticker/request may replace
the chart and set `chartSource=latest` through History API. A completed stale job
cannot change another ticker, tab, interval, URL, focus, or chart.

Tab changes retain valid Technical parameters so returning restores the chart.
Changing ticker retains `interval` but resets `chartSource` to `auto`; returning to
the Watchlist or global Market Overview removes ticker-specific Technical parameters.

When Snapshot Comparison is active (`base` and `target` are valid), external refresh
is disabled and the Technical chart remains bound to the selected stored Snapshot
context. Refreshed current data is not mixed into the comparison. Snapshot SMA/Swing
lines are never overlaid on a refreshed artifact unless that exact method is later
recomputed from the artifact in a reviewed version; V1 omits those overlays on the
refreshed chart and labels the distinction.

## 7. Market Overview contract

### 7.1 Module order and common metadata

The ticker-independent page is delivered in this fixed order:

1. TSE-listed aggregate margin balances;
2. market short-selling turnover ratio;
3. 1570 margin balances;
4. Tokyo/Nagoya foreign-investor flow;
5. 1321 latest EOD;
6. 1321/2633 relative ETF market-price proxy.

Modules 1-4 ship in DR-M1/M2; modules 5-6 ship in DR-E1/E2. An unimplemented module
is not rendered as if unavailable source data.

Every available or fallback module always displays source, endpoint/schema revision,
`dataDate`, `fetchedAt`, cadence, unit, availability/fallback state, and calendar days
elapsed from `dataDate` to the Browser's local current date. Elapsed days are a
presentation-only date difference, not a market calculation or freshness claim.
Dates never use traffic-light color alone.

Every module persists this closed common envelope:

```text
MarketOverviewModuleArtifactV1 = {
  schemaVersion: "market_overview_module_v1",
  state: "available" | "unavailable",
  reason: PersistedModuleUnavailableReasonV1 | null,
  moduleId, sourceId, asOfCutoff, dataDate, fetchedAt, cadence, displayUnit,
  sourceInputs, sourcePayloadDigest, artifactDigest,
  observations, warnings
}

PersistedModuleUnavailableReasonV1 =
  source_no_observation | missing_expected_row | duplicate_identity |
  ambiguous_vintage | insufficient_common_dates | invalid_base

PersistedObservationStateV1 =
  { state: "available", reason: null }
| { state: "unavailable",
    reason: "source_no_observation" | "missing_expected_row" |
            "duplicate_identity" | "ambiguous_vintage" }
```

`observations` is exactly one of the following module-owned arrays; every numeric
field uses the field-level `MarketDataValueV1<number>` union in section 8.1:

```text
TseMarginObservationV1 = {
  identity, dataDate, cadence, observationState,
  shortQuantity, longQuantity, quantityRatio,
  acceptedIssueCount, populationIdentity, displayUnit
}
MarketShortObservationV1 = {
  identity, dataDate, observationState,
  nonShortValue, restrictedShortValue,
  unrestrictedShortValue, shortTurnoverRatioPercent, coverageCodeSet
}
Margin1570ObservationV1 = {
  identity, dataDate, cadence, observationState,
  shortQuantity, longQuantity, quantityRatio,
  unit: "口", basisEventId: string | null,
  basisState: "old_basis" | "transition" | "new_basis"
}
ForeignFlowObservationV1 = {
  identity, section: "TokyoNagoya", periodStart, periodEnd, publishedDate,
  observationState, sellThousandYen, buyThousandYen, netThousandYen,
  correctionIdentity: string | null
}
Etf1321EodObservationV1 = {
  identity, dataDate, observationState, adjustedCloseYen,
  previousCommonDate: date | null,
  previousAdjustedCloseYen, changeYen, changeRatePercent
}
EtfRelativeRangeV1 =
  { range: "3m" | "6m" | "1y" | "3y" | "max", state: "available",
    rangeStart, rangeEnd, commonDates,
    normalized1321, normalized2633,
    return1321Percent, return2633Percent, differencePercentagePoints,
    direction: "1321_leads" | "2633_leads" | "same" }
| { range: "3m" | "6m" | "1y" | "3y" | "max", state: "unavailable",
    reason: "insufficient_common_dates" | "invalid_base",
    rangeStart: date | null, rangeEnd: date | null, commonDateCount }
```

Array/date/value-length invariants are strict: parallel ETF arrays have the same
length and exact dates, derived net/change/ratio values must recompute bit-for-bit
under the pinned calculation version, and all observation identities are unique.
Every artifact has at least one observation identity, or exactly five ETF range
variants. A proved `source_no_observation` never creates an empty artifact: its
schedule/query supplies one unique expected identity whose observation state and all
dependent numeric fields are unavailable. Foreign-flow non-available observations
retain the scheduled `publishedDate` and use `correctionIdentity: null`; an ETF
unavailable range has no direction field.

For modules 1-5, root `state/reason` equals the newest expected observation's state
and reason; an older available point does not hide a currently unavailable identity.
For the relative ETF module, root state is available when at least one of the five
ranges is available. If all five are unavailable, root state is unavailable with
`invalid_base` when any range has that reason, otherwise
`insufficient_common_dates`. Root reason is null exactly when root state is
available.

For an available artifact, `dataDate` is its latest actual observation date/common
range end. For an unavailable artifact, `dataDate` is the schedule/query-proved
expected identity date used by its unavailable observation; foreign flow inherits
Phase 2 and uses expected date-only `publishedDate`. The state and visible reason
make clear that this is a requested/expected identity, not a claimed observed value.
This same required date is the storage directory identity. If no expected date can be
proved, publication is forbidden as unproved coverage. A module cannot substitute
another module's payload or unit.

### 7.2 TSE aggregate margin quantities

The label is exactly `東証上場銘柄集計（株式・ETP・REIT）`. It is not a two-market
JPX aggregate. For each source date, strict unique issue rows in the verified TSE
population are summed:

```text
short quantity = sum(source short quantity)
long quantity  = sum(source long quantity)
quantity ratio = long quantity / short quantity
```

All pagination must finish under the preflight cap. The exact source row primary key,
issue-type allowlist, population, and unit mapping are whatever DR-M0 verifies and
merges; DR-M1 must not assume `(dataDate, issueCode, issueType)` or any unpublished
field. In a proved-complete response, a missing expected row or duplicate verified
primary key produces a canonical unavailable observation with the corresponding
typed reason. An unrecognized issue type, negative/non-finite quantity, malformed
field, or unproved/incomplete pagination fails that module refresh with
`source_invalid_response` / `source_pagination_incomplete` and publishes nothing.
The exact source counts and completeness basis are stored for a valid publication.

Short and long quantities use independent field-level available/unavailable unions.
Valid `short quantity == 0` and valid long quantity remain displayed; only the ratio
is `unavailable/zero_denominator`. It never produces infinity and never erases the
two observed balances. If DR-M0 proves the TSE source convention permits a cross-
instrument count, the aggregate UI unit is exactly
`公表数量（株・口を1として合算）`; it is not described as economically homogeneous
shares. If that convention cannot be proved, the source gate fails rather than
inventing a unit. No monetary balance is calculated.

The aggregate is not corporate-action adjusted. A change may include splits, unit-
basis changes, listings/delistings, or population changes and is not labelled as pure
investor-position growth. V1 does not attempt a full-universe historical adjustment.

Observations through 2026-09-24 retain `weekly` cadence and observations from
2026-09-25 retain `daily` cadence only after DR-M0 passes. The boundary is shown and
the line is segmented; no interpolation, resampling, or cadence-adjusted comparison
is performed.

### 7.3 Market short-selling turnover ratio

For each date, all expected unique rows from `/v2/markets/short-ratio` must be
present. DR-M0 freezes the exact versioned code allowlist and coverage label from the
date-query response, including whether `9999 その他`, ETP, REIT, or an unclassified
population is represented; “33-sector” is not used as shorthand for an unverified
set. Let:

```text
short = sum(restricted short-selling value + unrestricted short-selling value)
total = sum(non-short-selling value + restricted short-selling value
            + unrestricted short-selling value)
ratio percent = short / total * 100
```

A missing expected code or duplicate verified identity in a proved-complete response
produces a canonical unavailable observation. An unknown extra code, null/malformed
component, incomplete pagination, or non-finite/negative value fails the module
refresh and publishes nothing. If all components are valid and `total == 0`, the
components remain available and only the ratio is `unavailable/zero_denominator`.
This is a turnover-value ratio, not outstanding short positions, margin balances, or
a squeeze signal.

### 7.4 1570 margin quantities

The instrument is identified by the strict J-Quants security identity for code 1570.
The card displays `信用売残`, `信用買残`, and `数量倍率`, using the field-level rules
in section 7.2 for that one row: valid zero balances remain visible and only a zero-
denominator ratio is unavailable. The unit label is exactly `口`, never `株`.

Margin quantities are not corporate-action adjusted. A split or unit-basis change
inside the displayed window creates a labelled basis break and disconnected chart
segments; values are never retroactively divided, multiplied, or joined across the
break without a separately sourced adjustment contract. Basis breaks come only from
the reviewed `next_funds_corporate_action_events_v1` input, never from detecting a
jump in values. Its initial official registry includes 1321's 1:100 event (trading-
unit change 2026-10-05, effective 2026-10-07) and 1570's 1:50 event (trading-unit
change 2027-02-25, effective 2027-03-01), plus 2633's 1:10 event (base date
2023-12-07, effective 2023-12-08, trading unit unchanged); any revision changes the
input/root digest.

For unadjusted 1570 quantities, `marketBasisFrom` is the issuer-announced trading-unit
implementation date and `legalEffectiveDate` is the split effective date. The last
observation before `marketBasisFrom` is `old_basis`; observations from
`marketBasisFrom` through the day before `legalEffectiveDate` are `transition`; the
first observation on/after `legalEffectiveDate` begins `new_basis`. The chart draws
separate old/new segments and never joins a transition observation to either segment;
the exact table still shows its unadjusted values. Every transition/new observation
carries the event ID. For the announced 1570 event these boundaries are 2027-02-25
and 2027-03-01. The trading-unit and effective dates therefore are not left for the
renderer to choose.

### 7.5 Tokyo/Nagoya foreign-investor flow

This module reuses the existing `TokyoNagoya` investor-type source and deterministic
correction/official-calendar eligibility logic. For each
`(section, periodStart, periodEnd)`, it independently selects the latest publication
eligible at the artifact `asOfCutoff`; multiple equally eligible corrections are
ambiguous and unavailable. It displays the source period and published date plus
foreign-investor sell, buy, and `buy - sell` in source-provided thousand JPY. Source
`total` and `balance` identities must validate exactly. The series resolver is a new
pure correction-vintage function; it must not obtain 26 points by repeatedly calling
an existing latest-only selector. A missing or ambiguous vintage is unavailable, not
zero.

The artifact and UI preserve the source's date-only `publishedDate`; they never
convert it to an instant. For this module `dataDate = publishedDate`, not `periodEnd`,
and `fetchedAt` remains the separate actual fetch instant. This is inherited Phase 2
behavior, not a versioned semantic change.

It is market-section context and is not evidence about the current ticker, a sector,
or future direction.

### 7.6 Observation charts and tables

Modules 1-4 each show the latest 26 expected observation identities proved by their
versioned schedule/calendar inputs at the artifact `asOfCutoff`, in chronological
order, plus a permanently available exact table. Margin uses the DR-M0-frozen
`margin_cadence_registry` and trading calendar, including exact old-weekly short-week
exceptions and the 2026-09-24/25 boundary; short ratio uses its exact publication-
schedule registry and calendar; foreign flow uses its period/publication schedule
and calendar. No resolver infers “every weekday” or “once per week” from rows alone.

An identity absent from a proved expected set occupies its chronological position as
`missing_expected_row`, carries its typed reason, and breaks a chart line. A calendar
or schedule that cannot prove whether the date/period was expected fails the module
refresh as unproved coverage; it cannot manufacture an unavailable point. The
selector never skips an unavailable identity to collect 26 apparently valid points.
Weekly and daily cadence are not normalized. For margin data, a refetch stores the
current provider vintage with its fetch instant and digest; the UI does not claim that
an overwritten historical provider vintage can be reconstructed.

### 7.7 1321 latest EOD

The card says `1321 日経225連動ETF proxy` and `最新取得済みEOD`, not Nikkei 225
current value. It displays the latest adjusted close and previous common source
session change:

```text
change       = latest adjusted close - previous adjusted close
change rate  = change / previous adjusted close * 100
```

Fewer than two valid rows or a zero previous close makes change fields unavailable.
The values exclude distribution reinvestment and must not be called total return.

### 7.8 1321/2633 relative ETF price proxy

1321 (`13210` in J-Quants) is labelled as a Nikkei 225-linked ETF proxy. 2633
(`26330`) is labelled as an unhedged S&P 500-linked ETF whose JPY market price
includes USD/JPY, Tokyo/US trading-hour, tracking, fee, and market-price effects.
Although the issuers define their target indices using total-return index concepts,
this module compares only distribution-excluding, adjusted TSE market prices and is
not ETF/index total return. The adapter verifies both security-master identities and
their corporate-action-registry inputs before accepting bars.

For `3M | 6M | 1Y | 3Y | Max`, with `1Y` default:

1. derive `rangeEnd` as the latest exact common trading date;
2. for 3M/6M subtract exactly 3/6 Gregorian calendar months from `rangeEnd`; for
   1Y/3Y subtract exactly 1/3 Gregorian calendar years, clamping an invalid day to the
   last day of that month; `Max` has no lower bound within the artifact's verified
   ten-year source range and is labelled with its actual first/last dates, not as
   fund inception history;
3. select each instrument's valid adjusted close rows on or after that inclusive
   lower bound and through `rangeEnd`;
4. inner join exact common trading dates;
5. reject duplicate dates and never forward fill;
6. require at least two common dates and positive first closes; and
7. normalize each common-date series to 100 at the first common date.

```text
normalized = adjusted close / first common adjusted close * 100
period return percent = (last normalized / 100 - 1) * 100
difference percentage points = return(1321) - return(2633)
```

Direction is based mechanically on the unrounded selected-period return difference:
positive is `1321優勢`, negative is `2633優勢`, and exact zero is `同水準`. The exact
user-approved label is:

```text
JPY建てETF市場価格・選択期間: 1321優勢／2633優勢／同水準
```

The label is a compact description of that one arithmetic sign, not a general ETF,
country, or future-return ranking. The chart and table display unrounded calculation
inputs and consistently rounded presentation values so a rounded zero does not hide
the underlying sign; when the displayed difference rounds to zero but the unrounded
sign is nonzero, the exact unrounded direction is disclosed in accessible text. No
Buy/Sell, forecast, total return, dividend reinvestment, or country-wide investment
advantage is derived.

The persisted ETF module contains one strict precomputed result for each of the five
ranges. The Browser selects a stored result and never performs the join,
normalization, return, difference, or direction calculation.

## 8. Refresh API, jobs, and security

### 8.1 Read and mutation routes

```text
GET    /api/market-data/technical/:ticker/latest
GET    /api/market-data/overview

POST   /api/market-data/technical/jobs
POST   /api/market-data/overview/jobs
GET    /api/market-data/jobs/active
GET    /api/market-data/jobs/:jobId
DELETE /api/market-data/jobs/:jobId
```

GET routes read only already published, validated local artifacts and never contact
J-Quants. Technical with no canonical artifact is 404. Overview with no canonical
module artifact is 404; a partially populated overview is 200 with strict per-module
`available` / `fallback` / `unavailable` / `not_implemented` unions. External
communication occurs only after an accepted POST job.

Technical POST accepts exactly:

```json
{ "ticker": "7203" }
```

Overview POST accepts exactly:

```json
{}
```

Unknown/duplicate keys, invalid ticker, malformed JSON, or a non-object body are 400.
The button itself is the explicit intent to contact J-Quants and consume quota; there
is no second confirmation dialog and no `confirmExternalFetch` body field. The UI
keeps the source, Standard requirement, EOD/publication semantics, and quota warning
visible immediately next to each separate refresh button.

Success and read envelopes are closed and versioned:

```text
MarketDataWarningCodeV1 =
  artifact_corrupt_fallback | artifact_corrupt_no_fallback | cadence_changed |
  basis_break | source_gap | source_refresh_failed

MarketDataWarningV1 = {
  code: MarketDataWarningCodeV1, message,
  moduleId: MarketDataModuleIdV1 | null,
  artifactIdentity: MarketDataArtifactIdentityV1 | null
}

MarketDataModuleIdV1 =
  tse_margin_quantities | market_short_ratio | margin_1570 |
  tokyo_nagoya_foreign_flow | etf_1321_eod | etf_1321_2633_relative

MarketDataValueV1<T> =
  { state: "available", value: T }
| { state: "unavailable",
    reason: "source_no_observation" | "zero_denominator" |
            "insufficient_history" | "missing_expected_row" |
            "duplicate_identity" |
            "ambiguous_vintage" }

MarketDataModuleViewV1 =
  { moduleId, state: "available", artifactIdentity, payload, warnings }
| { moduleId, state: "fallback", artifactIdentity, payload, warnings }
| { moduleId, state: "unavailable", artifactIdentity, payload,
    reason: PersistedModuleUnavailableReasonV1,
    warnings }
| { moduleId, state: "unavailable", artifactIdentity: null, payload: null,
    reason: "not_collected" | "artifact_corrupt",
    warnings }
| { moduleId, state: "not_implemented" }

TechnicalLatestResponseV1 = {
  schemaVersion: "technical_latest_response_v1",
  state: "available" | "fallback", artifact: TechnicalChartDatasetV1, warnings
}

MarketOverviewResponseV1 = {
  schemaVersion: "market_overview_response_v1",
  modules: MarketDataModuleViewV1[] // exactly the six IDs in fixed order
}

MarketDataJobAcceptedV1 = {
  schemaVersion: "market_data_job_accepted_v1",
  jobId, kind: "technical_refresh" | "overview_refresh",
  acceptedAt, statusUrl
}

MarketDataJobTargetV1 =
  { kind: "technical", ticker }
| { kind: "overview" }

MarketDataArtifactIdentityV1 = {
  scope: "technical" | "overview", tickerOrSourceId, dataDate,
  sourcePayloadDigest, artifactDigest, rootRelativeIdentity
}

MarketDataModuleResultV1 =
  { moduleId, state: "published" | "idempotent_reuse",
    artifactIdentity, warningCodes }
| { moduleId, state: "retained_previous", artifactIdentity,
    failureCode, warningCodes }
| { moduleId, state: "failed", artifactIdentity: null,
    failureCode, warningCodes }

MarketDataJobFailureCodeV1 =
  source_unauthorized | source_entitlement_required | source_rate_limited |
  source_timeout | source_not_yet_updated | source_no_observation |
  source_invalid_response | source_pagination_incomplete |
  source_response_too_large | external_schedule_infeasible |
  artifact_collision | artifact_write_failed | all_modules_failed |
  invariant_failure

MarketDataJobViewV1 = {
  schemaVersion: "market_data_job_view_v1", jobId,
  kind: "technical_refresh" | "overview_refresh",
  target: MarketDataJobTargetV1,
  status: "accepted" | "running" | "cancel_requested" | "publishing" |
          "completed" | "failed" | "cancelled" | "interrupted",
  acceptedAt, startedAt: instant | null, completedAt: instant | null,
  progress: { attempts, pages, acceptedRows, responseBytes,
              completedModules, totalModules },
  failure: { code: MarketDataJobFailureCodeV1, message } | null,
  artifactIdentity: MarketDataArtifactIdentityV1 | null,
  moduleResults: MarketDataModuleResultV1[]
}
```

Variant `payload` objects are closed discriminated objects owned by their module ID;
they never accept arbitrary properties. Technical jobs use one terminal
`artifactIdentity` and an empty `moduleResults`; Overview jobs use null root
`artifactIdentity` and exactly one ordered result per implemented module.
Root `failure` is non-null exactly for status `failed`. A failed Technical job uses
its direct failure code. A failed Overview job always uses `all_modules_failed`; its
ordered `moduleResults` retain each module's actual failure code. For `completed`
(including completed with warnings), `cancelled`, `interrupted`, and every
nonterminal state, root `failure` is null; completed-with-warning causes exist only
in `moduleResults`. `all_modules_failed` is root-only and is never a module result.
`artifactIdentity` contains only root-relative identity fields and digests. Nullable
timestamps/terminal fields are present as explicit nulls when inapplicable. HTTP GET
returns 200 for a validated envelope, including a terminal failed job view; errors
use the section 8.5 union.

`source_no_observation` in the job-failure union is used by Technical refresh only
when a proved-complete requested range contains no renderable bar. It never publishes
an empty Technical artifact. Overview's same-named persisted reason remains a
module-artifact state under the strict schedule proof in section 7 and is not a
module job failure.

Only a proved-complete official response may publish a module artifact. That artifact
may encode `source_no_observation`, a source-row duplicate/missing expected row, an
ambiguous eligible vintage, a zero denominator field, or a calculation-insufficient
range through the closed unavailable unions. Authentication/entitlement/network/
timeout/429, schema, unproved coverage, pagination, or size failure publishes no
artifact and retains the previous pointer. Such failures appear only in the job view
and, where a prior value is retained, as `source_refresh_failed` UI warning.

The boundary is closed:

| Condition after source attempt | Canonical publication | Representation |
| --- | --- | --- |
| complete official response proves no observation | yes | module `unavailable/source_no_observation` |
| missing expected row or duplicate verified primary key in a complete, allowlist-proved response | yes | unique observation/module unavailable with `missing_expected_row` / `duplicate_identity` |
| valid observed denominator is zero | yes | observed numerator/denominator stay available; only derived field is `zero_denominator` |
| ambiguous eligible correction vintage | yes | observation `ambiguous_vintage` |
| valid ETF rows but fewer than two common dates or invalid base | yes | affected range field `insufficient_common_dates` / `invalid_base` |
| unknown enum/code/field, partial null, non-finite/negative/impossible value, identity mismatch, or future row | no | job module `source_invalid_response`; retain previous pointer |
| incomplete pagination or coverage cannot be proved | no | `source_pagination_incomplete`; retain previous pointer |
| auth, entitlement, network, timeout, 429, response-size, or deadline failure | no | corresponding async job failure; retain previous pointer |

An unknown extra source identity is schema failure; it is not treated as the inverse
of a missing expected identity. Negative/non-finite and unknown-type reasons are
intentionally absent from `MarketDataValueV1` because no valid artifact may contain
them.

### 8.2 Shared session and routing

Market-data mutations reuse the one process-local Dashboard session returned by
`GET /api/session`, including its exact `X-Dexter-CSRF` token, constant-time check,
Host/Origin rules, no-CORS rule, no-store/nosniff headers, JSON media-type policy,
body accounting, and sanitized error union from Phase 4.

DR-T2 extracts or composes that security owner so Strategy Validation and Market Data
cannot mint independent CSRF tokens. Market routes are dispatched before the generic
non-GET 405 guard while `/api/analyses/*` remains GET-only. Unsupported methods return
405 with exact `Allow` and never fall through to a different domain.

POST body cap is 4,096 UTF-8 bytes. DELETE has zero body bytes. Content-Length alone
is not trusted; chunked bodies are counted and stopped at the same cap.

### 8.3 Process-wide J-Quants coordinator

One process-wide coordinator owns admission and request rate for every J-Quants job:
Strategy Validation, Technical refresh, and Overview refresh. There is exactly one
nonterminal external job across all three kinds. A second job receives 409
`active_job_conflict`; its safe message may name only the active job kind and does not
expose provider or source inputs.

The coordinator's closed admission discriminator is
`strategy_validation | technical_refresh | overview_refresh`. It shares only the
lease, cancellation-checkpoint interface, and rate limiter. Market Data does not
change, parse, persist, or return Phase 4 Strategy Validation job schemas, routes, or
lifecycle; Strategy Validation likewise does not own Market Data job records.

All J-Quants requests from these jobs also share one account-global rate limiter and
the existing configured requests-per-minute ceiling. A job may make requests only
through that coordinator. Operation-local limiters are not sufficient.

Technical and Overview production jobs reuse Phase 4's
`rolling_attempt_log_v1`: a 30-second per-attempt timeout, at most two retries after
the first attempt only for network errors, HTTP 429, or HTTP 5xx, exact `Retry-After`
handling, deterministic 1/2-second fallback delays, and cancellation/deadline
precedence. HTTP 4xx other than 429, strict schema failures, and body/pagination
failures are not retried. Every initial, pagination, and retry attempt consumes the
shared account rate and job cap.

Technical refresh is exactly one logical ticker/range bars query, one calendar-
envelope query, and one security-master identity query, at most 20 actual HTTP
attempts including cursors/retries, 8,000 accepted rows, 32 MiB response bytes, and a
600-second job deadline.
If ten years cannot fit those bounds, it fails pre-dispatch or on the first exceeded
bound with `external_schedule_infeasible` / `source_response_too_large`; it never
silently shortens history.

DR-M0 fixes the Overview production caps from the measured post-migration Standard
contract in the reviewed plan amendment required by section 3.4. DR-M1 implements
those exact merged caps and has no authority to choose larger ones. Entitlement
failures are never retried; an HTTP 429 that remains after the inherited bounded
retry policy terminates with a typed rate-limit failure.

When DR-E1 adds modules 5-6, their shared source work is exactly two ten-year bars
queries and two security-master queries; the local corporate-action registries make
no HTTP request. The ETF increment is capped at 40 actual attempts, 16,000 accepted
rows, 64 MiB, and 600 seconds. The final Overview ceilings are the DR-M0 merged
attempt/row/byte limits plus those increments, while the whole-job deadline is at
most the DR-M0 deadline plus 600 seconds. DR-E1 must prove the increment with fixtures
and the bounded Standard source gate; failure never shortens `Max` or drops a module.

### 8.4 Market Data job lifecycle, recovery, and publication

The following strict lifecycle applies only to `MarketDataJobViewV1`:

```text
accepted -> running -> publishing -> completed
                    \-> failed
accepted/running -> cancel_requested -> cancelled
accepted/running/cancel_requested/publishing -> interrupted (startup recovery only)
```

Job views contain schema version, UUID, kind, sanitized target, status, timestamps,
bounded progress counts, safe failure code/message, and terminal artifact identities.
They never contain credentials, raw rows, raw response, request ID, headers, absolute
paths, or provider exception text.

The active-job recovery read is:

```text
MarketDataActiveJobV1 = {
  schemaVersion: "market_data_active_job_v1",
  marketJob: MarketDataJobViewV1 | null,
  blockingKind: "strategy_validation" | null
}
```

Exactly one of `marketJob` and `blockingKind` may be non-null. A running Market Data
job returns its view; an active Strategy Validation lease returns only
`blockingKind`; no lease returns both null. The specific `/jobs/active` route is
dispatched before `/:jobId`. On reload, the matching Market Data page reads it once,
then polls that market job every 1,000 ms only while it is nonterminal and the
document is visible; polling stops on terminal state/unmount and resumes on
visibility return. A Strategy Validation blocker is shown but cannot be cancelled
through a Market Data route. This status polling is not market-data auto-refresh.

Cancellation is cooperative between source requests and before publication. DELETE
returns 202 while cancellation is being accepted, 200 for already cancelled, 404 for
missing, and 409 for `publishing`, `completed`, `failed`, or `interrupted`. Once canonical promotion
begins, it is not cancelled. A failed/cancelled/timed-out Technical job publishes no
canonical artifact and does not advance a pointer.

An Overview job first finishes all source attempts and module validation, then enters
`publishing`; DELETE is rejected from that point. Each module is an independent atomic
publication unit. A failed module retains its prior pointer and a successful module
may advance, exactly as recorded in the terminal `moduleResults` union. There is never
a partially written module artifact. The Overview job is `completed` with warnings
when at least one implemented module publishes or idempotently reuses a current
canonical artifact and another has a typed source, collision, or storage failure; it
is `failed` when no implemented module publishes/reuses. A canonical typed
unavailable result from a proved-complete response counts as a successful
publication, not a provider failure. Already published sibling modules are never
rolled back after a later module fails. Startup reconciliation validates every
recorded module identity and reports any interrupted pointer update rather than
pretending the set was atomic.

Mutable job recovery state is stored separately from canonical market artifacts.
Process startup marks abandoned nonterminal jobs `interrupted`; it never resumes an
external request automatically. A save failure after a successful external response
reports that quota may have been consumed and leaves the previous pointer intact.

After completion, only the matching current Browser request explicitly adopts the
new artifact. There is no polling outside the active job view, no scheduled refresh,
and no automatic background freshness loop.

### 8.5 HTTP statuses and failure union

| Status | Meaning |
| ---: | --- |
| 200 | successful read or already-cancelled response |
| 202 | job or cancellation accepted |
| 400 | malformed route/query/body/schema/source request |
| 403 | Host, Origin, or CSRF failure before admission |
| 404 | exact artifact/job not found |
| 405 | unsupported method with exact `Allow` |
| 409 | active-job conflict or invalid cancellation/lifecycle action |
| 413 | request body exceeds the route cap |
| 415 | unsupported media type |
| 500 | Technical corruption without a valid fallback; Overview corruption when no implemented module validates; repository-wide filesystem or invariant failure |

Every response is a strict success or `{ "error": { "code", "message" } }` union.
The closed HTTP error codes are `invalid_request`, `invalid_query`, `invalid_ticker`,
`source_configuration_missing`, `request_forbidden`, `artifact_not_found`,
`job_not_found`, `active_job_conflict`, `invalid_job_state`, `method_not_allowed`,
`request_body_too_large`, `unsupported_media_type`, `artifact_corrupt`,
`artifact_recovery_bound_exceeded`, `repository_failure`, and `invariant_failure`.
Async provider/runtime failures use only `MarketDataJobFailureCodeV1`; they never
include raw provider text. A provider response that exceeds its bound terminates the
accepted job with `source_response_too_large`; it does not retroactively change the
POST response to HTTP 413. Where source entitlement is discovered only after
dispatch, the job terminates failed and its GET view carries the safe failure code;
the original POST still correctly returned 202.

A canonical path collision discovered after POST is an asynchronous terminal
`artifact_collision` job failure. The job GET remains HTTP 200 with that sanitized
failure; it is not retroactively converted to HTTP 409.

## 9. Dashboard state and interaction contract

- Watchlist, empty, loading, partial, fallback, retained-previous, and error surfaces use the same
  primitives and remain distinguishable without color.
- Technical and Overview have separate refresh buttons and active-job status.
- The Overview button attempts all currently implemented Overview sources in one
  bounded job. Each source module publishes independently: a successful module may
  advance while a failed module retains its previous pointer and shows a typed
  warning. A source-level unavailable observation is a valid typed payload; malformed
  schema, incomplete pagination, or provider failure never advances that module.
- Consecutive clicks, ticker changes, source/interval changes, History navigation,
  tab changes, and aborts use latest-request-wins guards. Stale responses cannot
  overwrite content, URL, announcements, or focus.
- A refresh failure keeps the previously displayed valid artifact or Snapshot and
  adds a visible warning; it never clears valid content or fabricates a new date.
- Focus moves to the updated heading only after the matching current request adopts a
  completed artifact. Validation errors focus their scoped alert; cancellation
  returns focus to the initiating control.
- Charts have semantic names, exact tables, keyboard operation, and no pointer-only
  information. Collapsed panes retain an accessible control and state.
- No chart or card hides an unavailable observation, cadence break, source revision,
  distribution exclusion, proxy limitation, or artifact fallback.

## 10. Implementation sequence and PR boundaries

Each step is one independently reviewable PR. A step begins only after the previous
PR is independently approved and merged and local `main` is fast-forwarded to
`origin/main`.

1. **DR-0 — docs-only contract**
   - synchronize `docs/SPEC.md` and the Post-MVP roadmap;
   - add root `DESIGN.md`, connect it through `AGENTS.md`, and add this plan and
     `docs/DASHBOARD_REFRESH_HANDOFF.md`;
   - do not change runtime code, dependencies, Usage, setup, or historical UX plans.
2. **DR-V1 — visual tokens and primitives**
   - implement the exact root `DESIGN.md` tokens and shared primitives;
   - preserve behavior and current six-tab information architecture.
3. **DR-V2 — Watchlist and global navigation**
   - migrate Watchlist/loading/error/empty surfaces;
   - add the header Market Overview route with an explicit not-yet-available state
     until the data steps merge.
4. **DR-V3 — detail shell and complex surfaces**
   - migrate Card/Table/Dialog/Comparison/Radar/Validation/chart theme;
   - enact the exact seven-tab shell without moving existing Snapshot sections.
5. **DR-T1 — pure Technical chart series**
   - implement strict daily input, interval aggregation, partial-period rules,
     RSI/MACD series, cross state, and pure tests only.
6. **DR-T2 — Technical artifact, source, and job API**
   - implement strict J-Quants mapper, repository, digest/pointer, Standard smoke,
     shared session/coordinator, manual refresh, and GET/job routes.
7. **DR-T3 — Technical UI**
   - implement source precedence, day/week/month, four panes, crosshair OHLCV,
     exact table, URL/race/focus, and Comparison separation.
8. **DR-M0 — margin-source migration gate**
   - verify the official migration, individual Standard entitlement, exact schema,
     cadence boundary, primary key/coverage/unit contract, one-date reconciliation,
     and bounded exact-26-observation production-shape smoke;
   - add no public value when the gate is unresolved.
9. **DR-M1 — four supply/demand sources, artifacts, and API**
   - implement modules 1-4 in one bounded Overview job with per-module atomic
     publication; the four-module set is deliberately not atomic.
10. **DR-M2 — four supply/demand UI modules**
    - implement cards, latest 26-observation charts/tables, cadence/basis breaks,
      metadata, fallback, and warnings.
11. **DR-E1 — 1321/2633 sources and relative-performance engine**
    - implement strict EOD input, 1321 change, common-date normalization, range,
      direction, proxy caveats, and immutable module artifacts.
12. **DR-E2 — two ETF UI modules**
    - add the 1321 EOD and 1321/2633 proxy cards/chart/table and range URL/UI state.
13. **DR-X — usage, setup, handoff, and closeout**
    - update `Usage.md`, `docs/USER_SETUP.md`, and environment guidance only for
      merged behavior;
    - run complete validation and update the handoff from candidate to closeout.

No step opportunistically implements a later step. DR-V1-V3 do not fetch market data;
DR-T1 has no I/O; DR-M0 is a gate rather than a UI/source implementation; DR-X adds
no new runtime behavior.

## 11. Test and acceptance matrix

| Step | Required tests and acceptance |
| --- | --- |
| DR-0 | `DESIGN.md` sole-visual-authority consistency, `AGENTS.md` startup/governance link, no runtime/dependency diff, links and sequence reviewed |
| DR-V1 | exact tokens, measured contrast, focus-visible, status not color-only, existing behavior regression |
| DR-V2 | Watchlist/loading/error/empty, global deep link/conflict, Back/Forward/reload, inherited unknown-tab canonicalization, dormant/new-key matrix, unknown-query preservation |
| DR-V3 | exact seven IDs/labels/order, Home/End/arrows/roving focus, all existing complex surfaces, availability ownership, token contrast at every required surface |
| DR-T1 | strict bar/gap union, positive OHLC/non-negative volume and valid zero, daily `partial:false`, gap-only period, OHLCV aggregation, week/month/calendar/holiday boundaries, week-mid/month-mid `queryFrom` leading partials, partial current week/month, all-null/partial-null, RSI index 14, MACD bundle index 33, first cross index 34/equality, 34-month boundary, same-window Engine parity, input immutability |
| DR-T2 | strict V2 mapper, acceptedAt/16:30/query-range gate, ten-year entitlement, three-input manifest/root digest, all-gap `source_no_observation` with previous-pointer retention and initial GET 404, idempotency, same-date correction, async collision, atomic publish/pointer, bounded corruption/fallback, containment, GET 404/500/no-fetch, shared CSRF/coordinator/active-job recovery, timeout/cancel/startup |
| DR-T3 | auto/snapshot/latest precedence, absent latest, refresh adoption, URL/Back/Forward/reload, latest-request-wins, collapse, keyboard crosshair, exact table, Comparison isolation |
| DR-M0 | old/new fixtures, official migration evidence, individual-Standard entitlement, exact source primary key/fields/issue and sector allowlists/units/vintages, schedule/calendar and short-week/boundary resolver, one-date reconciliation smoke, exact 26-window bootstrap caps, secret-safe record |
| DR-M1 | complete issue aggregation, field-level valid zero/ratio denominator, verified primary key and unit, canonical expected-date unavailable artifact/path, persisted-vs-uncollected/corrupt identity, proved-missing/duplicate unavailable versus malformed/incomplete no-publish matrix, short-ratio allowlist/formula, correction eligibility, per-module atomic publication/partial success/all-modules-failed root, 1570 identity/unit/old-transition-new official basis break |
| DR-M2 | latest 26 expected identities including unavailable rows, weekly/daily boundary, no interpolation, fallback warnings, source/date/cadence/elapsed metadata, keyboard/mobile tables |
| DR-E1 | exact three-input 1321 EOD and six-input relative-ETF manifests, EOD insufficient-history fields, common-date inner join, no forward fill, positive base, base 100, range boundaries, unavailable range without direction, return/difference/direction, exact tie, distribution exclusion, 1321/2633 announced-split adjusted-price regressions, corporate-action price basis |
| DR-E2 | 3M/6M/1Y/3Y/Max, 1Y default, exact proxy labels/caveats, URL/race/focus, table/chart agreement |
| DR-X | full unit/integration/Playwright/visual QA, source gates, usage/setup accuracy, no-score/no-signal/Snapshot regression |

Responsive visual QA covers 320, 390, 680, 768, 980, 1024, and 1280 px with no
document-level horizontal overflow. It covers Watchlist, all seven tabs, dialogs,
loading, empty, partial, fallback, error, long Japanese labels, tables, and expanded
and collapsed chart panes.

API tests cover exact Allow/405 behavior and 400, 403, 404, 409, 413, 415, and 500;
Host, Origin, CSRF, body counting, timeout, cancellation, race, corruption, and secret
non-exposure. A test transport proves GET never dispatches externally and normal CI
and Playwright make zero network calls beyond the local test server. Overview tests
distinguish partial 200 from all-modules-corrupt 500 and require
`all_modules_failed` only at the failed job root.

Every PR runs focused tests. Before each PR is published, and again at DR-X, run:

```text
bun test
bun run typecheck
git diff --check
```

Browser-affecting steps also run the configured full Playwright suite. Manual source
smokes are recorded separately and never replace deterministic tests.

## 12. Done conditions

Dashboard Refresh is Done only when:

1. DR-0 through DR-X were separate, independently reviewed PRs merged in order;
2. local `main` is fast-forwarded to the exact green `origin/main`;
3. all automated validation and required responsive/visual QA pass;
4. the J-Quants Standard Technical smoke passed without secret exposure;
5. DR-M0 recorded the post-migration official result plus both exact individual-
   Standard schema/reconciliation and 26-observation production-shape smokes;
6. all UI values retain source, date, unit, cadence, unavailable, and proxy semantics;
7. Snapshot V1-V9, Comparison, Radar, Strategy Validation, no-score, and no-signal
   regression tests remain green; and
8. Usage, setup, and handoff describe only the exact merged behavior.

Phase 5 begins only after all eight conditions are satisfied. A delayed or failed
margin migration gate delays DR-M1 onward and Phase 5; it does not authorize a weaker
source.

## 13. Explicitly deferred scope

- realtime or direct Nikkei 225 cash-index value, including intraday feeds;
- Nikkei PER, PBR, EPS, or PER-weighted 10-25x theoretical price bands;
- market-wide margin valuation profit/loss rate;
- individual-investor margin-buy rate;
- monetary margin-balance aggregation until a licensed response and entitlement are
  separately verified;
- VIX, VIX MACD, or another volatility feed until a lawful durable source, license,
  and point-in-time contract are approved;
- direct index or ETF total-return comparison and distribution reinvestment;
- automatic refresh, polling outside an active job, scheduler, SSE, or WebSocket;
- Python, a Dashboard database, Snapshot V10, or artifact backfill;
- artifact revision browser or automatic retention deletion;
- Buy/Sell/Hold, score, signal, prediction, or investment advice; and
- Phase 5 Portfolio, cross-stock correlation, VaR, monitoring, or notification work.

These items are not described as impossible. They require a separate reviewed plan
with a lawful source, entitlement, normalization, security, and acceptance contract.

## 14. DR-0 delivery boundary

DR-0 changes only:

- `AGENTS.md` — require `DESIGN.md` before user-facing UI design and enforce its
  subject-specific authority;
- root `DESIGN.md` — define the visual Source of Truth and migration reference;
- `docs/SPEC.md` — add the independent Dashboard Refresh roadmap and invariants;
- `docs/MVP_IMPLEMENTATION_PLAN.md` — align the Post-MVP roadmap without changing
  completed MVP Step 0-10 contracts;
- this normative plan; and
- `docs/DASHBOARD_REFRESH_HANDOFF.md` — non-normative recovery context.

DR-0 does not change code, tests, fixtures, dependencies, environment files, Usage,
setup, Snapshot data, local artifacts, API behavior, CSS, or Browser output. It does
not rewrite `docs/VISUALIZATION_MVP_PLAN.md`, `docs/DASHBOARD_UX_PLAN.md`, or Phase
2-4 plans/handoffs. Runtime work may start only after this exact plan candidate passes
independent review, is merged, and local `main` is fast-forwarded.
