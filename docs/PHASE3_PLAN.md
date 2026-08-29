# Phase 3 Implementation Plan

**Status:** P3-0 design contract; approval is determined only by the current
`docs/REVIEW_POLICY.md` Merge Gate and merged Git history

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

History publication uses this exact no-replace protocol; an existence check followed
by `rename` or `copyFile` is prohibited because it has a time-of-check/time-of-use
overwrite race:

1. create a unique temporary file in the final history directory with `wx`;
2. write and close the complete canonical payload, then re-read and validate its
   schema, path/body identity, and digest;
3. publish by creating a hard link from that same-volume temporary file to the final
   path; final-path `EEXIST` is the only losing-writer signal;
4. after successful linking, delete the temporary name; the final hard link is the
   winner and is never renamed over or replaced;
5. on `EEXIST`, read and validate the winner and compare the complete canonical
   digest: equal is idempotent success, different is `snapshot_id_collision`, and an
   unreadable/corrupt winner is a typed `snapshot_history_corrupt` failure; and
6. on an unsupported hard-link result such as `EXDEV`, `EPERM`, or `ENOSYS`, return
   typed `create_only_publish_unsupported`; do not fall back to replace-by-rename,
   copy, delete, repair, or an in-process-only lock.

Every path removes its own temporary file in `finally`; tests assert no temporary
name is left after success, idempotency, collision, validation failure, or unsupported
publication. P3-I0 must prove this protocol on the supported Bun/Windows and Bun/POSIX
filesystems before merge. The Evaluator sidecar repository reuses this exact protocol
in P3-E1. A sidecar `EEXIST` is an ID collision, even when payloads happen to match,
because each `evaluationId` denotes one run.

`latest.json` alone keeps the established replace-by-rename behavior. The writer
publishes history first and may update `latest.json` only after a `created` or
`existing_same` history outcome. Collision, corrupt-winner, validation, filesystem,
or unsupported-publication failure never changes `latest.json`.

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

All digest inputs are one typed object, never positional arguments to
`CanonicalJsonV1`. `artifactInputDigest` uses this exact envelope:

```ts
type ArtifactInputEnvelopeV1 = Readonly<{
  kind: 'dexter_evaluator_input';
  version: 1;
  snapshotDigest: SnapshotDigest;
  evidenceManifestDigest: `sha256:${string}`;
  evaluatorSchemaVersion: 1;
  evidenceManifestVersion: 1;
  rubricVersion: 1;
  promptVersion: 1;
  safetyPolicyVersion: 1;
  qualityGateId: string;
  gateManifestDigest: `sha256:${string}`;
  gateEvaluatedCommitSha: string;
  runtime: Readonly<{
    providerId: string;
    modelId: string;
    reasoningEffort: string | null;
  }>;
}>;
```

Every key is required, `undefined` is invalid, and nullable values use explicit
`null`. `artifactInputDigest` is SHA-256 over the complete CanonicalJsonV1 envelope
and is formatted as `sha256:` plus all 64 lowercase hexadecimal characters. Raw
prompts are not persisted.

Comparison responses contain both Snapshot digests but are not persisted.

### 3.4 Stored-report safety

The system fails closed; it does not redact or truncate.

`SafetyPolicyV1` scans exact non-empty configured values of at least eight UTF-16
code units from this code-owned environment allowlist:

```text
OPENAI_API_KEY, ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN,
CLAUDE_CODE_OAUTH_TOKEN, GOOGLE_API_KEY, XAI_API_KEY, MOONSHOT_API_KEY,
DEEPSEEK_API_KEY, OPENROUTER_API_KEY, EDINETDB_API_KEY, JQUANTS_API_KEY,
EXASEARCH_API_KEY, PERPLEXITY_API_KEY, TAVILY_API_KEY, LANGSEARCH_API_KEY,
X_BEARER_TOKEN, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_SESSION_TOKEN,
SLACK_BOT_TOKEN, SLACK_APP_TOKEN, DISCORD_BOT_TOKEN, LINE_CHANNEL_SECRET,
LINE_CHANNEL_ACCESS_TOKEN
```

The exact-value match is case-sensitive against the unmodified string. Shorter
configured values are not substring-matched because they create unsafe false
positives; marker checks still apply. Marker checks are the following case-sensitive
regular expressions and no implicit broader heuristic:

```text
/-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/
/\bsk-(?:proj-)?[A-Za-z0-9_-]{16,}\b/
/\bxox[baprs]-[A-Za-z0-9-]{16,}\b/
/\bgh[pousr]_[A-Za-z0-9]{20,}\b/
/\bAKIA[0-9A-Z]{16}\b/
/\bAIza[0-9A-Za-z_-]{35}\b/
```

Disallowed controls are U+0000–U+0008, U+000B, U+000C, U+000E–U+001F, and
U+007F. TAB, LF, and CR are allowed. Character limits use JavaScript UTF-16 code
units; byte limits use UTF-8 bytes.

At V9 save time, scan the complete stored report and reject an exact credential,
marker, disallowed control, more than 50,000 UTF-16 code units, or more than 200,000
UTF-8 bytes. Before Evaluator confirmation and dispatch, repeat that scan over the
report and scan the complete logical input; also reject a logical input above 200,000
UTF-16 code units.

Evaluator-only absolute-path detection splits with
``/[\s"'`<>()\[\]{}]+/u``, strips only trailing
`/[.,;:!?。、，；：！？]+$/u`, and then applies `path.win32.isAbsolute` and
`path.posix.isAbsolute`. A token parsed as an `http:` or `https:` URL is exempt;
`file:` URLs, Windows drive paths, UNC paths, and POSIX absolute paths are rejected.
Relative paths and plain ticker/ID strings are not rejected.

Failures use only these fixed codes: `credential_value_detected`,
`credential_marker_detected`, `private_key_marker_detected`,
`disallowed_control_character`, `report_utf16_too_large`,
`report_utf8_too_large`, `logical_input_too_large`, and
`absolute_path_detected`. Messages are code-owned and contain no detected value,
environment-variable name, path, offset, report excerpt, or input fragment. Silent
redaction and truncation are prohibited. Prompt-injection text remains inert input
data and is never treated as an instruction.

P3-I0 acceptance tests include:

- two or more real processes racing the same/different canonical payload, exactly one
  winning final inode, equal-payload idempotency, typed collision, corrupt winner,
  unsupported hard link, and no replaced winner or leaked temporary file;
- `latest.json` unchanged after every losing/error outcome and updated only after a
  verified created/existing-same history outcome;
- literal canonical golden vectors, source-key reordering, Unicode preservation,
  negative zero, explicit null, `undefined`, non-finite number, and complete lowercase
  digest length;
- every allowlisted environment name using dummy values, below-eight-unit behavior,
  every marker regex, every rejected/allowed control boundary, UTF-16 and UTF-8 size
  boundaries including surrogate pairs, and fixed failure messages with no matched
  content;
- Windows drive/UNC, POSIX and `file:` rejection; `http:`/`https:` exemption;
  relative-path acceptance; punctuation/token boundaries; and no provider dispatch;
  and
- V9 remains the only writer, V1–V9 remain readable, and no old history file is
  rewritten or backfilled.

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
      reason: 'non_available_state';
      sideStates: Readonly<{
        base: ComparisonValueStateV1;
        target: ComparisonValueStateV1;
      }>;
      affectedSides: readonly ('base' | 'target')[];
    }>
  | Readonly<{
      state: 'not_applicable';
      mode: 'not_applicable';
      delta: null;
      reason: 'record_added' | 'record_removed';
      affectedSides: readonly ('base' | 'target')[];
    }>;

type SnapshotComparisonMetricRowV1 = Readonly<{
  metricKey: ComparisonMetricKeyV1;
  section: ComparisonSectionV1;
  valueKind: 'number' | 'category';
  expectedUnit: string | null;
  displaySemantics: ComparisonDisplaySemanticsV1;
  definitionIntroducedInSnapshotVersion: 1 | 2 | 3 | 6 | 8 | 9;
  instanceIntroducedInSnapshotVersion: 1 | 2 | 3 | 6 | 8 | 9;
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
  | Readonly<{
      state: 'not_collected';
      unavailableReasons: ComparisonObservationV1['unavailableReasons'];
    }>;

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

Section classification uses this exact precedence:

1. schema predates the section: `not_collected` with synthetic reason
   `schema_predates_section`;
2. schema supports the section, its object is null, and its matching top-level stored
   unavailability entry has `reason === 'not_collected'`: `not_collected`, preserving
   that reason/detail;
3. schema supports the section and its object is null for any other reason:
   `unavailable`, preserving matching reason/detail or using synthetic
   `missing_section_value` when none exists; `missing_required_section` remains an
   unavailable reason, never not-collected; and
4. the section object exists: `available`.

A field-level null alone never implies `not_collected`. An existing section object
paired with a matching top-level `not_collected` entry is a semantic contradiction
and fails the whole request as sanitized `corrupt_snapshot`; it is not repaired.
Individual unavailable metrics remain row states and do not relabel an existing
section. Preserve each side's section reasons separately. When a row has any
non-available side, `reason: non_available_state`, `sideStates`, and `affectedSides`
preserve the exact asymmetric transition; do not collapse mixed
unavailable/not-collected/absent states to one reason.

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
  ) => readonly ComparisonInstanceDefinitionV1[];
  extractObservation: (
    snapshot: AnalysisSnapshot,
    instance: ComparisonInstanceDefinitionV1,
  ) => ComparisonObservationV1;
  compare: (
    base: ComparisonObservationV1,
    target: ComparisonObservationV1,
  ) => ComparisonDispositionV1;
}>;

type ComparisonInstanceDefinitionV1 = Readonly<{
  identity: ComparisonInstanceIdentityV1;
  introducedInSnapshotVersion: 1 | 2 | 3 | 6 | 8 | 9;
}>;
```

The definition version is the earliest schema containing any instance of that key;
every fixed or dynamic instance also declares its own introduction version.
`extractObservation` owns both version guards, exact value accessor, actual stored
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

#### Market Correlation — five definitions

Each definition creates only 20/60/250-day instances. The 60- and 250-day instances
are V1+; the 20-day instance is V3+ because P2-M1 first persisted it in Snapshot V3.
V1/V2 therefore return the fixed 20-day instance as `not_collected`, not `absent`:

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

Entry identity is entry reason plus trigger. Initial candidate Comparison includes
only the deterministic `risk_reward_2R` target. Its candidate identity is:

```text
entry.reason + stop.reason + target.reason
```

Match only when exactly one record on a side has the identity. Zero matches is
`absent`; more than one is row-level `identity_ambiguous`. Never match by array
index. `resistance_level` candidates are excluded because Snapshot V1–V9 persist no
stable resistance-source identity and can legitimately contain multiple targets with
the same reason tuple. Risk, reward, and tick-size fields are registry-excluded.

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
- History is ordered by `generatedAt asc, snapshotId asc` after every item has passed
  repository validation. An immediate predecessor means the final item in that order
  whose `generatedAt` is strictly earlier than the target; same-time items are never
  a valid base for each other.
- With no strictly ordered pair—including zero items, one item, or only same-time
  items—the start action is disabled and the UI says
  `比較には生成時刻の異なる保存済み分析が2件以上必要です`. It does not write
  a one-sided URL or start a Comparison request.
- The oldest item may be selected as base but is disabled as a target because it has
  no predecessor. Attempting to adopt it as target preserves the current URL, pair,
  rows, focus, and History entry and announces the same strictly ordered-pair
  requirement.
- Starting Comparison first resolves and validates the current target and its
  predecessor in memory, then calls `pushState` once with both IDs. Resolution
  failure preserves the normal detail URL and shows a scoped error.
- Target pins the entire Dashboard to that exact Snapshot.
- Changing target first resolves and validates its immediate predecessor, then calls
  `pushState` once with the complete new pair. It never emits a transient target-only
  or stale-base URL.
- Changing base validates it against the current target and calls `pushState` once;
  invalid selection leaves URL and state unchanged.
- Tab selection uses `replaceState` and preserves the pair.
- Ticker/list navigation removes the pair.
- Malformed, one-sided, same-ID, or reversed deep links are not repaired or swapped;
  show an inline error and a Comparison-reset action.
- Reset uses one `pushState` to remove both IDs, preserves ticker and `tab=report`,
  and returns to normal latest-detail behavior.
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
- that action resolves both items before one `pushState`, selects the newer target
  and its immediate predecessor, and resets pair-scoped filter/disclosures;
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
  definition introduction, and per-instance introduction for all 67 definitions;
- all readable V1–V9 combinations without input mutation;
- V1/V2 20-day market-correlation `not_collected` versus V3+ availability, with
  60/250-day instances remaining V1+;
- same/changed ticker, order, period, benchmark, method, window, identity, and dates;
- available zero, required-null `missing_required_section`, supported optional-null
  stored `not_collected`, unavailable, absent, mixed asymmetric side states with
  reason/detail preservation, and identity ambiguity;
- exact raw delta, metric-specific native/percent/fraction/category display metadata,
  presentation conversion, and negative-zero handling;
- fixed dynamic instance order, duplicate identity, resistance-candidate exclusion,
  and no array-index matching;
- no recursive diff, collection aggregation, source fetch, score, or signal.

P3-H2 tests:

- 200/400/404/405/500 and safe route/query validation;
- latest/no-comparison, start/reset, target/base changes, zero/one/same-time history,
  oldest-target rejection, and no transient/invalid History entry;
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
- top-level `selection.tooFewPeers === false`;
- `peerSampleSize >= PEER_COMPARISON_DEFAULTS.minimumPeers` for every axis; the
  inherited initial threshold is exactly 5;
- `cohortSize = peerSampleSize + 1`; and
- finite rank in inclusive range 1–cohortSize.

If any axis is missing or invalid, suppress the entire polygon and preserve the
exact table with an explicit invalid/unavailable state. Do not clamp, re-rank,
impute, or draw a partial polygon.

`marketCapPriorityApplied === false` does not by itself suppress an otherwise valid
polygon, but its stored reason/limitation is displayed next to both chart and table.
The minimum of five is not a new Phase 3 quality score; it is the existing Peer
Comparison engine adequacy threshold and changes only with that reviewed engine
contract.

### 5.3 Presentation and accessibility

- Place Radar in `fundamentals / 比較・配当` alongside the existing peer table.
- Use a static SVG with `role=img`, a short title, and a description directing
  users to the exact table.
- Hide individual SVG labels from assistive technology to avoid duplicate reading.
- The semantic table contains metric, exact percentile, target/median/rank, sample
  size, direction, data date, and state. It also exposes global selected-peer count,
  `tooFewPeers`, and market-cap-priority applied/reason state.
- Do not make the polygon interactive or keyboard-focusable.
- Use no good/bad color interpretation.
- Keep chart/table overflow inside labelled regions on mobile; no document overflow.

Tests cover boundary 0/1, out-of-range, missing, direction mismatch, sample sizes
0/1/4/5, top-level `tooFewPeers`, cohort mismatch, invalid rank,
market-cap-priority limitation display, polygon suppression, exact table equivalence,
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
- `--model`, saved `modelId`, and `DEFAULT_MODEL` are selectors only; after profile
  resolution the exact provider/model/effective-reasoning tuple must match an
  accepted `QualifiedEvaluatorRuntimeV1` entry.
- The initial accepted tuple is only `openai / gpt-5.6-terra / high`. A local or
  remote selector without a matching passed gate fails preflight with typed
  `runtime_not_quality_gated`, before confirmation, dispatch, cost, or sidecar.

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
happens to mention a value—determines inclusion. Every scope maps one-to-one to this
closed claim-domain taxonomy; a provider cannot invent a domain:

```ts
type EvidenceClaimDomainV1 =
  | 'snapshot_identity'
  | 'valuation_metrics'
  | 'fundamental_periods'
  | 'peer_positions'
  | 'technical_metrics'
  | 'advanced_technical_metrics'
  | 'supply_demand_metrics'
  | 'market_correlation_windows'
  | 'reported_short_persisted_rows'
  | 'investor_flow_tokyo_nagoya_period'
  | 'sector_benchmark_persisted_windows'
  | 'sector_short_persisted_observations'
  | 'advanced_dividend_persisted_facts'
  | 'volume_profile_summary'
  | 'strategy_persisted_candidates'
  | 'outside_price_history_series'
  | 'outside_volume_profile_bins'
  | 'outside_filing_narrative'
  | 'outside_company_management_history'
  | 'outside_competitors_industry'
  | 'outside_macro_market_news'
  | 'outside_undeclared_financial_metric'
  | 'outside_source_totality'
  | 'outside_other_context';
```

Each scope records a stable scope ID, one exact `claimDomain`, state, allowlisted
reason, and coverage:

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
  | 'stored_not_collected'
  | 'snapshot_section_unavailable'
  | 'volume_profile_bins_excluded'
  | 'raw_series_excluded'
  | 'domain_not_persisted'
  | null;
```

`complete_for_domain` means that the versioned manifest allowlist contains every
persisted Snapshot fact eligible to verify that exact, narrowly named claim domain;
it never claims complete source disclosures, all periods, or complete knowledge of
the company or market. `partial` means the target Snapshot cannot supply every item
eligible for that persisted domain because the section is unavailable or
uncollected.
`outside_snapshot_scope` means V1–V9 persist no evidence eligible to verify it.
Coverage and reason are generated from schema/version and collection state, never
chosen by the model.

The manifest digest hashes one object, not a bare array or positional values:

```ts
type EvidenceManifestDigestEnvelopeV1 = Readonly<{
  kind: 'dexter_evidence_manifest';
  version: 1;
  manifest: EvidenceManifestV1;
}>;
```

`evidenceManifestDigest` is SHA-256 over its complete CanonicalJsonV1 bytes and uses
`sha256:` plus all 64 lowercase hex characters. The exact envelope and manifest are
persisted together so a digest never depends on current registry regeneration.

Manifest V1 has exactly these scope IDs; adding/removing/renaming a scope increments
`manifestVersion`:

| Scope ID | Claim domain | Exact eligible V1 evidence / coverage |
| --- | --- | --- |
| `snapshot_identity` | `snapshot_identity` | stored ticker, company, status, generated/data dates and provenance; complete after Snapshot validation |
| `valuation` | `valuation_metrics` | exact stored valuation scalars, units, dates and provenance; complete when section exists |
| `fundamental` | `fundamental_periods` | all persisted fiscal records within the declared six-record maximum; complete when section exists |
| `peer_comparison` | `peer_positions` | exact seven stored metric positions and cohort/selection metadata; complete when section exists |
| `technical` | `technical_metrics` | exact stored technical scalar/category results and dates; complete when section exists |
| `advanced_technical` | `advanced_technical_metrics` | exact stored outputs, methods and dates; complete when supported object exists |
| `supply_demand` | `supply_demand_metrics` | exact stored balances, averages, deviation/percentile and volume inputs; complete when section exists |
| `market_correlation` | `market_correlation_windows` | exact persisted TOPIX windows: 60/250 in V1+, 20 in V3+; complete for instances supported by that schema |
| `reported_short_positions` | `reported_short_persisted_rows` | every row actually persisted in the Snapshot, at most 100; never asserts all public disclosures were collected |
| `investor_type_flows` | `investor_flow_tokyo_nagoya_period` | exact persisted Tokyo/Nagoya period and values only; never other exchanges or periods |
| `sector_benchmark` | `sector_benchmark_persisted_windows` | exact stored benchmark identity/method and persisted windows only; no unstored source-coverage claim |
| `sector_short_ratio` | `sector_short_persisted_observations` | exact stored observations and method only; no unstored source-coverage claim |
| `advanced_dividend` | `advanced_dividend_persisted_facts` | every persisted fiscal/event fact within 20/50 limits, methods and dates |
| `volume_profile_summary` | `volume_profile_summary` | exact stored POC/Value Area summary and method; complete for the summary domain |
| `strategy` | `strategy_persisted_candidates` | every exact persisted entry/candidate value, reason and calculation input |
| `outside_price_history_series` | `outside_price_history_series` | no items; always outside with `raw_series_excluded` |
| `outside_volume_profile_bins` | `outside_volume_profile_bins` | no items; always outside with `volume_profile_bins_excluded` |
| `outside_filing_narrative` | `outside_filing_narrative` | no items; filing prose/tool output is not persisted |
| `outside_company_management_history` | `outside_company_management_history` | no items; management/company-history facts are not persisted |
| `outside_competitors_industry` | `outside_competitors_industry` | no items; competitor/industry narrative is not persisted |
| `outside_macro_market_news` | `outside_macro_market_news` | no items; macro, market-news and current-event facts are not persisted |
| `outside_undeclared_financial_metric` | `outside_undeclared_financial_metric` | no items; any metric/ratio absent from the Evidence registry, such as EV/EBITDA |
| `outside_source_totality` | `outside_source_totality` | no items; claims such as “all filings/disclosures/periods” cannot be proven by persisted rows |
| `outside_other_context` | `outside_other_context` | no items; catch-all for a claim outside every closed persisted domain |

Stored-scope state uses the same precedence as Comparison: schema predates scope →
`not_collected/partial/schema_predates_scope`; supported null plus matching stored
top-level `reason === 'not_collected'` →
`not_collected/partial/stored_not_collected`; any other supported null →
`unavailable/partial/snapshot_section_unavailable`; object present → available and
`complete_for_domain` after all eligible items fit the limits. Object-present plus a
matching top-level `not_collected` entry is corrupt input. Field-level null alone
never changes the scope to not-collected. Raw free-form top-level reason/detail is not
sent; only the allowlisted scope reason and schema-enumerated item state/reason are.

The four collections that have no persisted source-completeness field—reported short
positions, investor flow, sector benchmark, and sector short ratio—are complete only
for their explicitly named *persisted-content* domains. The Evaluator must not infer
or say that their upstream source, all dates, or all disclosures are complete. A
claim of source totality always maps to `outside_source_totality`.

Each eligible field is declared in a typed code-owned Evidence Definition registry
with stable definition key, introduced Snapshot version, per-instance introduction
version, exact accessor, scope, value/unit/date/identity projection, and coverage
rule. Do not reflectively traverse the Snapshot. Dynamic item IDs hash this exact
single object:

```ts
type EvidenceItemIdEnvelopeV1 = Readonly<{
  kind: 'dexter_evidence_item_id';
  version: 1;
  manifestVersion: 1;
  scopeId: string;
  definitionKey: string;
  instanceIdentity: ComparisonInstanceIdentityV1;
}>;

itemId = 'e_' + sha256Hex(CanonicalJsonV1(envelope)).slice(0, 24)
```

`sha256Hex` here returns raw 64-character lowercase hex without a `sha256:` prefix;
truncation occurs only after producing all 64 characters.

Fixed registry instances are emitted in deterministic order even when a readable
schema predates that instance. Such an item has `not_collected`, null value, and
allowlisted `schema_predates_instance`; it is not misclassified as an absent record.
In particular, the market-correlation 20-day item is not-collected for V1/V2 while
60/250-day items remain V1+. This item state does not make the scope incomplete for
the older schema; `complete_for_domain` is relative to every instance that schema can
persist plus explicit not-collected markers for later fixed instances.

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

Claim-domain assignment is part of the strict provider schema and local validation.
Filing narrative, company/management history, competitor/industry statements,
macro/news statements, undeclared metrics, source-totality claims, and all remaining
context map to their exact outside domain. Existing AI scenarios/risks are not
evidence and map by what they claim; they do not default to filing narrative.
`unsupported_claim` is allowed only when the finding's domain maps to a
`complete_for_domain` persisted scope and no matching allowlisted item exists.
Every outside, unavailable, or not-collected domain is
`not_verifiable_from_snapshot` or an applicable `missing_caveat`, never unsupported
solely because the Snapshot lacks evidence. Phase 3 adds no source field, V10, or
backfill to close these gaps.

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
      claimDomain: EvidenceClaimDomainV1;
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
      claimDomain: EvidenceClaimDomainV1;
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
      claimDomain: EvidenceClaimDomainV1;
      importance: 'material' | 'advisory';
      summary: string;
      anchor: ReportAnchorV1;
      basis: EvidenceRefsBasisV1;
    }>
  | Readonly<{
      findingId: string;
      category: 'missing_caveat';
      claimDomain: EvidenceClaimDomainV1;
      importance: 'material' | 'advisory';
      summary: string;
      anchor: ReportAnchorV1;
      basis: EvidenceRefsBasisV1 | ManifestAbsenceBasisV1;
    }>;
```

Categories:

- `unsupported_claim` requires `manifest_absence` with reason
  `no_matching_allowlisted_evidence`, at least one referenced
  `complete_for_domain` scope whose `claimDomain` exactly equals the finding domain,
  no matching unavailable/not-collected item or scope limitation, and no evidence
  refs;
- `not_verifiable_from_snapshot` requires `manifest_absence` with reason
  `relevant_evidence_unavailable` or `outside_snapshot_scope`, references only scopes
  whose `claimDomain` equals the finding domain, and importance is always `advisory`;
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
For a dynamic persisted-content domain, lack of a row is unsupported only when the
claim is explicitly about what this exact Snapshot persisted. A claim about upstream
source totality maps to `outside_source_totality` even when the persisted-content
scope is complete.

The provider wire schema mirrors this category-sensitive union but omits
`findingId`. The model does not supply it. Before hashing, validate the complete
finding, deduplicate refs, order evidence refs by manifest item order, and order scope
refs by the manifest scope registry. Hash this exact normalized single object:

```ts
type EvaluationFindingIdEnvelopeV1 = Readonly<{
  kind: 'dexter_evaluation_finding_id';
  version: 1;
  category: EvaluationFindingV1['category'];
  claimDomain: EvidenceClaimDomainV1;
  importance: 'material' | 'advisory';
  anchor: ReportAnchorV1;
  basis: EvidenceRefsBasisV1 | ManifestAbsenceBasisV1;
}>;

findingId = 'f_' + sha256Hex(CanonicalJsonV1(envelope)).slice(0, 24)
```

`sha256Hex` produces all 64 lowercase hex characters before truncation. Never hash
provider ref order or the unvalidated wire object. After IDs exist, normalize
findings by material before advisory, then anchor start, category order, and finding
ID.

#### 6.3.1 Canonical golden vectors

P3-I0 and P3-E1 implement these literal UTF-8 fixtures. Reordering source-object
insertion does not change any output. `undefined`, omitted required envelope keys,
non-finite numbers, and implicit optional fields are rejected rather than hashed.

```text
CanonicalJsonV1({ b: "日本", a: -0, c: null })
  = {"a":0,"b":"日本","c":null}
sha256Hex
  = adc7d70bc50092a016f02fb4930fe657de189b28ace486f8f7448fbcff6bd1b5
```

```text
CanonicalJsonV1({ a: "x" }) where an optional source key b is absent
  = {"a":"x"}
sha256Hex
  = bac82bcae3ff0e486fd02d6dce53dc6444bcbd21f6ab5dea0a69e86e8b723b7f
```

```text
EvidenceItemIdEnvelopeV1
  = {"definitionKey":"marketCorrelation.window.beta","instanceIdentity":[{"name":"benchmark","value":"TOPIX"},{"name":"period","value":20}],"kind":"dexter_evidence_item_id","manifestVersion":1,"scopeId":"market_correlation","version":1}
sha256Hex
  = f6445e5bbc10fdb2a5191e0f1b0c1722c450dab3b62639f33e90b3c49f6e47d2
itemId
  = e_f6445e5bbc10fdb2a5191e0f
```

```text
Normalized EvaluationFindingIdEnvelopeV1
  = {"anchor":{"end":2,"excerpt":"根拠","start":0},"basis":{"kind":"manifest_absence","reason":"no_matching_allowlisted_evidence","scopeRefs":["valuation"]},"category":"unsupported_claim","claimDomain":"valuation_metrics","importance":"material","kind":"dexter_evaluation_finding_id","version":1}
sha256Hex
  = 70ceb8a3bdf2877d9bfd621972e51cfec507197d4d70eab6f2f5970fa5491ca9
findingId
  = f_70ceb8a3bdf2877d9bfd6219
```

```text
ArtifactInputEnvelopeV1 with zero snapshot digest, one manifest digest, two gate
manifest digest, 40 lowercase `a` gate commit, qualityGateId=qg_v1_terra_high,
and openai/gpt-5.6-terra/high
  = {"evaluatorSchemaVersion":1,"evidenceManifestDigest":"sha256:1111111111111111111111111111111111111111111111111111111111111111","evidenceManifestVersion":1,"gateEvaluatedCommitSha":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","gateManifestDigest":"sha256:2222222222222222222222222222222222222222222222222222222222222222","kind":"dexter_evaluator_input","promptVersion":1,"qualityGateId":"qg_v1_terra_high","rubricVersion":1,"runtime":{"modelId":"gpt-5.6-terra","providerId":"openai","reasoningEffort":"high"},"safetyPolicyVersion":1,"snapshotDigest":"sha256:0000000000000000000000000000000000000000000000000000000000000000","version":1}
artifactInputDigest
  = sha256:781fc1a408d67c18ae0cdf00777e4f3568bf0b9b67cb367cf5fd158425600a5a
```

### 6.4 Sidecar

```text
.dexter/evaluations/<ticker>/<snapshotId>/<evaluationId>.json
```

- `evaluationId` is UUIDv4.
- One run has one create-only, versioned sidecar published by the exact no-replace
  hard-link protocol in Section 3.2; no rename/copy fallback is allowed.
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
- `qualityGateId`, gate manifest digest, and gate-evaluated commit SHA;
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

Runtime selection first resolves:

1. explicit `--model`;
2. saved `modelId`;
3. `DEFAULT_MODEL`.

Resolve once with `deep_analysis`, then require an exact match in this code-owned
gate record:

```ts
type QualifiedEvaluatorRuntimeV1 = Readonly<{
  qualityGateId: string;
  gateManifestDigest: `sha256:${string}`;
  gateEvaluatedCommitSha: string;
  state: 'qualified';
  providerId: string;
  modelId: string;
  reasoningEffort: string | null;
  evaluatorSchemaVersion: 1;
  evidenceManifestVersion: 1;
  rubricVersion: 1;
  promptVersion: 1;
  safetyPolicyVersion: 1;
}>;
```

`qualityGateId` matches `^qg_[a-z0-9][a-z0-9_-]{0,63}$`, the gate digest is a full
lowercase `sha256:` digest, and `gateEvaluatedCommitSha` is exactly 40 lowercase hex
characters. Duplicate gate IDs or a gate record whose manifest does not hash to its
declared digest are invalid configuration and fail before provider dispatch.

Use that immutable provider/model/reasoning and version tuple for the entire run.
There is no ungated/experimental mode, compatibility fallback, or reasoning
downgrade. The CLI and Dashboard detail display the gate ID and evaluated commit.

P3-E2 introduces an Evaluator-only `invokeEvaluatorOnce` provider boundary. It must
not call the current generic `callLlm` or `withRetry` paths, because those paths have
retry, permissive-structured-output, and raw-error logging behavior outside this
contract. Existing callers remain unchanged. The new boundary:

- provider attempt limit: 1;
- hard timeout: 180 seconds;
- no retry or repair call;
- one provider dispatch and an AbortSignal propagated through the provider adapter;
- tools: none;
- maximum output tokens: 16,384;
- provider-native strict structured output for every qualified runtime, followed by
  exact local category-sensitive validation with unknown fields rejected; and
- logging limited to allowlisted provider ID, fixed failure code, and attempt number.
  Raw error/message/cause, response, prompt, request ID, credential, and path are
  never logged.

Timeout or cancellation cannot start another provider request. Cancellation wins
over a late response. A provider adapter that cannot enforce native strict output,
AbortSignal, empty tools, and the output-token limit is not eligible for a quality
gate.

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

The gate pins exact provider/model/reasoning and every field of
`QualifiedEvaluatorRuntimeV1` in its versioned manifest. The initial gate runtime is
`openai / gpt-5.6-terra / high`. A successful campaign creates one reviewed gate
record whose ID and manifest digest are used by the CLI and sidecars.

The campaign is run against the exact P3-E2 candidate commit. Any later change to
Evaluator runtime/provider adapter, prompt, evidence registry/manifest, finding
schema, rubric, safety policy, gold harness/fixtures, or dependency lockfile
invalidates that result and requires the full paid gate again before merge. An
unrelated docs-only correction may be explicitly excluded only by independent
review. Changing any qualified runtime or version requires a new gate ID; an old
record never authorizes a different tuple.

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
- qualified runtime acceptance, `--model`/saved/default ungated rejection before
  confirmation, default-No and non-interactive confirmation, one provider dispatch,
  no generic `callLlm`/retry path, timeout, cancel, late response,
  provider/schema/reference failure, sanitized logs, and save-after-cost behavior;
- correct closed-domain classification of unsupported versus
  not-verifiable-from-Snapshot cases, including filing, company/management,
  competitor/industry, macro/news, undeclared EV/EBITDA, source-totality, and other
  outside-context fixtures;
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
| P3-I0 | cross-process no-clobber/idempotency, hard-link unsupported path, latest ordering, canonical golden vectors, exact safety grammar, V1–V9 readability |
| P3-H1 | 67 definitions/accessors, definition/instance versions, display/provenance, V1–V9, dates/identities/zero |
| P3-H2 | exact HTTP union, URL lifecycle, disclosure/reload races, focus, responsive |
| P3-R1 | range/direction/sample/cohort/rank, SVG/table accessibility, mobile |
| P3-E1 | closed claim domains, strict finding/basis, canonical IDs, V1–V9 manifest, no-replace sidecar |
| P3-E2 | qualified tuple, injection, confirmation, one dispatch/timeout/cancel, sanitized logs, stub CI, exact-head paid gate |
| P3-E3 | cursor, gate metadata, unselected/no-fallback, zero/unavailable/findings, race/keyboard |
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
- Strategy `resistance_level` candidate Comparison until a stable persisted
  resistance-source identity exists;
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
- V9 remains the only Snapshot writer and V1–V9 remain readable without backfill;
- P3-I0's reviewed no-replace history acceptance, collision, digest, and report-safety
  changes pass without changing Snapshot schema version;
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
- cross-process create-only publication without rename/copy overwrite fallback;
- exact separation of deterministic, presentation, AI, and deferred ownership;
- complete Comparison key/unit/date/identity/API/URL contracts;
- metric-specific Comparison display and pair/reload/disclosure lifecycle;
- exact Evaluator safety grammar, closed evidence domains, canonical byte envelopes,
  no-replace persistence, qualified runtime, cost, API, and UI contracts;
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
