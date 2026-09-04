# Dexter JP Dashboard Refresh & Market Context Implementation Plan

**Plan version:** `dashboard_refresh_plan_v2`

**Status:** User-approved current-code-only amendment to the merged DR-0 contract; this version and each runtime step still require independent review and merge

**Last Updated:** 2026-09-04

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
rewritten. Where this plan deliberately changes the current six-tab shell, adds a
guarded market-data mutation surface, or introduces the versioned Dashboard-only
admission and cross-domain job-recovery guards in section 8.3, the change is explicit
and applies only after the corresponding step is reviewed and merged. These guards
preserve Phase 4's empty-start execution controls and status-specific run recovery;
they do not redefine `rolling_attempt_log_v1` or its persisted job/run schemas.

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
| `jquants_v2_equities_bars_daily` | Technical and 1321/2633 EOD bars | J-Quants `/v2/equities/bars/daily` | approved, reverified in DR-T0/DR-E1 | configured Standard-or-higher account |
| `jquants_v2_markets_calendar` | Technical and ETF session envelope | J-Quants `/v2/markets/calendar` | approved inherited source, reverified in DR-T0/DR-E1 | configured Standard-or-higher account |
| `jquants_v2_equities_master` | current ticker/security identity and instrument basis at one eligible end date | J-Quants `/v2/equities/master` at the eligible end date | approved inherited source, reverified in DR-T0/DR-E1; it does not prove historical identity | configured Standard-or-higher account |
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

DR-T0A retires `jquants_v2_instrument_lifetime_candidate` without replacing it with
a fabricated source. It was never approved or used by a production codec, artifact,
receipt, route, or UI, so no persisted-data migration or backfill exists. Technical
and ETF history instead use the explicit calculation boundary
`current_code_history_v1`: the eligible-end-date master proves only the current code
and instrument label, while the historical rows remain code-addressed observations
whose instrument identity is not verified across the full range.

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

`inputDigest` is `sha256:<64 lowercase hex>` over `CanonicalJsonV1` of this one
strict, writer-side preimage:

```text
SourceInputDigestPayloadV1 = {
  kind: "dexter_market_source_input", version: 1,
  identity:
    { kind: "provider", role, sourceId, sourceContractVersion,
      sourceMappingVersion, sourceRevisionIds, endpoint,
      normalizedQueryIdentity, dataDateOrEffectiveRange,
      publishedDate, publishedAt, cadence, unitAndCoverageBasis }
  | { kind: "registry", role, sourceId, sourceContractVersion,
      registryVersion, sourceRevisionIds, registryId,
      effectiveRange, unitAndCoverageBasis },
  observations // exact sanitized, ordered rows of the pinned source mapping
}
```

The source mapping owns the closed row type and canonical row order; this is not a
raw-response object or a recursive selection of arbitrary fields. Revision ID arrays
are unique and lexically sorted. The input preimage excludes
`inputDigest`, `asOfCutoff`, fetch/verification instants, entitlement class, page
boundaries/counts, credentials, headers, cursors, request IDs, and paths. Eligibility
is applied before hashing the normalized rows. A schedule input also hashes its
resolved expected-observation identities, including any intraday publication
boundary; calculations must not consult a cutoff-dependent input absent from the
envelope. Read-time validation recomputes the
root envelope and artifact digest from the stored manifest; it does not claim to
recompute an input's observation digest without those source rows or refetch them.
`sourceInputs` is sorted by `role`, `sourceId`, then provider
`normalizedQueryIdentity` or registry `registryId`. Duplicate roles or inputs are
invalid. A date-only source publication is stored in `publishedDate`; it is never
converted to midnight and stored as `publishedAt`. `publishedAt` is non-null only
when the source directly proves an instant.

Technical has exactly the roles `security_master`, `trading_calendar`, and
`daily_bars`. The 1321 EOD module has exactly `security_master_1321`,
`trading_calendar`, `daily_bars_1321`, and `corporate_action_registry_1321`. The
relative ETF module has exactly that one shared `trading_calendar` role plus
`security_master_1321`, `daily_bars_1321`, `corporate_action_registry_1321`,
`security_master_2633`, `daily_bars_2633`, and
`corporate_action_registry_2633`. No role claims historical instrument identity. A
correction to any actual input therefore changes the root source digest even if the
bar or margin rows are unchanged.

After DR-M0 replaces the candidate mapping, the TSE aggregate uses
`security_master_population`, `trading_calendar`, `margin_cadence_registry`, and
`margin_rows`. 1570 uses exactly `security_master_1570`, `trading_calendar`,
`margin_cadence_registry`, the same job-level `margin_rows` digest, and
`corporate_action_registry_1570`. Market short ratio uses `trading_calendar`,
`short_ratio_schedule_registry`, `sector_coverage_registry`, and `short_ratio_rows`;
foreign flow uses `trading_calendar`, `investor_type_schedule_registry`, and
`investor_type_rows`. These role sets are closed for V1.

Every artifact persists exactly one calculation version from this closed union:

```text
MarketDataCalculationVersionV1 =
  technical_chart_calculation_v1 |
  tse_margin_quantities_calculation_v1 |
  market_short_ratio_calculation_v1 |
  margin_1570_calculation_v1 |
  tokyo_nagoya_foreign_flow_calculation_v1 |
  etf_1321_eod_calculation_v1 |
  etf_1321_2633_relative_calculation_v1
```

The sole preimage of `sourcePayloadDigest` is this strict object; digest helpers do
not accept positional arguments or a `MarketDataArtifactIdentityV1`:

```text
MarketDataSourcePayloadEnvelopeV1 = {
  kind: "dexter_market_data_source_payload", version: 1,
  target:
    { kind: "technical", ticker, jquantsCode }
  | { kind: "overview", moduleId, sourceId },
  dataDate, calculationDate,
  calculationVersion: MarketDataCalculationVersionV1,
  sourceInputs: { role, inputDigest }[]
}
```

`target`, `calculationVersion`, and the closed ordered role set must agree exactly.
The envelope's `sourceInputs` uses the ordering already fixed above and includes
every role exactly once. `calculationDate` is the Tokyo calendar date of the frozen
`asOfCutoff`, persisted in both artifact kinds. It is semantic input to elapsed
week/month and expected-observation selection, not a fetch instant. Identical source
rows on a new calculation date therefore produce a new revision; an equal complete
envelope on the same date remains idempotent. This prevents reusing an in-progress
Friday candle as an elapsed candle on Monday without a content revision.
The envelope contains no `sourcePayloadDigest`, `artifactDigest`,
path/root-relative identity, job/receipt identity, `acceptedAt`, `checkedAt`,
`fetchedAt`, `entitlementVerifiedAt`, credential, header, cursor, request ID, raw
envelope, or derived display value. `sourcePayloadDigest` is SHA-256 over the UTF-8
bytes of its `CanonicalJsonV1` representation and is formatted as `sha256:<64
lowercase hex>`.

`sourceRevisionIds` refer to an allowlisted code registry whose entries pin the
official URL/title/revision/retrieval date in code; artifacts do not accept or
persist arbitrary URLs. Provider `fetchedAt` is the actual fetch instant and is never
backdated. Pagination can only be stored with `complete: true`; an incomplete result
cannot be an input to a canonical artifact.

### 3.2 Primary references

DR-T0, DR-E1, and DR-M0 reverify, rather than merely quote, the applicable official
references:

- J-Quants daily adjusted bars and availability:
  <https://jpx-jquants.com/ja/spec/eq-bars-daily> and
  <https://jpx-jquants.com/ja/spec/data-spec>, plus the official update-time guide
  <https://jpx-jquants.com/ja/spec/data-update>;
- J-Quants listed-issue master, including its current documented ability to retrieve
  past/current/next-business-day issue information but not an assumed continuous-
  lifetime proof: <https://jpx-jquants.com/ja/spec/eq-master>, with the closed
  product and market code tables at
  <https://jpx-jquants.com/ja/spec/eq-master/product-category> and
  <https://jpx-jquants.com/ja/spec/eq-master/marketcode>;
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

### 3.3 DR-T0 Technical source and current-code gate

The product accepts that J-Quants does not prove one instrument identity across the
full historical range. DR-T0 therefore verifies source availability and the current
eligible-end-date master identity only. It must not describe returned bars, equal
codes, company names, or absence of rows as a listing/lifetime proof.

Before Technical refresh is exposed, a manual bounded smoke must prove with the
configured credential that:

1. `/v2/equities/bars/daily` accepts the intended maximum ten-year range on the
   actual Standard-or-higher plan;
2. the inherited `/v2/markets/calendar` mapper supplies the exact calendar envelope
   needed to distinguish an elapsed from an in-progress week/month;
3. `/v2/equities/master` returns exactly one eligible-end-date row that satisfies
   the applicable closed `current_master_expectation_v1` predicate;
4. pagination for all three inputs is complete and bounded;
5. the strict mapper recognizes the current V2 fields and adjustment semantics;
6. the documented update-time/source revision still supports the exact
   `jquants_daily_bars_eligibility_v1` cutoff;
7. data dates are EOD dates, every returned bar has the requested code, and no future
   row is accepted;
8. after the earliest returned daily source row, every official session through
   `eligibleThrough` has an explicit source row; an all-null source row is a gap, but
   an absent row fails closed rather than being synthesized; and
9. logs, errors, fixtures, artifacts, and PR text contain no credential, request
   header, request ID, raw response body, or absolute path.

The current-code boundary is deliberately weaker than historical identity proof:

```text
CurrentCodeHistoryBoundaryV1 =
  { state: "available",
    contractVersion: "current_code_history_v1",
    mode: "current_code_only", jquantsCode,
    currentMasterDate: eligibleThrough,
    sourceCoverageFrom,
    sourceCoverageThrough: eligibleThrough,
    historicalIdentity: "not_verified" }
| { state: "unavailable",
    contractVersion: "current_code_history_v1",
    mode: "current_code_only", jquantsCode,
    currentMasterDate: eligibleThrough,
    historicalIdentity: "not_verified",
    reason: "source_no_observation" }
```

The eligible-end-date master predicate is the closed
`current_master_expectation_v1` contract. It is part of the versioned strict master
mapping; changing a code, product, market allowlist, or name rule requires a new
mapping version and reviewed source-revision entry.
Every `security_master*` provider input therefore persists
`sourceMappingVersion: "jquants_current_master_mapping_v1"` and the allowlisted
revision IDs for the master, product-category, and market-code pages.

```text
CurrentMasterExpectationV1 =
  { family: "technical_domestic_equity",
    jquantsCode: normalizeJapaneseSecuritiesCode(canonicalTicker) + "0",
    productCategories: ["011"],
    marketCodes: ["0105", "0111", "0112", "0113"],
    namePolicy: "validated_source_label_only" }
| { family: "etf_1321", jquantsCode: "13210",
    productCategories: ["014"], marketCodes: ["0109"],
    namePolicy: "validated_source_label_only" }
| { family: "etf_2633", jquantsCode: "26330",
    productCategories: ["014"], marketCodes: ["0109"],
    namePolicy: "validated_source_label_only" }
```

The code meanings are pinned to the official J-Quants product-category and market-
code registries rechecked on 2026-09-04: `011` is domestic equity, `014` is ETF,
`0105` is TOKYO PRO MARKET, `0111`/`0112`/`0113` are Prime/Standard/Growth, and
`0109` is Other, the master market classification accepted for the two fixed ETF
targets. DR-T0 rechecks the Technical values and DR-E1 must prove the actual 1321 and
2633 rows match their frozen values before a production adapter is enabled. A
different actual value returns to plan review; it is not added dynamically.

`CoName` is not compared with Snapshot text, an issuer registry, or a hard-coded
name. Company-name changes therefore do not reject an otherwise valid current row.
It is accepted and stored exactly as the current source label only when it is a
string of 1-160 UTF-16 code units, equals its ECMAScript `trim()` result, and contains
no control character or configured secret marker. No Unicode normalization,
case-folding, internal-space collapse, or alias matching is performed. `MktNm`,
`ProdCat` names, and `CoNameEn` do not participate in identity acceptance.
The strict normalized master observation is exactly
`{ Date, Code, CoName, Mkt, ProdCat }` in that key order. All five values, including
the displayed `CoName`, enter the `security_master*` input digest; an accepted name
or market transfer therefore produces a new source payload rather than silently
reusing an older artifact. Extra provider fields never enter the digest.

After strict response-shape and completed-pagination validation, master identity
checks run in this exact order. The first failed check is the internal sanitized
`CurrentMasterRejectionReasonV1`; every value maps to the existing public
`instrument_identity_unverified`, publishes no artifact/receipt, and retains any
prior authoritative observation:

```text
missing_row -> duplicate_row -> effective_date_mismatch -> code_mismatch ->
product_category_mismatch -> market_code_mismatch -> blank_name -> invalid_name
```

`missing_row` means zero selected rows and `duplicate_row` means more than one.
`effective_date_mismatch` requires `Date === eligibleThrough`; code comparison is an
exact five-character comparison; product and market comparisons use the applicable
closed arrays above. A `CoName` whose `trim()` is empty is `blank_name`; any other
name-policy violation is `invalid_name`. Unknown fields are rejected or ignored only
as fixed by the strict mapper schema, never used as an alternate identity. A market
transfer inside the Technical allowlist is accepted at the current eligible date; a
transfer outside it, an ETF category change, or any product change fails closed.

`sourceCoverageFrom` is the earliest strictly mapped daily source row inside the
requested range. Sessions before it are outside the retrieved series and are not
called pre-listing, missing, delisted, or part of another instrument. From that date
through `sourceCoverageThrough`, a missing official-session row, pagination
uncertainty, code mismatch, or current-master mismatch fails the job. This detects a
visible internal coverage break but cannot detect a code reuse or instrument change
that leaves no missing session. The artifact and UI therefore always carry
`historical_identity_unverified`, even when the complete maximum range is returned.
An empty complete bars response has no invented coverage dates and may only produce
the unavailable boundary in an ETF module artifact; a Technical refresh publishes no
artifact and follows its existing `source_no_observation` retention/404 contract.

The exact Japanese warning displayed persistently next to the Technical chart and in
each affected ETF module is:

```text
履歴は現在の銘柄コードに紐づくJ-Quants調整後価格です。表示期間全体が同一銘柄であることは確認していません。
```

Coverage clipping is defined by the strict shared official-session calendar, not by
a raw calendar-date comparison. For any available boundary:

```text
historyCoverageClipped(boundary) =
  exists official session s such that
    queryFrom <= s < boundary.sourceCoverageFrom
```

An unavailable boundary never makes this predicate true by itself. Consequently, a
Saturday, Sunday, or exchange holiday at `queryFrom` followed by the first complete
official session is not clipped. If the calendar input cannot prove the sessions in
this interval, the source input is invalid and no artifact or receipt is published.

Technical and the single-boundary 1321 EOD module carry
`history_coverage_clipped` exactly when their one available boundary satisfies the
predicate. Their exact Japanese message is:

```text
取得できた履歴は {sourceCoverageFrom} からです。この日付は上場日を示しません。
```

The relative 1321/2633 module carries exactly one `history_coverage_clipped` warning
when either fixed boundary satisfies the predicate. It never selects one boundary's
date for the single-boundary message. Its exact Japanese message is:

```text
取得できた履歴の開始日は1321が{coverage1321}、2633が{coverage2633}です。これらの日付は上場日を示しません。
```

The token order is always 1321 then 2633. For an available boundary its token is the
canonical `sourceCoverageFrom` date in `YYYY-MM-DD`; for an unavailable boundary it
is exactly `観測なし`. Both tokens are rendered even when only one available
boundary is clipped. This rule also covers an all-null input whose boundary is
available from its earliest mapped row. When neither available boundary is clipped,
the warning is absent. These closed templates and selectors are part of artifact
derivation, so the same source inputs cannot choose a different warning payload or
`artifactDigest`.

For Technical both warnings have `moduleId: null`; for ETF artifacts they use the
owning module ID. Persisted warnings have `artifactIdentity: null` under the existing
non-cyclic digest rule. Current-code-only artifacts are presentation inputs only.
They must not feed Phase 4 validation, a backtest, score, trading/decision signal,
recommendation, or historical Snapshot reconstruction. This prohibition does not
refer to the stored MACD `signal` indicator series inside the Technical chart.

The smoke is manual, default-No, writes no canonical artifact, observation receipt,
or job record, and is not a substitute for fixture tests. Its durable output is only
the secret-safe reviewed gate evidence required by DR-T0. It allows at most 20 actual
HTTP attempts and 180 seconds, with one 30-second attempt per page and no retry.
DR-T0 may freeze a lower production bound after measurement; it may not silently
raise the 20-attempt gate or shorten the requested maximum range to make the smoke
pass.

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
DR-M1a-c/DR-M2 without blocking the Technical or ETF path.

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
section 7.2. DR-M1a-c cannot start until the exact amendment is merged. These are
source-dependent decisions, not discretion left to the DR-M1a-c implementers.

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
  observations/technical/<ticker>/<acceptedAtEpochMs>_<jobId>.json
  observations/overview/<sourceId>/<acceptedAtEpochMs>_<jobId>.json
  jobs/<jobId>.json
```

`jobs/` contains mutable Market Data job records, not canonical content or
observation receipts. Section 8.3 governs their publication and cross-domain
recovery; section 8.4 governs their native schema/lifecycle. Both Market Data job
kinds use this one repository. Phase 4 jobs remain at their existing
`.dexter/research/strategy-validation/jobs/<jobId>.json` location.

`sourcePayloadDigestHex` is only the 64-character lowercase hexadecimal portion of
the JSON field `sourcePayloadDigest`; the `sha256:` prefix is never part of a Windows
filename. Ticker, date, source ID, and digest hex are parsed through exact
allowlists/patterns before path construction. Every resolved path must remain under
the configured market-data root. Symlink/reparse-point escapes and absolute/user-
supplied paths fail closed.

`acceptedAtEpochMs` is the canonical non-negative base-10 integer parsed from the
receipt's validated UTC `acceptedAt`; it is not ordered lexically. `jobId` is UUIDv4.
An observation filename and body must agree exactly. Receipt paths are create-only
and use the same containment and no-replace requirements as canonical artifacts.

The six storage `sourceId` values, in display order, are exactly
`tse_margin_quantities_v1`, `market_short_ratio_v1`, `margin_1570_v1`,
`tokyo_nagoya_foreign_flow_v1`, `etf_1321_eod_v1`, and
`etf_1321_2633_relative_v1`. They identify derived module contracts; external inputs
remain separately identified in `sourceInputs`.

### 5.2 Canonical identity and digest

All canonical files are strict UTF-8 JSON, create-only, and atomically published by
write-to-private-temp, flush/close, and the exact inherited P3-I0
`link(privateTemp, finalPath)` no-replace promotion. `rename`, `copyFile`, or an
existence-check-then-replace fallback is prohibited. `EEXIST` reopens and fully
validates the winner before idempotent reuse or collision is decided. A partial temp
file is never a valid revision. Failure cleanup removes only private temps owned by
that publication invocation; startup ignores unowned crash remnants and must not
delete a temp that another process could still be using.
Observation receipts use the same protocol.

`sourcePayloadDigest` is:

```text
sha256:<64 lowercase hexadecimal characters>
```

It is SHA-256 over only `MarketDataSourcePayloadEnvelopeV1` from section 3.1. The
derivation order is fixed:

1. strictly validate and freeze every `SourceInputV1`, the output `dataDate`, target,
   `calculationDate`, and `calculationVersion`;
2. construct and validate the one source-payload envelope;
3. compute `sourcePayloadDigest` from its `CanonicalJsonV1` bytes;
4. derive the contained canonical path from scope, ticker/source ID, `dataDate`, and
   the digest hex;
5. construct the strict artifact with that exact digest and persisted
   `calculationVersion`; and
6. compute `artifactDigest` over the complete canonical artifact payload excluding
   only `artifactDigest`, then publish and reopen/validate it.

The input/root source preimages never hash `MarketDataArtifactIdentityV1`, a path,
another digest derived later in this sequence, or a volatile timestamp. The final
`artifactDigest`, in contrast, protects the complete first-published artifact,
including its retained provenance timestamps. The root artifact `fetchedAt` is
the maximum validated `fetchedAt` among its provider `sourceInputs`; every V1
artifact requires at least one provider input. Registry inputs do not manufacture a
fetch instant.

An equal complete source-payload envelope maps to the same path and is idempotent.
A later equal fetch reopens and fully validates the existing path, confirms its
root envelope and calculation result, and returns the entire first-published
artifact unchanged. This retains all original admission/cutoff/fetch/verification
instants and pagination metadata, not only root `fetchedAt`. For the calculation
result comparison, remove only root `acceptedAt` (where present), `asOfCutoff`,
`fetchedAt`, and `artifactDigest`, and replace `sourceInputs` with the ordered
`{ role, inputDigest }` projection. All remaining fields must be canonically equal
to the newly calculated candidate; a mismatch is `artifact_collision`, not reuse.
This comparison also applies to a concurrent `EEXIST` winner. It then
publishes a new immutable observation receipt with the new `checkedAt`; the job/API
result reports `idempotent_reuse`. A path whose existing canonical identity/digest/
bytes fail those invariants is a typed collision or corruption; it is never
overwritten. A corrected input on the same `dataDate` receives a different source
digest and therefore a new immutable revision. V1 transformation changes that would
alter output for an equal source payload require a separately reviewed storage
version; they must not overwrite a V1 path.

### 5.3 Observation receipts and latest cache

Canonical content and the act of confirming that content as the current provider
state are separate. Every successful Technical publication/reuse and every
successful Overview module publication/reuse writes exactly one strict create-only
receipt:

```text
MarketDataObservationReceiptV1 = {
  schemaVersion: "market_data_observation_receipt_v1",
  jobId,
  target:
    { kind: "technical", ticker }
  | { kind: "overview", moduleId, sourceId },
  acceptedAt, checkedAt,
  artifactIdentity: MarketDataArtifactIdentityV1,
  receiptDigest
}
```

`checkedAt` is frozen after all strict source inputs for the publication unit have
been normalized and validated and its expected content identity is fixed, before
receipt publication. A concurrent content `EEXIST` may change the result from
`published` to `idempotent_reuse` without changing that check instant. For an
Overview job, one job-level `checkedAt` is frozen after all source attempts and
module validations settle; every successful module receipt from that job uses that
same instant. A failed/retained module has no new receipt. `receiptDigest` is the
SHA-256 `CanonicalJsonV1` digest of the complete receipt excluding only that field.
The receipt contains no source body, credential, header, request ID, absolute path,
or arbitrary provider error.

Latest selection is authoritative only from validated immutable receipts, never
from artifact `dataDate`, artifact `fetchedAt`, file modification time, job
completion order, or mutable `latest.json`. `LatestMarketObservationOrderV1` parses
`acceptedAtEpochMs` numerically and chooses the greatest admission instant. This
means A at t1, corrected B at t2, and re-observed A at t3 resolves to the t3 receipt
even though A reuses the t1 content artifact. It also means an older-admitted job
that finishes after a newer-admitted job cannot roll latest backward.

At the greatest admission millisecond, all valid receipts for one target must point
to the same artifact identity. If they do, the lexicographically smallest `jobId`
is the deterministic equivalent-receipt choice. If they point to different
artifacts, current order is unprovable and resolution fails closed with
`latest_resolution_failed`; digest order must not guess a provider vintage.

`latest.json` is only a replaceable atomic cache of the selected receipt identity
and artifact identity. It contains no absolute path and is never sufficient evidence
of latest. Every read enumerates the validated contained receipt identities needed
to prove that no newer admission exists; it may use a matching valid cache entry
only after that proof. A stale, absent, or corrupt cache is rebuilt from receipts
and cannot change the selected artifact. Concurrent cache writers are harmless
because either result is revalidated against receipts on read.

Publication order is canonical artifact create/reuse, reopen/validation, observation
receipt no-replace creation, and only then best-effort cache refresh. A canonical
artifact without a valid receipt is an orphan and is never latest. A receipt is the
publication commit point; failure before it publishes no new current observation.
Once a receipt exists, cache-write or later job-record failure cannot erase or hide
that committed observation.

There is no automatic retention deletion, compaction, or backfill. The initial UI
selects only the authoritative latest observed revision; historical content or
receipt browsing is deferred.

V1 deliberately has O(total receipt filenames for the target) normal-read
enumeration. `latest.json` is not a bounded index and does not reduce that proof
cost. DR-A1 must exercise representative receipt counts and report the enumeration
cost; it must not describe this cache as a constant-time latest lookup. Directory
sharding, an authoritative bounded index, and receipt-group skipping are deferred
to a separately reviewed storage/order contract rather than improvised in DR-A1.

### 5.4 Strict artifacts and fallback

`TechnicalChartDatasetV1` and every Market Overview module are closed strict schemas.
Unknown fields, invalid dates, non-finite values, inconsistent units, duplicate
canonical output identities, incomplete-pagination claims, digest mismatch, and path
mismatch are corruption, not unavailable market observations. A unique canonical
observation that explicitly records `duplicate_identity` or `missing_expected_row`
detected in a proved-complete source response is valid; it does not persist duplicate
canonical identities.

Repository reads never silently skip corruption:

1. validate path containment, then enumerate receipt filenames for the target and
   parse their numeric admission identities without trusting file timestamps;
2. if no observation receipt exists, return 404, including when safely contained
   orphan content exists; an unreadable/unsafe directory is a repository error,
   not evidence of absence;
3. resolve the greatest admission group under section 5.3, validate each receipt and
   its exact pointed artifact, and verify receipt/path/body/digest/target identity;
4. if the newest receipt or target artifact is corrupt, scan prior receipts in
   deterministic admission order and select the first fully valid prior observed
   revision, reading at most 256 receipts, 256 MiB total, and two seconds;
5. return that prior revision with a typed `artifact_corrupt_fallback` warning that
   names only the sanitized artifact identity; or
6. return a typed 500 if receipts exist but no valid observed revision
   remains, same-instant latest receipts disagree, or the repository itself cannot be
   read safely. Exhausting a scan limit before proving a valid receipt/artifact pair
   is `artifact_recovery_bound_exceeded`; it never returns an unvalidated older file.

The 256-receipt recovery limit counts every inspected receipt, including the newest
group and repeated references to the same artifact, not 256 distinct artifacts.
Consequently, 256 newer receipts pointing to one corrupt artifact can prevent
reaching an older valid artifact. V1 returns the typed bound error in that case;
fallback is bounded best effort, not a guarantee that all surviving history can be
reached. A cache hit or shared artifact digest must not bypass receipt validation,
tie-conflict checks, or the recovery budget.

An orphan artifact without a valid receipt never participates in latest selection.
An absent, stale, corrupt, or backwards-written `latest.json` cache is reconstructed
after authoritative resolution and is not itself an artifact-fallback condition.
Startup reconciliation ignores unowned private temps; it never deletes an immutable
artifact or receipt merely because a job record is interrupted.

For Technical data, explicit `latest` remains an error, while `auto` must display a
valid Snapshot with the same visible warning when no artifact survives; if Snapshot
is also invalid, `auto` is an error. For Market Overview, each unaffected source module
remains available while the failed module retains its prior valid revision and
warning. Fallback is never labelled latest without its actual `dataDate`, original
artifact `fetchedAt`, and receipt `checkedAt`.

The Overview endpoint applies that read independently per module. With no receipt
for any implemented module it returns 404. With at least one valid/fallback
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
| { kind: "gap", date, reason: "source_all_null" }

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

CurrentCodeHistoryBoundaryAvailableV1 = Extract<
  CurrentCodeHistoryBoundaryV1, { state: "available" }
>

TechnicalChartDatasetV1 = {
  schemaVersion: "technical_chart_dataset_v1",
  calculationVersion: "technical_chart_calculation_v1",
  ticker, jquantsCode, instrumentName, priceUnit: "JPY", volumeUnit,
  acceptedAt, asOfCutoff, calculationDate, queryFrom, queryTo,
  calculationFrom, calculationTo, eligibleThrough,
  historyBoundary: CurrentCodeHistoryBoundaryAvailableV1,
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

`historyBoundary` records the accepted current-code-only limitation; it is not a
listing or lifetime assertion. The eligible-end-date master must satisfy the exact
family predicate and rejection order in section 3.3. `CoName` is only a validated
current source label, not an expected identity; Technical `instrumentName` is that
accepted source string exactly. Any identity rejection fails
`instrument_identity_unverified`, but a valid current row does not upgrade
`historicalIdentity` from `not_verified`.

The mapper accepts strictly positive adjusted open/high/low/close values with
`low <= open/close <= high`, finite non-negative adjusted volume, a valid official-
session date, and one row per `(code,date)`. Valid volume zero is retained. A source
row whose entire adjusted OHLCV set is null becomes `source_all_null`; a partially
null row is invalid. An absent official-session row on or after
`sourceCoverageFrom` is never synthesized as a gap. Incomplete pagination is
`source_pagination_incomplete`; with complete pagination, absence at
`eligibleThrough` is `source_not_yet_updated` and any earlier absence is
`source_invalid_response`. Duplicate rows, a future date, zero/negative price,
negative volume, impossible price ordering, or incomplete source/calendar coverage
fails the whole refresh before publication.

`acceptedAt` and `asOfCutoff` are frozen at successful job admission. The source-
eligibility rule is `jquants_daily_bars_eligibility_v1`: when the Tokyo calendar date
is an official TSE session and admission is at or after 16:30:00 JST,
`eligibleThrough` is that date; otherwise it is the latest official session strictly
before the Tokyo calendar date. This boundary is based on the documented target
update time, not a guarantee of completion, and is reverified in DR-T0. If the latest
eligible session is neither an explicit all-null source row nor a valid bar,
the job fails `source_not_yet_updated` and retains the previous authoritative
observation.

`queryFrom` is the same calendar date ten Gregorian years before `calculationDate`,
inclusive. When `calculationDate` is February 29 and the target year is not a leap
year, `queryFrom` is March 1; it is never moved back to February 28. It is fixed
before source dispatch rather than derived from `eligibleThrough`; this avoids a
circular calendar request and keeps the inclusive bounds within ten Gregorian
years. After the calendar selects `eligibleThrough`, `queryTo = eligibleThrough`, and
the daily-bars query is exactly the inclusive range `[queryFrom, queryTo]`.
`calculationFrom = sourceCoverageFrom` and `calculationTo = queryTo`. Official
sessions before `sourceCoverageFrom` are not persisted, do not enter aggregation or
indicators, and receive no inferred listing or missing-data meaning. If the section
3.3 `historyCoverageClipped(historyBoundary)` predicate is true, the artifact carries
the single-boundary `history_coverage_clipped` warning with the exact start date.
Every artifact also carries
`historical_identity_unverified`.
`calendarCoverageFrom` is the earlier of the Gregorian Monday containing
`queryFrom` and the first day of `queryFrom`'s Gregorian month;
`calendarCoverageTo` is the later of the Gregorian Sunday containing
`calculationDate` and the last day of `calculationDate`'s Gregorian month. These
bounds are known before source dispatch. The calendar input covers that exact
inclusive range in one request; `eligibleThrough` must fall inside it, so eligibility,
source coverage, and both leading and trailing partial status can be proved without
a second calendar query.

`dataDate` is the last actual renderable bar date inside
`[calculationFrom, calculationTo]`, never the request end, fetch date,
or a gap date. Publication requires at least one renderable bar in
that calculation envelope. A proved-complete response containing only gaps fails the
Technical job with `source_no_observation`, publishes no artifact or receipt, and
leaves an existing authoritative observation unchanged; when no prior observation
exists, the latest GET remains 404. A gap-only subperiod remains valid when at least
one renderable bar exists
elsewhere in the dataset. If the provider cannot satisfy the exact requested ranges
within the DR-T0-frozen bounds, the job fails rather than shortening them.

For the chart engine, fewer than 251 valid bars after `sourceCoverageFrom` remain
legitimate input and indicator-specific warm-up rules apply. This preserves Phase 2
section 7.0's existing short-history behavior for
`AdvancedTechnicalResult`; Dashboard Refresh neither relabels pre-listing sessions
as missing data nor changes the production 251-bar selector. It also does not claim
that `sourceCoverageFrom` is an IPO or listing date.

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

A week/month is complete only when its Gregorian period has ended before
`calculationDate`, the calendar envelope contains every official session
in the period, and its final session is no later than `eligibleThrough`. If the
calendar proves that the first weekly/monthly period contains a session inside the
same Gregorian period but before `sourceCoverageFrom`, the candle formed only from
retrieved rows is deliberately
`partial: true`; every indicator and cross field is `unavailable/partial_period`, and
that candle is excluded from indicator inputs. This leading-range truncation is not
a source/calendar coverage failure. If no earlier official session exists, the
normal completeness rules apply. No omitted session is called pre-listing or used to
infer an IPO date. A trailing in-progress candle is likewise
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
- Every selected source displays its actual `dataDate`, original artifact `fetchedAt`
  where applicable, authoritative receipt `checkedAt` for refreshed data, source
  label, and fallback state.

Source precedence is evaluated before interval availability. If a newer Snapshot wins
`auto` while week/month is requested, the scoped unavailable state offers an explicit
switch to `latest`; it does not silently choose the older artifact or calculate a
series from Snapshot rows.

After a successful Technical job, the still-current ticker/request performs one
latest GET through the authoritative receipt resolver. Only a successful read may
replace the chart and set `chartSource=latest` through History API; the job's exact
result is not assumed to be authoritative latest if a newer admission has committed.
A failed read retains the prior displayed chart with a warning. A completed stale
job cannot change another ticker, tab, interval, URL, focus, or chart.

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

Modules 1-4 ship in DR-M1a-c/M2; modules 5-6 ship in DR-E1/E2. An unimplemented module
is not rendered as if unavailable source data.

Every available or fallback module always displays source, endpoint/schema revision,
`dataDate`, original artifact `fetchedAt`, authoritative receipt `checkedAt`, cadence,
unit, availability/fallback state, and calendar days elapsed from `dataDate` to the
Browser's local current date. `checkedAt` says when this exact payload was most
recently confirmed; it is not rewritten into the content artifact. Elapsed days are
a presentation-only date difference, not a market calculation or freshness claim.
Dates never use traffic-light color alone.

Every module persists this closed common envelope:

```text
MarketOverviewModuleArtifactV1 = {
  schemaVersion: "market_overview_module_v1",
  calculationVersion: MarketDataCalculationVersionV1,
  state: "available" | "unavailable",
  reason: PersistedModuleUnavailableReasonV1 | null,
  moduleId, sourceId, asOfCutoff, calculationDate,
  dataDate, fetchedAt, cadence, displayUnit,
  historyBoundaries: CurrentCodeHistoryBoundaryV1[],
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

`historyBoundaries` is exactly empty for modules 1-4, exactly the `13210`
current-code boundary for module 5, and exactly the `13210`, `26330` boundaries in
that order for module 6. Each agrees with its end-date master and daily-bars source
inputs. Every entry has `historicalIdentity: "not_verified"`; arbitrary extra
boundaries and any continuity claim are invalid.

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
    reason: "source_no_observation" | "insufficient_common_dates" | "invalid_base",
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
ranges is available. If all five are unavailable, root state is unavailable and the
reason precedence is `source_no_observation`, then `invalid_base`, then
`insufficient_common_dates`. Root reason is null exactly when root state is available.

For an available artifact, `dataDate` is its latest actual observation date/common
range end. For an unavailable artifact, `dataDate` is the schedule/query-proved
expected identity date used by its unavailable observation; foreign flow inherits
Phase 2 and uses expected date-only `publishedDate`. The state and visible reason
make clear that this is a requested/expected identity, not a claimed observed value.
This same required date is the storage directory identity. If no expected date can be
proved, publication is forbidden as unproved coverage. A module cannot substitute
another module's payload or unit.

ETF modules use this additional closed no-observation contract. Here
`eligibleThrough` is a calendar/query-proved expected identity, not a claimed price
observation:

| Complete input condition | top-level `dataDate` | root state/reason | payload | `historyBoundaries` |
| --- | --- | --- | --- | --- |
| 1321 has zero renderable bars because the response is empty or every mapped row is `source_all_null` | `eligibleThrough` | `unavailable/source_no_observation` | exactly one `Etf1321EodObservationV1` with `identity = dataDate = eligibleThrough`; `observationState` and every numeric field are `unavailable/source_no_observation`, `previousCommonDate = null` | empty response: unavailable 13210 boundary; all-null rows: available 13210 boundary beginning at the earliest mapped row |
| relative ETF has zero renderable bars on either required side | `eligibleThrough` | `unavailable/source_no_observation` | exactly five unavailable ranges in fixed order, each `source_no_observation`, `rangeStart = rangeEnd = null`, `commonDateCount = 0` | 13210 then 26330; each empty side is unavailable and each side with mapped rows is available from its earliest row |
| both relative-ETF sides have renderable bars but a range has zero common dates | `eligibleThrough` when all five ranges are unavailable; otherwise the latest actual common `rangeEnd` | `unavailable/insufficient_common_dates` only when all five ranges are unavailable | that range is `insufficient_common_dates`, with null start/end and count 0; other ranges retain their independently computed state | both boundaries available |
| a relative-ETF range has exactly one common date | same rule as the preceding row | `unavailable/insufficient_common_dates` only when all five ranges are unavailable | that range has identical non-null `rangeStart`/`rangeEnd` and `commonDateCount = 1` | both boundaries available |

For every provider input, `dataDateOrEffectiveRange` is exact: each daily-bars input
uses `{ from: queryFrom, through: eligibleThrough }`, the shared calendar uses
`{ from: calendarCoverageFrom, through: calendarCoverageTo }`, and each master input
uses `eligibleThrough`. Each corporate-action registry input uses
`effectiveRange = { from: queryFrom, through: eligibleThrough }`. Empty normalized
bar observations hash as `[]`; explicit all-null rows remain sanitized gap rows in
their input digest.

Every canonical ETF artifact requires `historical_identity_unverified`.
`history_coverage_clipped` is additionally required exactly under the calendar-based
section 3.3 predicate: module 5 tests its one available 13210 boundary, while module
6 tests both fixed boundaries and emits the one relative-module template with both
tokens. An unavailable boundary does not trigger it, and a non-session gap between
`queryFrom` and the first official session does not trigger it. `source_gap` is
required when an input contains at least one explicit `source_all_null` row. No
source-failure warning is added to a successfully observed unavailable artifact.
Required codes occur once and are sorted by the closed
`MarketDataWarningCodeV1` order. A proved-complete
no-observation artifact is a successful `published` or `idempotent_reuse` module
result and commits a new observation receipt. That receipt becomes authoritative
even when an older available receipt exists; the older artifact is not presented as
fallback. Provider/schema/pagination/identity failures still publish nothing and
retain the prior receipt under section 8.

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
merges; DR-M1a must not assume `(dataDate, issueCode, issueType)` or any unpublished
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
Weekly and daily cadence are not normalized. A refetch records the confirmed provider
vintage through a new receipt. New content stores its original fetch instant and
digest; equal content reuses that immutable artifact and advances only receipt
`checkedAt`. The UI does not claim that a provider vintage overwritten before local
observation can be reconstructed.

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
The 1321 payload persists its `CurrentCodeHistoryBoundaryV1`. The end-date master
must satisfy `etf_1321` in `current_master_expectation_v1`; its `CoName` is only the
validated current source label. Historical identity remains unverified. Sessions
before `sourceCoverageFrom` are outside the retrieved series without an inferred
listing meaning. A missing row after that boundary, a current-master predicate
failure, or incomplete pagination fails before publication. Every available or
unavailable 1321 artifact carries `historical_identity_unverified`. Its one shared-
calendar input applies the same `jquants_daily_bars_eligibility_v1` end-date and post-
start official-session coverage checks as Technical. Zero-renderable-bar publication
uses the exact `eligibleThrough` unavailable shape and authoritative receipt rule in
section 7.1.

### 7.8 1321/2633 relative ETF price proxy

1321 (`13210` in J-Quants) is labelled as a Nikkei 225-linked ETF proxy. 2633
(`26330`) is labelled as an unhedged S&P 500-linked ETF whose JPY market price
includes USD/JPY, Tokyo/US trading-hour, tracking, fee, and market-price effects.
Although the issuers define their target indices using total-return index concepts,
this module compares only distribution-excluding, adjusted TSE market prices and is
not ETF/index total return. The adapter verifies both eligible-end-date master rows
against the `etf_1321` and `etf_2633` expectations and verifies their corporate-
action-registry inputs before accepting bars; neither current name is an equality
predicate. Each series begins at its `sourceCoverageFrom` within the maximum ten-year
query. Earlier sessions are excluded without an inferred listing meaning. Historical
identity is not guaranteed; both module artifacts and UI retain the exact
`historical_identity_unverified` warning. One `trading_calendar` input is shared by
the two code series within this module; both must use the same `eligibleThrough` and
each must independently pass the post-start official-session coverage check. Empty,
all-null, one-sided empty, zero-common-date, and prior-receipt behavior uses the exact
section 7.1 state table.

For `3M | 6M | 1Y | 3Y | Max`, with `1Y` default:

1. derive `rangeEnd` as the latest exact common trading date;
2. for 3M/6M subtract exactly 3/6 Gregorian calendar months from `rangeEnd`; for
   1Y/3Y subtract exactly 1/3 Gregorian calendar years, clamping an invalid day to the
   last day of that month; `Max` has no lower bound within the artifact's retrieved
   current-code source range and is labelled with its actual first/last dates, not as
   fund inception history or verified continuous identity;
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

GET routes read only already published, validated local observations and never contact
J-Quants. Technical with no committed receipt is 404. Overview with no committed
module receipt is 404; a partially populated overview is 200 with strict per-module
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
  basis_break | source_gap | source_refresh_failed | history_coverage_clipped |
  historical_identity_unverified | job_record_write_failed

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
  { moduleId, state: "available", artifactIdentity,
    observationReceiptIdentity, checkedAt, payload, warnings }
  | { moduleId, state: "fallback", artifactIdentity,
    observationReceiptIdentity, checkedAt, payload, warnings }
  | { moduleId, state: "unavailable", artifactIdentity,
    observationReceiptIdentity, checkedAt, payload,
    reason: PersistedModuleUnavailableReasonV1,
    warnings }
  | { moduleId, state: "unavailable", artifactIdentity: null,
    observationReceiptIdentity: null, checkedAt: null, payload: null,
    reason: "not_collected" | "artifact_corrupt",
    warnings }
  | { moduleId, state: "not_implemented" }

TechnicalLatestResponseV1 = {
  schemaVersion: "technical_latest_response_v1",
  state: "available" | "fallback", artifact: TechnicalChartDatasetV1,
  observationReceiptIdentity, checkedAt, warnings
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

MarketDataObservationReceiptIdentityV1 = {
  scope: "technical" | "overview", tickerOrSourceId,
  acceptedAtEpochMs, jobId, receiptDigest, rootRelativeIdentity
}

MarketDataModuleResultV1 =
  { moduleId, state: "published" | "idempotent_reuse",
    checkedAt, artifactIdentity, observationReceiptIdentity, warningCodes }
  | { moduleId, state: "retained_previous", checkedAt,
    artifactIdentity, observationReceiptIdentity,
    failureCode, warningCodes }
  | { moduleId, state: "failed", checkedAt,
    artifactIdentity: null, observationReceiptIdentity: null,
    failureCode, warningCodes }

MarketDataJobResultV1 =
  { kind: "technical", state: "published" | "idempotent_reuse",
    checkedAt, artifactIdentity, observationReceiptIdentity, warningCodes }
  | { kind: "overview", checkedAt,
    moduleResults: MarketDataModuleResultV1[] }

MarketDataJobFailureCodeV1 =
  source_unauthorized | source_entitlement_required | source_rate_limited |
  source_timeout | source_not_yet_updated | source_no_observation |
  instrument_identity_unverified |
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
  result: MarketDataJobResultV1 | null
}
```

Variant `payload` objects are closed discriminated objects owned by their module ID;
they never accept arbitrary properties. Persisted artifact warnings use only
`cadence_changed`, `basis_break`, `source_gap`, `history_coverage_clipped`, or
`historical_identity_unverified`, with deterministic allowlisted messages and
`artifactIdentity: null`; an artifact
must not contain a reference to its own future digest. Corruption/refresh-failure
warnings are view/job metadata, not stored content. A completed Technical job has the
`technical` result and can therefore distinguish a new publication from
`idempotent_reuse` while carrying its new `checkedAt` and receipt identity. A
normally completed or failed Overview job has the `overview` result and
exactly one ordered module result per implemented module. Its root `checkedAt` is the
single instant frozen under section 5.3; every module result carries that same value,
but only `published`/`idempotent_reuse` creates a new receipt. `retained_previous`
identifies the prior authoritative receipt/artifact while reporting the current
attempt's failure; `failed` has neither identity. A job-wide failure before a module
is attempted is explicitly assigned to that module during adjudication; it does not
omit the module result or manufacture a source observation.

Root `failure` is non-null exactly for status `failed`. A failed Technical job uses
its direct failure code. A failed Overview job always uses `all_modules_failed`; its
overview result retains each module's actual failure code. `result` is non-null for
a completed job and for every normally failed Overview job;
it is null for failed Technical, cancelled, interrupted, and every nonterminal state.
For `completed` (including completed with warnings), `cancelled`, `interrupted`, and
every nonterminal state, root `failure` is null; completed-with-warning causes exist
only in the result. `all_modules_failed` is root-only and is never a module result.
Artifact and receipt identities contain only root-relative identity fields and
digests. Nullable timestamps/terminal fields are present as explicit nulls when
inapplicable. HTTP GET returns 200 for a validated envelope, including a terminal
failed job view; errors use the section 8.5 union.

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
artifact or receipt and retains the previous authoritative observation. Such
failures appear only in the job view
and, where a prior value is retained, as `source_refresh_failed` UI warning.

The boundary is closed:

| Condition after source attempt | Canonical publication | Representation |
| --- | --- | --- |
| complete official response proves no observation | yes | module `unavailable/source_no_observation` |
| missing expected module observation or duplicate module-owned observation key in a complete, allowlist-proved response | yes | unique observation/module unavailable with `missing_expected_row` / `duplicate_identity`; this does not include current-master rows |
| valid observed denominator is zero | yes | observed numerator/denominator stay available; only derived field is `zero_denominator` |
| ambiguous eligible correction vintage | yes | observation `ambiguous_vintage` |
| valid ETF rows but fewer than two common dates or invalid base | yes | affected range field `insufficient_common_dates` / `invalid_base` |
| current-master missing/duplicate/effective-date/code/product/market/name rejection | no | job module `instrument_identity_unverified` using the section 3.3 precedence; retain previous authoritative receipt |
| unknown non-master enum/code/field, partial null, non-finite/negative/impossible value, other identity mismatch, or future row | no | job module `source_invalid_response`; retain previous authoritative receipt |
| incomplete pagination or coverage cannot be proved | no | `source_pagination_incomplete`; retain previous authoritative receipt |
| auth, entitlement, network, timeout, 429, response-size, or deadline failure | no | corresponding async job failure; retain previous authoritative receipt |

An unknown extra source identity is schema failure; it is not treated as the inverse
of a missing expected identity. Negative/non-finite and unknown-type reasons are
intentionally absent from `MarketDataValueV1` because no valid artifact may contain
them.

### 8.2 Shared session and routing

Market-data mutations reuse the one process-local Dashboard session returned by
`GET /api/session`, including its exact `X-Dexter-CSRF` token, constant-time check,
Host/Origin rules, no-CORS rule, no-store/nosniff headers, JSON media-type policy,
body accounting, and the `{ error: { code, message } }` envelope/message-sanitization
mechanism from Phase 4. The public code vocabulary is domain-owned, not shared:
Phase 4 keeps `forbidden_host`, `forbidden_origin`, `csrf_failed`, and
`payload_too_large`; Market Data maps those security failures to `request_forbidden`
and its body-limit failure to `request_body_too_large` under section 8.5. Shared
guards return internal reasons that each route adapter maps to its own closed
codes; Market Data must not replace a Phase 4 public code or vice versa.

The inherited job contract is limited to that session/security owner, admission
conflict, bounded lifecycle, polling, cancellation checkpoints, recovery, and safe
error behavior. Market Data does not inherit Phase 4's preflight resource, unchecked
confirmation checkbox, or `confirmExternalFetch` request field. Section 8.1's
labelled refresh button is the one explicit external-fetch intent for this separately
approved workflow.

DR-C1 extracts or composes that security owner so Strategy Validation and Market Data
cannot mint independent CSRF tokens. Market routes are dispatched before the generic
non-GET 405 guard while `/api/analyses/*` remains GET-only. Unsupported methods return
405 with exact `Allow` and never fall through to a different domain.

POST body cap is 4,096 UTF-8 bytes. DELETE has zero body bytes. Content-Length alone
is not trusted; chunked bodies are counted and stopped at the same cap.

### 8.3 Dashboard-process J-Quants coordinator

One coordinator owned by one running Dashboard server process owns admission,
durable-job reconciliation, and request rate for every Dashboard J-Quants job:
Strategy Validation, Technical refresh, and Overview refresh. A healthy process
admits at most one nonterminal job across all three kinds and both durable job
repositories. An uncertain record is an admission blocker, never evidence of an
idle coordinator. While a healthy lease is active, another POST receives 409
`active_job_conflict`; its safe message may name only the active job kind and does
not expose provider or source inputs. Recovery-required state takes precedence over
ordinary active-job conflict and cooldown.

The coordinator's closed admission discriminator is
`strategy_validation | technical_refresh | overview_refresh`. It shares the lease,
native-adapter inventory/publication proofs, recovery barrier, cancellation-
checkpoint interface, and rate limiter. Domain adapters alone parse, persist,
validate, and reconcile their native records. The coordinator receives validated
identity/terminal-state projections and outcomes, not a second generic persisted
job schema. Market Data does not own Phase 4 records, and vice versa.

All J-Quants requests from these Dashboard jobs share that process-local rate limiter
and the existing configured requests-per-minute ceiling. A Dashboard job may make
requests only through its current coordinator lease. Operation-local limiters inside
individual Dashboard job runtimes are not sufficient, and constructing a new runtime
or completing/failing/cancelling a job must not erase retained process attempt times.

#### Empty-start admission: `dashboard_empty_start_admission_v1`

Choose empty-start admission, not carry-over debt inside an accepted job and not a
second post-admission limiter with a different feasibility model. The coordinator
uses one process monotonic clock for admission and actual dispatch. It retains
timestamps of all actual original/pagination/retry attempts, including failed or
cancelled fetches, until their age is at least 60,000 ms. Merely finishing the job
does not clear this log. An active lease is released only after the durable terminal
and all-domain inventory proofs below, not merely an in-memory terminal event or a
worker's `finally`. Cooldown is a coordinator condition, not a nonterminal job or a
held job lease.

Every job-creation POST for the three Dashboard kinds, including a zero-attempt
Strategy Validation plan, follows this order after Host/Origin/CSRF/media/body and
local request/preflight/registered-module validation:

1. Under the one admission critical section, require successful shared startup
   recovery and no `admission_recovery_required` latch. An existing healthy active
   or provisional lease returns the existing HTTP 409 `active_job_conflict`, without
   `Retry-After` because completion time is unknown. Before admitting from idle,
   strictly inventory both repositories and prove that neither contains a durable
   nonterminal record. An unexpected record or an unprovable inventory enters
   recovery-required state; a domain-local active scan is insufficient.
2. With no active lease, expire timestamps with age >= 60,000 ms. If any remain,
   return HTTP 409 `active_job_conflict` immediately, now meaning temporarily
   unavailable coordinator admission. Add a seconds-only `Retry-After` header:

   ```text
   retryAfterSeconds = ceil((latestRetainedDispatchMs + 60_000 - nowMs) / 1_000)
   ```

   It is an integer from 1 through 60, based on the newest retained attempt, not
   the first free rate slot or the prior job's completion time. The safe message is
   `J-Quantsの通信間隔を確保するため、あと {retryAfterSeconds} 秒待って再度実行してください。ジョブは未受付です。`
   Only that validated integer is interpolated; no prior target, input, or
   credential is disclosed. Do not claim that a completed job is still running.
3. This cooldown response creates no job/run/receipt, freezes no `acceptedAt` or
   execution-budget origin, consumes no Phase 4 preflight, reserves no lease, and
   dispatches no request. The server does not hold the HTTP request until expiry,
   enqueue a job, or start a timer that will accept it later. With cooldown alone,
   active-job GETs return their normal no-active-job envelopes. There is no pending
   server job to cancel; DELETE for a prior job keeps its existing lifecycle rules.
4. Only a later explicit user retry can start work. Revalidate session, preflight
   expiry/consumption/digest and local feasibility on that request. A still-valid
   Phase 4 preflight and confirmation remain usable; expiry returns the existing
   `preflight_expired` and requires a new local preflight, not an automatic one.
5. Only when the process log is empty and no lease is active, atomically reserve the
   new lease and freeze `acceptedAt` and its monotonic budget origin. Recheck
   preflight expiry/consumption/digest inside this same critical section before
   reservation; validation only outside the section is insufficient. Create the
   normal job through `dashboard_job_recovery_v1` below. Only a proved `published`
   create becomes the active lease, consumes the Phase 4 preflight, and queues its
   execution once. Another simultaneous POST cannot pass the same check. A rejected
   promise is not proof that nothing was saved: release after a failed create only
   under the explicit all-domain absence rule. Never delete a durable job or roll
   back a consumed preflight to hide an uncertain publication.

Neither an HTTP disconnect after a cooldown refusal nor passage of `Retry-After`
can start an external request. Non-finite/backwards process-clock state fails closed
before admission (`internal_failure` for Phase 4, `invariant_failure` for Market
Data), with no preflight consumption. Wall-clock changes never clear the attempt log
or drive cooldown arithmetic. A process restart has a new in-memory log and does
not create a cross-process/account-level guarantee.

This establishes the same empty initial log used by Phase 4 sections 9.1-9.2 for
every accepted job. Keep `rateLimitVersion: rolling_attempt_log_v1`, frozen rate,
attempt/deadline caps, and the existing formula unchanged:

```text
minimumDispatchDurationMs = N === 0 ? 0 : floor((N - 1) / R) * 60_000
```

The duration is relative to successful `acceptedAt`, not the first button click or
a rejected POST. The Phase 4 5,400,000-ms deadline and each Market Data job's own
budget begin only at that acceptance. Prior-job cooldown consumes neither budget.
For R=1/N=90, a prior attempt requires a refused admission until expiry; after a new
acceptance, the last minimum dispatch remains at +5,340,000 ms. R=1/N=91 remains
infeasible at local preflight, regardless of cooldown. Do not merely wait for some
capacity after acceptance while retaining the old empty-log estimate.

DR-C1 appends this fixed notice to the existing Dashboard Phase 4 preflight
`warnings` array, preserving its schema and the current warning/error surfaces:
`最小dispatch時間とExecution budgetは受付成立後の時間です。直前の通信から最大60秒は受付できず、手動再試行が必要です。`
DR-T3/DR-M2/DR-E2 include the same admission limitation next to their refresh/quota
explanation. No UI automatically retries a refused POST, polls cooldown, clears a
valid confirmation, or adds a queued-job status. The existing latency/pagination/
retry caveats still apply after acceptance.

This is an explicit versioned addition to Dashboard admission and its warning/error
copy, not a behavior-preserving refactor claim. Phase 4 routes, public code enums,
preflight/job/run/control schemas, accepted-job calculation semantics, and standalone
CLI behavior stay unchanged. The admission and recovery versions are Dashboard
coordinator policies, not replacement values in persisted Phase 4 `rateLimitVersion`.

#### Durable job guard: `dashboard_job_recovery_v1`

Use a sticky fail-closed recovery barrier, not best-effort lease release or live
automatic repair after an uncertain write. The process states are `initializing`,
`idle`, `provisional`, `active`, and `admission_recovery_required`. Only healthy
`idle` may acquire a new provisional lease. All job mutations, inventory/release
proofs, and admission transitions share the same critical section; native adapters
must not use independent mutation queues to bypass it. External fetches never hold
this critical section, but each dispatch rechecks the live lease and recovery latch.

Each native repository adapter exposes this internal closed result for job create
and every atomic replace, including progress, cancellation, and terminal writes:

```text
JobWriteOutcomeV1<T> =
  { state: "definitely_not_published" }
| { state: "published", record: T }
| { state: "ambiguous" }
```

- `definitely_not_published` requires proof that this invocation never attempted
  final-path promotion. It describes this write, not the absence of an older record.
- `published` requires a successful promotion, completed private-temp cleanup, and
  a strict final-path reread whose identity and complete canonical payload equal the
  proposed native record. A successful syscall alone is not that proof.
- Once promotion was attempted, any exception or missing/mismatching/unreadable
  final record is conservatively `ambiguous`. This includes final `link` success
  followed by cleanup failure, create success followed by final-read failure, and
  terminal `rename` success followed by read failure. Even known promotion success
  is not downgraded to `definitely_not_published`. Collision does not authorize
  adopting an existing job as this invocation's job.

These are internal proof outcomes, not new HTTP, job-status, or persisted schema
fields. DR-C1 adds the Phase 4 adapter contract without inferring outcomes from the
legacy exception kind. Proposed/previous native records stay with their owner; no
raw exception, path, or credential reaches the coordinator's public response.

| Write and proof | Required coordinator action |
| --- | --- |
| create is `published` | adopt that exact job into the active lease, consume its preflight once if applicable, and enqueue once; return the normal 202 |
| create is `definitely_not_published` | under the same critical section, prove the proposed final identity is absent and a fresh strict inventory of **both** repositories has zero nonterminal records; only then release the provisional lease and return the domain's sanitized 500, with no preflight consumption or dispatch |
| create is `ambiguous`, absence/inventory cannot be proved, or adoption/queueing fails after publication | retain the reservation as a recovery blocker and latch `admission_recovery_required`; never queue/requeue from the failed path or release merely because POST failed |
| replace is `published` and nonterminal | keep the same active lease and continue only its permitted lifecycle |
| terminal replace is `published` | validate the exact native terminal record and its required run/receipt associations, then strictly inventory both repositories; release only if zero durable nonterminal records remain |
| any replace is not `published`, or terminal/inventory proof fails | retain the blocker and latch `admission_recovery_required`, including when an in-memory terminal view exists |

No broad catch/finally, cancelled fetch, expired execution deadline, HTTP disconnect,
or controller removal releases this blocker. On latching, stop future dispatch and
abort any in-flight fetch through its existing controller; quota may already have
been consumed. A canonical promotion that already crossed its noninterruptible
commit boundary may finish, but cannot reopen admission. Late worker callbacks
cannot rewrite jobs, enqueue work, or clear the latch. Existing attempt times remain
in the process log. A preflight not yet consumed stays unconsumed but cannot be reused
in this blocked process; a consumed one is never restored.

The latch stays set for the lifetime of this process, even if a later diagnostic
read succeeds. Recovery requires a user-initiated Dashboard restart and successful
shared startup reconciliation. There is no unlock API, automatic write retry,
repair timer, force flag, or new persisted lock/recovery-marker file. This deliberately
trades availability after a transient storage error for an unambiguous single-job
boundary; a private-temp cleanup failure after promotion can require a restart.

#### Shared startup and read semantics

The adapter registry has two fixed repository slots: `strategy_validation` and
`market_data` (the latter owns both refresh kinds). It is frozen before initialization,
even with zero registered source modules. DR-C1 uses the real Phase 4 adapter and an
absent-domain probe for Market Data: only an absent or empty `market-data/jobs/`
directory proves that unimplemented domain empty; any entry or probe failure blocks
startup. DR-O1 supplies the real common Market Data job repository/adapter before
either refresh route may create a job. DR-T2 depends on that foundation and never
creates a competing repository or coordinator.

One shared startup barrier replaces independent Dashboard domain initialization.
First perform a read-only strict inventory of both slots, including native schema,
filename/identity, and terminal-record validation. Do not run a domain's cleanup or
status-reconciliation side effects before this combined inventory is adjudicated.
An in-memory completion from a previous process is never startup evidence.

| Combined durable inventory | Startup action before admission |
| --- | --- |
| zero nonterminal records, all records valid | finish only the native allowed temp cleanup, re-inventory both slots, and enter `idle` only after another zero/valid proof |
| exactly one valid nonterminal record in either slot | hold one recovery reservation; run only its native local reconciliation, then verify its terminal record/associations and re-inventory both slots; enter `idle` only at zero/valid |
| two or more nonterminal records, including one in each domain | latch recovery-required before any cleanup or rewrite; retain all records, choose no winner, and require investigation rather than automatically interrupting them all |
| corrupt/unknown record, invalid entry/identity, missing adapter, failed enumeration/read/cleanup/reconciliation, or ambiguous recovery write | latch recovery-required; preserve evidence and never treat that slot as empty |

Phase 4 reconciliation keeps section 7.6 of its source plan: pre-publication jobs
become `interrupted`; a `publishing` job with its exact fully verified final run
becomes `completed`; missing final run becomes `interrupted`; a suspect final run
follows the existing sanitized failure/retention rule. Do not blanket-interrupt a
valid already-promoted Phase 4 run. Market Data uses section 8.4: abandoned
nonterminal jobs become `interrupted` with null result, while committed receipts
remain independently authoritative. Neither adapter resumes external work. A
failed startup proof is sticky for that process, and restarting alone does not
repair persistent corruption or a multiple-nonterminal inventory. Investigate
without deleting records; any manual repair requires separate explicit authority.

Method, route/body, Host/Origin/CSRF checks retain precedence over these errors.
During `initializing` or recovery-required state, valid job-creation POSTs and job
DELETEs fail closed, and both `/jobs/active` routes return a sanitized 500 rather
than a false idle/busy view. The internal recovery reason maps to Phase 4
`artifact_unavailable` and Market Data `repository_failure`, with no `Retry-After`.
Initializing uses `ジョブ記録を確認中です。完了後に再度操作してください。`; the
latched state uses
`ジョブ記録の整合性を確認できないため、新規実行を停止しました。Dashboardを再起動してください。解消しない場合は記録を変更せず調査してください。`
No target, path, or uncertain completion time is interpolated. These mappings add
no public error code. Phase 4 preflight creation is also blocked in these states;
an ordinary active job or rate cooldown still does not block local preflight.

In a healthy process, Market Data's active route uses section 8.4's envelope.
Phase 4's active route returns its own native job or, for a Market Data lease,
409 `active_job_conflict` with only the kind-labelled safe message; it does not
return `job: null` while another domain blocks admission. True idle, including
rate-only cooldown after durable completion, uses each existing empty envelope.
Read/release/creation cannot interleave outside the shared critical section.

Exact job GETs may still return an independently validated terminal native record;
an uncertain/nonterminal record without a healthy active owner returns the same
recovery 500, never an apparently running ghost. Proved missing exact identity is
still 404. Section 8.4's validated Market Data in-memory completed view is the one
explicit exception to durable terminal reads; it carries its storage warning and
does not clear the latch. Snapshot, artifact/receipt, and valid run/case GETs retain
their own strict validation and can remain readable; a suspect Phase 4 run must not
bypass its existing job/run association checks. `GET /api/session` remains available.

Browser job-read failures stop automatic job polling, including visibility-triggered
resumption, until an explicit page reload; show the returned safe error in existing
surfaces and label retained nonterminal content as last-known, not currently running.
Do not parse message text to infer recovery or retry POST/DELETE automatically. A
reload can reread status but cannot clear a server latch. These error/recovery flows
are part of DR-C1 and the later Market Data UI steps, with no new styling or job-status
variant. Restart invalidates old CSRF/preflight capabilities as before.

#### Rate scope and accepted-job execution

This is not an account-global or cross-process guarantee. The standalone Phase 4 CLI
constructs its own `JQuantsExecutionRuntimeV1`, and another Dashboard process would
have another coordinator. Running a Strategy Validation CLI invocation, another
Dashboard server, or another J-Quants client concurrently with this Dashboard is an
unsupported operating mode and can exceed the account's effective limit. DR-X must
document that the user runs only one external J-Quants process at a time. No
credential, shared cross-process rolling-attempt log, filesystem lease, daemon, or
database is added by Dashboard Refresh.

The immutable receipt resolver in section 5.3 remains safe if two processes are
accidentally run: completion order cannot overwrite canonical content or define
latest. That storage safety does not turn concurrent external dispatch into a
supported or rate-coordinated mode.

Technical and Overview production jobs reuse Phase 4's
`rolling_attempt_log_v1`: a 30-second per-attempt timeout, at most two retries after
the first attempt only for network errors, HTTP 429, or HTTP 5xx, exact `Retry-After`
handling, deterministic 1/2-second fallback delays, and cancellation/deadline
precedence. HTTP 4xx other than 429, strict schema failures, and body/pagination
failures are not retried. Every initial, pagination, and retry attempt consumes the
shared Dashboard-process rate budget and its job cap.

Technical refresh is exactly one logical ticker/range bars query, one calendar-
envelope query, and one end-date security-master current-identity query. The whole
job allows at most 20 actual HTTP attempts including cursors and retries,
8,000 accepted rows, 32 MiB response bytes, and a 600-second deadline.
If ten years cannot fit those bounds, it fails pre-dispatch or on the first exceeded
bound with `external_schedule_infeasible` / `source_response_too_large`; it never
silently shortens history.

DR-M0 fixes the Overview production caps from the measured post-migration Standard
contract in the reviewed plan amendment required by section 3.4. DR-M1a-c register
their work under those exact merged DR-O1 caps and have no authority to choose larger
ones. Entitlement
failures are never retried; an HTTP 429 that remains after the inherited bounded
retry policy terminates with a typed rate-limit failure.

When DR-E1 adds modules 5-6, their shared source work is exactly two maximum-ten-year
bars queries, two end-date security-master queries, and one shared calendar-envelope
query; the local corporate-action registries make no HTTP request. The ETF increment
is capped at 40 actual attempts, 16,000 accepted rows, 64 MiB, and 600 seconds. Before
any DR-M1 module is registered, that increment is the whole Overview-job ceiling and
DR-E1 has no DR-M0 dependency. After one or more DR-M1 modules are registered, the
Overview ceilings are the merged limits for exactly
the registered DR-M1 modules plus those ETF increments; the whole-job deadline is at
most the corresponding DR-M0-frozen deadline plus 600 seconds. DR-E1 must prove the
increment with fixtures and the bounded Standard source gate; failure never shortens
`Max` or drops a module.

### 8.4 Market Data job lifecycle, recovery, and publication

The following strict lifecycle applies only to `MarketDataJobViewV1`:

```text
accepted -> running -> publishing -> completed
accepted/running/publishing -> failed (no receipt committed by this job)
accepted/running -> cancel_requested -> cancelled
accepted/running/cancel_requested/publishing -> interrupted (startup recovery only)
```

Job views contain schema version, UUID, kind, sanitized target, status, timestamps,
bounded progress counts, safe failure code/message, and terminal artifact identities.
They never contain credentials, raw rows, raw response, request ID, headers, absolute
paths, or provider exception text.

The common repository persists exactly this closed `MarketDataJobViewV1` payload
at `jobs/<jobId>.json`, with a 65,536-byte UTF-8 limit and filename/body identity
agreement. There is no second persisted wrapper. Create is atomic no-replace;
replace is atomic private-temp promotion to the existing exact job path. Both use
section 8.3's write outcomes, containment, strict reread, and coordinator guard.
The domain adapter alone validates result/receipt associations and native lifecycle.
Job records and attributable private job temps are not content/receipt revisions;
recovery never deletes or rewrites a canonical artifact or observation receipt.

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
`blockingKind`; only proved healthy idle returns both null. Initializing/recovery-
required state returns section 8.3's 500, not this empty envelope. The specific
`/jobs/active` route is dispatched before `/:jobId`. On reload, the matching Market
Data page reads it once, then polls that market job every 1,000 ms only while it is
nonterminal and the document is visible; polling stops on terminal state/unmount and resumes on
visibility return unless a job-read error stopped it under section 8.3. A Strategy
Validation blocker is shown but cannot be cancelled through a Market Data route.
This status polling is not market-data auto-refresh.

Cancellation is cooperative between source requests and before publication. DELETE
returns 202 while cancellation is being accepted, 200 for already cancelled, 404 for
missing, and 409 for `publishing`, `completed`, `failed`, or `interrupted`. Once
canonical promotion begins, it is not cancelled. A pre-publication source failure,
cancellation, or timeout writes neither content nor a receipt. A storage failure
before receipt commit may leave orphan content but no new current observation.
A committed receipt counts as successful publication even if the later cache or
job-record write fails; it must not be represented as an uncommitted failed fetch.

An Overview job first finishes all source attempts and module validation, then enters
`publishing`; DELETE is rejected from that point. Each module is an independent atomic
publication unit. A failed module retains its prior authoritative receipt and a
successful module may create a new one, exactly as recorded in the terminal
`MarketDataJobResultV1` union. There is never a partially written module artifact or
receipt. The Overview job is `completed` with warnings
when at least one implemented module commits a receipt for published or reused
content and another has a typed source, collision, or storage failure; it
is `failed` when no implemented module commits a receipt. A canonical typed
unavailable result from a proved-complete response counts as a successful
publication, not a provider failure. Already published sibling modules are never
rolled back after a later module fails. Startup reconciliation validates every
recorded receipt/artifact identity and reports an interrupted job without pretending
the set was atomic. A receipt committed before interruption remains authoritative
for that module; an orphan artifact committed before its receipt is ignored.

The section 8.3 shared startup barrier owns all recovery. Only after its combined
inventory permits single-job reconciliation does this adapter mark an abandoned
nonterminal Market Data job `interrupted`; it never resumes an external request.
A save failure after a successful external response reports that quota may have been
consumed. If failure occurred before receipt commit, the previous authoritative
observation remains. If it occurred after receipt commit, the immutable receipt
remains visible even when cache or job-record update failed.

If only the terminal job-record rewrite fails after receipt commit, the running
process latches `admission_recovery_required` and retains the coordinator blocker.
An exact job GET may still serve its validated in-memory `completed` view, but the
active-job route returns recovery 500 and every new job POST is refused. The
in-memory view is publication evidence only, never proof of durable job completion
or permission to release the blocker. Technical adds
`job_record_write_failed` to result warning codes; Overview adds it to the successful
module results. Its visible warning includes section 8.3's recovery-required message
and restart action, even though publication is shown as completed.
Cache-write failure alone does not change publication success or
poison an otherwise proved terminal job. There is no live terminal-write retry.
On restart, if the terminal write had actually succeeded and its complete record
validates, keep it terminal. Otherwise, the one valid remaining nonterminal record
is reconciled as `interrupted` with `result: null`, and must be durably verified
before reopening admission. Its committed receipts remain independently readable.
Corrupt or multiple records use the shared fail-closed branch, not blanket
interruption. Recovery never invents a result or repeats external requests.

After completion, only the matching current Browser request issues one corresponding
latest/overview GET and adopts its authoritative receipt-resolved result. A
completed job cannot bypass latest resolution by installing its own older result;
read failure retains the prior displayed values with a warning. This one read is
not polling. There is no polling outside the active job view, no scheduled refresh,
and no automatic background freshness loop.

### 8.5 HTTP statuses and failure union

| Status | Meaning |
| ---: | --- |
| 200 | successful read or already-cancelled response |
| 202 | job or cancellation accepted |
| 400 | malformed route/query/body/schema/source request, including an Overview POST with no registered source module |
| 403 | Host, Origin, or CSRF failure before admission |
| 404 | no committed observation receipt for the requested scope, or exact job not found |
| 405 | unsupported method with exact `Allow` |
| 409 | coordinator admission conflict (active job or empty-start cooldown), or invalid cancellation/lifecycle action |
| 413 | request body exceeds the route cap |
| 415 | unsupported media type |
| 500 | Technical corruption without a valid fallback; Overview corruption when no implemented module validates; ambiguous latest-receipt order; shared startup/recovery admission block; repository-wide filesystem or invariant failure |

Every response is a strict success or `{ "error": { "code", "message" } }` union.
The closed HTTP error codes are `invalid_request`, `invalid_query`, `invalid_ticker`,
`source_configuration_missing`, `request_forbidden`, `artifact_not_found`,
`job_not_found`, `active_job_conflict`, `invalid_job_state`, `method_not_allowed`,
`request_body_too_large`, `unsupported_media_type`, `artifact_corrupt`,
`artifact_recovery_bound_exceeded`, `latest_resolution_failed`,
`repository_failure`, and `invariant_failure`.
The internal `admission_recovery_required` state is not an additional public code:
section 8.3 maps it to `repository_failure` here and `artifact_unavailable` on Phase 4
routes. Healthy active-job/cooldown conflicts remain 409, never storage-recovery 409.
Async provider/runtime failures use only `MarketDataJobFailureCodeV1`; they never
include raw provider text. A provider response that exceeds its bound terminates the
accepted job with `source_response_too_large`; it does not retroactively change the
POST response to HTTP 413. Where source entitlement is discovered only after
dispatch, the job terminates failed and its GET view carries the safe failure code;
the original POST still correctly returned 202.

A canonical path collision discovered after POST is an asynchronous terminal
`artifact_collision` job failure. The job GET remains HTTP 200 with that sanitized
failure; it is not retroactively converted to HTTP 409.

An Overview POST with zero registered source modules returns 400
`source_configuration_missing` before admission. It creates no job record, acquires no
coordinator lease, and dispatches no external request. An empty successful Overview
job is invalid.

## 9. Dashboard state and interaction contract

- Watchlist, empty, loading, partial, fallback, retained-previous, and error surfaces use the same
  primitives and remain distinguishable without color.
- Technical and Overview have separate refresh buttons and active-job status.
- The Overview button attempts all currently implemented Overview sources in one
  bounded job. Each source module publishes independently: a successful module may
  create a new authoritative receipt while a failed module retains its previous
  observed revision and shows a typed warning. A source-level unavailable observation
  is a valid typed payload; malformed schema, incomplete pagination, or provider
  failure never creates a receipt for that module.
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

Each identifier below is one independently reviewable PR. A step begins only after
its listed direct predecessors are independently approved and merged and local
`main` is fast-forwarded to `origin/main`. The dependency graph, rather than the
visual list order alone, controls admission; Phase 5 still waits for DR-X.

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
6. **DR-C1 — shared Dashboard session and empty-start coordinator**
   - extract the existing Dashboard session/security owner and one Dashboard-process
     J-Quants admission/rate coordinator;
   - implement `dashboard_empty_start_admission_v1`, including immediate cooldown
     refusal, manual-retry warning/error copy, preflight preservation, and atomic
     empty-start acceptance;
   - implement `dashboard_job_recovery_v1`, typed publication outcomes through the
     Phase 4 adapter, both fixed repository slots, the initial Market Data absence
     probe, all-domain release/startup proofs, and sticky recovery/read semantics;
   - preserve Phase 4 routes, public code enums, schemas, accepted-job timing/
     financial semantics, status-specific run recovery, and CLI behavior. Reuse
     existing Browser error surfaces with the explicit cross-domain/recovery flow;
     add no layout, styling, or persisted job-status variant.
7. **DR-A1 — market-data artifact and observation repository**
   - implement `MarketDataSourcePayloadEnvelopeV1`, calculation versions, canonical
     artifact create/reuse, immutable observation receipts, authoritative latest
     resolution, rebuildable cache, collision/recovery, and pure repository tests;
   - add no source request, mutation route, or UI.
8. **DR-O1 — generic Overview job and read API foundation**
   - implement the one common Market Data job repository and native recovery
     adapter for both refresh kinds, replacing DR-C1's absence probe before startup;
   - implement the strict module registry, per-module atomic artifact/receipt
     orchestration, root result semantics, and read/job routes over DR-C1/DR-A1;
   - with zero registered source modules, GET remains 404 and POST returns 400
     `source_configuration_missing` without a job, lease, or external request.
9. **DR-T0A — current-code-only docs amendment**
   - retire the unprovable lifetime candidate and replace every Technical/ETF
     continuity claim with the explicit `current_code_history_v1` boundary;
   - freeze the current-master predicates, ETF no-observation artifact contract,
     persistent warning, non-use boundary, leap-day rule, revised prerequisites, and
     migration sequence in `SPEC.md`, this plan, and the handoff; change no runtime.
10. **DR-T1A — current-code Technical series boundary**
   - replace the merged structural `listingWindow` with `historyBoundary`, remove
     synthetic missing-row gaps, and implement exact first-source-row, leading
     partial, internal-missing failure, warning-input, and non-mutation tests;
   - change no source request, artifact repository, route, or UI.
11. **DR-A2 — current-code artifact and warning contract**
   - replace the unused pre-production lifetime roles/fields with the three-input
     Technical and four/seven-input ETF role sets; replace
     `instrument_lifetime_clipped` with `history_coverage_clipped` and
     `historical_identity_unverified` in generic job/artifact contracts and golden
     vectors;
   - no production Technical/ETF codec or receipt exists, so add no migration,
     backfill, source request, route, or UI.
12. **DR-T0 — Technical source and current-code gate**
   - verify the exact individual-Standard bars/calendar/end-date-master contracts,
     entitlement, `current_master_expectation_v1`, complete post-start coverage, and
     production bounds with strict fixtures plus the default-No bounded live smoke;
   - freeze the source revisions and measured caps before merge; add no canonical
     artifact, public mutation/read route, or UI.
13. **DR-T2 — Technical source and job API**
   - implement the DR-T0-frozen strict J-Quants mappers, manual Technical refresh,
     current-code warning/artifact codec, and GET/job routes over
     DR-C1/DR-A1/DR-O1; reuse DR-O1's job repository and registered recovery adapter
     rather than owning a separate job store.
14. **DR-T3 — Technical UI**
   - implement source precedence, day/week/month, four panes, crosshair OHLCV,
     exact table, URL/race/focus, Comparison separation, and the persistent
     current-code-only warning.
15. **DR-M0 — margin-source migration gate**
   - verify the official migration, individual Standard entitlement, exact schema,
     cadence boundary, primary key/coverage/unit contract, one-date reconciliation,
     and bounded exact-26-observation production-shape smoke;
   - add no public value when the gate is unresolved.
16. **DR-M1a — shared margin source plus aggregate/1570 modules**
   - implement the one verified complete margin input and the pure module 1/3
     mappers/engines/artifact builders, then register both modules with DR-O1; add no
     UI.
17. **DR-M1b — market short-ratio module**
   - implement the verified source mapper, schedule resolver, engine, and artifact
     builder for module 2, then register it with DR-O1; add no UI.
18. **DR-M1c — foreign-flow module**
   - implement the series correction-vintage selector, mapper, engine, and artifact
     builder for module 4, then register it with DR-O1; add no UI. The implemented
     module set remains per-module atomic rather than one transaction.
19. **DR-M2 — four supply/demand UI modules**
   - implement cards, latest 26-observation charts/tables, cadence/basis breaks,
     metadata, fallback, and warnings.
20. **DR-E1 — 1321/2633 sources and relative-performance engine**
   - implement strict EOD input, 1321 change, common-date normalization, range,
     direction, fixed ETF master predicates, current-code history boundaries, the
     closed no-observation matrix, proxy caveats, and immutable module artifacts/
     receipts.
21. **DR-E2 — two ETF UI modules**
   - add the 1321 EOD and 1321/2633 proxy cards/chart/table, persistent
     current-code-only warning, and range URL/UI state.
22. **DR-X — usage, setup, handoff, and closeout**
   - update `Usage.md`, `docs/USER_SETUP.md`, and environment guidance only for
     merged behavior;
   - run complete validation and update the handoff from candidate to closeout.

The exact direct dependencies are:

```text
DR-0 -> DR-V1 -> DR-V2 -> DR-V3
DR-V3 -> DR-T1
DR-T1 -> DR-C1 -> DR-A1
DR-A1 -> DR-O1 -> DR-T0A
DR-T0A -> { DR-T1A, DR-A2, DR-T0 }
{ DR-O1, DR-T0, DR-T1A, DR-A2 } -> DR-T2
DR-T2 -> DR-T3
{ DR-O1, DR-T2 } -> DR-E1 -> DR-E2
DR-O1 -> DR-M0 -> { DR-M1a, DR-M1b, DR-M1c } -> DR-M2
{ DR-T3, DR-E2, DR-M2 } -> DR-X -> Phase 5
```

DR-M1a, DR-M1b, and DR-M1c are independent after DR-M0 and may merge in any order;
DR-M2 waits for all three. A delayed DR-M0 does not block DR-T3 or the independent
ETF path. No step opportunistically implements a later step. DR-V1-V3 do not fetch
market data; DR-T0A changes docs only; DR-T0 exposes no public route and persists no
market-data artifact; DR-T1/DR-T1A and DR-A1/DR-A2 expose no new route; DR-O1 cannot
dispatch without a registered module. DR-O1 precedes DR-T0A and DR-T2 to establish
the common job repository/recovery owner; it has no margin-source dependency. DR-C1 changes shared ownership and the explicit
admission/recovery/copy contract while preserving accepted-job calculation/timing
and Phase 4's native recovery outcomes. DR-M0 is a gate rather than a UI/source
implementation; DR-X adds no new runtime behavior.

## 11. Test and acceptance matrix

| Step | Required tests and acceptance |
| --- | --- |
| DR-0 | `DESIGN.md` sole-visual-authority consistency, `AGENTS.md` startup/governance link, no runtime/dependency diff, links and sequence reviewed |
| DR-V1 | exact tokens, measured contrast, focus-visible, status not color-only, existing behavior regression |
| DR-V2 | Watchlist/loading/error/empty, global deep link/conflict, Back/Forward/reload, inherited unknown-tab canonicalization, dormant/new-key matrix, unknown-query preservation |
| DR-V3 | exact seven IDs/labels/order, Home/End/arrows/roving focus, all existing complex surfaces, availability ownership, token contrast at every required surface |
| DR-T1 | merged predecessor only: strict bar/gap union, positive OHLC/non-negative volume and valid zero, the superseded structural lifetime window, fewer-than-251 bars, daily `partial:false`, gap-only period, OHLCV aggregation, week/month/calendar/holiday boundaries, leading/trailing partials, all-null/partial-null, RSI index 14, MACD bundle index 33, first cross index 34/equality, 34-month boundary, same-window Engine parity, input immutability; DR-T1A replaces the window before production use |
| DR-C1 | one Dashboard session token and one three-kind process coordinator; unchanged Phase 4 routes/public code enums/schemas/accepted-job controls/CLI; empty-start admission and exact cooldown 409/Retry-After; typed create/replace publication outcomes; all-domain inventory/release/startup proofs; sticky recovery blocker; retained attempt log across failure/cancel/runtime construction; preflight preservation and atomic admission; cross-domain active/read/recovery Browser flow; two runtime instances cannot bypass the shared Dashboard limiter |
| DR-A1 | literal `MarketDataSourcePayloadEnvelopeV1` golden vectors; target/role/calculation-version mismatch; volatile/derived-field exclusion; exact digest-to-path-to-artifactDigest derivation; persisted calculation version and maximum-provider `fetchedAt`; create/reuse/collision; receipt no-replace and digest/identity; A(t1)->B(t2)->A(t3); delayed older-admission completion; two-process inverse completion; equal-millisecond equal-artifact equivalence and conflicting-artifact `latest_resolution_failed`; stale/backwards/corrupt/missing cache reconstruction; orphan artifact exclusion; interrupted after-receipt visibility; bounded corrupt-receipt/artifact fallback; containment |
| DR-O1 | common two-kind job repository/native recovery adapter; strict 65,536-byte job record and filename identity; create/replace fault injection and cross-domain admission/restart; zero-module GET 404 and POST 400 `source_configuration_missing` in a healthy process with no job/lease/dispatch; strict module registration/order; one root Overview `checkedAt`; success receipt versus retained-previous/failed identities; per-module artifact/receipt atomicity; partial success/all-modules-failed root; terminal-write recovery latch; GET persisted-vs-uncollected/corrupt identity |
| DR-T0A | `SPEC`/plan/handoff agreement; retired candidate and no fabricated replacement; exact `current_code_only` warning/non-use boundary; calendar-defined coverage clipping; deterministic single-boundary and two-boundary warning templates/selectors; closed master predicates/rejection precedence; ETF no-observation state table; March-1 leap rule; revised graph; no runtime/dependency/Usage/setup diff |
| DR-T1A | `historyBoundary` strictness; first source row; pre-start omission without listing inference; post-start missing-session failure; all-null explicit gap; leading partial; 251-bar short history; removal of `missing_in_complete_envelope`; input immutability and merged indicator parity |
| DR-A2 | exact three-input Technical, four-input 1321, and seven-input relative-ETF roles; golden envelope/digest changes; warning enum/order plus exact single-boundary and fixed-order relative templates; old lifetime role/warning rejection; zero production-artifact migration proof; repository/job regressions |
| DR-T0 | exact official bars/calendar/end-date-master endpoint/query/field/entitlement registry; bounded three-input no-publication smoke; `current_master_expectation_v1` code/product/market/name evidence; wrong date/code/product/market, blank/invalid name, missing/duplicate rows in exact precedence; company-name change and allowed-market transfer acceptance; earliest source row and complete post-start official-session coverage; calendar-based clipping including weekend/holiday non-trigger; Standard maximum-ten-year history including February-29/March-1 boundary, pagination and request/page/row/byte/deadline ceilings; secret/path non-exposure |
| DR-T2 | strict frozen-source mappers, acceptedAt/16:30/query-range gate, exact three-input manifest, closed Technical end-date identity predicate/rejection precedence, current-code history boundary, permanent history warning, calendar-proved clipping, post-start missing-session failure, all-gap `source_no_observation` with prior-receipt retention and initial GET 404; Technical `published` versus `idempotent_reuse` result/`checkedAt`/receipt schema; GET 404/500/no-fetch; shared CSRF/coordinator/DR-O1 job repository and recovery adapter; cross-kind create/terminal-write faults, timeout/cancel/startup |
| DR-T3 | auto/snapshot/latest precedence, absent latest, refresh adoption, URL/Back/Forward/reload, latest-request-wins, collapse, keyboard crosshair, exact table, Comparison isolation |
| DR-M0 | old/new fixtures, official migration evidence, individual-Standard entitlement, exact source primary key/fields/issue and sector allowlists/units/vintages, schedule/calendar and short-week/boundary resolver, one-date reconciliation smoke, exact 26-window bootstrap caps, secret-safe record |
| DR-M1a | complete issue aggregation, shared margin-input reuse, field-level valid zero/ratio denominator, verified primary key/unit, canonical expected-date unavailable artifact, proved-missing/duplicate versus malformed/incomplete no-publish, 1570 identity/unit/old-transition-new official basis break, two registered module results |
| DR-M1b | short-ratio exact coverage allowlist/formula, valid zero/zero denominator, schedule identity, proved-missing/duplicate versus malformed/incomplete no-publish |
| DR-M1c | 26-point correction-vintage/eligibility resolver, ambiguous/missing identity, date-only publication, valid zero, no repeated latest-only selection, no future use |
| DR-M2 | latest 26 expected identities including unavailable rows, weekly/daily boundary, no interpolation, fallback warnings, source/date/cadence/elapsed metadata, keyboard/mobile tables |
| DR-E1 | exact four-input 1321 EOD and seven-input relative-ETF manifests, one shared calendar; exact 1321/2633 code/`ProdCat=014`/`Mkt=0109`/source-label predicates and rejection precedence; company-name change acceptance; per-code source coverage boundaries, permanent unverified-history warning, calendar-based clip predicate, and one fixed-order two-token relative clip warning; post-start missing-session failure; empty/all-null 1321, 1321-only empty, 2633-only empty, both empty, zero/one common date, all five unavailable, mixed range availability, and prior-available receipt replacement; exact `dataDate`, payload, history-boundary combination, input range/digest, warning set, and successful receipt for each; EOD insufficient-history fields, common-date inner join, no forward fill, positive base, base 100, range boundaries, unavailable range without direction, return/difference/direction, exact tie, distribution exclusion, 1321/2633 announced-split adjusted-price regressions, corporate-action price basis |
| DR-E2 | 3M/6M/1Y/3Y/Max, 1Y default, exact proxy/current-code caveats, persistent warning, URL/race/focus, table/chart agreement |
| DR-X | full unit/integration/Playwright/visual QA, source gates, one-external-J-Quants-process operating restriction, Usage/setup accuracy, no-score/no-signal/Snapshot regression |

The review regressions also require these exact boundary cases:

DR-C1 exercises the common guard with the real Phase 4 adapter and synthetic Market
Data adapter fixtures; DR-O1/T2 repeat the applicable cases with the real shared
Market Data repository. DR-C1 does not pre-implement a Market Data source or job API.

- DR-C1/O1/T2: inject failures before promotion, after final `link` but before temp
  cleanup, during cleanup, after create promotion but before final read, and after
  terminal `rename` but before final read. Assert the actual final file as well as
  the typed outcome; no exception may be treated as evidence of absence. Check the
  complete proposed/previous payload, collision/non-owned identity, byte cap,
  partial/invalid JSON, and filename mismatch. Include cancellation/progress
  replacement faults, failure between publication/adoption/preflight consumption/
  queueing, and late worker callbacks after the latch.
- DR-C1/O1/T2: a definitely-unpublished create releases only after both valid
  repositories prove zero nonterminal and the proposed identity is absent. Inject
  other-domain preparing/publishing records and failed inventories; each must block
  Strategy -> Technical/Overview and Technical/Overview -> Strategy, plus same-kind
  retry, even with an empty attempt log or N=0. Ordinary successful create queues
  once and consumes once; an uncertain create dispatches zero and never reuses its
  preflight in that process. Any unproved terminal write keeps the global blocker.
- DR-C1/O1/T2: shared startup sees zero, one in either domain, two within one domain,
  one in each domain, corrupt/unknown records, missing/disabled adapter, and unreadable
  or nonempty absent-domain slot. Assert no cleanup/rewrite occurs before combined
  inventory adjudication. Valid Phase 4 promoted runs still recover as completed;
  valid Market Data nonterminals become interrupted without replaying source calls.
  Recovery write/read failure is sticky; restart after an actually successful
  terminal rename preserves completed rather than rewriting interrupted. A second
  restart cannot silently skip multiple/corrupt records. GET must never trigger
  reconciliation or return false idle while blocked.
- DR-C1 and Market UI steps: verify exact 500/domain-code/message/no-Retry-After,
  preserved security/method precedence, cross-domain active responses, last-known
  labels, halted polling through visibility/reload races, and no automatic POST,
  DELETE, or repair. A validated in-memory Market completion can refresh its visible
  artifact once while both active routes and subsequent job POSTs still report
  recovery-required. No error-path output exposes private paths or exceptions.
- DR-C1: fake-clock prior-job bursts at R=1/2/5; empty versus partly occupied logs;
  rejection at latest attempt +59,999 ms and acceptance at +60,000 ms; newest rather
  than oldest expiry controls admission. Verify N=R, N=0, and the 90/91 and 180/181
  feasibility boundaries without changing existing execution controls. Cover every
  pair of the three job kinds, simultaneous retries, zero-dispatch failure, retained
  failed/cancelled attempts, stale lease rejection, and wall-clock/monotonic-clock
  changes. A cooldown response must not create/consume/dispatch anything, active GET
  stays idle, and expiry/disconnect/DELETE cannot auto-start work. Playwright covers
  the existing preflight warning and confirmation surviving a refused start, manual
  retry success, expired-preflight handling, no cooldown polling, and no active-job
  mislabel. Header seconds and safe message agree exactly.
- DR-C1/O1/T2: shared envelope/sanitization with domain-specific codes; Phase 4 keeps
  its separate Host/Origin/CSRF and payload codes while Market Data uses
  `request_forbidden` / `request_body_too_large`. Cooldown alone maps to 409 with
  `Retry-After`; actual active-job conflict has no fabricated retry time.
- DR-A1: literal input/root-envelope golden vectors; equal `calculationDate` with
  changed admission/cutoff/fetch/page metadata reuses the original bytes, while
  date rollover with identical source rows produces a new revision. Compare the
  full deterministic calculation projection, including a concurrent `EEXIST`
  winner. Test same-context A(t1)-B(t2)-A(t3), orphan-only initial 404, retention of
  a prior receipt after pre-receipt failure, and no deletion of another process's
  private temp.
- DR-A1: synthetic directories with 1/256/10,000 receipt filenames expose full
  enumeration rather than a claimed bounded cache lookup. With other recovery
  budgets available, 255 newer references to corrupt content plus one older valid
  receipt can fall back within 256; 256 such references plus an older valid receipt
  return `artifact_recovery_bound_exceeded`. Duplicate artifact identity does not
  excuse validation of a malformed receipt or a same-instant conflict.
- DR-T0/T1A/T2: verify only the eligible-end-date current master. The first returned
  source row establishes retrieval coverage, not listing. Omit earlier sessions,
  mark a first partial week/month accurately, fail any later absent official-session
  row, and always persist the historical-identity warning. Fixtures must show that
  a gapless code reuse cannot be detected or described as rejected.
- DR-T0/T2/E1: use the exact family-specific current-master predicate and ordered
  rejection reason; do not compare `CoName` with Snapshot or hard-coded issuer text.
  Cover missing, duplicate, wrong effective date/code/product/market, blank/invalid
  name, an accepted company-name change, and a Technical transfer between allowed
  markets. Query-range fixtures include `calculationDate=2028-02-29`,
  `queryFrom=2018-03-01`, and no February-28 row.
- DR-T0/T2/E1: coverage-warning fixtures use the shared official calendar. A weekend
  or exchange-holiday `queryFrom` followed by the first official session emits no
  `history_coverage_clipped`; omitting one or more official sessions before an
  available `sourceCoverageFrom` emits it. An unavailable boundary alone never
  emits it, and an unprovable calendar interval publishes no artifact or receipt.
- DR-O1/T2: enumerate result/failure nullability for every status; copy the one
  Overview `checkedAt` to every result, including failed/unattempted modules. A
  receipt failure differs from a successful receipt followed by a terminal-job
  rewrite failure; test `job_record_write_failed`, in-memory completed status with
  a retained global blocker, and both restart outcomes (proved completed versus
  remaining nonterminal -> interrupted/null result) with the committed receipt
  still visible. Cache-only failure must not falsely poison healthy job completion.
- DR-T3/M2/E2: one authoritative GET after job completion precedes adoption; an
  older completed job cannot install its result over a newer admitted receipt. A
  failed adoption read preserves the previous display with a warning.
- DR-E1: the strict module schema persists exactly zero, one, or two current-code
  history boundaries according to module ID, with exact 13210/26330 ordering, source
  agreement, and `historicalIdentity: "not_verified"`.
- DR-E1: for complete empty/all-null and insufficient-common-date cases, assert the
  exact section 7.1 table, envelope/path `dataDate`, input ranges/digests, warning
  codes, and receipt adoption. An existing available receipt does not turn a newly
  proved no-observation artifact into fallback or `retained_previous`.
- DR-E1: freeze literal warning/artifact golden vectors where both relative
  boundaries are available and clipped with unequal starts, only 1321 is clipped,
  only 2633 is clipped, one side is unavailable, and neither side is clipped. The
  message always contains 1321 then 2633, uses each available canonical start date
  or exact `観測なし`, stores the warning code once, and produces one deterministic
  artifact digest for the source inputs.

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

1. every node from DR-0 through DR-X was a separate, independently reviewed PR merged
   only after its section 10 predecessors;
2. local `main` is fast-forwarded to the exact green `origin/main`;
3. all automated validation and required responsive/visual QA pass;
4. the J-Quants Standard Technical smoke passed without secret exposure;
5. DR-M0 recorded the post-migration official result plus both exact individual-
   Standard schema/reconciliation and 26-observation production-shape smokes;
6. all UI values retain source, date, unit, cadence, unavailable, and proxy semantics;
7. every Technical/ETF artifact and surface retains the exact current-code-only
   historical-identity warning and none feeds validation/backtest/score/signal logic;
8. Snapshot V1-V9, Comparison, Radar, Strategy Validation, no-score, and no-signal
   regression tests remain green; and
9. Usage, setup, and handoff describe only the exact merged behavior.

Phase 5 begins only after all nine conditions are satisfied. A delayed or failed
margin migration gate delays DR-M1a-c, DR-M2, DR-X, and Phase 5; it does not
authorize a weaker source or block the independent Technical/ETF path.

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
- artifact revision browser, automatic retention deletion, receipt sharding/bounded
  indexing, or receipt-group skipping without a separate storage/order review;
- live job-recovery/force-unlock APIs, automatic ambiguous-write retry, and automatic
  repair or deletion of corrupt/multiple durable job records;
- Buy/Sell/Hold, score, trading/decision signal, prediction, or investment advice;
  the chart's descriptive MACD `signal` line remains in scope; and
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
