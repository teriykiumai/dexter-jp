# Phase 3 Implementation Plan

**Status:** Phase 3 normative contract; P3-EF freezes P3-E2/P3-E3; approval is
determined only by the current `docs/REVIEW_POLICY.md` Merge Gate and merged Git
history

**Repository baseline:** `b2989cd1f78fc374f433352fd6532a506fb00108`

**Baseline identity:** PR #73 merge; Dashboard UX closeout complete

**Merged implementation baseline before P3-X:**
`656781ae197a4480f90e9be964cebeb37e8449d0` (PR #82 merge; P3-C0 complete)

**Date:** 2026-08-30

## 1. Purpose and authority

This document is the normative implementation plan for Phase 3. P3-0 fixed the
source, ownership, formula, identity, safety, persistence, presentation, and
PR-boundary contracts before runtime implementation began. P3-EF narrows the active
scope after the Evaluator candidate failed its manual quality gate.

Phase 3 adds three independently reviewable product outcomes:

1. deterministic comparison of two saved analyses;
2. a visual rendering of the seven existing peer percentiles;
3. a docs-only composite-score evaluation plan.

The merged P3-E1 evidence-manifest and sidecar repository remain as dormant internal
foundation. Phase 3 does not add an Evaluator runtime, CLI, API, Dashboard surface,
or executable quality gate. P3-E2 and P3-E3 are frozen after the candidate runtime
failed its locked-holdout campaign; no passed attestation exists.

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
  accessibility contracts;
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
values come only from validated persisted Snapshots. No Phase 3 path sends a stored
report or evidence manifest to an Evaluator provider.

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
- Do not fetch current data while comparing or drawing a saved Snapshot.
- Do not recover values from prompts, tool arguments, Dashboard text, or the report.
- Do not forward-fill, interpolate, infer aggregation, or convert missing data to
  zero.

### 3.2 History immutability

P3-I0 changes saved history to create-only:

- the first valid write for one ticker/snapshot ID creates the history file;
- the same ID plus the same canonical payload is an idempotent success;
- the same ID plus a different payload is a typed `snapshot_id_collision` failure;
- an existing history file is never replaced, repaired, or migrated in place;
- authoritative latest selection moves to validated immutable history as the explicit
  P3-I0 repository change described below;
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

`LatestSnapshotOrderV1` is the ascending numeric `generatedAtEpochMs`, computed as
`Date.parse(snapshot.generatedAt)` after schema validation. The authoritative latest
Snapshot is the history item with the maximum epoch milliseconds for the ticker.
Raw ISO-string or locale ordering is prohibited. P3-I0 changes `loadLatest`,
`listLatest`, and the existing descending `listHistory` ordering, plus the existing
latest-detail GET, Watchlist, and saved-Snapshot reload controller, to use the shared
numeric epoch comparator, never mutable-file last-writer completion or raw-string
order. P3-H2 later reuses the comparator/resolver for predecessor selection and
Comparison reload; P3-I0 introduces no Comparison path.

Resolution validates every candidate's schema, filename/body ID, canonical ticker,
and digest before ordering. It does not skip a corrupt/unsupported/mismatched history
file; any such item returns typed `latest_resolution_failed`. Zero history files
enters the legacy fallback below; if that file is also absent, return the existing
not-found outcome. P3-I0 adds the new repository
error kind to the existing exhaustive Dashboard mapping as sanitized HTTP 500
`snapshot_unavailable` for both latest-list and latest-detail GET; no path, corrupt
identity, or parser detail is exposed.

There is no V1–V9 tie-breaker. `createSnapshotId(generatedAt)` canonicalizes the same
validated epoch millisecond to the same ID/path. The same canonical payload is
idempotent, a different payload is `snapshot_id_collision`, and a history filename
that differs from the generated ID is corrupt. Different schema-valid timestamp
spellings that normalize to the same millisecond therefore cannot coexist as two
ordered history items. A future identity model may add a versioned tie rule; Phase 3
must not fabricate one.

P3-I0 stops writing `latest.json`. An existing `latest.json` is a legacy read fallback
only when the ticker has zero history files; validate it normally and never rewrite,
delete, migrate, or use it when any history file exists. Thus there is no mutable
cross-process latest pointer to regress, while legacy latest-only installations remain
readable without backfill. A successful history `created` or `existing_same` outcome
returns only after the authoritative resolver confirms the maximum identity; an old
idempotent retry never changes it.

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
  gateAttestationDigest: `sha256:${string}`;
  evaluatorSourceDigest: `sha256:${string}`;
  gateEvaluatedCommitSha: string;
  executionEnvironment: Readonly<{
    bunVersion: string;
    bunRevision: string;
    platform: string;
    arch: string;
    dependencyManifestDigest: `sha256:${string}`;
  }>;
  runtime: Readonly<{
    providerId: string;
    modelId: string;
    reasoningEffort: string | null;
    providerBoundary: Readonly<{
      baseUrl: 'https://api.openai.com/v1';
      organizationId: null;
      projectId: null;
      adapterMaxRetries: 0;
      sdkMaxRetries: 0;
    }>;
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
X_BEARER_TOKEN, LANGSMITH_API_KEY, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY,
AWS_SESSION_TOKEN,
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
UTF-8 bytes. P3-I0 also retains dormant pre-dispatch report/logical-input scanners,
but Phase 3 has no caller that may confirm or dispatch an Evaluator request. Any
future Evaluator plan must re-review those scanners before use.

Dormant Evaluator-facing `FilesystemPathPolicyV1` scans the report and every manifest
string value before JSON serialization. It is not an authorization to dispatch in
Phase 3. It splits with
``/[\s"'`<>()\[\]{}]+/u``, strips only trailing
`/[.,;:!?。、，；：！？]+$/u`, and applies these rules in order:

1. an empty token, the exact prose separator `/`, a relative path, and a plain
   ticker/ID are allowed;
2. a syntactically valid `http:` or `https:` URL is allowed; a `file:` URL is
   rejected;
3. the following exact origin-relative Snapshot endpoint literals are allowed and no
   general `/v2/` or `/api/` exception exists:

```text
/v2/equities/investor-types
/v2/equities/master
/v2/equities/bars/daily
/v2/fins/summary
/v2/fins/dividend
/v2/indices/bars/daily
/v2/markets/calendar
/v2/markets/short-ratio
```

4. otherwise, a token for which `path.win32.isAbsolute` or
   `path.posix.isAbsolute` is true is rejected.

The endpoint allowlist is code-owned and must equal the endpoint literals eligible
for the V1–V9 Evidence manifest; a new eligible endpoint changes
`SafetyPolicyV1`. The standard required headings `# Entry / Stop / Target` and
`# Bull / Base / Bear` therefore pass, as do the allowlisted endpoint values. Bare
`/` passes; `C:\Users\...`, UNC, `/home/user/...`, `/tmp/...`, other absolute
filesystem tokens, and `file:` URLs fail.

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
- history A at `t1`, history B at `t2`, then a delayed retry of A always resolves B
  from `loadLatest`, `listLatest`, the existing latest-detail GET, Watchlist, and
  saved-Snapshot reload; include reversed cross-process completion order;
- schema-valid `2026-08-23T01:02:03Z` and
  `2026-08-23T01:02:03.500Z` histories order by epoch milliseconds in latest detail,
  Watchlist, and existing history list, never by raw string;
- equal normalized epoch milliseconds produce one snapshot ID: equal canonical
  payload is idempotent, different payload collides, and a different filename ID is
  rejected as corrupt rather than tie-sorted;
- `latest_resolution_failed` maps through latest-list and latest-detail GET to the
  existing sanitized 500 response, while the inherited Dashboard reload state
  machine preserves its current successful Snapshot/UI state;
- history presence prevents every read and write of legacy `latest.json`; a
  latest-only legacy ticker remains readable only while it has zero history files,
  and no P3-I0 path rewrites, deletes, or migrates that file;
- literal canonical golden vectors, source-key reordering, Unicode preservation,
  negative zero, explicit null, `undefined`, non-finite number, and complete lowercase
  digest length;
- every allowlisted environment name using dummy values, below-eight-unit behavior,
  every marker regex, every rejected/allowed control boundary, UTF-16 and UTF-8 size
  boundaries including surrogate pairs, and fixed failure messages with no matched
  content;
- exact equality between the Safety credential allowlist and all credential-bearing
  names discovered from `env.example`, provider/search registries, finance/source
  clients, Agent SDK auth guards, and gateway integrations; adding an unclassified
  `*_API_KEY`, `*_TOKEN`, `*_SECRET`, `*_ACCESS_KEY_ID`, or
  `*_SECRET_ACCESS_KEY` fails the test, and `LANGSMITH_API_KEY` is an explicit
  regression fixture;
- required output headings with bare `/`, every allowlisted Snapshot endpoint,
  `http:`/`https:`, relative paths, and punctuation boundaries pass; Windows
  drive/UNC, `/home/user`, `/tmp`, another POSIX absolute path, and `file:` reject;
  no Phase 3 provider dispatch exists, and any future integration must fail before
  dispatch; and
- V9 remains the only writer, V1–V9 remain readable, and no old history file is
  rewritten or backfilled.

### 3.5 Ownership and operation surface

| Result | Owner | Persisted in Snapshot | Creation surface |
| --- | --- | --- | --- |
| History comparison | pure deterministic Comparison module | no | read-only GET/controller |
| Peer Radar | Dashboard presentation of stored values | no | presentation only |
| Evaluator foundation | versioned evidence/sidecar contracts | no | P3-E1 repository only; no producer or consumer |
| Composite score | not adopted | no | prohibited until Phase 4 decision |
| PDF/export artifact | deferred | no | no Phase 3 surface |

Dashboard routes remain GET-only. The Browser has no evaluation route or tab, does
not incur provider cost, mutate a Snapshot, or write an artifact.

### 3.6 Shared value semantics

```ts
type ComparisonValueStateV1 =
  | 'available'
  | 'unavailable'
  | 'not_collected'
  | 'ambiguous'
  | 'absent';
```

- `available` includes valid numeric zero.
- `unavailable` preserves an applicable stored reason; when an exact
  schema-supported nullable metric has no persisted field-level reason, Comparison
  and Evidence use only the code-owned `missing_metric_value` synthetic reason.
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
- satisfy `baseGeneratedAtEpochMs < targetGeneratedAtEpochMs`, where both numeric
  values are computed by the shared P3-I0 `LatestSnapshotOrderV1` parser/comparator
  after Snapshot schema validation.

Raw timestamp/locale comparison is prohibited at the pure P3-H1 request boundary as
well as in repository/history selection. Equal or reversed epoch order is invalid;
do not swap. Do not substitute latest. There is no caller-supplied historical cutoff:

```text
comparisonAsOf = target.generatedAt
delta = targetValue - baseValue
```

`comparisonAsOf` preserves the target Snapshot's validated stored timestamp for
display/audit; it is not the comparison operand.

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

type ComparisonObservationContextV1 = Readonly<{
  dataDates: readonly NamedDataDateV1[];
  provenance: readonly ComparisonProvenanceV1[];
  identity: ComparisonInstanceIdentityV1;
}>;

type ComparisonUnavailableReasonV1 = Readonly<{
  reason: string;
  detail: string | null;
}>;

type NonEmptyComparisonUnavailableReasonsV1 = readonly [
  ComparisonUnavailableReasonV1,
  ...ComparisonUnavailableReasonV1[],
];

type ComparisonObservationV1 =
  | Readonly<ComparisonObservationContextV1 & {
      state: 'available';
      value: number | string;
      actualUnit: string | null;
      unavailableReasons: readonly [];
    }>
  | Readonly<ComparisonObservationContextV1 & {
      state: 'unavailable';
      value: null;
      actualUnit: string | null;
      unavailableReasons: NonEmptyComparisonUnavailableReasonsV1;
    }>
  | Readonly<ComparisonObservationContextV1 & {
      state: 'not_collected';
      value: null;
      actualUnit: null;
      unavailableReasons: NonEmptyComparisonUnavailableReasonsV1;
    }>
  | Readonly<{
      state: 'ambiguous';
      value: null;
      actualUnit: null;
      dataDates: readonly [];
      provenance: readonly [];
      identity: ComparisonInstanceIdentityV1;
      unavailableReasons: readonly [Readonly<{
        reason: 'duplicate_instance_identity';
        detail: null;
      }>];
      candidateCount: number;
    }>
  | Readonly<{
      state: 'absent';
      value: null;
      actualUnit: null;
      dataDates: readonly [];
      provenance: readonly [];
      identity: ComparisonInstanceIdentityV1;
      unavailableReasons: readonly [];
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
        | 'missing_data_date'
        | 'invalid_data_date'
        | 'data_date_regressed'
        | 'identity_changed';
    }>
  | Readonly<{
      state: 'incomparable';
      mode: 'incomparable';
      delta: null;
      reason: 'identity_ambiguous';
      affectedSides:
        | readonly ['base']
        | readonly ['target']
        | readonly ['base', 'target'];
      candidateCounts: Readonly<{
        base: number | null;
        target: number | null;
      }>;
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
      reason: 'record_added';
      affectedSides: readonly ['base'];
      presentSide: 'target';
    }>
  | Readonly<{
      state: 'not_applicable';
      mode: 'not_applicable';
      delta: null;
      reason: 'record_removed';
      affectedSides: readonly ['target'];
      presentSide: 'base';
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
      unavailableReasons: NonEmptyComparisonUnavailableReasonsV1;
    }>
  | Readonly<{
      state: 'not_collected';
      unavailableReasons: NonEmptyComparisonUnavailableReasonsV1;
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
section. Preserve each side's section reasons separately.

Observation invariants are schema-enforced, not runtime convention:

- `available` has a finite number or valid non-empty category string; numeric zero is
  valid, `value` is never null, and reasons are empty;
- `unavailable` has null value and at least one preserved/allowlisted reason; its
  actual stored unit may remain present;
- `not_collected` has null value, null actual unit, and at least one stored or
  synthetic reason;
- `ambiguous` is valid only for a schema-supported dynamic identity with two or more
  matching records. It selects no record/value/unit/date/provenance, preserves the
  union identity, has exact integer `candidateCount >= 2`, and has only the fixed
  `duplicate_instance_identity` reason;
- `absent` is only a missing side of a schema-supported dynamic identity and has null
  value/unit, empty dates/provenance/reasons, and the union identity; and
- `available + null`, non-finite available number, `not_collected + value`,
  `ambiguous + candidateCount < 2`, ambiguous residual record context,
  `absent + value`, and empty required reason tuples are invalid results.

For a schema-supported metric whose section/record exists, observation extraction
uses this exact value/reason precedence:

1. a non-null schema-valid value with no matching stored metric-unavailable entry is
   `available`;
2. a null value with one or more exact registry-mapped stored metric reasons is
   `unavailable` and preserves those reasons/details in registry-defined order;
3. a null value with no applicable stored metric reason is `unavailable` with the
   sole code-owned synthetic reason `{ reason: 'missing_metric_value', detail: null }`;
4. a non-null value paired with a matching stored metric-unavailable entry is a
   semantic contradiction and fails the request as sanitized `corrupt_snapshot`.

`missing_metric_value` is not inferred from prose and does not mean zero,
not-collected, or an absent dynamic record. It is the shared Comparison/Evidence V1
fallback only for an exact schema-supported nullable field that has no persisted
field-level reason. Section state/version and dynamic-identity precedence still run
before this value rule.

Disposition uses this exact precedence:

1. either side `ambiguous` → `identity_ambiguous`, with ambiguous sides in
   base/target order and their exact candidate counts; a non-ambiguous side has null
   candidate count, and no candidate value is selected even if the other side is
   available or absent;
2. base `absent` and target `available` → `record_added`, affected base, present
   target;
3. base `available` and target `absent` → `record_removed`, affected target, present
   base;
4. either side `unavailable` or `not_collected`, including its pairing with
   `absent` → `non_available_state` with exact `sideStates` and all non-available
   `affectedSides` in base/target order;
5. both sides `available` → registry comparison; and
6. both sides `absent` is an impossible union-generation result and fails as an
   internal contract error rather than returning a row.

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
  comparisonDateRoles: readonly NamedDataDateV1['role'][];
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
`absent`; more than one produces the typed `ambiguous` side observation and the
row-level `identity_ambiguous` disposition with exact candidate count. Never match by
array index or copy any candidate value into an ambiguous observation.
`resistance_level` candidates are excluded because Snapshot V1–V9 persist no stable
resistance-source identity and can legitimately contain multiple targets with the
same reason tuple. Risk, reward, and tick-size fields are registry-excluded.

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
source-eligible dates remain named context. Duplicate fiscal/event identities use the
same typed `ambiguous` observation and never select the first record. V1–V7 are
`not_collected`.

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

For every both-available row, comparability is evaluated in this exact order:

1. both values must satisfy the registry value kind;
2. numeric actual units must both exist and equal the registry expected unit;
3. registry identity checks run in the applicable order `period`, `benchmark`,
   `method`, `window`, then remaining identity;
4. every `comparisonDateRoles` entry is checked in its declared order; and
5. only then is numeric `absolute_delta` or category `from_to` emitted.

Each observation contains at most one `NamedDataDateV1` per role. A checked role that
is absent or null on either side returns `missing_data_date`. A non-null checked value
must pass `CanonicalCalendarDateV1`:

```text
YYYY-MM-DD
year 0001..9999
month 01..12
day valid for that Gregorian month
leap year = divisible by 4, except centuries not divisible by 400
```

Validation extracts numeric `(year, month, day)` components and compares those tuples
lexicographically. `Date.parse`, implementation-defined normalization, locale
comparison, and raw string comparison are prohibited. A malformed/non-canonical or
duplicate checked role returns `invalid_data_date`; a valid target tuple earlier than
the base tuple returns `data_date_regressed`. These are row-level incomparable states,
not Snapshot corruption, because the inherited V1–V9 schema deliberately accepts
non-empty legacy date strings. Raw values remain in `dataDates` for display/audit.

The initial registry fixes `comparisonDateRoles` as follows:

- Valuation: `currentPrice` uses `price`; PER/PBR/dividend yield use `price` then
  `financial`; revenue CAGR uses `financial`.
- Fundamental rows use `submit`.
- Technical and Advanced Technical rows use `section`.
- Supply/Demand rows use `section`, except `averageDailyVolume20` uses `volume` and
  `digestionDays` uses `section` then `volume`.
- Market Correlation rows use `section`, `window_start`, then `window_end`.
- Sector Benchmark rows use `analysis_as_of`, `section`, `window_start`, then
  `window_end`.
- Strategy rows use `section`.
- Advanced Dividend fiscal rows use `source_eligible` then `disclosed`; event rows
  use `source_eligible` then `notified`. Record/rights-record/ex/payment dates remain
  display-only context and do not gate comparability.
- Volume Profile rows use `section`, `window_start`, then `window_end`.

Changing this role map or the canonical-date/comparison policy increments
`registryVersion`. The Browser only displays the resulting dates/reason and never
parses or compares dates.

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
- History is ordered by numeric `generatedAtEpochMs asc` after every item has passed
  repository validation. Raw stored timestamp strings are never sorted. An immediate
  predecessor is the item immediately before the target in that order. Equal epoch
  milliseconds map to the same inherited snapshot ID and cannot form two validated
  history items.
- With no strictly ordered pair—including zero or one item—the start action is
  disabled and the UI says
  `比較には生成時刻の異なる保存済み分析が2件以上必要です`. It does not write
  a one-sided URL or start a Comparison request.
- The oldest item may be selected as base but is disabled as a target because it has
  no predecessor. Attempting to adopt it as target preserves the current URL, pair,
  rows, focus, and History entry and announces the same strictly ordered-pair
  requirement.
- Starting Comparison first resolves and validates the current displayed target and
  its predecessor in memory, then calls `pushState` once with both IDs. Resolution
  failure preserves the current detail URL and shows a scoped error.
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
- Reset uses one `pushState` to remove both IDs, preserves ticker plus `tab=report`,
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
ticker + baseSnapshotId + targetSnapshotId + resultVersion + registryVersion
```

The selected row filter and open `日付・比較条件` disclosures survive tab changes,
Back/Forward, and a reload of that unchanged identity. They reset to the default
filter and closed disclosures when ticker, either Snapshot ID, result version, or
registry version changes. Never carry an open disclosure from one comparison
identity/version into another.
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
- no-fraction base plus fractional target is accepted by epoch order, while the
  reverse pair is `invalid_order`; raw string comparison is a regression failure;
- available zero, required-null `missing_required_section`, supported optional-null
  stored `not_collected`, unavailable, absent, mixed asymmetric side states with
  reason/detail preservation, and identity ambiguity;
- nullable Fundamental values, `valuation.currentPrice`, and nullable fiscal/event
  dividend facts use an exact stored metric reason when present and otherwise the
  sole `missing_metric_value` synthetic reason; numeric zero remains available, and
  non-null value plus a matching unavailable record is corrupt;
- every checked date role accepts only a valid canonical Gregorian `YYYY-MM-DD`,
  compares numeric year/month/day tuples, and deterministically distinguishes
  `missing_data_date`, `invalid_data_date`, and `data_date_regressed` across V1–V9;
  non-canonical month/day width, impossible leap/day values, raw lexical order, and
  permissive `Date.parse` normalization are regression failures;
- `absent → available` reaches `record_added`, `available → absent` reaches
  `record_removed`, and absent paired with unavailable/not-collected follows the
  declared non-available precedence;
- reject every invalid observation combination, including available-null,
  available-with-reasons, unavailable-with-value/empty-reasons,
  not-collected-with-value/unit/empty-reasons, and absent with residual
  value/unit/date/provenance/reason context;
- section-level unavailable/not-collected states require the named non-empty reason
  tuple at type and runtime-schema boundaries; an empty tuple is unrepresentable;
- exact raw delta, metric-specific native/percent/fraction/category display metadata,
  presentation conversion, and negative-zero handling;
- fixed dynamic instance order, one-side and both-side duplicate Strategy/Dividend
  identities producing exact typed ambiguous observations/dispositions/counts,
  resistance-candidate exclusion, and no array-index/value selection;
- no recursive diff, collection aggregation, source fetch, score, or signal.

P3-H2 tests:

- 200/400/404/405/500 and safe route/query validation;
- latest/no-comparison, start/reset, target/base changes, zero/one history,
  chronological fractional-second predecessor selection consistent with the shared
  resolver, oldest-target rejection, and no transient/invalid History entry;
- deep link, reload, Back/Forward, ticker/list/tab transitions, and pair-keyed
  filter/disclosure restoration and reset, including reset on a `resultVersion`-only
  state-key change;
- starting/resetting Comparison from an Evaluation-pinned historical Snapshot
  preserves the matching selectors and exact target; target adoption/change clears
  them, and Back/Forward/reload never creates a mismatched tuple;
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
- `selection.peers` has unique IDs, excludes the target, contains only the target's
  stored sector, and has count within the inherited 5–10 peer bounds;
- `selection.tooFewPeers` exactly equals
  `selection.peers.length < PEER_COMPARISON_DEFAULTS.minimumPeers` and is false for
  a rendered polygon;
- stored `targetValue` is finite and exactly equals the corresponding finite stored
  target metric; stored `median` is finite;
- no matching entry exists in the stored top-level `unavailable` array;
- stored `peerSampleSize` is an integer from 1 through `selection.peers.length`;
- `cohortSize = peerSampleSize + 1`; and
- finite rank in inclusive range 1–cohortSize. Fractional average ranks from ties are
  valid and must not be rejected as non-integer.

The 5–10 threshold applies only to company selection and `tooFewPeers`; it is not a
per-metric sample threshold. An engine-valid stored position whose `peerSampleSize`
is greater than zero remains available even when only 1–4 selected peers have an
eligible value for that metric. Preserve and display that exact sparse sample size
and the existing market-cap limitation; do not relabel the position or suppress the
polygon solely for being below five.

These are structural checks over stored Peer outputs, not a recalculation of median,
rank, percentile, eligibility, or score. P3-R1 must not import/call
`isAvailableMetricValue`, iterate selected peer metric values to reconstruct sample
size, or otherwise replay Engine eligibility in the Browser. Zero eligible peers
remain represented only by the stored `insufficient_peer_data` unavailable entry and
its stored null position fields. If replay validation is ever required, it belongs in
a separately reviewed versioned deterministic analysis/Snapshot boundary, not a
retroactive V1–V9 presentation rule.

If any axis is missing or invalid, suppress the entire polygon and preserve the
exact table with an explicit invalid/unavailable state. Do not clamp, re-rank,
impute, or draw a partial polygon.

`marketCapPriorityApplied === false` does not by itself suppress an otherwise valid
polygon, but its stored reason/limitation is displayed next to both chart and table.

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

Tests cover boundary 0/1, out-of-range, missing, direction mismatch, selected-peer
count/duplicate/target/sector mismatch, null/mismatched target value, null median,
matching unavailable entry, inconsistent top-level `tooFewPeers`, invalid sample/
cohort relation, valid fractional and invalid out-of-range rank, market-cap-priority
limitation display, polygon suppression, exact table equivalence, screen-reader
naming, and 320/768/1280px layout. With five valid selected same-sector peers and
`tooFewPeers: false`, stored positions with `peerSampleSize` 1 or 4 remain available
and render; the same sparse fixture behaves identically in every V1–V9 envelope.
Another fixture proves zero samples retain the stored `insufficient_peer_data` state.
A module-boundary test permits shared constants/types but prohibits a Dashboard
runtime dependency on any Peer Engine eligibility predicate. Paired browser fixtures
that differ only in selected peers' raw metric values but have identical stored
positions/unavailable state must render identically, proving chart visibility and
sample-size display do not replay eligibility.

## 6. P3-E — Dormant Evaluator foundation

### 6.1 Frozen scope

P3-E1 implemented only deterministic evidence-manifest, finding, digest, and
create-only sidecar repository contracts. That merged foundation remains internal
and has no Phase 3 producer or consumer.

P3-E2 and P3-E3 are deferred. Phase 3 has no `evaluate:snapshot` CLI, provider
dispatch, qualification attestation, evaluation GET API, URL selector, or
`evaluation / AIレビュー` tab. No pending manifest or failed campaign authorizes
runtime use, and no unavailable sidecar may be fabricated to represent an Evaluator
that did not run.

The contracts below through Section 6.4 document the retained P3-E1 storage
foundation. Section 6.5 records why runtime and presentation are deferred; the
rejected candidate implementation remains available only in closed-PR history.

### 6.2 Evidence manifest

The dormant provider-neutral foundation defines a possible future input consisting
of:

- an instruction-isolated exact stored report;
- a deterministic, versioned evidence manifest; and
- a strict output schema.

No Phase 3 runtime sends this input, uses tools, or fetches data.

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
  | 'price_history_series'
  | 'volume_profile_bins'
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
  | 'excluded_from_manifest'
  | 'outside_snapshot_scope';

type EvidenceScopeStateV1 =
  | 'available'
  | 'unavailable'
  | 'not_collected'
  | 'persisted_but_excluded'
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
uncollected. `excluded_from_manifest` means the Snapshot persists the domain but the
Evaluator input contract intentionally sends none of its records. It is distinct
from unavailable data and from data outside Snapshot scope.
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
| `price_history_series` | `price_history_series` | no items; a stored schema-valid non-empty array is `persisted_but_excluded/excluded_from_manifest/raw_series_excluded`; null/unavailable follows stored-scope precedence |
| `volume_profile_bins` | `volume_profile_bins` | no items; V1–V8 are `not_collected/partial/schema_predates_scope`; a V9 stored schema-valid non-empty bins array is `persisted_but_excluded/excluded_from_manifest/volume_profile_bins_excluded`; null/unavailable follows stored-scope precedence |
| `outside_filing_narrative` | `outside_filing_narrative` | no items; filing prose/tool output is not persisted |
| `outside_company_management_history` | `outside_company_management_history` | no items; management/company-history facts are not persisted |
| `outside_competitors_industry` | `outside_competitors_industry` | no items; competitor/industry narrative is not persisted |
| `outside_macro_market_news` | `outside_macro_market_news` | no items; macro, market-news and current-event facts are not persisted |
| `outside_undeclared_financial_metric` | `outside_undeclared_financial_metric` | no items; any metric/ratio absent from the Evidence registry, such as EV/EBITDA |
| `outside_source_totality` | `outside_source_totality` | no items; claims such as “all filings/disclosures/periods” cannot be proven by persisted rows |
| `outside_other_context` | `outside_other_context` | no items; catch-all for a claim outside every closed persisted domain |

Every mention of provenance in this table means the URL-free
`EvidenceProvenanceV1` projection. Identity/section `sourceUrls` and provenance-record
`sourceUrls` are excluded even when non-empty in the validated Snapshot.

Stored-scope state uses the same precedence as Comparison: schema predates scope →
`not_collected/partial/schema_predates_scope`; supported null plus matching stored
top-level `reason === 'not_collected'` →
`not_collected/partial/stored_not_collected`; any other supported null →
`unavailable/partial/snapshot_section_unavailable`; object present → available and
`complete_for_domain` after all eligible items fit the limits. Object-present plus a
matching top-level `not_collected` entry is corrupt input. Field-level null alone
never changes the scope to not-collected. Raw free-form top-level reason/detail is not
sent; only the allowlisted scope reason and schema-enumerated item state/reason are.

The two intentionally omitted persisted collections have exact additional state
rules. A schema-valid non-empty stored `priceHistory` array produces
`price_history_series/persisted_but_excluded/excluded_from_manifest/raw_series_excluded`.
A V9 schema-valid non-empty stored Volume Profile `bins` array produces
`volume_profile_bins/persisted_but_excluded/excluded_from_manifest/volume_profile_bins_excluded`.
The Evaluator receives no items from either scope. Their unavailable/null cases use
the normal stored-scope precedence; a schema that predates bins is `not_collected`,
not `persisted_but_excluded`.

The four collections that have no persisted source-completeness field—reported short
positions, investor flow, sector benchmark, and sector short ratio—are complete only
for their explicitly named *persisted-content* domains. The Evaluator must not infer
or say that their upstream source, all dates, or all disclosures are complete. A
claim of source totality always maps to `outside_source_totality`.

Every eligible fact is declared in a typed code-owned Evidence Definition registry.
The registry fixes both fact projection and item granularity; P3-E1 may not decide to
emit one scalar per collection field. Fixed scalar metrics use one item per metric.
A dynamic fiscal period, public-short row, investor-flow period, correlation/window,
sector-short observation, dividend observation/event, or Strategy candidate uses one
item per semantic record and carries every allowlisted scalar/category in a non-empty
ordered `facts` tuple. Thus one public-short row remains one persisted Evidence item,
not four or more duplicated scalar items, while a finding can identify an exact fact
inside that item by `{ itemId, factKey }` and every value/unit remains exact.

Each definition has a stable definition key, introduced Snapshot version,
per-instance introduction version, exact accessor, scope, item granularity,
fact-key/value/unit/date projection, identity/method projection, and coverage rule.
Do not reflectively traverse the Snapshot. A fact key is stable within its definition
and never contains dynamic identity. The public item shape is:

```ts
type EvidenceFactUnavailableReasonV1 = Readonly<{
  reason: string;
  detail: string | null;
}>;

type NonEmptyEvidenceFactUnavailableReasonsV1 = readonly [
  EvidenceFactUnavailableReasonV1,
  ...EvidenceFactUnavailableReasonV1[],
];

type EvidenceFactContextV1 = Readonly<{
  factKey: string;
  dataDates: readonly NamedDataDateV1[];
}>;

type EvidenceFactV1 =
  | Readonly<EvidenceFactContextV1 & {
      state: 'available';
      value: number | string | boolean;
      unit: string | null;
      unavailableReasons: readonly [];
    }>
  | Readonly<EvidenceFactContextV1 & {
      state: 'unavailable';
      value: null;
      unit: string | null;
      unavailableReasons: NonEmptyEvidenceFactUnavailableReasonsV1;
    }>
  | Readonly<EvidenceFactContextV1 & {
      state: 'not_collected';
      value: null;
      unit: null;
      unavailableReasons: NonEmptyEvidenceFactUnavailableReasonsV1;
    }>;

type EvidenceProvenanceV1 = Readonly<{
  source: string;
  role: string;
  asOfDate: string | null;
  qualifiers: readonly Readonly<{
    name: 'endpoint' | 'section';
    value: string | null;
  }>[];
}>;

type EvidenceItemV1 = Readonly<{
  itemId: string;
  scopeId: string;
  definitionKey: string;
  instanceIdentity: ComparisonInstanceIdentityV1;
  facts: readonly [EvidenceFactV1, ...EvidenceFactV1[]];
  provenance: readonly EvidenceProvenanceV1[];
  method: string | null;
  limitation: string | null;
}>;
```

Fact state/value/unit/reason combinations use the same available/non-available
invariants as Comparison; false and numeric zero are valid available values. Every
registry definition enumerates the only accepted stored/synthetic reason values and
their source mapping. `schema_predates_instance` is the fixed synthetic reason for a
later fixed instance. `missing_metric_value` is the fixed synthetic reason for a
schema-supported nullable fact whose item exists but has no exact persisted
field-level reason, using the same precedence as Comparison. Unknown/free-form
reasons fail manifest generation. A record item may contain available, unavailable,
and not-collected facts simultaneously without relabelling the whole scope
unavailable.

Evidence provenance is projected into the dedicated URL-free shape above. Snapshot
`sourceUrls` are never copied, hashed into the manifest, persisted in a sidecar, or
sent to the provider; `ComparisonProvenanceV1` is not assignable at this boundary.
`endpoint` qualifiers remain only the exact registry-allowlisted relative API paths,
never an `http:`/`https:` URL or caller-supplied string. Any unexpected provenance
source, role, qualifier, or non-relative endpoint fails manifest generation rather
than passing through raw metadata.
Facts are ordered by the code-owned definition and there are at most 64 facts per
item. Dynamic item IDs hash this exact single object:

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
- scope ID and stable `definitionKey`; `definitionKey` is the sole code-owned
  traceability pointer in V1, and there is no separate `schemaPointer` or JSON Pointer
  field;
- a non-empty ordered tuple of exact keyed values/states/units;
- an empty or non-empty exact allowlisted reason tuple according to each fact state;
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
`unsupported_claim` is allowed only when every finding domain maps to a
`complete_for_domain` persisted scope and no matching allowlisted item exists.
Every outside, unavailable, or not-collected domain is
`not_verifiable_from_snapshot` or an applicable `missing_caveat`, never unsupported
solely because the Snapshot lacks evidence. A `persisted_but_excluded` domain is
`not_verifiable_by_evaluator` or an applicable `missing_caveat`; it must not be
described as missing from the Snapshot. Phase 3 adds no source field, V10, or backfill
to close these gaps.

Limits:

- at most 6 fundamental periods;
- at most 100 public-short records;
- at most 100 sector-short observations;
- at most 20 dividend fiscal observations;
- at most 50 dividend events;
- at most 16 Strategy candidates;
- at most 32 scopes and 343 items;
- at most 2,000 characters per string;
- at most 150,000 manifest characters;
- at most 200,000 total Evaluator logical-input characters.

Do not truncate. A limit violation fails before provider dispatch. A contractually
omitted collection is represented by scope coverage, not fabricated evidence.

The 343-item cap is proven against this exact V1 item budget; it is not an arbitrary
post-generation guard:

| Scope | Item granularity | Maximum items |
| --- | --- | ---: |
| Snapshot identity | one identity record | 1 |
| Valuation | one item per fixed metric | 5 |
| Fundamental | one item per fiscal record | 6 |
| Peer positions | seven metrics plus selection/cohort | 8 |
| Technical | one item per fixed metric | 6 |
| Advanced Technical | one item per fixed metric | 7 |
| Supply/Demand | one item per fixed metric | 12 |
| Market Correlation | one item per 20/60/250 window | 3 |
| Reported short positions | one item per persisted row | 100 |
| Investor type flows | one complete Tokyo/Nagoya period item | 1 |
| Sector benchmark | identity/method plus three windows | 4 |
| Sector short ratio | identity/method plus at most 100 observations | 101 |
| Advanced Dividend | identity/method plus 20 fiscal and 50 event records | 71 |
| Volume Profile summary | one summary/method item | 1 |
| Strategy | entry/method plus at most 16 candidate items | 17 |
| Persisted-but-excluded and outside scopes | no items | 0 |
| **V1 maximum** |  | **343** |

An over-limit persisted collection fails the entire Evaluator preflight; it is never
truncated and its scope is never mislabeled complete. Adding a scope, item kind, fact,
or higher collection maximum requires an `evidenceManifestVersion` increment and a
reviewed recomputation that stays within both the 343-item and character limits.

### 6.3 Finding schema

```ts
type ReportAnchorV1 = Readonly<{
  start: number;   // UTF-16 code-unit offset, inclusive
  end: number;     // exclusive
  excerpt: string; // exact report.slice(start, end)
}>;

type SingleReportAnchorLocationV1 = Readonly<{
  kind: 'single_anchor';
  anchor: ReportAnchorV1;
}>;

type ReportAnchorSetLocationV1 = Readonly<{
  kind: 'report_anchor_set';
  anchors: readonly [ReportAnchorV1, ReportAnchorV1, ...ReportAnchorV1[]];
}>;

type EvidenceFactRefV1 = Readonly<{
  itemId: string;
  factKey: string;
}>;

type AvailableFactRefsBasisV1 = Readonly<{
  kind: 'available_fact_refs';
  refs: readonly [EvidenceFactRefV1, ...EvidenceFactRefV1[]];
}>;

type NonAvailableFactRefsBasisV1 = Readonly<{
  kind: 'non_available_fact_refs';
  refs: readonly [EvidenceFactRefV1, ...EvidenceFactRefV1[]];
}>;

type ReportContradictionBasisV1 = Readonly<{
  kind: 'report_contradiction';
}>;

type ManifestAbsenceBasisV1 = Readonly<{
  kind: 'manifest_absence';
  scopeRefs: readonly string[];
  reason:
    | 'no_matching_allowlisted_evidence'
    | 'relevant_evidence_unavailable'
    | 'persisted_evidence_not_sent'
    | 'outside_snapshot_scope';
}>;

type EvidenceClaimDomainsV1 = readonly [
  EvidenceClaimDomainV1,
  ...EvidenceClaimDomainV1[],
];

type EvaluationFindingV1 =
  | Readonly<{
      findingId: string;
      category: 'unsupported_claim';
      claimDomains: EvidenceClaimDomainsV1;
      importance: 'material' | 'advisory';
      summary: string;
      location: SingleReportAnchorLocationV1;
      basis: ManifestAbsenceBasisV1 & Readonly<{
        reason: 'no_matching_allowlisted_evidence';
      }>;
    }>
  | Readonly<{
      findingId: string;
      category: 'not_verifiable_from_snapshot';
      claimDomains: EvidenceClaimDomainsV1;
      importance: 'advisory';
      summary: string;
      location: SingleReportAnchorLocationV1;
      basis:
        | NonAvailableFactRefsBasisV1
        | (ManifestAbsenceBasisV1 & Readonly<{
            reason: 'relevant_evidence_unavailable' | 'outside_snapshot_scope';
          }>);
    }>
  | Readonly<{
      findingId: string;
      category: 'not_verifiable_by_evaluator';
      claimDomains: EvidenceClaimDomainsV1;
      importance: 'advisory';
      summary: string;
      location: SingleReportAnchorLocationV1;
      basis: ManifestAbsenceBasisV1 & Readonly<{
        reason: 'persisted_evidence_not_sent';
      }>;
    }>
  | Readonly<{
      findingId: string;
      category: 'internal_inconsistency';
      claimDomains: EvidenceClaimDomainsV1;
      importance: 'material' | 'advisory';
      summary: string;
      location: SingleReportAnchorLocationV1;
      basis: AvailableFactRefsBasisV1;
    }>
  | Readonly<{
      findingId: string;
      category: 'internal_inconsistency';
      claimDomains: EvidenceClaimDomainsV1;
      importance: 'material' | 'advisory';
      summary: string;
      location: ReportAnchorSetLocationV1;
      basis: ReportContradictionBasisV1;
    }>
  | Readonly<{
      findingId: string;
      category: 'unclear_reasoning';
      claimDomains: EvidenceClaimDomainsV1;
      importance: 'material' | 'advisory';
      summary: string;
      location: SingleReportAnchorLocationV1;
      basis: AvailableFactRefsBasisV1;
    }>
  | Readonly<{
      findingId: string;
      category: 'missing_caveat';
      claimDomains: EvidenceClaimDomainsV1;
      importance: 'material' | 'advisory';
      summary: string;
      location: SingleReportAnchorLocationV1;
      basis:
        | AvailableFactRefsBasisV1
        | NonAvailableFactRefsBasisV1
        | ManifestAbsenceBasisV1;
    }>;
```

Categories:

- `unsupported_claim` requires `manifest_absence` with reason
  `no_matching_allowlisted_evidence`; every referenced scope is
  `available/complete_for_domain`, every finding domain is represented by at least
  one referenced scope, and no unavailable, not-collected, excluded, or outside
  scope participates;
- `not_verifiable_from_snapshot` uses `non_available_fact_refs` when the exact
  allowlisted fact exists inside an otherwise available scope but its state is
  `unavailable` or `not_collected`; otherwise it requires `manifest_absence` with
  reason `relevant_evidence_unavailable` for only unavailable/not-collected scopes or
  `outside_snapshot_scope` for only outside scopes. Importance is always `advisory`;
- `not_verifiable_by_evaluator` requires `manifest_absence` with reason
  `persisted_evidence_not_sent`, only
  `persisted_but_excluded/excluded_from_manifest` scopes, and advisory importance;
- `internal_inconsistency` with `available_fact_refs` means one report claim
  contradicts available Snapshot evidence and requires one anchor plus exact fact
  refs covering every domain; with `report_contradiction` it means two to four report
  spans are mutually
  inconsistent, requires no Snapshot evidence, and is valid for persisted,
  unavailable, excluded, or outside domains;
- `unclear_reasoning` is deliberately evidence-grounded in V1: it requires one
  report anchor and available fact refs covering every domain. Purely rhetorical
  or prose-only lack of clarity without eligible Snapshot evidence is outside this
  category and produces no fabricated ref;
- `missing_caveat` accepts available fact refs, non-available fact refs, or manifest
  absence. Available refs must resolve only to `available` facts; non-available refs
  must resolve only to `unavailable`/`not_collected` facts; either fact-ref set must
  cover every domain. A manifest-absence basis uses the same exact
  reason/state/coverage compatibility defined above for its reason.

`not_verifiable_from_snapshot` says only that the persisted artifact cannot verify
the claim; it is not an assertion that the claim is false or unsupported. A correctly
source-caveated outside-scope claim produces no finding merely for being outside the
Snapshot. A central conclusion that relies on unavailable/outside-scope evidence
without an appropriate limitation may instead produce `missing_caveat`.
`not_verifiable_by_evaluator` says that the target Snapshot contains the relevant
collection but the versioned Evaluator input intentionally omitted it; it neither
asserts that the claim is false nor that the Snapshot lacks the evidence. If one
single anchor contains domains requiring different absence reasons, emit separate
findings
rather than selecting one misleading reason.

Every finding has `material | advisory` importance, a plain-text summary, one typed
location, and one typed basis. All categories except report-to-report internal
inconsistency use `single_anchor`.

Validation:

- maximum 20 findings;
- summary 1–1,000 trimmed characters;
- each excerpt is 1–500 UTF-16 code units;
- each anchor satisfies `0 <= start < end <= report.length`, has no boundary inside
  a surrogate pair, and exactly equals `report.slice(start, end)`;
- `report_anchor_set` has 2–4 unique, non-overlapping anchors ordered by
  `(start, end)`; duplicate, overlapping, out-of-order, or single-anchor sets reject
  the entire available artifact;
- 1–4 unique claim domains, ordered by the closed EvidenceClaimDomain registry;
- 1–16 unique valid available/non-available fact refs or 1–8 unique valid scope refs;
- no empty refs, sentinel IDs, free-form paths, unknown fields, score, pass, or
  recommendation;
- duplicate finding and finding-ID collision invalidate the available output.

Category/basis/coverage incompatibility invalidates the entire available output;
never coerce it into another category or fabricate a fact ref. Every fact ref must
resolve to exactly one stored manifest item and one definition-declared `factKey`.
`available_fact_refs` accepts only `available` facts;
`non_available_fact_refs` accepts only `unavailable` or `not_collected` facts and
preserves their exact allowlisted reasons in the manifest. For every fact or
manifest-absence basis, the set of domains reached through referenced fact items or
scopes must equal `claimDomains`: no domain may be omitted, and no referenced
item/scope may belong to another domain. Each fact-ref basis requires at least one
referenced fact for every domain. `manifest_absence` requires at least one referenced
  scope for each domain and the exact category-compatible state/coverage above. In
  particular, an unavailable, not-collected, excluded, or outside scope cannot satisfy
`unsupported_claim`, and an excluded scope cannot satisfy
`not_verifiable_from_snapshot`. More than four domains requires splitting at an
anchor into separately valid findings.
`report_contradiction` is the only basis exempt from Evidence/scope coverage because
the exact report spans are its complete basis; it is legal only for
`internal_inconsistency` with `report_anchor_set` and has no refs or scope refs.
For a dynamic persisted-content domain, lack of a row is unsupported only when the
claim is explicitly about what this exact Snapshot persisted. A claim about upstream
source totality maps to `outside_source_totality` even when the persisted-content
scope is complete.

The provider wire schema mirrors this category-sensitive union but omits
`findingId`. The model does not supply it. Before hashing, validate the complete
finding, deduplicate fact refs, order them by manifest item and definition fact order,
and order scope refs by the manifest scope registry. Hash this exact normalized
single object:

```ts
type EvaluationFindingIdEnvelopeV1 = Readonly<{
  kind: 'dexter_evaluation_finding_id';
  version: 1;
  category: EvaluationFindingV1['category'];
  claimDomains: EvidenceClaimDomainsV1;
  importance: 'material' | 'advisory';
  location: SingleReportAnchorLocationV1 | ReportAnchorSetLocationV1;
  basis:
    | AvailableFactRefsBasisV1
    | NonAvailableFactRefsBasisV1
    | ManifestAbsenceBasisV1
    | ReportContradictionBasisV1;
}>;

findingId = 'f_' + sha256Hex(CanonicalJsonV1(envelope)).slice(0, 24)
```

`sha256Hex` produces all 64 lowercase hex characters before truncation. Never hash
provider ref order or an unvalidated location/wire object. Fact refs are deduplicated
and ordered by manifest item order, then that definition's fact order; anchor sets
must first pass the canonical-order contract above. After IDs exist, normalize findings by
material before advisory, then first location-anchor start, category order, and
finding ID.

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
  = {"definitionKey":"marketCorrelation.window","instanceIdentity":[{"name":"benchmark","value":"TOPIX"},{"name":"period","value":20}],"kind":"dexter_evidence_item_id","manifestVersion":1,"scopeId":"market_correlation","version":1}
sha256Hex
  = 83b8164e241819769d1fe6fde8d7ebf80a2b06fa1bdf49fa616aa8de284eb907
itemId
  = e_83b8164e241819769d1fe6fd
```

```text
Normalized EvaluationFindingIdEnvelopeV1
  = {"basis":{"kind":"manifest_absence","reason":"no_matching_allowlisted_evidence","scopeRefs":["valuation"]},"category":"unsupported_claim","claimDomains":["valuation_metrics"],"importance":"material","kind":"dexter_evaluation_finding_id","location":{"anchor":{"end":2,"excerpt":"根拠","start":0},"kind":"single_anchor"},"version":1}
sha256Hex
  = 462879a85341fa9c9caf9503fab4e1629e74bdeff3356a77be21a5c6e1b540f1
findingId
  = f_462879a85341fa9c9caf9503
```

```text
ArtifactInputEnvelopeV1 with zero snapshot digest; one manifest digest; two gate
manifest digest; three gate-attestation digest; four evaluator-source digest; five
dependency-manifest digest; Bun 1.3.14 revision 1.3.14+0d9b296af on win32/x64; 40
lowercase `a` gate commit; qualityGateId=qg_v1_terra_high; and
openai/gpt-5.6-terra/high with canonical OpenAI route, null organization/project,
and zero adapter/SDK retries
  = {"evaluatorSchemaVersion":1,"evaluatorSourceDigest":"sha256:4444444444444444444444444444444444444444444444444444444444444444","evidenceManifestDigest":"sha256:1111111111111111111111111111111111111111111111111111111111111111","evidenceManifestVersion":1,"executionEnvironment":{"arch":"x64","bunRevision":"1.3.14+0d9b296af","bunVersion":"1.3.14","dependencyManifestDigest":"sha256:5555555555555555555555555555555555555555555555555555555555555555","platform":"win32"},"gateAttestationDigest":"sha256:3333333333333333333333333333333333333333333333333333333333333333","gateEvaluatedCommitSha":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","gateManifestDigest":"sha256:2222222222222222222222222222222222222222222222222222222222222222","kind":"dexter_evaluator_input","promptVersion":1,"qualityGateId":"qg_v1_terra_high","rubricVersion":1,"runtime":{"modelId":"gpt-5.6-terra","providerBoundary":{"adapterMaxRetries":0,"baseUrl":"https://api.openai.com/v1","organizationId":null,"projectId":null,"sdkMaxRetries":0},"providerId":"openai","reasoningEffort":"high"},"safetyPolicyVersion":1,"snapshotDigest":"sha256:0000000000000000000000000000000000000000000000000000000000000000","version":1}
artifactInputDigest
  = sha256:7a0fd8c7bd15c3b9a197bc316e6ba1d63a7f094682a8b80ba9df88433cfcc86e
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
- `qualityGateId`, gate manifest/attestation/source digests, and gate-evaluated commit
  SHA;
- exact Bun version/revision, platform/architecture, and resolved runtime-dependency
  manifest digest;
- exact provider base URL, organization/project routing, and adapter/SDK retry limits;
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

### 6.5 Deferred runtime and presentation decision

The candidate P3-E2 runtime completed deterministic/stub validation but failed its
single manually approved locked-holdout campaign. No passed attestation was created,
the candidate PR was closed without merge, and P3-E3 was not started. Aggregate
failure evidence showed material precision/recall, missing-caveat recall, available-
fact basis accuracy, matched-location accuracy, stability, and injection integrity
below the reviewed thresholds.

The used locked holdout is retired for runtime/prompt/model selection. Do not lower
the reviewed thresholds, tune against its aggregate results, rerun it as a release
gate, or merge a pending/failed qualification. A future Evaluator requires a
separate reviewed plan, new versioned development and locked-holdout sets, two
independent annotations plus adjudication, a new gate ID, explicit provider/model/
runtime binding, a new cost decision, and a concrete user workflow demonstrating
that the expected review benefit justifies ongoing qualification maintenance.

Until then, there is no Evaluator CLI, provider request, attestation, read API, URL
state, Dashboard tab, or Phase 3 acceptance test beyond preserving the dormant P3-E1
foundation and proving those surfaces are absent.

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

Phase 3 keeps the reviewed registry at five stable tabs:

| ID | Exact Japanese label | Phase 3 placement |
| --- | --- | --- |
| `report` | 概要・レポート | Comparison first, then existing report content |
| `technical` | 株価・テクニカル | unchanged |
| `fundamentals` | 比較・配当 | Radar with existing peer/dividend content |
| `supply-demand` | 需給・空売り | unchanged |
| `market` | 市場・セクター | unchanged |

All five tabs exist for every readable V1–V9 Snapshot. `report` remains the default.
The automatic ARIA tabs pattern, keyboard wrap/Home/End behavior, sticky horizontal
mobile tablist, selected-tab visibility, History API, focus restoration, and
unknown-tab canonicalization remain inherited.

No Router, evaluation endpoint/tab/URL state, polling, WebSocket, source refresh,
PDF control, or provider-cost action is introduced.

## 9. Implementation sequence

Each step is a separate small Draft PR from fast-forwarded `main`. Do not start a
dependent step before the predecessor is independently reviewed and merged.

1. **P3-0 — Source of Truth design synchronization**
   - update SPEC, MVP roadmap, this plan, and the non-normative handoff;
   - no runtime code.
2. **P3-I0 — History immutability, latest resolution, digest, and stored-report safety**
   - create-only history, authoritative epoch-ordered latest resolver,
     CanonicalJsonV1, digest, collision, save/evaluator safety;
   - integrate the comparator/resolver and `latest_resolution_failed` only through
     the existing latest/history GET, Watchlist, and saved-Snapshot reload surfaces;
     add no new API route or UI;
   - no Comparison, Evaluator call, Radar, score, or PDF.
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
7. **P3-EF — Evaluator freeze and roadmap synchronization**
   - retain merged P3-E1 as dormant internal foundation;
   - defer P3-E2/P3-E3, runtime, CLI, paid gate, API, URL state, and Dashboard tab;
   - remove only the unused H2 `evaluationSnapshot`/`evaluation` URL scaffolding;
   - do not merge the failed candidate runtime.
8. **P3-C0 — Composite-score evaluation design**
   - docs-only Phase 4 evidence gate; no runtime score.
9. **P3-X — Final closeout**
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
| P3-I0 | cross-process no-clobber/idempotency, hard-link unsupported path, epoch-ordered authoritative latest/no legacy rewrite, existing GET error mapping/reload preservation, canonical golden vectors, exact safety grammar, V1–V9 readability |
| P3-H1 | 67 definitions/accessors, epoch request order, definition/instance versions, nullable-value synthetic reason, discriminated observation including duplicate ambiguity, added/removed/non-available reachability, strict canonical date-role comparison, display/provenance, V1–V9, identities/zero |
| P3-H2 | exact HTTP union, Comparison URL lifecycle, result/registry-version state key, disclosure/reload races, focus, responsive |
| P3-R1 | selected-peer/target/unavailable structural consistency, stored sparse sample/cohort/fractional rank without Engine eligibility replay, SVG/table accessibility, mobile |
| P3-E1 | grouped-record cardinality budget, fact state/stored-or-synthetic reason, URL-free provenance, exact available/non-available fact refs, closed claim-domain sets, strict category/domain/basis/location coverage, persisted-but-excluded scopes, canonical IDs, V1–V9 manifest, no-replace sidecar |
| P3-EF | Source of Truth agreement, no Evaluator runtime/CLI/API/UI/attestation or reserved Evaluation URL behavior on `main`, retained P3-E1 compatibility, five-tab Dashboard |
| P3-C0 | no-look-ahead, gate completeness, absence of runtime score |
| P3-X | full regression, Playwright, CI/review/merge/main and docs synchronization |

Browser-interaction PRs use Playwright because unit tests do not establish initial
effects, History API, focus, sticky/mobile overflow, or request races. Normal CI
does not contact a paid provider.

## 11. Adopted, deferred, and rejected scope

### Implement in reviewed Phase 3 steps

- exact-registry deterministic saved-analysis Comparison;
- presentation-only Radar of seven existing peer percentiles;
- dormant P3-E1 evidence/sidecar foundation with no runtime or presentation surface;
- docs-only composite-score evaluation design.

### Explicitly defer

- PDF/print view/export storage/download API;
- Evaluator runtime, CLI/controller, provider dispatch, qualification attestation,
  paid gate, GET API, URL state, and `evaluation / AIレビュー` Dashboard tab;
- any reuse of the failed candidate's locked holdout for prompt/model tuning or a
  second qualification attempt; a future independent plan requires a new versioned
  development set, locked holdout, gate ID, annotation, and cost decision;
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

Evaluator is reconsidered only after a concrete review workflow, acceptable error
rates, and ongoing evaluation budget are documented. At that time, create an
independent safety, runtime, gold-set, maintenance, and UI plan; do not reactivate
P3-E2/P3-E3 or reuse the consumed locked holdout implicitly.

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
- required CI and focused Browser tests pass;
- `Usage.md`, applicable setup guidance, this plan, and the handoff match reality;
- V9 remains the only Snapshot writer and V1–V9 remain readable without backfill;
- P3-I0's reviewed no-replace history acceptance, collision, digest, and report-safety
  changes pass without changing Snapshot schema version;
- valid zero/unavailable/not-collected semantics and existing signals regressions pass;
- no runtime composite score or new financial signal exists;
- no Evaluator runtime, CLI, API, URL selector, Dashboard tab, provider dispatch, or
  passed attestation exists on `main`;
- the five-tab Dashboard contract remains unchanged apart from reviewed Comparison
  and Radar placement;
- Dashboard remains GET-only; and
- no `.dexter` artifact, credential, proprietary/private gold item, or secret is
  tracked.

## 13. P3-EF review contract

P3-EF changes only:

- `docs/SPEC.md`;
- `docs/MVP_IMPLEMENTATION_PLAN.md`;
- `docs/PHASE3_PLAN.md`; and
- `docs/PHASE3_HANDOFF.md`;
- `src/dashboard/web/app.tsx`;
- `src/dashboard/web/comparison.ts` and its colocated test;
- `src/dashboard/web/presentation.ts` and its colocated test; and
- the focused Comparison Playwright test file.

The only application behavior removed is the unused H2 reservation of
`evaluationSnapshot`/`evaluation` query state and its ability to pin a detail
Snapshot. P3-EF changes no dependency, CI, Snapshot schema, Engine, tool, or skill.
The closed P3-E2 candidate is not merged, and P3-E1 is neither reverted nor exposed.

Self-review verifies:

- Source of Truth precedence and explicit roadmap synchronization;
- V1–V9 immutability and no hidden migration;
- cross-process create-only publication without rename/copy overwrite fallback;
- exact separation of deterministic, presentation, AI, and deferred ownership;
- complete Comparison key/unit/date/identity/API/URL contracts;
- metric-specific Comparison display and pair/reload/disclosure lifecycle;
- retained P3-E1 safety, evidence, digest, and no-replace sidecar contracts without a
  runtime producer or Dashboard consumer;
- explicit deferral of P3-E2/P3-E3, the failed/consumed holdout, paid gate, API, URL,
  and sixth-tab candidate contracts;
- no Evaluation-specific query parsing/preservation, reload identity, or pinned-detail
  behavior remains in production Dashboard code; a focused browser regression proves
  the retired parameters are inert while generic unknown-query preservation remains
  unchanged;
- no score implementation before Phase 4 validation;
- PDF and Evaluator runtime removed from Phase 3 implementation/Done/sequence while
  existing Browser-test Playwright and the merged P3-E1 foundation remain;
- reviewable step boundaries; and
- Handoff remains non-normative and does not claim approval.

## 14. P3-X final closeout contract

P3-C0 is merged at the implementation baseline recorded above. P3-X is a docs-only
closeout and changes only:

- `Usage.md` to document the implemented immutable-history, Comparison, Radar, URL,
  and read-only API behavior plus the deferred boundaries;
- this plan to replace the stale next-step instruction with the closeout contract;
  and
- `docs/PHASE3_HANDOFF.md` to record the merged Phase 3 baseline through P3-C0 and
  the Phase 4 boundary.

`docs/USER_SETUP.md` is inspected but does not change because Phase 3 introduced no
new required runtime, dependency, credential, environment variable, font, or browser
installation. P3-X changes no code, dependency, Snapshot/API/UI contract, or
historical predecessor plan.

P3-X must:

1. verify `Usage.md` against the merged repository and tests rather than the design
   candidate;
2. record the immutable merged PR/commit history through P3-C0 while keeping the
   current P3-X approval, CI, and merge state dependent on GitHub and
   `docs/REVIEW_POLICY.md`;
3. run the full regression, type-check, diff check, and Dashboard Playwright suite;
4. confirm V9 writer/V1–V9 readability, five tabs, GET-only Dashboard, and valid
   zero/unavailable/not-collected behavior remain unchanged;
5. confirm no Evaluator runtime/CLI/API/UI/provider dispatch, runtime score,
   PDF/export surface, Snapshot V10, new signal, credential, or `.dexter` artifact is
   introduced; and
6. publish one independently reviewable Draft PR from fast-forwarded `main`.

The P3-X candidate must not describe itself as merged or declare Phase 3 complete.
After that exact head passes independent review, is merged, and local `main` is
fast-forwarded to `origin/main`, the Section 12 Done conditions are satisfied and no
further Phase 3 feature step remains. Any score experiment or product adoption is
Phase 4 work under `docs/PHASE3_SCORE_EVALUATION_PLAN.md` plus a separate reviewed
implementation plan; deferred Evaluator or PDF work requires its own independent
plan rather than reopening Phase 3.
