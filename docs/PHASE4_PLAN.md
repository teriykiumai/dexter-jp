# Dexter JP Phase 4 Implementation Plan

**Plan version:** `phase4_strategy_validation_plan_v1`

**Status:** Candidate — requires independent review and merge before runtime work

**Last Updated:** 2026-08-31

## 1. Purpose and authority

Phase 4 adds a research-only point-in-time foundation and validates the observable
outcomes of deterministic Entry / Stop / Target candidates. It answers two bounded
questions:

1. what happened after a candidate already persisted in an immutable Analysis
   Snapshot; and
2. what candidates the versioned 251-session reconstruction policy produces from
   official data bounded at a declared historical anchor, and what happened
   afterward.

The two questions have different evidentiary strength. Every case therefore carries
exactly one confidence value:

```text
precommitted | reconstructed_251_as_of
```

`precommitted` means the candidate existed in a saved Snapshot before its outcome
window. `reconstructed_251_as_of` means the candidate was rebuilt later by
`technical_251_strategy_v1` from exactly 251 source sessions bounded at the anchor.
J-Quants can return historical rows but does not establish the exact correction
vintage originally delivered on that historical day. The current production
comprehensive-analysis path passes its complete retrieved history, which may exceed
251 rows, to `analyzeTechnical`; therefore a reconstructed case is neither a replay
of that production pipeline nor a fully reproduced historical record. Its aggregate
is never merged with a precommitted aggregate.

This plan inherits and does not weaken:

- `AGENTS.md` for repository operation, safety, validation, and review;
- `docs/SPEC.md` for deterministic calculation, missing-data, no-look-ahead,
  AI-responsibility, and local-use invariants;
- `docs/MVP_IMPLEMENTATION_PLAN.md` for the completed Strategy and technical Engine;
- `docs/VISUALIZATION_MVP_PLAN.md` and `docs/DASHBOARD_UX_PLAN.md` for Snapshot,
  repository, local API, URL, accessibility, and responsive-Dashboard contracts;
- `docs/PHASE3_PLAN.md` for immutable Snapshot V1-V9, canonical digest, current
  five-tab Dashboard, and deferred-scope boundaries; and
- `docs/REVIEW_POLICY.md` for independent review and the Merge Gate.

`docs/PHASE3_SCORE_EVALUATION_PLAN.md` remains a historical, docs-only score protocol.
This plan neither executes it nor authorizes a runtime score.

## 2. Scope and baseline

### 2.1 Adopted scope

Phase 4 implements only:

- strict official-session, as-of, source-date, adjustment, and tick-size primitives;
- a J-Quants adapter dedicated to historical Strategy validation;
- a pure daily-OHLC Entry / Stop / Target outcome validator;
- immutable local research runs and normalized source evidence;
- a saved-Snapshot audit CLI;
- a strict manifest-driven historical reconstruction CLI;
- one bounded local background job and its same-origin API;
- a sixth Dashboard tab for explicit run and case inspection; and
- user setup, usage, handoff, and final validation for that surface.

### 2.2 Preserved baseline

- Analysis Snapshot V9 remains the only writer schema. V1-V9 remain readable.
- No Snapshot migration, V10, or backfill is introduced.
- `.dexter/analysis/` and `.dexter/evaluations/` are not modified by Phase 4.
- `analyzeTechnical` and `analyzeStrategy` remain the calculation authority.
- Strategy candidate reasons and `STRATEGY_DEFAULTS` are unchanged.
- The production analysis path still accepts one sourced `tickSize`; Phase 4 does
  not change that public Strategy interface or re-round stored candidates.
- Existing Analysis, Comparison, Radar, URL, and five-tab behavior remains a
  regression contract until the sixth tab is deliberately added at P4-D1.
- No new runtime dependency or non-Bun runtime is planned.

### 2.3 Product interpretation boundary

Phase 4 records observed outcomes and explicit limitations. It does not:

- declare a Strategy, stop reason, target reason, or resistance source PASS/FAIL;
- issue Buy / Sell / Hold recommendations or a new financial signal;
- claim causal or predictive validity from an observed rate;
- calculate portfolio performance, capital allocation, overlapping-position P&L,
  transaction costs, taxes, dividends, borrow, or slippage; or
- adopt, calculate, weight, or display a composite score.

## 3. Point-in-time type system

### 3.1 Branded value contracts

P4-I0 introduces pure parsers and branded values equivalent to:

```ts
type TseSessionDate = string;
type OutcomeAsOfSession = TseSessionDate;
type AsOfCutoff = string;
type SourceDate = string;
type SourceEffectiveDate = string;
type SourceEligibleDate = string;

type PointInTimeConfidence = 'precommitted' | 'reconstructed_251_as_of';

interface PointInTimeObservationV1<T> {
  value: T;
  sourceDate: SourceDate;
  sourceEffectiveDate: SourceEffectiveDate;
  sourceEligibleDate: SourceEligibleDate;
  asOfCutoff: AsOfCutoff;
}
```

All dates are strict `YYYY-MM-DD` Gregorian calendar dates. `AsOfCutoff` is a UTC
ISO-8601 instant with a trailing `Z`. A date-only source row is eligible only under
the endpoint-specific rule fixed in this plan; merely having `sourceDate <= anchor`
is insufficient when the source has a later effective or eligible boundary.

### 3.2 No-look-ahead order of operations

Every external response is handled in this order:

1. decode JSON without coercing unknown fields;
2. select only rows whose endpoint-specific eligible date is at or before the
   requested cutoff;
3. reject duplicate identities, impossible dates, and rows outside the requested
   ticker/date envelope;
4. validate the allowlisted fields and values; and
5. map to normalized domain observations.

Rows after the cutoff are filtered before domain parsing or calculation so a future
row cannot affect validation, duplicate detection, adjustment, sorting, or fallback.
There is no forward fill, interpolation, nearest-row substitution, stale-price
substitution, weekend inference, or inference of official sessions from price rows.

### 3.3 Official-session calendar

`TseSessionCalendarV1` is built only from `/v2/markets/calendar` rows. `HolDiv` must
be exactly `"0" | "1" | "2" | "3"`; `"1"` (business day) and `"2"` (TSE half-day
session) are TSE sessions, while `"0"` and `"3"` are not. Unknown `HolDiv`, duplicate
dates with unequal values, missing dates inside a required window, non-monotonic
output, or an unavailable source plan fails closed as `calendar_incomplete`,
`source_response_invalid`, or `source_plan_unavailable` according to the exact
cause.

The calendar owns predecessor/successor and ordinal-session arithmetic. JavaScript
weekday logic and the existence of an OHLC row never create a session. A required
window must include every official session from its first through last boundary,
including no-trade sessions.

## 4. Official source and normalization contract

### 4.1 Endpoint allowlist and fields

Only these J-Quants V2 GET endpoints may feed Phase 4:

| Endpoint | Exact used fields | Purpose |
| --- | --- | --- |
| `/v2/markets/calendar` | `Date`, `HolDiv` | official TSE session sequence |
| `/v2/equities/master` | `Date`, `Code`, `ScaleCat`, `Mkt`, `ProdCat` | point-in-time security and tick category |
| `/v2/equities/bars/daily` | `Date`, `Code`, `O`, `H`, `L`, `C`, `UL`, `LL`, `AdjFactor`, `ExRT` | t0 technical input and later outcome bars |

The adapter is separate from the interactive `get_stock_price` Tool and exposes no
LLM tool. It uses the existing `JQUANTS_API_KEY` lookup and error-sanitization
conventions but adds strict response schemas, abort support, attempt accounting,
rate limiting, and bounded retry. No endpoint, field, enum, plan availability, or
default is guessed.

"Exact used fields" does not mean the API must omit its other documented fields.
The mapper minimally extracts identity/date first, then validates every used field
strictly and ignores all unused properties without evaluating or persisting them.
An added unused property therefore cannot affect a calculation or digest; a missing,
renamed, malformed, or contradictory used property fails closed.

Only `ProdCat === "011"` is eligible. The requested canonical ticker must match the
existing `CanonicalTickerSchema` (including supported JPX alphanumeric codes) and
the canonical four-character portion of returned `Code`; multiple unequal rows
for the same effective identity fail. An empty row is unavailable, not a false or
zero value. `Mkt` is stored as evidence and must be a non-empty official code, but
Phase 4 does not infer market history beyond the returned dated row.

### 4.2 Source-date and eligible-date mapping

| Observation | `sourceDate` | `sourceEffectiveDate` | `sourceEligibleDate` |
| --- | --- | --- | --- |
| calendar | `Date` | `Date` | `Date` |
| master | requested official session | returned `Date` | returned `Date` |
| daily bar | `Date` | `Date` | `Date` |

For a reconstruction anchor, `asOfCutoff` is the final instant of the anchor's Tokyo
calendar date: `23:59:59.999+09:00`, canonically serialized as the equivalent UTC
instant, under `tokyo_end_of_day_v1`. This is an after-close research decision, not a
claim that the data was available at the exchange's closing bell. It deliberately
avoids back-applying today's market-close time to historical sessions.

For reconstructed rows, `sourceEligibleDate` is the earliest economic as-of date
represented by the endpoint's dated row, not proof of its original publication
timestamp or correction vintage. That limitation is why the confidence is
`reconstructed_251_as_of`. A future effective row still cannot enter the t0
calculation.

Calendar rows are planning facts and may be fetched later, but only dates at or
before a calculation boundary may influence the t0 calculation. Outcome rows are
intentionally post-decision observations; they are isolated from Strategy input and
cannot be read until the candidate is frozen and digested.

Every t0 daily-bar request ends at t0. Outcome bars use a separate request beginning
at t1; an adapter response spanning both sides is prohibited. Candidate-input
observations carry the t0 end-of-day cutoff.

At local preflight start, CLI and Dashboard freeze one UTC `startedAt`; every
execution accepted after confirmation retains that value and records its later,
required `acceptedAt` separately. `startedAt` controls outcome availability while
`acceptedAt` starts the external-execution budget. For every source-backed run,
after the official calendar is collected the orchestrator derives
`outcomeAsOfSession` as the greatest TSE session
strictly before
`TokyoDate(startedAt)`. Outcome observations carry `startedAt` as their immutable
cutoff and are accepted only when:

```text
decisionDate < Date <= outcomeAsOfSession
```

Preflight returns the frozen `startedAt` and the conservative boundary rule, not a
guessed session. The derived authoritative session is persisted in
job/run/case/source-manifest metadata before outcome-bar collection. The exact
Snapshot failures decidable before any source access (`strategy === null` or no
candidates, malformed/impossible Strategy date, and a Strategy date later than
generation) instead persist `outcomeAsOfSession: null` in the run, case, and empty
source manifest. They do not claim that the previous Gregorian date was an official
session and contain no outcome observation. A calendar request whose returned
envelope has missing internal dates or incomplete required coverage also cannot
derive an official boundary: it persists `outcomeAsOfSession: null` with exactly one
`candidate_calendar` reference to an unavailable `calendar_incomplete` envelope.
It is not a zero-attempt local failure. No bar whose
`Date === TokyoDate(startedAt)` is eligible, even if the fetch finishes after that
bar is published. A job that crosses a same-day publication boundary therefore has
the same accepted outcome set it had at start. Missing or incomplete calendar
coverage for this derivation is `calendar_incomplete`; there is no publication-time,
weekday, or nearest-session fallback.

The orchestrator persists the candidate digest before it passes any outcome row to
the pure validator. This request and data-flow separation is tested, not left as a
caller convention.

### 4.3 Daily-bar schema

`O/H/L/C` are either all finite positive numbers with `H >= max(O,C)`,
`L <= min(O,C)`, and `H >= L`, or all `null` for an official no-trade session. Mixed
nullability, non-finite values, non-positive prices, impossible ranges, an unknown
`UL`/`LL` value, a non-positive/non-finite `AdjFactor`, or unknown `ExRT` is
`source_response_invalid`.

On a complete traded row, `UL` and `LL` are strict strings `"0" | "1"`. On an
all-null-OHLC no-trade row, each flag may be `null` or `"0"` but not `"1"`. `ExRT` is
`null | "1" | "2" | "3"`. No-trade rows count as sessions but cannot trigger or fill
an order and cannot supply a mark price. Missing an official-session row is not
equivalent to a returned all-null row and fails the required window as
`price_history_incomplete`.

The source defines `UL` only as the daily stop-high flag and `LL` only as the daily
stop-low flag. Neither flag is a generic statement that every order on the row was
queue-blocked. For the narrow V1 fill check, `UL === "1"` identifies `H` as the
flagged upper boundary and `LL === "1"` identifies `L` as the flagged lower
boundary. Phase 4 does not reconstruct a theoretical limit price from a prior close,
static limit-width table, or an assumed expansion regime.

### 4.4 t0-relative price basis

Current API `AdjO/AdjH/AdjL/AdjC` values are not used because they may include
actions after the intended anchor. For each raw price `P(d)` with `d <= t0`, Phase 4
computes:

```text
CumAdj(d, t0) = product(AdjFactor(a)) for every action row d < a <= t0
P_t0(d)       = roundToOneDecimal(P(d) * CumAdj(d, t0))
```

`roundToOneDecimal` follows the J-Quants rule that the second decimal place is
rounded, producing one decimal place. The action-date row itself has cumulative
factor 1 for that event; the factor affects only earlier rows. Multiplication order,
decimal rounding, duplicate factor rows, and golden vectors are versioned as
`jquants_t0_adjustment_v1`.

The normalized t0 rows supplied to `analyzeTechnical` contain only `date`, adjusted
`open/high/low/close`, and `volume: null`. Strategy uses high, low, close, and ATR;
Phase 4 does not invent historical volume. If any of the exact 251 required rows has
incomplete OHLC, any required `analyzeTechnical` Strategy input is null, or the
Engine returns no candidate, that anchor is recorded as unavailable/invalid rather
than shortened or padded.

### 4.5 Outcome-window corporate actions

Outcome bars use raw `O/H/L/C` on the candidate's t0 price basis. For every observed
session after t0 through that case's evaluation end, `ExRT` equal to `"1"`, `"2"`,
or `"3"`, or `AdjFactor !== 1`, makes the case unavailable with
`corporate_action_in_outcome_window`. Unknown or malformed action metadata is
`source_response_invalid`.

Evaluation end is the first terminal outcome day, the twentieth entry-wait session
for `not_triggered`, the sixtieth holding session for `horizon_expired`, or the last
observed session used to establish `outcome_not_matured`. An action after a completed
evaluation does not retroactively alter that case.

This deliberately fails closed rather than attempting to transform frozen order
levels across a corporate action.

### 4.6 Tick resolver

`TseTickRuleV1` supports only 2015-09-24 through 2027-02-28 inclusive:

- 2015-09-24 through 2023-06-04: the fine table applies to `TOPIX Core30` and
  `TOPIX Large70`;
- 2023-06-05 through 2027-02-28: it also applies to `TOPIX Mid400`; and
- all other `ScaleCat` values use the ordinary domestic-share table.

Before the supported start or after the supported end returns
`tick_rule_period_unsupported`. Missing, unknown, or contradictory category evidence
returns `tick_category_unavailable`. The 2027 STR-based regime is not inferred.

| Price upper bound (JPY, inclusive) | Fine tick | Other tick |
| ---: | ---: | ---: |
| 1,000 | 0.1 | 1 |
| 3,000 | 0.5 | 1 |
| 5,000 | 1 | 5 |
| 10,000 | 1 | 10 |
| 30,000 | 5 | 10 |
| 50,000 | 10 | 50 |
| 100,000 | 10 | 100 |
| 300,000 | 50 | 100 |
| 500,000 | 100 | 500 |
| 1,000,000 | 100 | 1,000 |
| 3,000,000 | 500 | 1,000 |
| 5,000,000 | 1,000 | 5,000 |
| 10,000,000 | 1,000 | 10,000 |
| 30,000,000 | 5,000 | 10,000 |
| 50,000,000 | 10,000 | 50,000 |
| infinity | 10,000 | 100,000 |

Band boundaries are evaluated against the submitted price itself. A price is
executable only when it is an exact integer multiple of the tick for its own band,
using decimal-safe integer arithmetic rather than binary-floating epsilon.

For reconstructed candidates, resolve the first quote strictly above the swing high
with the anchor's category and supply that entry tick to the unchanged
`analyzeStrategy`. Then independently validate the generated entry, stop, and target
against the market tick for each level's own price band. A cross-band level that the
current single-tick Engine rounded to an invalid quote is `non_executable_tick`; it
is not re-rounded and Strategy V2 is not created. Stored Snapshot candidates are
also audited as stored and never rewritten.

Master evidence is required for t0 and for any prospective fill date on which the
applicable category would change quote validity. The source layer may identify
prospective touch dates from frozen candidate levels before requesting those master
rows, but such later rows cannot change the candidate. A missing or conflicting row
fails closed.

### 4.7 Normalized source envelope

Every accepted source set is persisted in a strict `PointInTimeSourceEnvelopeV1`
containing:

- schema and source-mapping versions;
- endpoint literal and normalized query parameters excluding credentials;
- requested ticker/date envelope and `asOfCutoff`;
- fetched-at UTC timestamp;
- exact normalized, sorted used rows;
- source-plan/error classification when unavailable; and
- canonical digest `sha256:<lowercase hex>` using `CanonicalJsonV1`.

Raw HTTP bodies, headers, API keys, pagination tokens, request IDs, absolute local
paths, and unused response fields are never persisted. Equal canonical content
deduplicates by digest. A digest collision or unequal content at an existing digest
is a typed persistence failure.

`PointInTimeSourceManifestV1` records the ordered unique envelope digests used by a
case, their calculation role, the frozen `startedAt`, and `outcomeAsOfSession`. The
boundary is `null` only for either the exact source-free local Snapshot failures in
Section 5.2, where `sources` is empty, or an anchor-level `calendar_incomplete`, where
`sources` contains exactly one `candidate_calendar` reference. The latter envelope
must independently validate as unavailable with reason `calendar_incomplete`. A
non-null boundary does not by itself prove source completeness. The manifest never
substitutes a digest for schema validation: envelopes are revalidated and redigested
when loaded.

## 5. Inputs and candidate creation

### 5.1 CLI surface

```text
bun run validate:strategy --ticker <ticker> --snapshot-id <snapshotId> [--confirm-external-fetch]
bun run validate:strategy --manifest <campaign.json> [--confirm-external-fetch]
```

Exactly one mode is required. Duplicate flags, unknown flags, missing values, unsafe
ticker/Snapshot IDs, nonexistent or non-regular manifest files, or extra positional
arguments are rejected before external access or artifact creation.

Every execution that would contact J-Quants displays the target, date range, bounded
request estimate, `minimumDispatchDurationMs`, configured rate, timeout, attempt cap,
the fact that actual pagination/retry/latency can still time out, and local
destination, then asks a default-No confirmation. Non-interactive execution requires
the exact `--confirm-external-fetch` flag. Confirmation is authorization for that
invocation only. A preflight or declined/cancelled confirmation writes no run or job
artifact.

CLI executes the shared orchestrator in the foreground and does not create a
Dashboard job JSON. `SIGINT`/`SIGTERM` abort the active request, prevent publication,
clean attributable temporary data, and exit nonzero with a sanitized message. The
Dashboard is the only producer of `jobs/<jobId>.json`.

### 5.2 Saved-Snapshot audit mode

The repository loads exactly the requested V1-V9 history item and verifies ticker,
Snapshot ID, schema, canonical digest, and immutable history identity. There is no
latest fallback. The mode audits every persisted deterministic Strategy candidate,
including both `risk_reward_2R` and `resistance_level`, without regenerating or
repairing it.

Stored 2R candidates use resistance tier `none`. Stored `resistance_level`
candidates use `precommitted_source_unknown`: persistence proves the level was fixed
before evaluation, but V1-V9 does not preserve a source identity that Phase 4 can
upgrade to source-verified evidence.

Saved candidates use the versioned `snapshot_candidate_identity_v1` envelope in
Section 5.4. Identical duplicates remain separate cases and are explicitly marked.
A Snapshot with `strategy === null` or no candidates produces exactly one
source-free `anchor_unavailable` case with `invalid_candidate` and
`outcomeAsOfSession: null`; it does not enter candidate identity or outcome
collection.

When one or more stored candidates exist, Snapshot audit applies this fail-closed
order after exact Snapshot schema/digest/identity validation and before constructing
any candidate identity or requesting any outcome bar:

1. parse `strategy.dataDate` with the strict `YYYY-MM-DD` Gregorian parser from
   Section 3.1; `null`, malformed/non-Gregorian text, and impossible calendar dates
   produce exactly one `anchor_unavailable` case with
   `strategy_data_date_invalid`;
2. let `generatedTokyoDate` be the Tokyo calendar date containing the exact
   `generatedAt` instant; a parsed Strategy date later than it produces exactly one
   `anchor_unavailable` case with `future_strategy_data`;
3. require the parsed Strategy date to be an official session in
   `TseSessionCalendarV1`; a complete calendar that proves it is not an official TSE
   session produces exactly one `anchor_unavailable` case with
   `strategy_data_date_invalid`, while missing/incomplete calendar coverage keeps the
   distinct `calendar_incomplete` reason and exactly one causal unavailable
   `candidate_calendar` envelope;
4. only after the official-session guard, normalize every stored candidate. A
   candidate whose persisted finite fields cannot satisfy the positive candidate
   schema produces one calendar-backed `anchor_unavailable` case with
   `invalid_candidate`; a positive candidate with an invalid Entry/Stop/Target
   relationship remains a frozen candidate case whose outcome is
   `unavailable/invalid_candidate`; and
5. only then derive the decision date as the later of the validated Strategy date
   and `generatedTokyoDate`, construct `snapshot_candidate_identity_v1`, and permit
   outcome-bar planning/collection.

The local invalid/future anchor case has no candidate, `candidateId`, duplicate
ordinal, fill, R, source envelope, or invented official-session boundary. It plans
zero requests and persists the null boundary described in Section 4.2. Every
remaining Snapshot plans at least the official-calendar request; therefore a proven
non-session Strategy date takes precedence over candidate normalization failure.
No Master or daily-bar request is made for a relationally invalid candidate, and no
daily-bar outcome request is made unless all five guards pass. The first eligible
evaluation session is the first official TSE session
strictly after the decision date. Confidence is `precommitted`.

The immutable artifact binds these branches independently of producer behavior.
Source-free `strategy_data_date_invalid` and `invalid_candidate` require
`strategyDataDate: null`, equal anchor/decision dates, a null outcome boundary, and
zero sources. Source-free `future_strategy_data` requires a non-null
`strategyDataDate` equal to both anchor and decision date, a null boundary, and zero
sources; `future_strategy_data` is invalid once any source is referenced.
Calendar-backed `strategy_data_date_invalid` and candidate-normalization
`invalid_candidate` require a non-null Strategy date, non-null official boundary,
and exactly one available `candidate_calendar` reference. `calendar_incomplete`
requires a null boundary and exactly one unavailable `candidate_calendar` reference
with the same reason. Repository reread revalidates these stage/source invariants;
it never skips completeness merely because the boundary is null.

### 5.3 Campaign manifest

The only accepted shape is:

```json
{
  "schemaVersion": "strategy_validation_campaign_v1",
  "name": "example",
  "anchors": [
    {
      "ticker": "7203",
      "anchorDate": "2025-03-31",
      "resistanceEvidence": [
        { "kind": "analysis_snapshot", "snapshotId": "..." }
      ]
    }
  ]
}
```

The JSON file must be UTF-8 without BOM, at most 1,048,576 bytes, and contain no
duplicate JSON object keys. Schemas are strict and reject unknown fields. `name` is
1-64 Unicode scalar values after NFC normalization and rejects Unicode `Cc`/`Cf`,
both path separators, `.`/`..` segments, Windows/POSIX absolute-path forms, and the
credential/private-key markers already fixed by `SafetyPolicyV1`.
There are 1-500 anchors. Tickers use the existing canonical Japanese security-code
schema; anchor dates are strict official TSE sessions. Duplicate `(ticker, anchorDate)`
pairs are rejected. There is no truncation.

Each anchor accepts 0-8 Snapshot references. Each reference must load by exact ID,
match the ticker, and pass schema/digest validation. Let `generatedTokyoDate` be the
Tokyo date containing its `generatedAt`. Before reading a candidate, the reference
must satisfy all of:

```text
generatedAt <= anchor cutoff
strategy !== null
strategy.dataDate === anchorDate
strategy.dataDate <= generatedTokyoDate
```

The last guard rejects a prior-day Snapshot that claims anchor-day Strategy data and
is applied before extracting any price. Extraction reads only persisted
`strategy.candidates[].target.price` values whose `target.reason` is exactly
`resistance_level`; report text, entry/stop levels, 2R targets, and other fields are
never resistance evidence. At most 16 unique finite positive extracted prices
survive exact deduplication across accepted evidence. For every surviving price, the
extractor retains the sorted unique Snapshot digests that supplied that exact price.
After the entry tick is resolved, provenance association reuses the unchanged
Engine's exact `tickAtOrBelow(rawResistance, entryTick)` transformation and groups
the source digests by that normalized target. Raw levels that the Engine rejects at
or below entry produce no mapping; multiple raw levels collapsing to one normalized
target contribute the sorted union of their digests. A generated
`resistance_level` candidate receives only the digests in the group for its exact
Engine output target; a `risk_reward_2R` candidate receives none. This association
does not create, round, or repair a candidate outside the Engine. Invalid temporal
evidence, identity, schema/digest, or extracted value makes that anchor unavailable
with `resistance_evidence_invalid`; it is never silently ignored.

Campaign candidate generation is the distinct, versioned policy
`technical_251_strategy_v1`. Its technical window is exactly t0 plus the preceding
250 official TSE sessions: 251 sessions in ascending order, ending at `anchorDate`.
All rows are normalized to the t0-relative price basis before calling the existing
`analyzeTechnical`, then `analyzeStrategy` with the resolved entry tick and accepted
resistance levels. The Engine implementations, reasons, and defaults are reused, but
only inside this fixed input policy.

This is intentionally not production-pipeline parity. The current
comprehensive-analysis workflow supplies the complete retrieved adjusted history to
`analyzeTechnical`, and the base Engine searches all supplied rows for its latest
Swing High/Low. History older than the final 251 sessions can therefore change a
production Technical/Strategy result while being outside this reconstruction policy.
Phase 4 does not shorten, canonicalize, or otherwise change that production path.
Campaign artifacts and UI must display `technical_251_strategy_v1` and confidence
`reconstructed_251_as_of`, with an explicit warning that its outcome statistics
describe this standardized retrospective policy rather than the current production
Strategy pipeline.

No current Snapshot technical values, current prices, later bars, or rows before the
policy's 251-session start may enter campaign candidate creation. Adding older rows
outside that start must not change the reconstructed candidate. Saved-Snapshot audit
mode is unaffected because it evaluates stored candidates without regeneration.

Campaign resistance evidence has two tiers:

```text
none | precommitted_source_unknown
```

`none` produces only 2R candidates. A valid historical Snapshot may supply a stored
resistance value, but current V1-V9 data does not prove the original resistance
producer identity, so it is labeled `precommitted_source_unknown` and aggregated
separately. Phase 4 never invents a resistance level or describes this tier as
source-verified.

### 5.4 Canonical candidate identity

Every candidate case persists `candidateId` as `sha256:<64 lowercase hex>`. It is
SHA-256 over one complete, strict typed envelope serialized with `CanonicalJsonV1`.
Snapshot and campaign modes use different identity versions:

```ts
type SnapshotCandidateIdentityEnvelopeV1 = Readonly<{
  candidateIdentityVersion: 'snapshot_candidate_identity_v1';
  snapshotDigest: SnapshotDigest;
  strategyDataDate: TseSessionDate;
  entry: Readonly<{ reason: EntryReason; price: number }>;
  stop: Readonly<{ reason: StopReason; price: number }>;
  target: Readonly<{ reason: TargetReason; price: number }>;
  duplicateOrdinal: number;
}>;

type CampaignCandidateIdentityEnvelopeV1 = Readonly<{
  candidateIdentityVersion: 'campaign_candidate_identity_v1';
  ticker: CanonicalTicker;
  anchorDate: TseSessionDate;
  candidateGenerationPolicy: 'technical_251_strategy_v1';
  resistanceEvidenceTier: 'none' | 'precommitted_source_unknown';
  resistanceEvidenceSnapshotDigests: readonly SnapshotDigest[];
  entry: Readonly<{ reason: EntryReason; price: number }>;
  stop: Readonly<{ reason: StopReason; price: number }>;
  target: Readonly<{ reason: TargetReason; price: number }>;
  duplicateOrdinal: number;
}>;
```

The evidence-digest array is the candidate-specific array from Section 5.3, sorted
lexicographically and deduplicated before hashing. Every field is required. Prices
must already be validated finite canonical numbers; `CanonicalJsonV1` normalizes
negative zero to zero. No run ID, case ID, job/preflight ID, manifest name/digest,
timestamp, outcome, fill, or unused resistance reference enters candidate identity.
Thus campaign composition and random publication identities cannot change an equal
candidate's ID, while ticker, anchor, policy, price/reason tuple, or evidence identity
changes do.

The normalized campaign-anchor identity is exactly `(ticker, anchorDate)` because
the manifest rejects duplicate pairs; no manifest-wide identity is needed to
disambiguate anchors. Every envelope field is also persisted in the candidate case,
and loaders reconstruct and rehash the envelope before accepting `candidateId`.
`duplicateOrdinal` is a nonnegative safe integer. Snapshot audit persists an empty
`resistanceEvidenceSnapshotDigests` array because V1-V9 has no source identity;
campaign 2R also persists an empty array, while campaign resistance persists the
candidate-specific array above.

For each mode, first form the complete identity base tuple above without
`duplicateOrdinal` and sort candidates by the `CanonicalJsonV1` bytes of that base
tuple in ascending unsigned UTF-8 byte order. Within each exactly equal base tuple,
assign zero-based ordinals `0..n-1`; Engine/source order is ignored. Hash the complete
envelope including that ordinal. This makes the candidate-ID multiset and its
candidate-ID sort order identical across equal reruns even though `runId` and
`caseId` are new UUIDv4 values. Different tickers or anchor dates cannot collide, and
true duplicates within one anchor remain distinct. An `anchor_unavailable` case has
no `candidateId`, candidate envelope, or duplicate ordinal.

## 6. Outcome validator

### 6.1 Windows and maturity

Campaign t0 is an after-close decision. Evaluation begins at t1. Snapshot audit uses
the first official session after its decision date. In both modes:

- entry may trigger on sessions 1 through 20 inclusive;
- the entry session is holding day 1;
- a filled position is observed through holding day 60 inclusive; and
- therefore a latest-possible t20 entry can require data through evaluation session
  79.

If session 20 completes with no entry, result is `not_triggered`; no extra 60-session
wait is required. A terminal stop, target, gap error, limit-queue ambiguity, or fully
bounded intraday ambiguity may complete earlier. If the entry window is incomplete,
or an open position has not reached holding day 60 and no terminal result is proven,
result is unavailable with `outcome_not_matured`.

### 6.2 Candidate preconditions

Before reading an outcome bar, the validator requires finite positive entry, stop,
and target; `stop < entry < target`; positive planned risk; supported reasons; and an
executable tick for each level. Failure is `invalid_candidate` or
`non_executable_tick`. The input candidate and source arrays are never mutated.

### 6.3 Daily fill algorithm

The algorithm version is `daily_long_fill_v1`; its queue subrule is
`adverse_flagged_boundary_v1`. Phase 4 validates long candidates only: Entry is a
buy, while Stop and Target are sells.

No-trade rows consume an official session but cause no touch or fill. For a complete
bar before entry:

1. `H < entry` means no trigger.
2. `O >= target` is `entry_gap_beyond_target`; no entry is assumed.
3. `O >= entry && O < target` fills the entry at `O`.
4. `O < entry && H >= entry` fills the entry at the candidate entry price.

After entry, including the entry bar where sequence is provable:

1. `O <= stop` fills the stop at `O`.
2. `O >= target` fills the target conservatively at the target price.
3. with the open between levels, a stop-only touch fills at stop;
4. a target-only touch fills at target; and
5. touching both levels without intraday sequence is `ambiguous_intraday`.

For an `O < entry && H >= entry` entry bar, the feasible branch set uses all OHLC
constraints. Let `stopTouched = L <= stop` and `targetTouched = H >= target`:

| Entry-bar facts | Deterministic interpretation |
| --- | --- |
| `targetTouched && stopTouched` | ambiguous: pessimistic stop, optimistic target |
| `targetTouched && !stopTouched` | target is provably crossed after entry |
| `!targetTouched && !stopTouched` | entry remains open at `C` |
| `!targetTouched && stopTouched && C <= stop` | stop is provably crossed after entry |
| `!targetTouched && stopTouched && C > stop` | ambiguous: pessimistic stop; optimistic assumes the low preceded entry and remains open at `C` |

The `C <= stop` rule is mandatory: after price reaches entry, finishing at or below
stop requires a post-entry stop crossing, so an optimistic open branch is impossible.
When the optimistic branch remains open, it continues through later rows from that
same holding-day count; it does not reset entry or horizon. Later dual-touch bars use
stop and target as the two bounds. Branches use the same later rows and cannot read
beyond the common horizon. Source geometry already guarantees `L <= C <= H`.

After the OHLC algorithm selects a hypothetical fill, the V1 adverse-side queue
check is exactly:

```text
buy entry  is limit-bound iff UL === "1" && selectedFillPrice === H
sell stop  is limit-bound iff LL === "1" && selectedFillPrice === L
sell target is never made queue-ambiguous by UL/LL alone
```

Prices are compared as exact canonical decimals on the already validated common
price basis; there is no epsilon, clamp, or inferred boundary. A limit-bound buy
entry or sell stop is unavailable with `limit_queue_ambiguous`, because a daily bar
does not prove the hypothetical order's priority or execution at that adverse
boundary. If the ambiguous event is the entry, `entryProven` remains false. If it is
a later stop, the already proven entry remains true but no realized R is emitted.
When a reported intraday bound requires that stop fill, the queue ambiguity takes
precedence over `ambiguous_intraday` because the stop bound itself is not executable
from daily evidence.

All other combinations retain the result chosen by the OHLC algorithm. In
particular:

- `UL === "1"` does not censor a lower sell-stop fill;
- `LL === "1"` does not censor a buy-entry or upper sell-target fill;
- a buy entry below `H` is not limit-bound even when `UL === "1"`;
- a sell stop above `L` is not limit-bound even when `LL === "1"`; and
- no-touch and final mark-only rows retain both flags only as source evidence.

The same rule applies to threshold, gap/open, and entry-bar fills. Thus an entry
selected at `O` is ambiguous only when it is a buy at `O === H` with `UL === "1"`;
a gap stop selected at `O` is ambiguous only when it is a sell at `O === L` with
`LL === "1"`. A case unavailable for this reason records the exact date, order side,
selected fill price, boundary kind/price, and source flag; it does not claim that the
order definitely failed.

The strict unavailable member for this reason alone requires:

```ts
limitQueueEvidence: {
  date: TseSessionDate;
  orderSide: 'buy' | 'sell';
  fillKind: 'entry' | 'stop';
  selectedFillPrice: number;
  boundaryKind: 'upper' | 'lower';
  boundaryPrice: number;
  sourceFlag: 'UL' | 'LL';
}
```

The allowed pairs are exactly buy/entry/upper/UL and sell/stop/lower/LL. The field is
absent for every other result/reason; mismatched or extra combinations are schema
errors.

### 6.4 Result union and reason vocabulary

Every case has exactly one result kind:

```text
not_triggered
stop_hit
target_hit
horizon_expired
ambiguous_intraday
unavailable
```

The closed unavailable-reason registry is:

```text
outcome_not_matured
source_plan_unavailable
source_history_unavailable
source_response_invalid
calendar_incomplete
price_history_incomplete
corporate_action_in_outcome_window
tick_rule_period_unsupported
tick_category_unavailable
non_executable_tick
entry_gap_beyond_target
strategy_data_date_invalid
future_strategy_data
invalid_candidate
resistance_evidence_invalid
limit_queue_ambiguous
```

Storage, API, UI, and aggregation switch exhaustively on this union. Unknown future
values make the artifact corrupt rather than rendering as another state.

### 6.5 R calculations

`plannedRisk = candidateEntry - stop`. After entry:

```text
actualRisk = entryFill - stop
realizedR  = (exitFill - entryFill) / actualRisk
markR      = (horizonClose - entryFill) / actualRisk
```

`actualRisk` must be finite and strictly positive. `realizedR` exists only for
`stop_hit` and `target_hit`. `markR` exists only for `horizon_expired` with a finite
day-60 close. A returned all-null day-60 bar yields `horizon_expired` with mark state
`unavailable`; no prior close substitutes. `not_triggered` has no R.

`ambiguous_intraday` stores pessimistic and optimistic result kinds, exit identities,
and exact R values when each branch terminates. An unresolved optimistic branch at
the currently available horizon carries an unavailable bound reason; it is never
converted to zero. Primary exact-outcome aggregates exclude ambiguous cases, while
separate lower/upper-bound aggregates retain their information.

## 7. Artifact schemas, identity, and repository

### 7.1 Storage layout

```text
.dexter/research/strategy-validation/
  runs/<runId>/
    run.json
    cases/<caseId>.json
    sources/<sourceDigest>.json
  jobs/<jobId>.json
```

`runId`, `caseId`, and `jobId` are lowercase canonical UUIDv4 values. URL and
filesystem schemas reject separators, dot-segments, encoded traversal, mixed case,
non-canonical UUIDs, and overlong inputs before path resolution. Every resolved path
must remain under the configured research root. The configured root is server-side
only and is never returned to the Browser.

### 7.2 Case artifact

`StrategyValidationCaseV1` is first discriminated by:

```text
anchor_unavailable | candidate
```

`anchor_unavailable` represents a valid requested anchor for which no candidate can
be produced or audited, for example missing source history, invalid resistance
evidence, `strategy === null`, an invalid Snapshot Strategy date, or null required
technical input. It contains the anchor/selector identity, confidence, exact
unavailable reason, applicable evidence digests, and versions, but no invented
candidate, candidate identity, price, fill, or R field.

`candidate` is then discriminated by the Section 6 result union. It contains:

- `schemaVersion: "strategy_validation_case_v1"`;
- case/run identity, mode, confidence, ticker, anchor/decision dates, and the exact
  Snapshot `strategyDataDate` when applicable;
- Snapshot ID/schema/digest or campaign manifest digest, as applicable;
- technical/Strategy/tick/source-contract, candidate-generation, daily-fill, and
  limit-queue version literals; `candidateGenerationPolicy` is `null` for Snapshot
  audit and exactly `technical_251_strategy_v1` for campaign mode;
- exact `candidateIdentityVersion`, canonical `candidateId`, and zero-based duplicate
  ordinal from Section 5.4;
- exact entry, stop, and target values and reason literals;
- tick category/effective date, per-level tick, and executability state;
- resistance evidence tier and `resistanceEvidenceSnapshotDigests`: empty for
  Snapshot audit and campaign 2R, otherwise only the campaign evidence digests mapped
  to that exact resistance target price;
- frozen `startedAt`, entry-wait and holding-window boundaries, plus the official
  `outcomeAsOfSession`; `null` is allowed only for an exact source-free local
  Snapshot anchor failure or a causal calendar-incomplete anchor;
- independent `entryProven` plus exact entry fill identity when true;
- result union, exact fill/mark dates and prices, planned/actual risk, R values,
  ambiguity bounds, and unavailable reasons;
- for `limit_queue_ambiguous` only, exact date, order side, selected fill price,
  boundary kind/price, and source flag; and
- ordered unique source-envelope digest references.

It does not contain a report body, raw prompt/response, API key, HTTP header, request
ID, absolute path, or unnormalized source body. Snapshot report text is not copied.

An anchor-level failure produces exactly one `anchor_unavailable` case. Once
candidates are frozen, each candidate produces exactly one `candidate` case even if
its outcome is unavailable. An anchor never mixes an anchor-level failure with
candidate cases.

### 7.3 Run artifact

`StrategyValidationRunV1` contains:

- `schemaVersion: "strategy_validation_run_v1"`;
- run ID, mode, confidence, campaign-normalized name or `null` for Snapshot mode,
  frozen `startedAt`, required CLI/Dashboard `acceptedAt`, execution deadline,
  completion timestamp, derived `outcomeAsOfSession` (`null` only for an exact
  zero-attempt source-free local Snapshot failure or an attempted calendar-incomplete
  boundary failure), and producer version;
- exact input selector and canonical Snapshot or manifest digest;
- source/technical/Strategy/outcome/tick/aggregation version literals and the same
  mode-constrained `candidateGenerationPolicy` value as every referenced case;
- the exact `aggregationScope` from Section 8.1;
- ordered case IDs and case digests;
- aggregate strata and metrics from Section 8;
- counted request attempts, cache hits, duration, frozen execution controls including
  `minimumDispatchDurationMs`, and termination state; and
- warnings that describe reconstruction vintage, the fixed 251-session policy and
  its non-production-parity boundary, resistance tier, ambiguity, and unavailable
  coverage without making an investment claim.

`runPayloadDigest` is the `SnapshotDigest` of the complete validated `run.json`
payload under `CanonicalJsonV1`; it is not embedded in `run.json`, avoiding a
self-referential digest. The repository recomputes it after rereading the assembled
payload and stores it as `expectedRunPayloadDigest` in the publishing job record.
Case and source digests remain independently validated before this run-level digest
is accepted.

Only a complete run is published. A failed, timed-out, or cancelled execution does
not publish a partial `run.json` or cases. Diagnostic information belongs in the job
artifact or sanitized CLI error, not a research result.

### 7.4 Atomic create-only publication

A run is assembled under a sibling temporary directory with a random non-secret
name. Every JSON file is strictly serialized, reread, schema-validated, and digested;
files are closed and the directory is atomically promoted without replacing an
existing run. If the platform cannot guarantee no-replace publication, the operation
fails with a typed persistence error. Temporary directories are removed on handled
failure/cancel and on startup recovery when safely attributable to this repository.

Rerunning equal input creates a new run ID. Content digests expose equality; no run
ID is reused and no `latest` alias is created. Existing artifacts are never mutated.
Malformed JSON, unsupported versions, digest mismatch, missing referenced cases or
sources, identity mismatch, and filesystem failures are surfaced; listing never
silently skips corruption.

### 7.5 Source placement and deduplication

Each run is self-contained: `sources/<sourceDigest>.json` contains every normalized
source envelope referenced by a case in that run. Equal source content within a run
is written once. Cross-run hard-linking or a mutable global cache is not required in
version 1. An implementation may use an in-memory request cache during one job, but
the run must not depend on it after publication.

The filename uses only the lowercase hex portion after `sha256:`. The envelope body
retains the prefixed digest. Loader recomputation must match both.

### 7.6 Job artifact

`StrategyValidationJobV1` is the only mutable Phase 4 artifact. It stores no source
rows or secrets and is rewritten atomically. Job creation reserves a UUIDv4
`runId` before any collection. Every state stores job ID, reserved run ID, exact
input digest, frozen `startedAt`, required `acceptedAt`, execution deadline, frozen
execution controls including `minimumDispatchDurationMs`, status, timestamps,
sanitized progress counts, and cancellation state. Once derived, it also
stores `outcomeAsOfSession`; `publishing` and `completed` additionally store
`expectedRunPayloadDigest`. Its status is one of:

```text
preparing
collecting
validating
publishing
completed
failed
cancel_requested
cancelled
interrupted
```

Allowed transitions are:

```text
preparing -> collecting | cancel_requested | failed | interrupted
collecting -> validating | cancel_requested | failed | interrupted
validating -> publishing | cancel_requested | failed | interrupted
publishing -> completed | failed | interrupted
cancel_requested -> cancelled | failed | interrupted
```

Transitions to `interrupted` occur only during startup reconciliation, never during
a live process.

Before promotion, the job is atomically rewritten as `publishing` with its reserved
run ID and `expectedRunPayloadDigest`. Only then may the matching temp directory be
promoted to `runs/<runId>`. `publishing` is not interruptible once promotion starts.
After promotion the job is atomically rewritten as `completed` without changing
that digest.

Startup reconciliation is status-specific:

1. `preparing`, `collecting`, `validating`, or `cancel_requested` becomes
   `interrupted`, and only its attributable temp directory is cleaned. A final run at
   its reserved ID is an invariant failure and is not deleted.
2. For `publishing`, load the reserved final path. If it is absent, clean the temp
   directory and mark `interrupted`. If it exists and its complete schema, internal
   references, input identity, run ID, and recomputed `runPayloadDigest` all equal
   the job's expected values, atomically finalize the job as `completed`. If it
   exists but any
   validation differs, mark the job `failed` with sanitized `artifact_unavailable`,
   retain the suspect directory, and surface repository corruption.
3. `completed`, `failed`, `cancelled`, and `interrupted` are not resumed or rewritten
   except by normal validated reads.

Thus a crash after promotion but before the completion rewrite recovers the exact
published run instead of orphaning it. Completed jobs reference exactly one validated
run ID. Cancelled/interrupted jobs have no final run. Failed jobs may retain only the
suspect final directory from the corruption branch above and expose a fixed sanitized
code/message, counts, and timestamps.

## 8. Aggregation and interpretation

### 8.1 Mandatory strata

Every run persists this aggregation scope:

```ts
type StrategyValidationAggregationScopeV1 =
  | Readonly<{
      scopeVersion: 'strategy_validation_aggregation_scope_v1';
      kind: 'snapshot_ticker';
      tickers: readonly [CanonicalTicker];
      tickerCount: 1;
      requestedAnchorCount: 1;
    }>
  | Readonly<{
      scopeVersion: 'strategy_validation_aggregation_scope_v1';
      kind: 'campaign_global';
      tickers: readonly CanonicalTicker[];
      tickerCount: number;
      requestedAnchorCount: number;
    }>;
```

`tickers` is the nonempty, sorted unique canonical ticker set; `tickerCount` must
equal its length. Snapshot mode always uses `snapshot_ticker`. Campaign mode always
uses `campaign_global`, including a one-ticker campaign, and
`requestedAnchorCount` equals the manifest's accepted anchor count. The run's ticker
scope is exactly `aggregationScope.tickers`. Scope `requestedAnchorCount` must equal
the Section 8.2 track-level value; any mismatch makes the run corrupt.

Aggregation has two levels. Track-level anchor coverage is calculated once for the
run's mode/confidence and includes every requested anchor, including
`anchor_unavailable`. It is never partitioned by candidate-only dimensions.

Candidate-level outcomes are separately partitioned by all applicable values of:

- confidence (`precommitted` or `reconstructed_251_as_of`);
- target reason (`risk_reward_2R` or `resistance_level`);
- stop reason (`latest_swing_low` or `entry_minus_1_5_atr`); and
- resistance evidence tier (`none` or `precommitted_source_unknown`).

No single all-candidate win rate or R value is emitted. Snapshot-audit and campaign
cases are never combined. Duplicate candidates remain counted and their duplicate
count is visible. An `anchor_unavailable` case is represented only at track level;
it is neither omitted, replicated into candidate strata, nor assigned null
target/stop/resistance dimensions.

All campaign track metrics and candidate strata are calculated once across every
ticker and anchor in the run: they are campaign-global, not statistics for the
Dashboard's current ticker. Ticker is deliberately not an aggregation stratum in
version 1. No persisted per-ticker aggregate, ticker-aggregate API, or Browser-side
derivation from cases exists. Within a selected run, the case-list ticker filter
changes only which case items are returned; it never changes `aggregationScope` or
any persisted aggregate.

### 8.2 Metrics

Track-level metrics are exactly:

```text
requestedAnchorCount
anchorUnavailableCount
candidateBearingAnchorCount
enteredAnchorCount
anchorCoverage = candidateBearingAnchorCount / requestedAnchorCount
eligibleAnchorEntryRate = enteredAnchorCount / candidateBearingAnchorCount
requestedAnchorEntryRate = enteredAnchorCount / requestedAnchorCount
```

`candidateBearingAnchorCount` counts unique requested anchors with at least one
`candidate` case. `anchorUnavailableCount` therefore equals requested minus
candidate-bearing anchors. `enteredAnchorCount` counts unique candidate-bearing
anchors for which at least one candidate has `entryProven === true`.

Every candidate case persists `entryProven` independently of later outcome
availability. It is true only when a valid entry fill and its exact date/price are
provable before any later failure. A later corporate-action or history failure may
leave it true; `entry_gap_beyond_target`, an unproven limit-queue fill, invalid
candidate, and no trigger leave it false. Zero denominators produce an explicit
unavailable ratio, never zero.

Track level also records `anchorUnavailable` counts/rates by exact reason, using
`requestedAnchorCount` as denominator. Multiple candidates and multiple strata from
one anchor never duplicate the track-level anchor counts.

For every candidate stratum the run records integer numerators and denominators for:

- `candidateAnchorCount`: unique candidate-bearing anchors represented in the stratum;
- `enteredCandidateAnchorCount` and
  `stratumAnchorEntryRate = enteredCandidateAnchorCount / candidateAnchorCount`;
- candidate count and entered-candidate count;
- `not_triggered`, `stop_hit`, `target_hit`, `horizon_expired`,
  `ambiguous_intraday`, and `unavailable` counts/rates;
- exact realized-R count, arithmetic mean, and median;
- horizon mark-R count, arithmetic mean, and median; and
- pessimistic/optimistic ambiguous-bound counts, means, and medians when defined.

`enteredCandidateAnchorCount` counts unique anchors with at least one
`entryProven === true` candidate in that stratum. Every outcome-state rate uses
candidate count as its denominator. Candidate strata do not expose a metric named
`anchorCoverage`; `stratumAnchorEntryRate` describes entry among anchors already
eligible for that stratum and must not be presented as population coverage.

Rates always name their denominator. Unavailable and ambiguous rows never enter the
exact realized-R denominator. Valid zero and negative R remain values. Empty metric
sets are an explicit unavailable state, not zero. Median uses the deterministic
midpoint of the two central values for an even count. All calculations use finite
numbers, ascending Section 5.4 `candidateId` order for summation, and a versioned
stable sort; negative zero is serialized as zero and non-finite aggregate output
fails validation.

These descriptive metrics have no significance test, confidence claim, PASS/FAIL,
P&L, cost-adjusted result, or recommendation. The UI must put coverage and unavailable
rates from track level before candidate-stratum target/stop rates so selection and
data limitations are visible.

## 9. External-fetch execution controls

### 9.1 Rate, attempts, retries, and timeout

The default rate is 5 actual request attempts per rolling minute. An optional
`JQUANTS_REQUESTS_PER_MINUTE` accepts only an integer from 1 through 500; missing uses
5, and malformed/out-of-range configuration fails before preflight. The value is
resolved once for an invocation/server process, frozen into preflight execution
controls, and inherited unchanged by the accepted job. All original, pagination,
and retry HTTP attempts consume both rate and campaign-attempt budgets.

The limiter version is `rolling_attempt_log_v1`. It uses monotonic elapsed time and
retains exactly the prior attempt timestamps whose age is less than 60,000 ms. A new
attempt may dispatch only when the retained count is below the configured rate;
otherwise it waits until the oldest retained timestamp reaches age 60,000 ms. The
initial log is empty, so at most `rate` attempts may form the initial burst. Wall-clock
UTC timestamps are persisted for audit but never drive limiter arithmetic.

Every accepted CLI invocation and Dashboard job records required `acceptedAt` before
any external dispatch. Its execution deadline is exactly
`acceptedAt + 5,400,000 ms`. One invocation/job permits at most 250 actual attempts
and no attempt may begin at or after that deadline. Each HTTP attempt has a 30-second
timeout clamped to the remaining execution budget. There are at most two retries
after the first attempt, only for network errors, HTTP 429, or HTTP 5xx. HTTP 4xx
other than 429, schema errors, plan restrictions, and logical/data errors are not
retried.

The runtime captures a monotonic budget origin at the same operation that records
`acceptedAt`; elapsed monotonic time enforces the 5,400,000 ms budget, while the UTC
deadline is audit/display metadata. A wall-clock adjustment cannot extend or shorten
execution.

`Retry-After` accepts only a non-negative integer number of seconds or a valid HTTP
date. It is honored when it falls within the remaining 90-minute budget; a value
beyond the budget terminates the job without another attempt. Missing or malformed
`Retry-After` uses deterministic delays of 1 second before retry one and 2 seconds
before retry two, with no jitter. Timeout or cancellation always takes precedence
over a scheduled retry.

The deadline is checked before every limiter wait, dispatch, calculation/validation
phase, and transition into `publishing`. Reaching it earlier aborts the unpublished
run with a typed timeout. Once atomic promotion has begun, Section 7.6 recovery rules
take precedence and publication is not interrupted; no external request can occur in
that final noninterruptible interval.

The existing interactive J-Quants client is not silently changed globally. P4-I1
either adds these controls behind a compatible optional transport or creates the
dedicated adapter on top of the existing credential/error primitives.

### 9.2 Request planning and cache

Preflight computes `estimatedMinimumAttempts` (`N`) from unique initial
endpoint/query pairs after same-job deduplication and returns
`hardMaximumAttempts: 250`. It does not contact J-Quants and does not guess actual
page count. Using the frozen rate `R`, it derives the earliest possible dispatch time
of the last minimum attempt under `rolling_attempt_log_v1`:

```text
minimumDispatchDurationMs =
  N === 0 ? 0 : floor((N - 1) / R) * 60_000

minimumScheduleFeasible =
  N <= 250 && minimumDispatchDurationMs < 5_400_000
```

Equality with 5,400,000 ms is infeasible because the last attempt would begin at the
deadline. At 1/minute, 90 minimum attempts are exactly feasible and 91 are rejected;
at 2/minute, the boundary is 180/181. At the default 5/minute, the 250-attempt hard
cap is stricter than the dispatch-time bound.

Preflight returns `rateLimitVersion`, `requestsPerMinute`,
`minimumDispatchDurationMs`, the fixed timeout/deadline/attempt caps, and
`estimatedMinimumAttempts`. If `minimumScheduleFeasible` is false, CLI and API reject
with typed `external_schedule_infeasible` before showing or accepting external-fetch
confirmation and create no job/run. The accepted job copies these exact execution
controls and the eventual run persists them; runtime must not reread or substitute a
different rate model/configuration.

This check rejects work proven impossible even with zero network latency. It does
not promise completion: pagination, retries, response latency, calculation, or
persistence may still exhaust the runtime cap. Those limitations remain in the
visible warning. Pagination and retries may raise the actual count above the minimum
but can never pass the attempt or wall-clock cap.

Within one job, identical normalized endpoint/query pairs share one in-flight or
completed response. A cache hit does not count as an attempt. Failed responses are
not cached across retries. There is no cross-process or indefinite source cache in
version 1.

### 9.3 Cancellation and failure publication

Cancellation aborts the current fetch, prevents retries, stops new calculation, and
cleans unpublished temporary data. Source errors are mapped to the fixed unavailable
reason vocabulary where a complete case can still be described. A transport,
persistence, internal invariant, timeout, attempt-cap, or cancellation failure that
prevents a complete run aborts the entire run; Phase 4 never publishes a partial
campaign.

Normal CI and browser tests use deterministic stubs and make zero external calls.
The live source smoke is manual, default-No, uses at most 10 actual attempts, prints
no response body or credential, and is not a substitute for unit/integration tests.

## 10. Local API and Dashboard contract

### 10.1 Tab and URL state

P4-D1 appends, without reordering the first five tabs:

```text
validation / 戦略検証
```

The canonical detail query is:

```text
?ticker=<ticker>&tab=validation&validationRun=<runId>&validationCase=<caseId>
```

`validationRun` and `validationCase` are optional as a pair hierarchy: case requires
run; run may stand alone. Malformed, duplicate, or orphaned parameters show a scoped
error and are not repaired. There is no automatic run selection, `latest` fallback,
or auto-open after a job completes. Explicit user selection uses History API state;
Back/Forward and reload restore the exact valid selection. Ticker/list navigation
removes run/case state. A run whose ticker scope excludes the current ticker is not
adopted. A deep-linked case whose persisted ticker differs from the current ticker
shows a scoped selection error and is not rendered under that stock page.

Latest-request-wins guards all list, run, case, job, and Snapshot transitions.
Stale responses and abort errors cannot overwrite newer content or move focus.
Keyboard tab navigation, returned-focus destination, loading announcements, and
320/768/1280 px document-level overflow follow the inherited Dashboard contract.

### 10.2 Read API

```text
GET /api/strategy-validation/runs?ticker=<ticker>&cursor=<cursor>&limit=<limit>
GET /api/strategy-validation/runs/:runId
GET /api/strategy-validation/runs/:runId/cases?ticker=<ticker>&cursor=<cursor>&limit=<limit>
GET /api/strategy-validation/runs/:runId/cases/:caseId
GET /api/strategy-validation/jobs/active
GET /api/strategy-validation/jobs/:jobId
```

List default is 20 and maximum is 100. Limits must be canonical base-10 integers.
Cursors are the unpadded base64url encoding of `CanonicalJsonV1` containing a version
literal, route kind, normalized filter digest, and the last complete sort tuple. They
are at most 1,024 ASCII bytes. Decode/schema/canonical-reencode mismatch, malformed,
duplicate, or cross-query cursors are 400. Runs sort by `completedAt desc, runId asc`.
Cases sort by `ticker asc, anchor/decisionDate asc, caseKind asc` with
`anchor_unavailable` before `candidate`, then the nullable Section 5.4 `candidateId`
ascending. The null sentinel applies only to `anchor_unavailable` and sorts before
all candidate IDs. Pagination has no duplicate or omission at equal sort keys.

The run and case lists each accept zero or one canonical `ticker`; the case filter
must also belong to the selected run's ticker scope. Unknown query parameters or
duplicate singleton parameters are 400. Loaders revalidate all referenced artifacts;
corruption is 500 and is never silently skipped. A run/case identity mismatch is 500,
not 404.

The run-list ticker filter includes a run exactly when
`aggregationScope.tickers` contains that ticker. The case-list ticker filter returns
only cases whose persisted ticker equals it. Run summaries include the validated
`aggregationScope`; `GET /runs/:runId` always returns the persisted run and its
campaign-global aggregates unchanged. Neither read route calculates a per-ticker
rate from cases. Case detail is an exact artifact read and the Dashboard separately
enforces the current-ticker selection rule above.

List successes are exactly:

```ts
interface StrategyValidationListResponseV1<T> {
  schemaVersion: 'strategy_validation_list_v1';
  items: T[];
  nextCursor: string | null;
}
```

Run and case detail return the validated persisted artifact directly. Job reads
return a sanitized `StrategyValidationJobViewV1`; `/jobs/active` returns
`{ schemaVersion: "strategy_validation_active_job_v1", job: JobView | null }`.
Summaries never include source rows or the absolute repository root.

### 10.3 Session and mutations

```text
GET    /api/session
POST   /api/strategy-validation/preflights
POST   /api/strategy-validation/jobs
DELETE /api/strategy-validation/jobs/:jobId
```

`GET /api/session` returns exactly
`{ schemaVersion: "dashboard_session_v1", csrfHeader: "X-Dexter-CSRF", csrfToken }`.
The token is 32 cryptographically random bytes encoded as unpadded base64url. It
returns no API credential, filesystem path, environment value, or external-provider
capability detail. The token rotates on process restart, is held only in Browser
memory, and is sent as `X-Dexter-CSRF` on every POST/DELETE.

All mutation requests require:

- exact allowed `Host` and exact same-origin `Origin` matching the request scheme,
  host, and port;
- no CORS response headers;
- media type `application/json` for POST, with no parameter or only
  `charset=utf-8` (case-insensitive); any other media type/charset is 415;
- valid `X-Dexter-CSRF` using constant-time comparison;
- a body length limit checked before JSON parsing; and
- strict JSON with duplicate keys and unknown fields rejected.

The UTF-8 request-body caps are 1,100,000 bytes for preflight and 4,096 bytes for job
creation. DELETE must have zero body bytes. Chunked bodies are counted while reading
and aborted at the same caps; `Content-Length` is not trusted by itself.

The preflight body is exactly one of:

```json
{ "mode": "snapshot", "ticker": "7203", "snapshotId": "..." }
```

```json
{ "mode": "campaign", "manifest": { "schemaVersion": "strategy_validation_campaign_v1", "name": "...", "anchors": [] } }
```

The successful response includes a UUIDv4 preflight ID, frozen `startedAt`, the
conservative outcome-session rule, normalized input digest, counts,
`estimatedMinimumAttempts`, `minimumDispatchDurationMs`, `rateLimitVersion`,
`requestsPerMinute`, `hardMaximumAttempts`, request/deadline timeouts, warnings, and
`expiresAt`. Schedule infeasibility returns the typed 400 before a preflight ID or
confirmation surface exists. A successful preflight performs local validation only
and expires after 10 minutes. It is one-time: accepting a job consumes it atomically
and records `acceptedAt`. Expired, already-used, mismatched, or process-restart
preflights cannot start a job. Preflights live only in bounded process memory and are
never written under `.dexter`.

The job body is exactly:

```json
{ "preflightId": "...", "confirmExternalFetch": true }
```

The boolean must literally be true. Server recomputes the normalized input digest
and refuses any mismatch. One global nonterminal job is allowed. Accepted creation
returns 202 with the job identity/status URL. The Browser never supplies or receives
`JQUANTS_API_KEY`.

DELETE has no body. It is idempotent only while the identified job is
`cancel_requested` or `cancelled`; completed/failed/interrupted/publishing jobs return
409 because cancellation cannot change them. Missing job is 404. Cancellation
returns 202 until terminal, then 200 for an already-cancelled job.

### 10.4 HTTP status and failure union

Phase 4 domain responses use these statuses:

| Status | Meaning |
| ---: | --- |
| 200 | successful read/preflight or already-cancelled response |
| 202 | job accepted or cancellation accepted |
| 400 | malformed route/query/body/schema/selector/cursor |
| 403 | Host, Origin, or CSRF failure |
| 404 | exact run/case/job/Snapshot not found |
| 409 | active-job conflict, stale/used preflight, invalid lifecycle action |
| 413 | body exceeds the route limit |
| 415 | unsupported media type |
| 500 | artifact corruption, filesystem failure, or internal invariant failure |

Every response is a strict success or `{ "error": { "code", "message" } }` union,
uses `Cache-Control: no-store` and `X-Content-Type-Options: nosniff`, and never embeds
raw exception text. Unsupported methods return 405 with exact `Allow`; 405 is the
inherited routing response outside the domain-status table.

The closed public error-code mapping is:

| Status | Codes |
| ---: | --- |
| 400 | `invalid_route_parameter`, `invalid_query`, `invalid_cursor`, `invalid_json`, `invalid_request`, `external_schedule_infeasible` |
| 403 | `forbidden_host`, `forbidden_origin`, `csrf_failed` |
| 404 | `snapshot_not_found`, `run_not_found`, `case_not_found`, `job_not_found` |
| 409 | `active_job_conflict`, `preflight_expired`, `preflight_consumed`, `preflight_mismatch`, `invalid_job_transition` |
| 413 | `payload_too_large` |
| 415 | `unsupported_media_type` |
| 500 | `artifact_unavailable`, `internal_failure` |

Internal source/provider detail stays in typed server-side control flow and is not
appended to these messages.

### 10.5 Dashboard operation and presentation

The tab offers two explicit forms:

- a saved Snapshot selector constrained to the current ticker; and
- a client-side JSON file picker that reads at most 1,048,576 bytes, applies the same
  UTF-8/BOM/duplicate-key/strict-schema parser as CLI before ordinary object
  serialization, and sends only the validated manifest value, never a local path.

The flow is `local preflight -> visible request/cost/time warning -> unchecked
confirmation -> start -> poll every 2 seconds -> explicit open-results action`.
Changing the form invalidates the prior preflight and clears confirmation. Refresh
during a job recovers `/jobs/active`; it does not auto-resume an interrupted server
job. There is no scheduled run, automatic execution, or hidden external request.

Only the three Phase 4 query keys receive Phase 4 validation. Existing unrelated
query-key preservation remains unchanged. Ticker/list navigation removes Phase 4
keys but does not opportunistically delete unrelated preserved keys.

The warning states that the job transmits ticker/date selectors to the configured
J-Quants account and may consume subscription quota. It shows the estimated minimum
attempts, `minimumDispatchDurationMs`, 90-minute execution budget, rate, and the fact
that the feasibility lower bound excludes pagination/retries/latency. It does not
fabricate a per-call monetary estimate when the configured plan has no verified
per-call price contract.

Run and case views present semantic tables before decorative charts. They show
confidence, coverage, candidate-generation policy, reconstruction-vintage and
non-production-parity warnings, resistance tier, source dates, candidate/fill facts,
tick validity, exact/unavailable/ambiguous state, and named denominators. Ambiguity
bounds are visually and semantically distinct from exact R. No PASS badge, score,
ranking, color-only direction, or Buy/Sell wording is allowed.

For `campaign_global`, every aggregate table/chart is headed exactly
`キャンペーン全体（{tickerCount}銘柄・{requestedAnchorCount}基準日）` and displays
this adjacent warning with the canonical current ticker substituted:
`集計値はキャンペーン全体です。表示中の銘柄は{ticker}ですが、ケース一覧だけがこの銘柄に絞り込まれています。`
The Dashboard always requests the case list with its current ticker and permits only
matching case detail. Run metadata and persisted aggregates remain campaign-global;
changing the case filter cannot change them. No aggregate label may name the current
ticker as its population, and React must not derive a ticker-specific count, rate,
mean, median, or bound from the filtered cases. A one-ticker campaign keeps the same
campaign-global label and rule.

Tables remain usable with keyboard and screen reader, status changes use an
appropriate live region, focus moves only after explicit navigation or a scoped
validation error, and charts (if any) are supplemental to exact accessible tables.

## 11. Implementation sequence and Merge Gates

Each step begins only after the prior PR's exact head passes independent review and
CI, is merged, and local `main` is fast-forwarded. Every implementation PR runs at
least `bun test`, `bun run typecheck`, and `git diff --check`; Browser steps also run
the repository Playwright suite.

1. **P4-0 — Source of Truth and detailed design**
   - update `docs/SPEC.md`;
   - add this normative plan and non-normative handoff;
   - change no runtime, dependency, Snapshot, API, Dashboard, Usage, or setup file.
2. **P4-I0 — Pure point-in-time primitives**
   - date/cutoff types, calendar arithmetic, t0 adjustment, tick resolver,
     source-envelope schemas/digests;
   - no network or repository writer.
3. **P4-I1 — J-Quants validation adapter and feasibility gate**
   - strict endpoint mappers, versioned rolling-window limiter, minimum-schedule
     feasibility, retry/timeout/cancel/attempt controls;
   - stubbed integration plus a manual live smoke;
   - must prove at least one matured anchor has usable calendar, master, raw OHLC,
     `UL/LL`, `AdjFactor`, and `ExRT` under the configured plan before P4-V1.
4. **P4-V1 — Pure outcome validator**
   - maturity, daily fills, gaps, no-trade rows, limit ambiguity, dual-touch branches,
     corporate actions, exact R and bounds;
   - no I/O.
5. **P4-R1 — Manifest, immutable run repository, and aggregation**
   - strict manifest/preflight schemas, cases/runs/sources, atomic create-only publish,
     corruption handling, and strata.
6. **P4-S1 — Saved-Snapshot audit CLI**
   - exact Snapshot selection/digest, all persisted candidates, confirmation,
     source collection, run publication.
7. **P4-C1 — Historical reconstruction CLI**
   - distinct `technical_251_strategy_v1` input policy, t0 normalization, reused
     Engine algorithms, evidence-qualified resistance, candidate freezing, outcome
     collection, and explicit non-production-parity labeling.
8. **P4-J1 — Local job and security API**
   - process CSRF, preflight, one job, polling, cancel, startup interruption,
     GET repositories and exact HTTP mapping.
9. **P4-D1 — Dashboard Strategy-validation tab**
   - sixth tab, forms, explicit confirmation, job progress, run/case URL state,
     accessible exact tables, responsive/race/focus behavior.
10. **P4-X — Usage, setup, handoff, and closeout**
    - CLI/Dashboard operation, J-Quants limits/configuration, manual smoke evidence,
      full validation, no-score/no-signal regression, and final handoff.

P4-I1 feasibility failure is an accepted stop outcome. Do not implement a fallback
source, relax source semantics, or continue dependent runtime steps without a new
reviewed plan and user decision.

## 12. Step validation matrix

| Step | Mandatory focused validation |
| --- | --- |
| P4-0 | Source of Truth agreement; predecessor docs unchanged; no runtime/dependency/Snapshot/UI diff |
| P4-I0 | strict dates/time zones; future-row isolation; official-session arithmetic; every non-null `outcomeAsOfSession` strictly before started Tokyo date; null/no-row distinction; cumulative factor boundaries and rounding golden vectors; corporate-action flags; all tick bands/dates/categories; decimal executability; canonical source digest; input immutability |
| P4-I1 | exact endpoint/query/field schemas; `ProdCat`; master/date identity; pagination duplicate/repeat; same startedAt before/after same-day publication yields identical accepted outcome rows; `rolling_attempt_log_v1` monotonic scheduling; `minimumDispatchDurationMs` at 1/min, 2/min, default 5/min, exactly feasible, and one-attempt-over boundaries; preflight/runtime frozen-control parity; 4xx/429/5xx/network retry matrix; `Retry-After`; rate and 250-attempt accounting; required `acceptedAt`; 30s/90m deadline; abort priority; no secret/body logging; stub CI; manual <=10-attempt matured-anchor smoke |
| P4-V1 | t1/t20/t60/t79 boundaries; no-trade sessions; every entry/open/threshold gap branch; entry-bar stop-only with `C <= stop`, `stop < C < target`, target-only, and dual-touch vectors; `UL=1/LL=0` with deterministic lower stop; `LL=1/UL=0` with deterministic upper-side fill; buy-entry exactly at flagged `H`; sell-stop exactly at flagged `L`; same flags with fill strictly inside the boundary; gap/open and entry-bar limit-bound variants; precedence over intraday bounds; all corporate-action boundaries; invalid ticks/candidates; immature outcomes; actual-risk zero; exact/mark/ambiguous R; no input mutation |
| P4-R1 | 1 MiB/UTF-8/duplicate keys/strict fields; required/absent/mismatched `limitQueueEvidence`; closed unavailable-reason schema including `strategy_data_date_invalid`; 1/500 anchors; duplicate anchor; 0/8 refs; 16 resistance dedup; UUID/path containment; canonical manifest/case/run/source digests; both candidate-identity golden envelopes; same tuple across anchors/tickers, true duplicate ordinals, and equal rerun IDs/order despite new run/case UUIDs; atomic no-replace and temp cleanup; rerun new ID; corruption never skipped; track-level all-anchor coverage and candidate-stratum denominators with mostly-unavailable/multi-stratum fixtures; multi-ticker campaign whose global and per-ticker rates differ while only global aggregates persist |
| P4-S1 | V1-V9 exact history load; ticker/ID/digest; no latest fallback; generatedAt Tokyo date; stored candidates paired with `strategy.dataDate` null, malformed/non-Gregorian text, impossible date, proven non-session date, valid date, future session/non-session dates, and incomplete calendar coverage; exact `strategy_data_date_invalid`/`future_strategy_data`/`calendar_incomplete` precedence; reason-specific local/calendar stage identity rejects source-free parsed-date invalidity, source-free post-calendar candidate invalidity, and source-backed future dates; local invalid/future branches use zero attempts, zero source refs, and null boundary even when the preceding Gregorian date is a weekend/holiday; incomplete calendar publishes one null-boundary anchor with one causal unavailable calendar envelope and no Master/daily request; every other Snapshot plans at least the calendar attempt; proven non-session precedes nonnormalizable candidate; official-session relationally invalid candidate remains a candidate case with `unavailable/invalid_candidate`; no Master/daily-bar fetch for that case; all stored 2R/resistance and duplicates; `snapshot_candidate_identity_v1` stability after date validation; default-No/noninteractive confirmation; error/cancel no run |
| P4-C1 | exact `technical_251_strategy_v1` t0-bounded sessions; adding older rows outside the final 251 leaves reconstruction unchanged; differential >251-bar fixture where full-history production input retains an older latest Swing/candidate but the 251 policy does not; `reconstructed_251_as_of` and non-production warning; no current AdjOHLC/future influence; missing OHLC/no candidate; same Engine code/reasons/defaults with no input-window parity claim; entry-tick injection and per-level validation; resistance Snapshot generatedTokyoDate guard before extraction; only persisted `resistance_level` target prices; raw-to-Engine-target evidence mapping including normalization collisions and candidate-specific digests; ticker/dataDate/digest; resistance tiers; `campaign_candidate_identity_v1`; latest t20 entry through holding day60 |
| P4-J1 | Host/Origin/CSRF; token restart/constant-time check; JSON/media/body limits; frozen preflight startedAt/execution controls; `external_schedule_infeasible` before preflight ID/confirmation; expiry/one-time/digest mismatch; one global job; every lifecycle transition; crash before promotion, after promotion/before completion rewrite, and after completion; reconciliation digest/identity/corruption; cancel during wait/fetch/validate/publish; 200/202/400/403/404/409/413/415/500 and inherited 405; canonical candidate-ID pagination ties; run ticker membership and ticker-filtered cases with unchanged campaign-global aggregate; corruption 500; no credential/path response |
| P4-D1 | six stable tabs/label/order; no auto selection/open; Snapshot picker/file size; minimum attempts/duration/rate/deadline warning before default-No confirmation; `technical_251_strategy_v1` and non-production-parity warning; polling/cancel/recovery; deep link/Back/Forward/reload; invalid/orphan/cross-ticker case URL; ticker/list transitions; latest-request-wins; multi-ticker global-vs-current-ticker fixture with exact campaign-global heading/warning, ticker-filtered cases, and no Browser aggregate derivation or ticker-specific metric label; focus/live region/keyboard; exact tables and ambiguity; 320/768/1280 px; document overflow; Playwright |
| P4-X | full Bun tests/typecheck/diff check/Playwright; manual smoke evidence; CI/review/merge/main; Usage/setup/handoff; absence of Snapshot V10, runtime score, PASS/FAIL, Buy/Sell, external CI, and partial runs |

Fixtures include valid zero, negative R, equality at every price/tick/date boundary,
one value beyond each boundary, malformed and duplicated source identities, no-trade
sessions, Japanese manifest names, and Windows/POSIX path-like attacks. Tests must not
assert only happy-path coverage or incidental serialization whitespace.

## 13. Done conditions

Phase 4 is Done only when:

- P4-0 through P4-X each have an independently reviewed and merged PR in order;
- local `main` is fast-forwarded to the final merged exact head;
- all required unit/integration/Playwright validation and CI pass;
- P4-I1 records a successful bounded manual feasibility smoke, with no credential or
  response body in Git/PR/test output;
- selectors whose minimum dispatch schedule cannot fit the frozen 90-minute budget
  are rejected before external-fetch confirmation;
- Snapshot audit and reconstructed campaign each produce and reload at least one
  matured deterministic fixture/run under their distinct confidence labels, and the
  campaign run is labeled as `technical_251_strategy_v1`, not production replay;
- equal campaign reruns preserve canonical candidate IDs/order despite new publication
  UUIDs, and a multi-ticker run is presented only as campaign-global while its case
  list remains current-ticker scoped;
- cancellation, crash recovery, corruption, no-look-ahead, action, tick, gap, and
  ambiguity failure paths are proven, including same-day publication crossing and
  post-promotion job reconciliation;
- Usage/setup/handoff match the implemented surface; and
- no runtime score, Strategy PASS/FAIL, Buy/Sell signal, partial campaign, Snapshot
  migration, or scheduled external job exists.

If source feasibility fails, the implementation sequence stops at P4-I1 and Phase 4
is not declared Done. The failure and evidence are documented without substituting
another source or weakening the contract.

## 14. Explicitly deferred scope

- all-TSE universe generation or broad cross-sectional backtest;
- portfolio construction, overlapping positions, capital allocation, P&L, fees,
  taxes, dividends, borrow, slippage, liquidity, and order-book simulation;
- minute/tick data, intraday sequence inference, MFE, and MAE;
- source-verified historical resistance producer;
- Strategy V2, per-level re-rounding, or production Strategy-interface changes;
- canonicalizing or migrating the production comprehensive-analysis Technical input
  window, and any claim of campaign/production candidate parity;
- per-ticker campaign aggregates, ticker-stratified outcome statistics, and a
  ticker-aggregate API;
- the 2027 STR-based tick regime;
- exact historical source correction-vintage reproduction;
- composite-score validation execution, runtime score, weights, or adoption;
- Strategy/parameter PASS/FAIL, statistical adoption thresholds, new Buy/Sell/Hold
  signal, ranking, recommendation, or automatic reanalysis;
- scheduled runs, POST polling alternatives, WebSocket/SSE, concurrent job queue,
  distributed workers, or automatic interrupted-job resume;
- Snapshot V10/backfill or writing research results into Analysis Snapshots;
- Evaluator runtime and PDF/export work deferred by Phase 3.

Any deferred item requires its own reviewed plan and must not be inferred from this
plan's types, artifacts, job mechanism, or Dashboard tab.

## 15. Normative external references

The following primary sources were checked on 2026-08-31. P4-I1 must recheck their
current revisions and freeze any code-relevant mapping version before implementation:

- J-Quants daily bars and exact `O/H/L/C`, `UL/LL`, `AdjFactor`, and `ExRT` semantics:
  <https://jpx-jquants.com/ja/spec/eq-bars-daily>
- JPX daily price-limit boundaries and exceptional expansion context:
  <https://www.jpx.co.jp/equities/trading/domestic/06.html>
- J-Quants cumulative adjustment method:
  <https://jpx-jquants.com/ja/spec/eq-bars-daily/adj>
- J-Quants historical master semantics and fields:
  <https://jpx-jquants.com/ja/spec/eq-master>
- J-Quants product category `011`:
  <https://jpx-jquants.com/ja/spec/eq-master/product-category>
- J-Quants official market calendar:
  <https://jpx-jquants.com/ja/spec/mkt-cal>
- J-Quants holiday/session division values:
  <https://jpx-jquants.com/ja/spec/mkt-cal/holiday-division>
- JPX domestic-equity tick tables and announced 2027 regime:
  <https://www.jpx.co.jp/equities/trading/domestic/07.html>
- JPX Mid400 fine-tick start on 2023-06-05:
  <https://www.jpx.co.jp/news/1030/20230309-01.html>
- JPX tick-size Phase III historical start evidence:
  <https://www.jpx.co.jp/news/1030/nlsgeu0000016dib-att/Japanese1.pdf>
- J-Quants CLI model definitions used only as a secondary schema cross-check:
  <https://raw.githubusercontent.com/J-Quants/jquants-cli/main/src/models.rs>

If a source changes or conflicts, the official endpoint/JPX document controls over
the CLI cross-check. Do not silently update a versioned contract: stop, document the
conflict, and review a migration.

## 16. P4-0 delivery boundary

P4-0 changes only `docs/SPEC.md`, this plan, and `docs/PHASE4_HANDOFF.md`. It does not
change `docs/MVP_IMPLEMENTATION_PLAN.md`, `docs/VISUALIZATION_MVP_PLAN.md`,
`docs/DASHBOARD_UX_PLAN.md`, `docs/PHASE3_PLAN.md`,
`docs/PHASE3_SCORE_EVALUATION_PLAN.md`, or `docs/PHASE3_HANDOFF.md`; those preserve
their historical reviewed scope.

P4-0 adds no command, API route, environment variable, dependency, source request,
research directory, Snapshot field, tab, or user-visible runtime behavior. The next
authorized implementation step is P4-I0 only after the exact P4-0 PR head passes the
independent Merge Gate, is merged, and local `main` is fast-forwarded.
