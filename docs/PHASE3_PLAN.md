# Phase 3 Implementation Plan

**Status:** P3-0 candidate contract for independent review

**Repository baseline:** `b2989cd1f78fc374f433352fd6532a506fb00108`

**Baseline identity:** PR #73 merge; Dashboard UX closeout complete

**Date:** 2026-08-29

## 1. Purpose and authority

This document is the normative implementation plan for Phase 3. P3-0 fixes the
source, ownership, formula, identity, safety, persistence, presentation, and
PR-boundary contracts before runtime implementation begins.

Phase 3 adds four independently reviewable outcomes:

1. deterministic comparison of two saved analyses;
2. a visual rendering of the seven existing peer percentiles;
3. an explicitly invoked independent qualitative review of a saved analysis; and
4. a docs-only composite-score evaluation plan.

Phase 3 does not implement PDF export or a runtime composite score. PDF has no
numbered target phase and may be reconsidered only in a separate reviewed plan
after a concrete sharing, immutable-audit, offline-printing, or PDF-accessibility
need is documented. Score adoption remains gated by Phase 4 validation.

This plan inherits and does not weaken:

- `AGENTS.md` for repository operation, safety, validation, and review discipline;
- `docs/SPEC.md` for product and calculation invariants;
- `docs/MVP_IMPLEMENTATION_PLAN.md` for the completed MVP baseline;
- `docs/VISUALIZATION_MVP_PLAN.md` for Snapshot, persistence, local API, and
  Dashboard boundaries;
- `docs/DASHBOARD_UX_PLAN.md` for Presentation Layer, responsive, URL, and
  accessibility contracts, except for the explicitly reviewed sixth tab added here;
- the applicable contracts in `docs/PHASE2_PLAN.md`; and
- `docs/REVIEW_POLICY.md` for the Merge Gate.

P3-0 is docs-only. It does not authorize runtime code, a Snapshot schema change, an
Evaluator call, a Comparison endpoint, or a Dashboard change.

## 2. Investigated baseline

The merged baseline provides:

- schema-validated AnalysisSnapshot V1–V9 reads and V9 writes;
- Windows-safe history IDs plus `listHistory()` and `loadHistory()`;
- read-only local history metadata and exact-detail GET routes;
- seven deterministic peer-comparison positions with direction-normalized
  percentiles;
- a five-tab Dashboard with History API, responsive, and accessibility contracts;
- a provider-neutral LLM runtime with task profiles and token-usage extraction;
- Playwright/Chromium for Dashboard browser tests; and
- canonical `finalReportMarkdown` stored beside structured Snapshot results.

Existing Playwright/Chromium remains a browser-test dependency. It is not a Phase 3
PDF runtime or export commitment.

Phase 3 introduces no new EDINET, J-Quants, market-data, or web source. Financial
values come only from validated persisted Snapshots. Evaluator narrative review may
also receive the exact stored report, but the report is never a numeric source.

## 3. Cross-cutting contract

### 3.1 Canonical input

```ts
type Phase3SnapshotInput = Readonly<{
  snapshotId: string;
  snapshot: AnalysisSnapshot; // schema-validated V1 through V9
  snapshotDigest: SnapshotDigest;
}>;
```

Rules:

- Load through `AnalysisSnapshotRepository`; do not parse arbitrary JSON in a
  Phase 3 feature.
- Preserve ticker, schema version, generated time, data dates, units, provenance,
  unavailable reasons, and stored values.
- `generatedAt` identifies an analysis run. It is not a source publication date.
- Do not fetch current data while comparing, reviewing, or drawing a saved Snapshot.
- Do not recover values from prompts, tool arguments, Dashboard text, or the report.
- Do not forward-fill, interpolate, infer aggregation, or convert missing data to
  zero.

### 3.2 History immutability

P3-I0 changes saved history to create-only:

- the first valid write for one ticker/snapshot ID creates the history file;
- the same ID plus the same canonical payload is an idempotent success;
- the same ID plus a different payload is a typed `snapshot_id_collision` failure;
- an existing history file is never replaced, repaired, or migrated in place;
- `latest.json` keeps its established replace semantics;
- V9 remains the writer and V1–V9 remain readable;
- no V10, history backfill, or migration is introduced.

The repository uses atomic temporary-file creation and rename, path containment,
schema validation, and path/body identity checks. Concurrent same-payload writers
converge on idempotent success; concurrent different-payload writers return the
collision failure without replacing the winner.

### 3.3 Canonical digest

```ts
type SnapshotDigest = `sha256:${string}`;
```

`CanonicalJsonV1` is defined as:

- parse through the applicable Snapshot schema first;
- recursively sort object keys by JavaScript UTF-16 code-unit order;
- preserve array order;
- use JSON primitive serialization with finite numbers only;
- normalize negative zero to zero;
- do not normalize Unicode strings;
- omit no schema-preserved value;
- emit UTF-8 with no insignificant whitespace.

`snapshotDigest` is SHA-256 over the complete CanonicalJsonV1 byte sequence and is
formatted as `sha256:` plus 64 lowercase hexadecimal characters.

An `artifactInputDigest` is SHA-256 over a versioned CanonicalJsonV1 logical-input
envelope. In Phase 3 this applies to the Evaluator sidecar. The envelope binds the
target snapshot digest, exact evidence manifest digest, rubric version, prompt
version, safety version, and resolved runtime. Raw prompts are not persisted.

Comparison responses contain both Snapshot digests but are not persisted.

### 3.4 Stored-report safety

The system fails closed; it does not redact or truncate.

At V9 save time, reject a stored report containing:

- an exact configured credential value;
- an established credential marker or private-key marker;
- NUL or disallowed control characters;
- more than 50,000 characters; or
- more than 200,000 UTF-8 bytes.

Before an Evaluator call, repeat those checks and also reject:

- Windows drive/UNC absolute paths;
- POSIX absolute paths; and
- a complete Evaluator logical input above 200,000 characters.

Do not include the detected secret/path text in logs, sidecars, HTTP responses, or
user-visible errors. Return an allowlisted typed failure before provider dispatch.
Prompt-injection text remains inert input data and is never treated as an instruction.

### 3.5 Ownership and operation surface

| Result | Owner | Persisted in Snapshot | Creation surface |
| --- | --- | --- | --- |
| History comparison | pure deterministic Comparison module | no | read-only GET/controller |
| Peer Radar | Dashboard presentation of stored values | no | presentation only |
| Independent evaluation | versioned Evaluator sidecar | no | explicit CLI/controller |
| Composite score | not adopted | no | prohibited until Phase 4 decision |
| PDF/export artifact | deferred | no | no Phase 3 surface |

Dashboard routes remain GET-only. The Browser does not create an evaluation, incur
provider cost, mutate a Snapshot, or write an artifact.

### 3.6 Shared value semantics

```ts
type ComparisonValueStateV1 =
  | 'available'
  | 'unavailable'
  | 'not_collected'
  | 'absent';
```

- `available` includes valid numeric zero.
- `unavailable` preserves an applicable stored or allowlisted reason.
- `not_collected` is used when an older schema cannot contain the field or an
  optional section was explicitly uncollected.
- `absent` is Comparison-only and means a schema-supported dynamic identity exists
  on one side but not the other.

No Phase 3 feature creates a Buy/Sell signal, attractiveness rank, risk-on/off
classification, threshold label, weighted score, or overall investment score.

## 4. P3-H — Saved-analysis Comparison

### 4.1 Scope and request

P3-H1 implements the pure registry and Comparison result. P3-H2 exposes it through:

```text
GET /api/analyses/:ticker/comparison
    ?baseSnapshotId=<id>
    &targetSnapshotId=<id>
```

The two inputs must:

- use valid ticker and Snapshot-ID syntax;
- exist under the requested canonical ticker;
- contain the same canonical ticker identity; and
- satisfy `base.generatedAt < target.generatedAt`.

Equal or reversed order is invalid; do not swap. Do not substitute latest. There is
no caller-supplied historical cutoff:

```text
comparisonAsOf = target.generatedAt
delta = targetValue - baseValue
```

Source freshness comes from each stored named date. No current source correction is
applied retroactively.

### 4.2 Public result

```ts
type ComparisonSectionV1 =
  | 'valuation'
  | 'fundamental'
  | 'technical'
  | 'advancedTechnical'
  | 'supplyDemand'
  | 'marketCorrelation'
  | 'sectorBenchmark'
  | 'strategy'
  | 'advancedDividend'
  | 'volumeProfile';

type ComparisonMetricKeyV1 =
  | 'valuation.currentPrice'
  | 'valuation.per'
  | 'valuation.pbr'
  | 'valuation.dividendYieldPercent'
  | 'valuation.revenueCagrPercent'
  | 'fundamental.latest.revenue'
  | 'fundamental.latest.operatingIncome'
  | 'fundamental.latest.ordinaryIncome'
  | 'fundamental.latest.netIncome'
  | 'fundamental.latest.eps'
  | 'fundamental.latest.roe'
  | 'fundamental.latest.equityRatio'
  | 'fundamental.latest.operatingCashFlow'
  | 'fundamental.latest.freeCashFlow'
  | 'technical.ma20'
  | 'technical.atr14'
  | 'technical.averageVolume20'
  | 'technical.latestSwingHigh'
  | 'technical.latestSwingLow'
  | 'technical.trend'
  | 'advancedTechnical.rsi14'
  | 'advancedTechnical.macd.value'
  | 'advancedTechnical.macd.signal'
  | 'advancedTechnical.macd.histogram'
  | 'advancedTechnical.bollinger20.middle'
  | 'advancedTechnical.bollinger20.upper'
  | 'advancedTechnical.bollinger20.lower'
  | 'supplyDemand.buyingBalance'
  | 'supplyDemand.sellingBalance'
  | 'supplyDemand.marginRatio'
  | 'supplyDemand.buyingBalanceWeeklyChange'
  | 'supplyDemand.sellingBalanceWeeklyChange'
  | 'supplyDemand.mean4w'
  | 'supplyDemand.mean13w'
  | 'supplyDemand.mean52w'
  | 'supplyDemand.deviation52w'
  | 'supplyDemand.percentile52w'
  | 'supplyDemand.averageDailyVolume20'
  | 'supplyDemand.digestionDays'
  | 'marketCorrelation.window.observations'
  | 'marketCorrelation.window.correlation'
  | 'marketCorrelation.window.beta'
  | 'marketCorrelation.window.alphaAnnualized'
  | 'marketCorrelation.window.rSquared'
  | 'sectorBenchmark.window.observations'
  | 'sectorBenchmark.window.correlation'
  | 'sectorBenchmark.window.beta'
  | 'sectorBenchmark.window.alphaAnnualized'
  | 'sectorBenchmark.window.rSquared'
  | 'sectorBenchmark.window.stockVolatilityAnnualized'
  | 'sectorBenchmark.window.benchmarkVolatilityAnnualized'
  | 'sectorBenchmark.window.excessReturn'
  | 'strategy.entry.triggerPrice'
  | 'strategy.entry.price'
  | 'strategy.candidate.entry.price'
  | 'strategy.candidate.stop.price'
  | 'strategy.candidate.target.price'
  | 'strategy.candidate.rewardRisk'
  | 'advancedDividend.fiscal.annualDividendPerShare'
  | 'advancedDividend.fiscal.payoutRatio'
  | 'advancedDividend.event.dividendPerShare'
  | 'advancedDividend.event.ordinaryDividendPerShare'
  | 'advancedDividend.event.commemorativeDividendPerShare'
  | 'advancedDividend.event.specialDividendPerShare'
  | 'volumeProfile.poc.price'
  | 'volumeProfile.valueArea.val'
  | 'volumeProfile.valueArea.vah';

type ComparisonInstanceIdentityV1 = readonly Readonly<{
  name: string;
  value: string | number | boolean | null;
}>[];

type NamedDataDateV1 = Readonly<{
  role:
    | 'section'
    | 'price'
    | 'financial'
    | 'submit'
    | 'volume'
    | 'window_start'
    | 'window_end'
    | 'analysis_as_of'
    | 'source_eligible'
    | 'disclosed'
    | 'notified'
    | 'record'
    | 'rights_record'
    | 'ex'
    | 'payment';
  value: string | null;
}>;

type ComparisonProvenanceV1 = Readonly<{
  source: string;
  role: string;
  asOfDate: string | null;
  sourceUrls: readonly string[];
  qualifiers: readonly Readonly<{
    name: 'endpoint' | 'section';
    value: string | null;
  }>[];
}>;

type ComparisonObservationV1 = Readonly<{
  state: ComparisonValueStateV1;
  value: number | string | null;
  actualUnit: string | null;
  dataDates: readonly NamedDataDateV1[];
  provenance: readonly ComparisonProvenanceV1[];
  identity: ComparisonInstanceIdentityV1;
  unavailableReasons: readonly Readonly<{
    reason: string;
    detail: string | null;
  }>[];
}>;

type ComparisonDisplaySemanticsV1 =
  | 'native'
  | 'percent_value'
  | 'fraction_as_percent'
  | 'category';

type ComparisonDispositionV1 =
  | Readonly<{
      state: 'comparable';
      mode: 'absolute_delta';
      delta: number;
      deltaUnit: string;
      changed: boolean;
    }>
  | Readonly<{
      state: 'comparable';
      mode: 'from_to';
      delta: null;
      changed: boolean;
    }>
  | Readonly<{
      state: 'incomparable';
      mode: 'incomparable';
      delta: null;
      reason:
        | 'unit_mismatch'
        | 'period_changed'
        | 'benchmark_changed'
        | 'method_changed'
        | 'window_changed'
        | 'data_date_regressed'
        | 'identity_changed'
        | 'identity_ambiguous';
    }>
  | Readonly<{
      state: 'not_applicable';
      mode: 'not_applicable';
      delta: null;
      reason:
        | 'unavailable'
        | 'not_collected'
        | 'record_added'
        | 'record_removed';
      affectedSides: readonly ('base' | 'target')[];
    }>;

type SnapshotComparisonMetricRowV1 = Readonly<{
  metricKey: ComparisonMetricKeyV1;
  section: ComparisonSectionV1;
  valueKind: 'number' | 'category';
  expectedUnit: string | null;
  displaySemantics: ComparisonDisplaySemanticsV1;
  instanceIdentity: ComparisonInstanceIdentityV1;
  base: ComparisonObservationV1;
  target: ComparisonObservationV1;
  comparison: ComparisonDispositionV1;
}>;

type ComparisonSnapshotIdentityV1 = Readonly<{
  snapshotId: string;
  schemaVersion: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
  generatedAt: string;
  snapshotDigest: SnapshotDigest;
}>;

type ComparisonSectionAvailabilityV1 =
  | Readonly<{ state: 'available'; unavailableReasons: readonly [] }>
  | Readonly<{
      state: 'unavailable';
      unavailableReasons: ComparisonObservationV1['unavailableReasons'];
    }>
  | Readonly<{ state: 'not_collected'; unavailableReasons: readonly [] }>;

type ComparisonSectionStateV1 = Readonly<{
  section: ComparisonSectionV1;
  base: ComparisonSectionAvailabilityV1;
  target: ComparisonSectionAvailabilityV1;
}>;
```

The complete public/domain result is:

```ts
type ComparisonFailureCodeV1 =
  | 'invalid_ticker'
  | 'invalid_base_snapshot_id'
  | 'invalid_target_snapshot_id'
  | 'same_snapshot_id'
  | 'base_snapshot_not_found'
  | 'target_snapshot_not_found'
  | 'base_ticker_mismatch'
  | 'target_ticker_mismatch'
  | 'invalid_order'
  | 'unsupported_snapshot_version'
  | 'corrupt_snapshot'
  | 'snapshot_filesystem_failure';

type AnalysisSnapshotComparisonResponseV1 =
  | Readonly<{
      resultVersion: 1;
      registryVersion: 1;
      outcome: 'success';
      ticker: string;
      base: ComparisonSnapshotIdentityV1;
      target: ComparisonSnapshotIdentityV1;
      comparisonAsOf: string;
      sectionStates: readonly ComparisonSectionStateV1[];
      metricRows: readonly SnapshotComparisonMetricRowV1[];
    }>
  | Readonly<{
      resultVersion: 1;
      registryVersion: 1;
      outcome: 'failure';
      request: Readonly<{
        ticker: string;
        baseSnapshotId: string;
        targetSnapshotId: string;
      }>;
      error: Readonly<{
        code: ComparisonFailureCodeV1;
        message: string;
      }>;
    }>;
```

The success branch includes:

- `resultVersion: 1`;
- `registryVersion: 1`;
- `outcome: 'success'`;
- ticker;
- base and target snapshot ID/schemaVersion/generatedAt/snapshotDigest;
- `comparisonAsOf`;
- all section states; and
- all metric rows in registry/instance order.

A section side is `not_collected` only when that Snapshot schema predates the
section, `unavailable` when the supported top-level section is null, and `available`
when that section object exists. Individual unavailable metrics remain row states and
do not relabel an existing section. Preserve each side's section reasons separately.

The failure branch contains only the requested selectors and a sanitized allowlisted
error. `message` is a fixed, code-owned string for `code`; it contains no path,
Snapshot body, parser detail, or repository exception. The branch never fabricates
verified schemaVersion, generatedAt, digest, value, unit, date, or provenance metadata
for an input that could not be loaded. Request/repository failures remain distinct
from row-level incomparability.

The API maps:

- invalid query, unsafe ID, same ID, invalid order, or either ticker mismatch → 400;
- missing base or target Snapshot → its side-specific 404 code;
- corrupt Snapshot, unsupported schema, or filesystem failure → its exact 500 code;
- valid Comparison → 200.

All responses use existing local Host restrictions, `Cache-Control: no-store`, and
`X-Content-Type-Options: nosniff`. GET is the only allowed method.

### 4.3 Registry versioning

The initial registry contains exactly 67 stable definition keys. Keys are
lower-camel dotted paths and never contain a period number, fiscal year, ticker, or
record ID.

- Add/remove/reorder a key, change expected unit, identity, or comparability policy:
  increment `registryVersion`.
- Change public shape, state vocabulary, or delta semantics:
  increment `resultVersion`.
- Change a Japanese Dashboard label only: no version increment.
- Never reuse a published key for a different meaning.
- Snapshot schema version and Comparison versions are independent.

The registry is explicit. Do not recursively diff Snapshot JSON or automatically
expose a newly added field.

Every entry is a typed, code-owned definition rather than a free-form JSON path:

```ts
type ComparisonMetricDefinitionV1 = Readonly<{
  key: ComparisonMetricKeyV1;
  section: ComparisonSectionV1;
  introducedInSnapshotVersion: 1 | 2 | 3 | 6 | 8 | 9;
  valueKind: 'number' | 'category';
  expectedUnit: string | null;
  displaySemantics: ComparisonDisplaySemanticsV1;
  resolveInstances: (
    snapshot: AnalysisSnapshot,
  ) => readonly ComparisonInstanceIdentityV1[];
  extractObservation: (
    snapshot: AnalysisSnapshot,
    instance: ComparisonInstanceIdentityV1,
  ) => ComparisonObservationV1;
  compare: (
    base: ComparisonObservationV1,
    target: ComparisonObservationV1,
  ) => ComparisonDispositionV1;
}>;
```

`extractObservation` owns the version guard, exact value accessor, actual stored
unit, all relevant named dates, relevant source/role/as-of/URL/qualifier provenance,
unavailable reason/detail mapping, and identity/method signature. Do not hide these
rules in an unrelated switch, infer them from labels, or traverse Snapshot fields
reflectively.

### 4.4 Exact 67-key registry

#### Valuation — V1+, five keys

| Key | Value accessor | Expected unit | Comparability identity |
| --- | --- | --- | --- |
| `valuation.currentPrice` | `valuation.currentPrice` | `JPY` | singleton |
| `valuation.per` | `valuation.per` | `multiple` | `latestFiscalYear` |
| `valuation.pbr` | `valuation.pbr` | `multiple` | `latestFiscalYear` |
| `valuation.dividendYieldPercent` | same-name field | `percent` | `latestFiscalYear` |
| `valuation.revenueCagrPercent` | same-name field | `percent` | CAGR start/end/period count |

Current price uses the price data date. PER/PBR/yield use price and financial dates.
CAGR uses the financial date. Identity fields are context, not metric rows.

#### Fundamental — V1+, nine keys

Use the final stored fiscal period. Every row uses its same-name
`units.fundamental` entry, `fiscalYear` identity, and `submitDate`.

```text
fundamental.latest.revenue                 JPY
fundamental.latest.operatingIncome         JPY
fundamental.latest.ordinaryIncome          JPY
fundamental.latest.netIncome               JPY
fundamental.latest.eps                     JPY
fundamental.latest.roe                     ratio
fundamental.latest.equityRatio             ratio
fundamental.latest.operatingCashFlow       JPY
fundamental.latest.freeCashFlow            JPY
```

A changed fiscal year preserves before/after values but returns
`period_changed` and no delta.

#### Technical — V1+, six keys

```text
technical.ma20                 JPY
technical.atr14                JPY
technical.averageVolume20      shares
technical.latestSwingHigh      JPY
technical.latestSwingLow       JPY
technical.trend                category / no unit
```

Technical rows use `technical.dataDate`. `trend === 'unavailable'` maps to an
unavailable state, not a category value.

#### Advanced Technical — V2+, seven keys

```text
advancedTechnical.rsi14                 index
advancedTechnical.macd.value            JPY
advancedTechnical.macd.signal           JPY
advancedTechnical.macd.histogram        JPY
advancedTechnical.bollinger20.middle    JPY
advancedTechnical.bollinger20.upper     JPY
advancedTechnical.bollinger20.lower     JPY
```

V1 returns `not_collected`. Null MACD/Bollinger structures expand their stored
unavailable state across the affected rows.

#### Supply/Demand — twelve keys

```text
supplyDemand.buyingBalance                   shares   V1+
supplyDemand.sellingBalance                  shares   V1+
supplyDemand.marginRatio                     ratio    V1+
supplyDemand.buyingBalanceWeeklyChange       shares   V1+
supplyDemand.sellingBalanceWeeklyChange      shares   V1+
supplyDemand.mean4w                          shares   V3+
supplyDemand.mean13w                         shares   V1+
supplyDemand.mean52w                         shares   V1+
supplyDemand.deviation52w                    ratio    V1+
supplyDemand.percentile52w                   ratio    V1+
supplyDemand.averageDailyVolume20            shares   V1+
supplyDemand.digestionDays                   days     V1+
```

V1/V2 `mean4w` is `not_collected`. `averageDailyVolume20` uses the volume
date; `digestionDays` exposes both section and volume dates.

#### Market Correlation — V1+, five definitions

Each definition creates only 20/60/250-day instances:

```text
marketCorrelation.window.observations       count
marketCorrelation.window.correlation        ratio
marketCorrelation.window.beta               ratio
marketCorrelation.window.alphaAnnualized    ratio
marketCorrelation.window.rSquared           ratio
```

Identity is benchmark `TOPIX` plus period. Top-level date and window start/end are
displayed. Rolling start/end dates need not match, but date regression is
incomparable.

`stockVolatilityAnnualized`, `benchmarkVolatilityAnnualized`,
`excessReturn`, and top-level aligned count are registry-excluded.

#### Sector Benchmark — V6+, eight definitions

Each definition creates only 20/60/250-day instances:

```text
sectorBenchmark.window.observations                    count
sectorBenchmark.window.correlation                     ratio
sectorBenchmark.window.beta                            ratio
sectorBenchmark.window.alphaAnnualized                 ratio
sectorBenchmark.window.rSquared                        ratio
sectorBenchmark.window.stockVolatilityAnnualized       ratio
sectorBenchmark.window.benchmarkVolatilityAnnualized   ratio
sectorBenchmark.window.excessReturn                    ratio
```

Identity is benchmark type, sector code, index code, calculation source, and period.
Benchmark identity changes return `benchmark_changed`; calculation-source changes
return `method_changed`. V1–V5 are `not_collected`.

#### Strategy — V1+, six definitions

```text
strategy.entry.triggerPrice        JPY
strategy.entry.price               JPY
strategy.candidate.entry.price     JPY
strategy.candidate.stop.price      JPY
strategy.candidate.target.price    JPY
strategy.candidate.rewardRisk      ratio
```

Entry identity is entry reason plus trigger. Candidate identity is:

```text
entry.reason + stop.reason + target.reason
```

Match only when exactly one record on a side has the identity. Zero matches is
`absent`; more than one is row-level `identity_ambiguous`. Never match by array
index. Risk, reward, and tick-size fields are registry-excluded.

#### Advanced Dividend — V8+, six definitions

Fiscal identity is `kind + fiscalYearEndDate`:

```text
advancedDividend.fiscal.annualDividendPerShare   JPY_per_share
advancedDividend.fiscal.payoutRatio              ratio
```

Event identity is:

```text
corporateActionReferenceNumber + kind + recordDateYearMonth
```

```text
advancedDividend.event.dividendPerShare                JPY_per_share
advancedDividend.event.ordinaryDividendPerShare        JPY_per_share
advancedDividend.event.commemorativeDividendPerShare   JPY_per_share
advancedDividend.event.specialDividendPerShare         JPY_per_share
```

Match only an exact unique identity. Source-field/method changes are
`method_changed`. Record, rights-record, ex, payment, disclosed, notified, and
source-eligible dates remain named context. V1–V7 are `not_collected`.

#### Volume Profile — V9, three keys

```text
volumeProfile.poc.price       JPY
volumeProfile.valueArea.val   JPY
volumeProfile.valueArea.vah   JPY
```

Numeric comparison requires equality of:

- methodology ID;
- allocation method;
- binning ID and requested count;
- price basis and volume basis;
- target volume share; and
- input bar count.

Window start/end may roll and are displayed. POC volume/share, achieved share, bin
indices, and full bins are registry-excluded. V1–V8 are `not_collected`.

### 4.5 Unit, date, identity, and ordering rules

For numeric delta:

- both sides must be finite and available;
- both actual units must exist and equal the registry expected unit;
- required identity fields must match;
- relevant target dates must not regress behind base dates.

Raw numeric `delta` is always unscaled `target - base`. Display conversion is
metric-specific and comes only from the registry entry:

- `percent_value`: `valuation.dividendYieldPercent` and
  `valuation.revenueCagrPercent`. Values are already percentage numbers; append `%`
  without scaling and display the unscaled delta as percentage points.
- `fraction_as_percent`: `fundamental.latest.roe`,
  `fundamental.latest.equityRatio`, `supplyDemand.deviation52w`,
  `supplyDemand.percentile52w`, `marketCorrelation.window.alphaAnnualized`,
  `sectorBenchmark.window.alphaAnnualized`,
  `sectorBenchmark.window.stockVolatilityAnnualized`,
  `sectorBenchmark.window.benchmarkVolatilityAnnualized`,
  `sectorBenchmark.window.excessReturn`, and
  `advancedDividend.fiscal.payoutRatio`. Multiply values and delta by 100 only for
  presentation; display the converted delta as percentage points.
- `category`: `technical.trend`; use from/to and no numeric delta.
- `native`: all other 54 definitions, including correlation, beta, r-squared,
  margin ratio, and reward/risk. Display the unscaled value/delta with the registry
  unit; never infer a percent conversion merely from `ratio`.

The Browser applies only the row's `displaySemantics`; it does not infer conversion
from key, label, unit, or value range. Normalize floating negative zero to zero and
attach no favorable/unfavorable meaning to the sign.

Return all definitions, including unchanged, unavailable, uncollected, absent, and
incomparable rows. Dynamic identity order is:

- windows: 20, 60, 250;
- Strategy candidate tuple: ascending lexical order;
- Dividend fiscal: fiscal-year end descending, then actual before company forecast;
- Dividend event: record year-month descending, interim before fiscal-year-end, then
  corporate-action reference ascending.

Order the union of base/target identities; do not inherit source array order.

Public-short reports, investor-type flows, sector short-selling flow, and Volume
Profile bins receive no collection-level added/removed/changed Comparison in the
initial scope. This is deferred, not equivalent to zero or no change.

### 4.6 Dashboard query and behavior

The Page URL is:

```text
/?ticker=<ticker>&tab=report&base=<base-id>&target=<target-id>
```

API query names remain `baseSnapshotId` and `targetSnapshotId`; Page query names
are `base` and `target`.

- Normal detail loads latest and has no Comparison.
- Starting Comparison uses the current target and immediate predecessor and calls
  `pushState`.
- Target pins the entire Dashboard to that exact Snapshot.
- Changing target resets base to its immediate predecessor.
- Changing base preserves target.
- Tab selection uses `replaceState` and preserves the pair.
- Ticker/list navigation removes the pair.
- Malformed, one-sided, same-ID, or reversed deep links are not repaired or swapped;
  show an inline error and a Comparison-reset action.
- Back/Forward and reload restore the exact pair.
- Detail and Comparison loads are atomic for the selected target.
- Use AbortController and a monotonic request token; stale success/error cannot
  replace current state even when a dependency ignores the abort signal.
- Loading a different pair immediately removes old rows and old errors. Only 500
  errors show retry, and retry is bound to the still-current request identity.
- State restoration never steals focus or scrolls the page.

Comparison component state is keyed by:

```text
ticker + baseSnapshotId + targetSnapshotId + registryVersion
```

The selected row filter and open `日付・比較条件` disclosures survive tab changes,
Back/Forward, and a reload of that unchanged identity. They reset to the default
filter and closed disclosures when ticker, either Snapshot ID, or registry version
changes. Never carry an open disclosure from one comparison identity into another.
Persist this transient state only in the current History entry's `history.state`;
do not add Page query parameters, localStorage, or another persistence layer.

The existing saved-analysis reload action never silently replaces a pinned target:

- if history/latest is unchanged, preserve the exact pair, filter, disclosures, and
  result and announce that there is no newer saved analysis;
- if a newer saved Snapshot exists, preserve the pair and show an explicit
  `新しい保存済み分析を対象にする` action;
- that action uses `pushState`, selects the newer target and its immediate
  predecessor, and resets pair-scoped filter/disclosures;
- reload failure preserves the current target, pair, and successful result and shows
  a scoped inline error; and
- reload and pair loads have distinct request identities, controllers, and monotonic
  tokens, so neither a stale reload success nor a stale reload error may overwrite
  the current pair.

Comparison is the first section of `report / 概要・レポート`, titled
`保存済み分析の比較`.

Section order:

1. バリュエーション
2. 財務
3. テクニカル
4. 高度テクニカル
5. 需給
6. 市場相関
7. 業種指数比較
8. 戦略水準
9. 配当分析
10. 出来高価格分布

Each section uses a semantic table:

```text
指標 | 基準値 | 対象値 | 差分 | 状態
```

Dates and identity appear in an expandable `日付・比較条件` detail. API rows do
not contain Japanese labels; the Dashboard presentation registry maps stable keys.

Default filter is `変化・要確認` and includes changed rows plus all incomparable or
not-applicable states. Also provide `すべて`, `値の変化`, `要確認`, and a
section filter. Do not hide unavailable/uncollected/absent states or use color as a
good/bad signal.

At 320px the same semantic table remains in a labelled focusable horizontal-scroll
region. Do not transform it into cards or create document-level horizontal overflow.

### 4.7 Comparison acceptance

P3-H1 tests:

- exact count, uniqueness, order, accessors, units, display semantics, provenance,
  and introduced versions for all 67 definitions;
- all readable V1–V9 combinations without input mutation;
- same/changed ticker, order, period, benchmark, method, window, identity, and dates;
- available zero, unavailable, not-collected, absent, and identity ambiguity;
- exact raw delta, metric-specific native/percent/fraction/category display metadata,
  presentation conversion, and negative-zero handling;
- fixed dynamic instance order and duplicate identity;
- no recursive diff, collection aggregation, source fetch, score, or signal.

P3-H2 tests:

- 200/400/404/405/500 and safe route/query validation;
- latest/no-comparison, start/reset, target/base changes, and zero/one history item;
- deep link, reload, Back/Forward, ticker/list/tab transitions, and pair-keyed
  filter/disclosure restoration and reset;
- unchanged/newer/failed reload behavior, explicit target adoption, overlapping
  reload/pair requests, ignored AbortSignal, stale success/error rejection, focus,
  and no unexpected scroll;
- filters, exact table states, 320/768/1280px, keyboard, and accessibility.

## 5. P3-R — Peer Radar

### 5.1 Scope

Radar renders the seven stored Peer Comparison positions:

| Axis | Expected direction |
| --- | --- |
| PER | `lower_is_better` |
| PBR | `lower_is_better` |
| ROE | `higher_is_better` |
| ROIC | `higher_is_better` |
| Operating Margin | `higher_is_better` |
| Revenue Growth | `higher_is_better` |
| Dividend Yield | `higher_is_better` |

It does not calculate a new rank, percentile, weight, or score.

### 5.2 Validation and fallback

For every axis require:

- finite percentile in inclusive range 0–1;
- stored metric and direction equal the expected registry entry;
- `peerSampleSize >= 1`;
- `cohortSize = peerSampleSize + 1`; and
- finite rank in inclusive range 1–cohortSize.

If any axis is missing or invalid, suppress the entire polygon and preserve the
exact table with an explicit invalid/unavailable state. Do not clamp, re-rank,
impute, or draw a partial polygon.

### 5.3 Presentation and accessibility

- Place Radar in `fundamentals / 比較・配当` alongside the existing peer table.
- Use a static SVG with `role=img`, a short title, and a description directing
  users to the exact table.
- Hide individual SVG labels from assistive technology to avoid duplicate reading.
- The semantic table contains metric, exact percentile, target/median/rank, sample
  size, direction, data date, and state.
- Do not make the polygon interactive or keyboard-focusable.
- Use no good/bad color interpretation.
- Keep chart/table overflow inside labelled regions on mobile; no document overflow.

Tests cover boundary 0/1, out-of-range, missing, direction mismatch, zero sample,
cohort mismatch, invalid rank, polygon suppression, exact table equivalence,
screen-reader naming, and 320/768/1280px layout.

## 6. P3-E — Independent Evaluator

### 6.1 Responsibility and invocation

Evaluator is optional qualitative AI review of one exact persisted Snapshot and its
stored report. It is not a financial Engine, report editor, score, or investment
judge.

```text
bun run evaluate:snapshot
  --ticker <ticker>
  --snapshot-id <id>
  [--model <model>]
  [--confirm-external-send]
```

- There is no latest alias.
- Dashboard has no run/re-run/delete button.
- No automatic execution occurs after analysis or save.
- Remote provider confirmation defaults to No every run.
- Non-interactive remote execution requires `--confirm-external-send`.
- There is no persistent, config, or environment bypass.
- Local providers are still identified accurately but do not show an external-send
  claim.

Before confirmation, show ticker, snapshot ID, provider, effective model, reasoning
effort, report/manifest/total input sizes, attempt limit, timeout, external-send
status, and possible API cost.

### 6.2 Evidence manifest

Evaluator receives:

- an instruction-isolated exact stored report;
- a deterministic, versioned evidence manifest; and
- a strict output schema.

It receives no tools and cannot fetch data.

The provider request has fixed code-owned instructions and one structured JSON data
object whose separate fields contain `report` and `evidenceManifest`. Both fields
are quoted untrusted data. Text inside either field—including requests to ignore the
rubric, reveal a secret, call a tool, or change output shape—is never an instruction.
No report text is interpolated into system/developer instructions, and the provider
tool list is exactly empty.

The manifest is an exact allowlist of stored deterministic evidence eligible to
verify report claims. Registry membership—not parsing whether the current prose
happens to mention a value—determines inclusion.
Each scope records a stable scope ID, stable claim domain, state, allowlisted reason,
and one exact coverage state:

```ts
type EvidenceScopeCoverageV1 =
  | 'complete_for_domain'
  | 'partial'
  | 'outside_snapshot_scope';

type EvidenceScopeStateV1 =
  | 'available'
  | 'unavailable'
  | 'not_collected'
  | 'outside_snapshot_scope';

type EvidenceScopeReasonV1 =
  | 'schema_predates_scope'
  | 'snapshot_section_unavailable'
  | 'stored_source_partial_coverage'
  | 'volume_profile_bins_excluded'
  | 'raw_series_excluded'
  | 'filing_output_not_persisted'
  | null;
```

`complete_for_domain` means that the versioned manifest allowlist contains every
persisted Snapshot fact eligible to verify that claim domain. `partial` means the
Snapshot or manifest contract contains only part of that domain.
`outside_snapshot_scope` means V1–V9 persist no evidence eligible to verify it.
Coverage and reason are generated from schema/version and collection state, never
chosen by the model.

Manifest V1 has exactly these scope IDs; adding/removing/renaming a scope increments
`manifestVersion`:

| Scope ID | Eligible V1 evidence | Coverage rule |
| --- | --- | --- |
| `snapshot_identity` | ticker, company, status, generated/data dates, provenance | complete when Snapshot loads |
| `valuation` | stored valuation scalars, units, dates, provenance | complete when section is available |
| `fundamental` | stored fiscal records, units, dates, provenance | complete when available and within limit |
| `peer_comparison` | seven stored metric positions and cohort metadata | complete when available |
| `technical` | stored technical scalar/category results and dates | complete when available |
| `advanced_technical` | stored advanced-technical outputs, methods, and dates | complete when schema-supported and available |
| `supply_demand` | stored balances, averages, deviation/percentile, volume inputs | complete when available |
| `market_correlation` | stored benchmark identity and 20/60/250-day outputs | complete when available |
| `reported_short_positions` | stored coverage metadata and public records | complete only when source coverage says complete and within limit |
| `investor_type_flows` | stored period, flow values, method, and coverage | inherit stored coverage |
| `sector_benchmark` | stored benchmark identity and 20/60/250-day outputs | inherit stored coverage/method |
| `sector_short_ratio` | stored periods, ratios, method, and coverage | inherit stored coverage |
| `advanced_dividend` | stored fiscal/event facts, methods, and dates | complete when available and within limits |
| `volume_profile` | stored summary/methodology except full bins | `partial` because bins are excluded |
| `strategy` | stored entry/candidate values, reasons, and calculation inputs | complete for persisted deterministic fields |
| `price_history` | no raw bars | `partial` with `raw_series_excluded` |
| `filing_narrative` | no items | always `outside_snapshot_scope` |

For a schema predating a scope, state is `not_collected`, coverage is `partial`, and
reason is `schema_predates_scope`. For a supported null/unavailable section, state is
`unavailable`, coverage is `partial`, and reason is
`snapshot_section_unavailable`. A stored partial/source-limited collection uses
`stored_source_partial_coverage` and is never relabelled complete. Raw free-form
top-level Snapshot `unavailable.reason/detail` text is not copied into the manifest;
only schema-enumerated result reasons may appear on individual items.
`complete_for_domain` means complete only for the registry-defined persisted domain,
not complete knowledge of the company or market.

Each eligible field is declared in a typed code-owned Evidence Definition registry
with stable definition key, introduced Snapshot version, exact accessor, scope,
value/unit/date/identity projection, and coverage rule. Do not reflectively traverse
the Snapshot. Dynamic item IDs are:

```text
"e_" + sha256(CanonicalJsonV1(
  manifestVersion,
  scopeId,
  definitionKey,
  instanceIdentity
)).slice(0, 24)
```

Definition keys never contain a fiscal year, date, ticker, window value, or record
ID; those belong to `instanceIdentity`. IDs are unique within a manifest, and a
collision invalidates generation before dispatch. The exact registry and stable-ID
fixtures are reviewed in P3-E1 before any provider call is introduced.

Each item records:

- stable semantic item ID;
- scope ID and schema pointer;
- exact value and unit;
- named dates;
- record/window identity;
- applicable method/coverage limitations.

Exclude:

- the raw Snapshot object;
- raw URLs and local paths;
- price-bar arrays and Volume Profile bins;
- raw prompts/tool arguments;
- existing AI scenarios/risks as evidence; and
- any Snapshot field not declared by the Evidence Definition registry.

In particular, filing-derived management context, material-risk narrative, and
other claims created from `read_filings` are outside V1–V9 Snapshot evidence because
the current Snapshot collector does not persist that tool result. Phase 3 does not
add a source field, V10 migration, or backfill to close that gap. Such a claim can be
evaluated for exact report anchoring and caveating, but its factual support cannot be
decided from the Snapshot manifest alone.

Limits:

- at most 6 fundamental periods;
- at most 100 public-short records;
- at most 20 dividend fiscal observations;
- at most 50 dividend events;
- at most 32 scopes and 512 items;
- at most 2,000 characters per string;
- at most 150,000 manifest characters;
- at most 200,000 total Evaluator logical-input characters.

Do not truncate. A limit violation fails before provider dispatch. A contractually
omitted collection is represented by scope coverage, not fabricated evidence.

### 6.3 Finding schema

```ts
type ReportAnchorV1 = Readonly<{
  start: number;   // UTF-16 code-unit offset, inclusive
  end: number;     // exclusive
  excerpt: string; // exact report.slice(start, end)
}>;

type EvidenceRefsBasisV1 = Readonly<{
  kind: 'evidence_refs';
  refs: readonly string[];
}>;

type ManifestAbsenceBasisV1 = Readonly<{
  kind: 'manifest_absence';
  scopeRefs: readonly string[];
  reason:
    | 'no_matching_allowlisted_evidence'
    | 'relevant_evidence_unavailable'
    | 'outside_snapshot_scope';
}>;

type EvaluationFindingV1 =
  | Readonly<{
      findingId: string;
      category: 'unsupported_claim';
      importance: 'material' | 'advisory';
      summary: string;
      anchor: ReportAnchorV1;
      basis: ManifestAbsenceBasisV1 & Readonly<{
        reason: 'no_matching_allowlisted_evidence';
      }>;
    }>
  | Readonly<{
      findingId: string;
      category: 'not_verifiable_from_snapshot';
      importance: 'advisory';
      summary: string;
      anchor: ReportAnchorV1;
      basis: ManifestAbsenceBasisV1 & Readonly<{
        reason: 'relevant_evidence_unavailable' | 'outside_snapshot_scope';
      }>;
    }>
  | Readonly<{
      findingId: string;
      category: 'internal_inconsistency' | 'unclear_reasoning';
      importance: 'material' | 'advisory';
      summary: string;
      anchor: ReportAnchorV1;
      basis: EvidenceRefsBasisV1;
    }>
  | Readonly<{
      findingId: string;
      category: 'missing_caveat';
      importance: 'material' | 'advisory';
      summary: string;
      anchor: ReportAnchorV1;
      basis: EvidenceRefsBasisV1 | ManifestAbsenceBasisV1;
    }>;
```

Categories:

- `unsupported_claim` requires `manifest_absence` with reason
  `no_matching_allowlisted_evidence`, at least one referenced
  `complete_for_domain` scope, and no evidence refs;
- `not_verifiable_from_snapshot` requires `manifest_absence` with reason
  `relevant_evidence_unavailable` or `outside_snapshot_scope`, and importance is
  always `advisory`;
- `internal_inconsistency` requires `evidence_refs`;
- `unclear_reasoning` requires `evidence_refs`;
- `missing_caveat` accepts either basis.

`not_verifiable_from_snapshot` says only that the persisted artifact cannot verify
the claim; it is not an assertion that the claim is false or unsupported. A correctly
source-caveated outside-scope claim produces no finding merely for being outside the
Snapshot. A central conclusion that relies on unavailable/outside-scope evidence
without an appropriate limitation may instead produce `missing_caveat`.

Every finding has `material | advisory` importance, plain-text summary, one exact
anchor, and one typed basis.

Validation:

- maximum 20 findings;
- summary 1–1,000 trimmed characters;
- excerpt 1–500 UTF-16 code units;
- `0 <= start < end <= report.length`;
- no anchor boundary inside a surrogate pair;
- exact `report.slice(start, end) === excerpt`;
- 1–16 unique valid evidence refs or 1–8 unique valid scope refs;
- no empty refs, sentinel IDs, free-form paths, unknown fields, score, pass, or
  recommendation;
- duplicate finding and finding-ID collision invalidate the available output.

Category/basis/coverage incompatibility invalidates the entire available output;
never coerce it into another category or fabricate an evidence ref. In particular,
an unavailable or outside-scope domain cannot satisfy `unsupported_claim`.

The provider wire schema mirrors this category-sensitive union but omits
`findingId`. The model does not supply it. After validation:

```text
findingId =
  "f_" + sha256(CanonicalJsonV1(category, importance, anchor, basis)).slice(0, 24)
```

Normalize refs into manifest order. Normalize findings by material before advisory,
then anchor start, category order, and finding ID.

### 6.4 Sidecar

```text
.dexter/evaluations/<ticker>/<snapshotId>/<evaluationId>.json
```

- `evaluationId` is UUIDv4.
- One run has one create-only, atomic, versioned sidecar.
- Validate path containment and path/body ticker/snapshot/evaluation identity.
- V1 is read/write; unknown versions are rejected without migration or rewrite.
- Multiple runs coexist; there is no latest alias or automatic selection.

The persisted result is exactly:

```ts
type EvaluationUnavailableCodeV1 =
  | 'provider_timeout'
  | 'provider_failure'
  | 'output_schema_invalid'
  | 'evidence_reference_invalid'
  | 'report_anchor_invalid';

type EvaluationResultV1 =
  | Readonly<{
      state: 'available';
      findings: readonly EvaluationFindingV1[];
    }>
  | Readonly<{
      state: 'unavailable';
      code: EvaluationUnavailableCodeV1;
      message: string;
      findings: readonly [];
    }>;
```

Unavailable `message` is fixed and sanitized per code. It contains no provider raw
error, request ID, response body, prompt fragment, credential, or path.

Persist:

- sidecar version and `evaluationId`;
- target ticker/snapshot ID/schemaVersion/generatedAt/snapshotDigest;
- `artifactInputDigest`;
- exact evidence manifest and its digest;
- evaluator schema, manifest, rubric, prompt, and safety versions;
- created/completed timestamps;
- provider, effective model, task profile, nullable reasoning effort;
- attempt count, timeout, duration;
- nullable input/output/total token usage;
- discriminated available/unavailable result.

Do not persist the Snapshot body, report body, raw prompt, raw provider output,
provider request ID, credential, local path, or raw provider error.

On load, re-read the target Snapshot and require digest/identity match. Do not
regenerate the stored manifest with current code.

Failure semantics:

- preflight, safety, missing target, or cancel before completion: no sidecar;
- post-dispatch timeout/provider/schema/ref/anchor failure: sanitized unavailable
  sidecar with no findings;
- cancel always wins over a late response and creates no sidecar;
- save-after-dispatch failure: no sidecar and a user warning that cost may have been
  incurred;
- unavailable is never converted to zero findings or a default pass;
- available zero findings states only that this run produced no validated finding.

A no-sidecar command failure returns only the requested ticker/Snapshot selectors and
an allowlisted sanitized failure code/message. It does not claim a verified target
schemaVersion, generatedAt, digest, manifest, or provider attempt when those facts
were not established.

### 6.5 Runtime

Runtime selection:

1. explicit `--model`;
2. saved `modelId`;
3. `DEFAULT_MODEL`.

Resolve once with `deep_analysis` and use the immutable effective
provider/model/reasoning for the entire call. Providers without supported reasoning
parameters record no effort instead of receiving an invented parameter.

- provider attempt limit: 1;
- hard timeout: 180 seconds;
- no retry or repair call;
- abort signal propagates to the provider;
- tools: none;
- maximum output tokens: 16,384;
- structured output: strict.

### 6.6 Read API and URL state

```text
GET /api/analyses/:ticker/history/:snapshotId/evaluations
GET /api/analyses/:ticker/history/:snapshotId/evaluations/:evaluationId
```

List:

- target existence is checked even when there are zero runs;
- metadata only, not the report or full manifest;
- default limit 20, maximum 100;
- sort `completedAt desc, evaluationId asc`;
- opaque strict base64url cursor containing version, completedAt, and evaluation ID;
- exact detail may be loaded even if not present on the current list page;
- a corrupt/unknown/digest-mismatched sidecar fails the list; do not skip it.

HTTP mapping:

- malformed ticker/snapshot/evaluation/cursor → 400;
- target Snapshot missing → 404 `snapshot_not_found`;
- evaluation missing → 404 `evaluation_not_found`;
- zero runs for an existing target → 200 with an empty page;
- corrupt/version/digest/filesystem failure → 500 `evaluation_unavailable`;
- non-GET → 405 with `Allow: GET`.

Preserve local Host restrictions, no CORS, `Cache-Control: no-store`, and
`nosniff`.

Page query:

```text
/?ticker=<ticker>&tab=evaluation
  [&base=<base-id>&target=<target-id>]
  [&evaluation=<evaluation-id>]
```

- Missing `evaluation` means unselected.
- Never auto-select even when exactly one run exists.
- Select/clear uses `pushState`.
- Tab changes use `replaceState` and preserve evaluation selection.
- Target/ticker/list changes clear evaluation.
- A base-only change preserves evaluation because target is unchanged.
- Syntactically invalid evaluation is removed before a request with
  `replaceState`.
- A valid 404 ID remains in the URL and shows inline error; do not fall back.
- Restore exact selection on Back/Forward.
- List and detail use separate AbortControllers and monotonic request tokens.
- Evaluation-panel failure does not replace the saved Snapshot page with a global
  error.

### 6.7 Dashboard

Evaluator has its own stable tab:

```text
evaluation / AIレビュー
```

The tab displays:

- an explicit non-deterministic AI-review label and statement that Snapshot/report
  are not modified;
- a native run selector;
- run time, provider, model, reasoning, schema/rubric/prompt/manifest versions;
- target Snapshot identity and digest;
- distinct states for no stored run, unselected, available zero findings,
  unavailable run, and available findings;
- material/advisory plain-text importance;
- escaped exact report excerpt in a blockquote;
- evidence value/unit/date/state/method/limitation table; or
- manifest-absence scope and reason.

It displays no execution/retry/delete control, score, percentage, pass/fail,
Buy/Sell, or gauge. Selecting a run does not steal focus or scroll. Loading uses
`role=status`; failure uses `role=alert`; status and importance are not conveyed
by color alone.

### 6.8 Gold set and release gate

Create a versioned Japanese set of 64 cases:

- 16 development and 48 locked holdout cases;
- two independent annotators plus adjudication;
- 12 clean holdout cases;
- balanced unsupported, not-verifiable-from-Snapshot, inconsistency,
  missing-caveat, and unclear-reasoning cases;
- V1–V9, zero, unavailable, not-collected, partial, compound, Japanese, and
  injection cases;
- fixed input digests;
- a 12-case stability subset;
- no telemetry or external eval service.

All 64 cases must use synthetic or explicitly redistributable fixture content and
must be safe to track in the repository. They contain no real credential, private
report, local path, proprietary payload, or unlicensed source text. The locked
holdout is immutable after adjudication and is not used for prompt tuning; "locked"
does not mean secret or unreviewable.

Finding matching is maximum one-to-one within category:

- report-anchor intersection-over-union at least 0.5;
- evidence-ref set F1 at least 0.5;
- manifest-absence reason exact match plus at least one overlapping scope;
- importance exact match for material metrics.

Locked-holdout gate:

- validated available: at least 46/48;
- material precision and recall: each at least 90%;
- per-category recall: each at least 80%;
- unsupported-claim precision and recall: each at least 90%;
- not-verifiable-from-Snapshot precision and recall: each at least 90%;
- missing-caveat recall: at least 85%;
- evidence-basis and matched-anchor accuracy: each at least 95%;
- ref/anchor integrity for available artifacts: 100%;
- material false positives across 12 clean cases: zero;
- clean cases with an advisory false positive: at most 1/12;
- timeouts: at most 1/48;
- successful-case p95 latency: below 180 seconds.

Run the stability subset three times:

- at least 90% of gold material findings appear in at least two runs;
- clean material false positives remain zero in all repetitions.

Eight injected pairs must:

- retain seeded material detection in 8/8;
- produce zero unknown refs, invalid anchors, summary canary leaks, scores, Buy/Sell,
  or tool calls; and
- not reduce material recall versus the paired baseline.

The gate pins exact provider/model/reasoning in its versioned manifest. The initial
gate runtime is `openai / gpt-5.6-terra / high`. Changing runtime, rubric, prompt,
manifest, or safety version requires a separate gate.

One campaign has a USD 25 hard cap. The gate manifest pins currency, input/output
unit prices, source, and verification date. Before each call reserve a safe upper
bound using input UTF-8 bytes as the maximum input-token count plus 16,384 output
tokens. Reconcile to returned usage after success; if usage is absent, retain the
reservation. Do not dispatch a call whose reservation exceeds remaining budget.
Raising the cap requires a reviewed manifest change.

The paid gate is manual and never runs in normal CI. Passing it does not authorize
automatic/default-on evaluation. P3-E2 cannot merge until the pinned locked-holdout
campaign passes all gates within the cost cap; P3-E3 cannot begin before that merge.
Unsupported-claim metrics exclude `not_verifiable_from_snapshot` gold labels and
predictions so lack of persisted filing evidence cannot be counted as unsupported.

### 6.9 Evaluator acceptance

P3-E1 tests include:

- deterministic V1–V9 manifests with exact scope domain/state/coverage/reason,
  stable item IDs, limits, and no silent truncation;
- a claim with no matching evidence inside a `complete_for_domain` scope can be
  represented as `unsupported_claim` with exact absence basis and no evidence refs;
- filing-derived or otherwise outside-scope claims map to
  `not_verifiable_from_snapshot` or an applicable `missing_caveat`, never to
  `unsupported_claim` solely because evidence was not persisted;
- unavailable and partial scopes cannot be promoted to complete coverage;
- category/basis/importance mismatches, fabricated refs, invalid anchors, unknown
  fields, and duplicate IDs reject the available artifact;
- exact persisted manifest loading across evaluator code-version change, without
  regeneration from the target Snapshot; and
- malformed/missing targets and preflight safety failures create no sidecar and
  return no fabricated verified metadata.

P3-E2 tests include:

- report/manifest prompt-injection fixtures remain inert quoted data with an empty
  tool list;
- default-No and non-interactive confirmation, one attempt, timeout, cancel, late
  response, provider/schema/reference failure, and save-after-cost behavior;
- correct classification of unsupported versus not-verifiable-from-Snapshot cases;
- no fabricated evidence, score, pass/fail, Buy/Sell, unknown ref, or invalid anchor;
- deterministic stub-provider tests in normal CI; and
- the versioned manual Japanese gold-set campaign as the merge gate above.

## 7. P3-C — Composite-score evaluation plan

### 7.1 Runtime decision

Phase 3 does not implement a composite score, weights, Snapshot field, Dashboard
score, threshold, or action. The current metrics have different populations,
dates, missingness, scales, and unvalidated predictive meaning.

Reject:

- copying a reference formula;
- treating 50 as an industry average without a population contract;
- reweighting around missing inputs;
- using Evaluator prose as a score input;
- deriving Buy/Sell, Entry, Stop, or Target from a composite value.

### 7.2 P3-C0 deliverable

P3-C0 creates only `docs/PHASE3_SCORE_EVALUATION_PLAN.md`. It must define:

- exact prediction target and horizon;
- point-in-time dataset and source-eligibility boundary;
- feature eligibility and missingness policy;
- train/development/locked time split;
- non-score baselines;
- calibration and sensitivity analysis;
- out-of-sample and look-ahead audit;
- acceptance thresholds, versioning, and adoption/rejection process.

Runtime adoption is a separate Phase 4 decision. If adopted, update
`docs/SPEC.md`, the roadmap, and a reviewed implementation plan before code.

## 8. Dashboard information architecture

Phase 3 extends the reviewed registry from five to six stable tabs:

| ID | Exact Japanese label | Phase 3 placement |
| --- | --- | --- |
| `report` | 概要・レポート | Comparison first, then existing report content |
| `evaluation` | AIレビュー | stored Evaluator runs only |
| `technical` | 株価・テクニカル | unchanged |
| `fundamentals` | 比較・配当 | Radar with existing peer/dividend content |
| `supply-demand` | 需給・空売り | unchanged |
| `market` | 市場・セクター | unchanged |

All six tabs exist for every readable V1–V9 Snapshot. `report` remains the default.
The automatic ARIA tabs pattern, keyboard wrap/Home/End behavior, sticky horizontal
mobile tablist, selected-tab visibility, History API, focus restoration, and
unknown-tab canonicalization remain inherited.

No Router, POST analysis/evaluation endpoint, polling, WebSocket, source refresh,
PDF control, or provider-cost action is introduced.

## 9. Implementation sequence

Each step is a separate small Draft PR from fast-forwarded `main`. Do not start a
dependent step before the predecessor is independently reviewed and merged.

1. **P3-0 — Source of Truth design synchronization**
   - update SPEC, MVP roadmap, this plan, and the non-normative handoff;
   - no runtime code.
2. **P3-I0 — History immutability, digest, and stored-report safety**
   - create-only history, CanonicalJsonV1, digest, collision, save/evaluator safety;
   - no Comparison, API/UI, Evaluator call, Radar, score, or PDF.
3. **P3-H1 — Pure saved-analysis Comparison**
   - 67-key registry, typed result, V1–V9 accessors, identity/delta logic;
   - no API or Dashboard.
4. **P3-H2 — Read-only Comparison presentation**
   - ticker-level GET route and Report-tab URL/UI;
   - no Browser calculation.
5. **P3-R1 — Peer Radar**
   - seven stored percentiles, validated polygon, exact accessible table.
6. **P3-E1 — Evidence and sidecar foundation**
   - manifest/finding schemas, repository, digest, failure contracts;
   - no LLM call.
7. **P3-E2 — Explicit Evaluator runtime**
   - controller/CLI, confirmation, one-attempt call, validation, manual gold gate;
   - no Dashboard cost trigger.
8. **P3-E3 — Evaluator read presentation**
   - cursor GET routes, URL selection, sixth Dashboard tab;
   - no report/Snapshot mutation.
9. **P3-C0 — Composite-score evaluation design**
   - docs-only Phase 4 evidence gate; no runtime score.
10. **P3-X — Final closeout**
    - Usage, applicable setup guidance, merged PR/validation record, handoff, and
      Phase 4 boundary.

## 10. Step validation matrix

Every PR runs:

```text
bun test
bun run typecheck
git diff --check
```

Additional gates:

| Step | Required focused validation |
| --- | --- |
| P3-I0 | collision/idempotency, canonical digest, report safety, V1–V9 unchanged |
| P3-H1 | 67 definitions/accessors, display/provenance, V1–V9, dates/identities/zero |
| P3-H2 | exact HTTP union, URL lifecycle, disclosure/reload races, focus, responsive |
| P3-R1 | range/direction/sample/cohort/rank, SVG/table accessibility, mobile |
| P3-E1 | coverage boundary, strict finding/basis, V1–V9 manifest, sidecar/create-only |
| P3-E2 | injection, confirmation, one attempt/timeout/cancel, stub CI, paid manual gate |
| P3-E3 | cursor, unselected/no-fallback, zero/unavailable/findings, race/keyboard |
| P3-C0 | no-look-ahead, gate completeness, absence of runtime score |
| P3-X | full regression, Playwright, CI/review/merge/main and docs synchronization |

Browser-interaction PRs use Playwright because unit tests do not establish initial
effects, History API, focus, sticky/mobile overflow, or request races. Normal CI
does not contact a paid provider.

## 11. Adopted, deferred, and rejected scope

### Implement in reviewed Phase 3 steps

- exact-registry deterministic saved-analysis Comparison;
- presentation-only Radar of seven existing peer percentiles;
- explicit qualitative Evaluator with separate versioned sidecars;
- docs-only composite-score evaluation design.

### Explicitly defer

- PDF/print view/export storage/download API;
- composite score implementation and weights pending Phase 4;
- collection-level public-short, investor-flow, or sector-flow diffs;
- automatic evaluation/reanalysis;
- cross-ticker comparison/ranking;
- Radar based on a new score;
- Snapshot migration/backfill.

PDF is reconsidered only after a concrete use case is documented. At that time,
create an independent feasibility, safety, runtime, accessibility, and test plan;
do not reopen or append it implicitly to Phase 3.

### Reject

- recursive generic JSON diff;
- current-source refresh during saved-history Comparison;
- old Snapshot mutation for Phase 3 artifacts;
- Evaluator default pass, empty-success fallback, retry, or unvalidated reference;
- numeric Evaluator quality/actionability/investment scores;
- Browser or LLM financial calculation;
- unsanitized report Markdown as trusted HTML;
- thresholds, rankings, or Buy/Sell signals;
- Dashboard provider-cost actions, POST generation, polling, or WebSocket.

## 12. Phase 3 Done

Declare Phase 3 complete only when:

- every step PR is independently reviewed and merged in sequence;
- local `main` is fast-forwarded to `origin/main`;
- required CI, focused Browser tests, and manual Evaluator gate pass;
- `Usage.md`, applicable setup guidance, this plan, and the handoff match reality;
- V9 writer and V1–V9 read behavior remain unchanged;
- valid zero/unavailable/not-collected semantics and existing signals regressions pass;
- no runtime composite score or new financial signal exists;
- Evaluator creation remains explicit CLI/controller-only;
- Dashboard remains GET-only; and
- no `.dexter` artifact, credential, proprietary/private gold item, or secret is
  tracked.

## 13. P3-0 review contract

P3-0 changes only:

- `docs/SPEC.md`;
- `docs/MVP_IMPLEMENTATION_PLAN.md`;
- `docs/PHASE3_PLAN.md`; and
- `docs/PHASE3_HANDOFF.md`.

It changes no application code, tests, dependency, CI, Snapshot schema, Dashboard
runtime, Engine, tool, or skill.

Self-review verifies:

- Source of Truth precedence and explicit roadmap synchronization;
- V1–V9 immutability and no hidden migration;
- exact separation of deterministic, presentation, AI, and deferred ownership;
- complete Comparison key/unit/date/identity/API/URL contracts;
- metric-specific Comparison display and pair/reload/disclosure lifecycle;
- Evaluator safety, evidence-coverage boundary, persistence, runtime, cost, API, and
  UI contracts;
- no score implementation before Phase 4 validation;
- PDF removed from Phase 3 implementation/Done/sequence while existing Browser-test
  Playwright remains;
- reviewable step boundaries; and
- Handoff remains non-normative and does not claim approval.

## 14. Next task after merge

After the exact P3-0 head passes independent review and is merged:

```text
P3-I0 — History immutability, CanonicalJsonV1 digest,
         and stored-report safety gate
```

Implement only that prerequisite. Do not add Comparison calculation/API/UI, Radar,
Evaluator runtime, score, PDF, Snapshot V10, or source fetch in P3-I0.
