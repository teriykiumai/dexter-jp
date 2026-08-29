# Phase 3 Implementation Plan

**Status:** P3-0 candidate contract for independent review

**Repository baseline:** `b2989cd1f78fc374f433352fd6532a506fb00108`

**Baseline identity:** PR #73 merge; Dashboard UX closeout complete

**Date:** 2026-08-29

## 1. Purpose and authority

This document is the normative implementation plan for Phase 3. P3-0 fixes the
source, ownership, formula, availability, provenance, presentation, and PR-boundary
contracts before runtime implementation begins.

Phase 3 adds four independently useful capabilities:

1. deterministic comparison of two saved analyses;
2. a visual rendering of existing peer percentiles;
3. an independent qualitative review of a saved analysis; and
4. explicit local PDF export of a saved analysis.

An advanced composite investment score is not adopted as a Phase 3 runtime feature.
It requires the Phase 4 validation work identified in `docs/SPEC.md`.

This plan inherits and does not weaken:

- `AGENTS.md` for repository operation and review discipline;
- `docs/SPEC.md` for product and calculation invariants;
- the immutable AnalysisSnapshot V1–V9 contracts established by the Phase 1.5 and
  Phase 2 plans;
- `docs/DASHBOARD_UX_PLAN.md` for the five-tab information architecture and
  Presentation Layer boundary; and
- `docs/REVIEW_POLICY.md` for the Merge Gate.

P3-0 is docs-only. It does not authorize a runtime implementation, Snapshot V10,
an Evaluator call, score, Radar, PDF, or historical-diff endpoint.

## 2. Investigated baseline

### 2.1 Current repository capability

The merged baseline already provides:

- immutable, schema-validated AnalysisSnapshot V1–V9 reads and V9 writes;
- stable Windows-safe history IDs plus `listHistory()` and `loadHistory()`;
- read-only local history metadata and detail API routes;
- seven deterministic peer-comparison positions with direction-normalized
  percentiles;
- a five-tab Dashboard with responsive and accessibility contracts;
- Playwright and local Chromium as existing dependencies; and
- canonical `finalReportMarkdown` stored beside structured Snapshot results.

These are reused before adding new persistence, calculation, routing, or rendering
layers.

### 2.2 Reference implementation research

The public [`raditrejp/dexter-kabu-jp`](https://github.com/raditrejp/dexter-kabu-jp)
repository was inspected only as a non-normative reference. Its separate no-tool LLM
evaluation context and Playwright PDF approach are useful architectural precedents.
Its default-pass behavior after parse failure and its arbitrary multi-axis 0–100
score are explicitly rejected below because they conflict with Dexter JP's missing-
data and deterministic-calculation boundaries.

Playwright's existing Chromium support can create a PDF from a print-oriented page
through [`page.pdf()`](https://playwright.dev/docs/api/class-page#page-pdf). Phase 3
therefore does not add a PDF dependency unless later implementation evidence proves
the existing runtime insufficient.

### 2.3 No new financial source

Phase 3 initially introduces no new EDINET, J-Quants, market-data, or web source.
Every financial value consumed by Phase 3 comes from one or more validated persisted
AnalysisSnapshots. Evaluator narrative review may also receive the selected
Snapshot's stored `finalReportMarkdown`, but Markdown is never a numeric source.

## 3. Cross-cutting Phase 3 contract

### 3.1 Canonical input boundary

The initial Phase 3 input is:

```ts
type Phase3SnapshotInput = Readonly<{
  snapshotId: string;
  snapshot: AnalysisSnapshot; // schema-validated V1 through V9
}>;
```

Rules:

- Load through `AnalysisSnapshotRepository`; do not parse arbitrary JSON in a Phase
  3 feature.
- Preserve the Snapshot's canonical ticker, schema version, generated time, data
  dates, units, provenance, unavailable reasons, and stored values.
- `generatedAt` identifies the analysis run. It is not a substitute for a source
  publication date or section `dataDate`.
- Do not fetch current source data while comparing, reviewing, drawing, or exporting
  a saved Snapshot.
- Do not recover values from prompts, tool arguments, formatted Dashboard text, or
  `finalReportMarkdown`.
- Do not forward-fill, interpolate, infer aggregation, or convert unavailable data
  to zero.

### 3.2 Result ownership

Phase 3 results have separate owners:

| Result | Owner | Persisted in Snapshot | Financial calculation |
| --- | --- | --- | --- |
| History comparison | pure deterministic comparison module | no | deterministic code |
| Peer Radar | Dashboard presentation of stored percentiles | no | none |
| Independent evaluation | versioned evaluator sidecar artifact | no | no financial calculation |
| PDF | local export artifact | no | none |
| Composite score | not adopted | no | prohibited until validated |

AnalysisSnapshot V9 remains the current writer. V1–V9 remain immutable and readable.
Phase 3 must not create V10 merely to store a transient comparison, a visualization,
an AI judgment, or an export path.

### 3.3 Shared state vocabulary

Phase 3 consumers preserve these states:

```ts
type Phase3ValueState =
  | 'available'
  | 'unavailable'
  | 'not_collected';

type Phase3ComparisonState =
  | 'comparable'
  | 'incomparable'
  | 'not_applicable';
```

- `available` includes a valid numeric zero.
- `unavailable` carries the source or calculation reason already present in the
  Snapshot where available.
- `not_collected` includes a field absent from an older Snapshot schema or an
  explicitly uncollected optional section.
- `incomparable` is a separate comparison state used only when both values exist but
  identity, unit, method, date, or period differences make a numeric delta
  misleading.
- `not_applicable` means at least one side is unavailable/uncollected or the metric's
  contract is categorical/record-only and therefore has no numeric delta.

Presentation may translate these terms but must not collapse them.

### 3.4 No score or signal

No Phase 3 feature may create a Buy/Sell signal, attractiveness rank, risk-on/off
classification, threshold label, weighted score, or overall investment score.
Qualitative evaluator findings do not modify deterministic Engine results, Strategy
candidates, scenarios, or the saved report.

## 4. P3-H — Saved-analysis comparison

### 4.1 Decision

**IMPLEMENT.** This is the first Phase 3 runtime capability because the current
repository already persists validated history, and a deterministic comparison adds
value without an external source, LLM, or Snapshot change.

### 4.2 Selection and as-of boundary

- The user selects a base and target `snapshotId` for one canonical ticker.
- Both Snapshots are loaded by the repository and must have identical canonical
  ticker identity.
- The base must have an earlier `generatedAt` than the target. Equal or reversed
  ordering is invalid input, not an automatic swap.
- Comparison order is always `target - base`.
- For a historical comparison cutoff, both saved Snapshots must have
  `generatedAt <= comparisonAsOf`; a newer Snapshot is ineligible.
- When the caller does not supply a historical cutoff, `comparisonAsOf` is the
  target Snapshot's `generatedAt`.
- Source freshness is evaluated from each stored section `dataDate`; no current row
  is fetched and no future source correction is retroactively applied.

### 4.3 Explicit metric registry

P3-H uses an allowlisted metric registry. It must not recursively diff the entire
Snapshot JSON and must not expose newly added fields automatically.

Each registry entry fixes:

```ts
type ComparisonMetricDefinition = Readonly<{
  key: string;
  section: string;
  label: string;
  valueKind: 'number' | 'category' | 'structured_records';
  expectedUnit?: string;
  identityKeys?: readonly string[];
  comparison: 'absolute_delta' | 'from_to' | 'record_identity';
}>;
```

The initial registry is intentionally narrow:

- Valuation: current price, PER, PBR, dividend yield, and revenue CAGR.
- Fundamentals: the latest fiscal observation. A numeric delta is allowed only when
  both observations identify the same fiscal period; otherwise report a period
  change with before/after values and no delta.
- Technical: stored latest Phase 1 and Advanced Technical values plus categorical
  trend as from/to.
- Supply/Demand: stored metric-level values and states.
- Market Correlation: windows keyed by exact period and benchmark identity.
- Sector Benchmark: windows only when sector code, index identity, method, and period
  are unchanged.
- Strategy: stored candidate levels as from/to; numeric deltas require the same
  candidate reason identity.
- Advanced Dividend: fiscal/event observations matched by their stored source
  identity; no inferred fiscal aggregation.
- Volume Profile: POC, VAL, and VAH only when methodology, allocation method, binning
  method, price basis, volume basis, and canonical window definition match.

Initial record-level boundaries:

- Public short-position reports remain separate reporter/fund records. No issuer-
  level delta or sum is calculated.
- Investor-type flows remain their source category hierarchy. No category merge is
  calculated.
- Sector short-selling flow remains sector context. It is never attributed to the
  issuer or combined with public short positions.
- Full Volume Profile bin arrays are not recursively diffed.

Those record sets may receive identity-based added/removed/changed presentation in a
later reviewed P3-H step; their initial omission from numeric deltas is not zero or
no change.

### 4.4 Formula and units

For comparable numeric values only:

```text
delta = targetValue - baseValue
```

- Normalize floating-point negative zero to zero.
- Return an absolute unit delta only; do not calculate percentage change.
- Ratio values remain `ratio`. Presentation may express their delta in percentage
  points without changing the stored delta.
- Percent values use percentage-point delta, not relative percent change.
- Multiples use a multiple delta.
- JPY and share values preserve their existing units.
- Category values use before/after only.
- If units differ or are missing where required, return `incomparable` with no delta.

No favorable/unfavorable interpretation is attached to the sign.

### 4.5 Result shape

```ts
type SnapshotComparisonUnavailableReason =
  | 'snapshot_not_found'
  | 'ticker_mismatch'
  | 'invalid_order'
  | 'after_comparison_as_of'
  | 'unit_mismatch'
  | 'period_changed'
  | 'benchmark_changed'
  | 'method_changed'
  | 'data_date_regressed';

type SnapshotMetricChange = Readonly<{
  key: string;
  section: string;
  label: string;
  unit: string | null;
  baseState: Phase3ValueState;
  targetState: Phase3ValueState;
  comparisonState: Phase3ComparisonState;
  baseValue: number | string | null;
  targetValue: number | string | null;
  baseDataDate: string | null;
  targetDataDate: string | null;
  delta: number | null;
  reason: SnapshotComparisonUnavailableReason | null;
}>;

type AnalysisSnapshotComparisonV1 = Readonly<{
  resultVersion: 1;
  ticker: string;
  base: Readonly<{
    snapshotId: string;
    schemaVersion: number;
    generatedAt: string;
  }>;
  target: Readonly<{
    snapshotId: string;
    schemaVersion: number;
    generatedAt: string;
  }>;
  comparisonAsOf: string;
  sectionStateChanges: readonly Readonly<{
    section: string;
    baseState: Phase3ValueState;
    targetState: Phase3ValueState;
  }>[];
  metricChanges: readonly SnapshotMetricChange[];
}>;
```

The result is transient and serializable but is not saved into either Snapshot. A
target section whose `dataDate` is earlier than the base has both value states
preserved but uses `comparisonState: 'incomparable'` and reason
`data_date_regressed`; it is not described as fresh or silently compared.

### 4.6 Dashboard/API boundary

- P3-H1 implements only the pure registry and comparison function.
- P3-H2 may add a read-only GET comparison route using existing safe ticker and
  snapshot-ID validation.
- The Dashboard displays the result in the existing **Report / Data** tab.
- The Browser may format, filter for display, and expand rows, but does not calculate
  deltas or reconcile record identities.
- Selecting history or comparison state must preserve the existing five-tab contract
  and must not trigger source analysis.

### 4.7 Tests

P3-H tests cover:

- same-ticker identity and strict generated-time ordering;
- historical cutoff eligibility;
- all readable V1–V9 combinations without rewriting either input;
- available zero, unavailable, not-collected, and incomparable states;
- exact absolute delta and negative-zero normalization;
- ratio/percent/multiple/JPY/share unit behavior;
- unit mismatch, period change, benchmark change, method change, and data-date
  regression;
- same and changed fiscal periods;
- same and changed correlation/sector/Volume Profile identities;
- no public-short aggregation, investor-category merge, forward fill, source fetch,
  threshold, score, or signal;
- deterministic order and input non-mutation;
- unsafe or missing history IDs at the API boundary; and
- Dashboard pass-through of code-calculated results.

## 5. P3-R — Peer-percentile Radar

### 5.1 Decision

**IMPLEMENT.** Render the seven existing deterministic peer percentiles. Do not add
an eighth axis, weight, average, or overall score.

The exact axes and order are:

1. PER
2. PBR
3. ROE
4. ROIC
5. Operating Margin
6. Revenue Growth
7. Dividend Yield

The Snapshot already stores each `percentile` from zero to one and its direction.
The existing Engine has already normalized lower PER/PBR as better and higher values
as better for the other axes. Browser code must not re-rank peers or invert axes.

### 5.2 Presentation contract

- Render in the existing **Fundamentals / Comparison / Dividend** tab.
- A value of `0.5` is labelled the peer-position midpoint, not an industry average.
- All seven available axes are required to draw the polygon. If any axis is
  unavailable, do not draw a partial polygon that implies a closed score; show the
  exact table and missing state instead.
- Always provide an accessible table containing the same seven labels, stored
  percentile, sample size, direction, and unavailable reason.
- SVG coordinate conversion from stored percentiles is presentation geometry, not a
  financial calculation.
- Do not encode favorable/unfavorable thresholds through colors or labels.
- Preserve V1–V9 compatibility and the distinction between valid zero and missing.

### 5.3 Tests

- exact seven-axis order and stored percentile pass-through;
- no Browser rank, direction inversion, weighting, mean, or score calculation;
- valid zero and one values;
- one or more missing axes suppress the polygon but preserve the table;
- V1–V9 fixtures;
- accessible name, axis labels, table equivalence, keyboard reading order, and
  responsive no-overflow behavior; and
- existing peer table and five-tab navigation regression.

## 6. P3-E — Independent qualitative Evaluator

### 6.1 Decision

**IMPLEMENT with a stricter contract than the reference implementation.** The
Evaluator is an optional second opinion about evidence use and reasoning quality. It
is not an investment judge, numerical score, report editor, or deterministic Engine.

### 6.2 Execution boundary

- Invocation is explicit and local. It does not run automatically after each
  analysis.
- One evaluation targets one immutable saved `snapshotId` and its stored report.
- The Evaluator runs in a separate LLM context with no tools and no access to the
  main Agent's scratchpad, tool history, memory, or external sources.
- Use provider-neutral `taskProfile: 'deep_analysis'`; resolve the runtime once per
  evaluation call under the existing P2-L0 contract.
- The structured Snapshot is the sole authority for numeric evidence. The report is
  reviewed for claims but is never parsed to reconstruct financial values.
- Evaluation never starts a repair/reanalysis loop and never edits a Snapshot or
  report.

### 6.3 Deterministic evidence manifest

Before the LLM call, code produces a compact, deterministic manifest from allowlisted
Snapshot paths:

```ts
type EvaluationEvidenceItem = Readonly<{
  id: string;
  snapshotPath: string;
  state: 'available' | 'unavailable' | 'not_collected';
  value: number | string | boolean | null;
  unit: string | null;
  dataDate: string | null;
}>;
```

The LLM refers to evidence by `id`. Post-validation rejects unknown IDs. It must not
invent free-form Snapshot paths or calculate replacement values. The manifest must
not include secrets, raw prompts, tool arguments, or local filesystem paths.

### 6.4 Qualitative rubric and result

The fixed rubric checks:

- unsupported claims;
- contradictions between report and structured evidence;
- missing caveats for unavailable, stale, partial, or method-limited data; and
- unclear reasoning where the report's conclusion does not follow from cited
  evidence.

There is no 1–5 score, weighted average, pass threshold, actionability score, or
investment-attractiveness score.

```ts
type EvaluationFindingCategory =
  | 'unsupported_claim'
  | 'internal_inconsistency'
  | 'missing_caveat'
  | 'unclear_reasoning';

type EvaluationFinding = Readonly<{
  category: EvaluationFindingCategory;
  importance: 'material' | 'advisory';
  summary: string;
  reportExcerpt: string | null;
  evidenceRefs: readonly string[];
}>;

type AnalysisEvaluationV1 = Readonly<{
  schemaVersion: 1;
  target: Readonly<{
    ticker: string;
    snapshotId: string;
    snapshotSchemaVersion: number;
    snapshotGeneratedAt: string;
  }>;
  createdAt: string;
  rubricVersion: 1;
  providerId: string;
  model: string;
  taskProfile: 'deep_analysis';
  status: 'available' | 'unavailable';
  findings: readonly EvaluationFinding[];
  unavailable: Readonly<{
    reason:
      | 'llm_unavailable'
      | 'invalid_structured_output'
      | 'invalid_evidence_reference'
      | 'target_snapshot_unavailable';
    message: string;
  }> | null;
}>;
```

`reportExcerpt` is bounded and post-validated as an exact substring of the target
stored report. It must not be rendered as trusted HTML. Every finding requires at
least one valid evidence reference; narrative wording alone cannot satisfy the
evidence contract.

### 6.5 Sidecar persistence and failure semantics

- Evaluation is stored under a separate local versioned repository keyed by target
  ticker and snapshot ID. Multiple runs may coexist.
- The sidecar records provider/model/runtime metadata needed to understand a
  non-deterministic judgment, but no credentials or raw provider response.
- Save validation, atomic write, path containment, and identity checks reuse the
  Snapshot repository's established safety pattern without modifying Snapshot files.
- LLM, schema, or evidence-reference failure is typed `unavailable` and never a
  default pass, empty success, or numeric fallback.
- An unavailable result has no findings. Its user-visible message is allowlisted or
  sanitized and never persists a raw provider error.
- An available result with zero findings means only that this particular evaluator
  run returned no validated findings; it does not certify correctness.

### 6.6 Dashboard boundary

- Present evaluation in the existing **Report / Data** tab, clearly labelled as an
  AI qualitative review with provider, model, rubric, target snapshot, and run time.
- Keep deterministic evidence and AI judgment visually distinct.
- Do not allow a finding to overwrite the report or deterministic result.
- Do not turn importance into a financial risk score or Buy/Sell recommendation.

### 6.7 Tests and external evaluation

Unit/integration tests cover:

- manifest allowlist, state/date/unit preservation, stable IDs, and no secrets;
- separate no-tool LLM context and `deep_analysis` runtime propagation;
- one resolved runtime per call;
- structured-output schema and bounded excerpts;
- unknown evidence reference rejection;
- parse/provider failure as typed unavailable with no default pass;
- sidecar identity, versioning, atomic save, path containment, multiple runs, and no
  Snapshot rewrite;
- explicit invocation only, no automatic retry/reanalysis, and no exact LLM wording
  assertion; and
- Dashboard distinction between unavailable, zero findings, and findings.

Before any automatic or default-on mode can be considered, run an external API eval
against a fixed Japanese report set. Measure unsupported-claim detection, false
positives, evidence-reference validity, missing-caveat detection, latency, tokens,
and cost. This eval is not a blocking CI test and does not authorize auto mode.

## 7. Advanced composite score

### 7.1 Decision

**DEFER to Phase 4 validation.** Do not implement a composite score during Phase 3.

Reasons:

- The current deterministic results do not establish validated weights or common
  scaling across valuation, quality, technical, flow, sector, and dividend domains.
- Several candidate inputs are unavailable for some Snapshot versions or rely on
  different dates and populations.
- The inspected reference score uses inputs and thresholds Dexter JP does not own and
  has not validated.
- A visually precise 0–100 score would imply predictive evidence that does not yet
  exist.

Any later proposal requires a separate docs-only scoring evaluation followed by an
explicit gold set/backtest, look-ahead audit, missing-data policy, sensitivity
analysis, calibration, and out-of-sample validation under Phase 4. Browser or LLM
score calculation remains prohibited.

The following are **REJECTED**:

- copying an arbitrary eight-axis formula;
- treating 50 as an industry average without an authoritative population contract;
- renormalizing weights around missing inputs without an approved formula;
- using Evaluator prose to calculate a score; and
- deriving Buy/Sell, Entry, Stop, or Target from a composite value.

## 8. P3-P — Local PDF export

### 8.1 Decision

**IMPLEMENT LATER in Phase 3**, after history comparison, Radar, and the Evaluator
have stable view models. PDF is an export format, not a new analysis product.

### 8.2 Export contract

- Export is an explicit local user action for one selected persisted `snapshotId`.
- It does not run automatically after analysis and does not fetch, refresh, or invoke
  an LLM.
- The base document is produced from structured, escaped print view models. It does
  not execute arbitrary report HTML.
- Reuse the installed Playwright/Chromium `page.pdf()` path; do not add a PDF
  dependency by default.
- Output is written below `.dexter/exports/` with a Windows-safe ticker/snapshot
  filename, path-containment checks, and a temporary-file then rename pattern where
  supported.
- Export failures leave the selected Snapshot and existing Dashboard state intact.
- Optional inclusion of a selected comparison or Evaluator sidecar requires explicit
  identity match with the exported snapshot. It is not selected implicitly as
  “latest”.

The PDF includes:

- ticker, company name, Snapshot schema version, snapshot ID, and generated time;
- section data dates, units, provenance summary, unavailable/not-collected states,
  and methodology limitations;
- deterministic Snapshot values and the stored report;
- an exact table fallback for any chart; and
- a statement that the artifact is local research output, not automated advice.

Japanese text, available system fonts, print page breaks, table overflow, and chart
legibility are verified. Secrets, local absolute paths, raw provider responses, raw
prompts, and tool arguments are excluded.

### 8.3 Tests

- selected snapshot ID and identity, never implicit live/latest substitution;
- readable V1–V9 Snapshots;
- no network, source fetch, Agent, LLM, or financial calculation;
- Japanese text, page sections, chart table fallback, data dates, units, provenance,
  and unavailable/zero distinction;
- escaped Markdown-derived content;
- evaluator/comparison identity mismatch rejection;
- Windows-safe naming, path containment, atomic finalization, temp cleanup, and
  failure preservation; and
- repeatable export from the same immutable inputs, excluding nondeterministic PDF
  metadata where the renderer cannot fix it.

## 9. Dashboard placement

Phase 3 retains the five existing top-level tabs:

- Peer Radar extends **Fundamentals / Comparison / Dividend**.
- History selection, deterministic diff, Evaluator, and PDF export extend
  **Report / Data**.
- No new top-level tab, Router, POST analysis endpoint, polling, WebSocket, or source
  refresh is introduced by this plan.
- Existing saved-Snapshot reload remains GET-only and is not reanalysis.

Any new API route is read-only unless an export/evaluation command is explicitly
designed as a local CLI/controller operation in its reviewed step. P3-0 does not
approve a browser endpoint that incurs LLM cost.

## 10. Implementation sequence

Each item is a separate small Draft PR from updated `main`:

1. **P3-0 — Source / Formula / Architecture Design** (this docs-only contract)
2. **P3-H1 — Pure saved-analysis comparison**
   - metric registry, typed result, formulas, V1–V9 tests;
   - no API, Dashboard, sidecar, PDF, or Snapshot change.
3. **P3-H2 — Read-only comparison presentation**
   - safe GET integration and Report/Data Dashboard UI;
   - no comparison calculation in the Browser.
4. **P3-R1 — Peer-percentile Radar**
   - existing seven stored percentiles plus exact accessible table;
   - no new Engine, Snapshot field, or score.
5. **P3-E1 — Evaluator evidence and sidecar foundation**
   - deterministic manifest, schemas, repository safety, and tests;
   - no LLM call.
6. **P3-E2 — Explicit independent evaluator runtime**
   - no-tool deep-analysis call, validation, CLI/controller opt-in, and external eval
     fixtures;
   - no automatic execution or Dashboard cost trigger.
7. **P3-E3 — Evaluator presentation**
   - selected sidecar read/presentation in Report/Data;
   - no report mutation or financial score.
8. **P3-P1 — Print view model and print presentation**
   - structured content, CSS, chart table fallbacks, visual QA;
   - no filesystem PDF export yet.
9. **P3-P2 — Explicit Playwright PDF export**
   - safe local export, file lifecycle, and integration tests.
10. **P3-C0 — Composite-score evaluation design**
    - Phase 4 evidence-gated docs-only task, not Phase 3 runtime.

The sequence begins with deterministic history comparison because it has the smallest
new trust surface and exercises the established V1–V9 history boundary. Evaluator
persistence precedes the LLM runtime so schema and failure semantics are reviewed
without provider behavior obscuring them. PDF follows stable view models rather than
creating a second presentation architecture.

## 11. Adopted, deferred, and rejected scope

### IMPLEMENT in reviewed Phase 3 steps

- explicit-registry deterministic comparison of saved analyses;
- presentation-only Radar of seven existing peer percentiles;
- explicit qualitative independent Evaluator with a separate sidecar; and
- explicit local persisted-Snapshot PDF export.

### DEFER

- composite investment score and weights pending Phase 4 validation;
- automatic evaluation and automatic reanalysis;
- automatic PDF after analysis;
- cross-ticker comparison/ranking;
- a Radar based on a new score rather than stored peer percentiles;
- PDF export of an unsaved/live analysis; and
- record-level public-short, investor-flow, or sector-flow aggregation.

### REJECT

- recursive generic JSON diff as a financial comparison;
- current-source refresh during a saved-history comparison;
- old Snapshot migration or mutation for Phase 3 artifacts;
- Evaluator default-pass behavior after a failure;
- numeric Evaluator quality/actionability/investment scores;
- arbitrary reference score formulas or missing-value reweighting;
- Browser or LLM financial calculation;
- unsanitized report Markdown as executable HTML;
- thresholds, rankings, crowding/risk labels, and Buy/Sell signals; and
- adding a top-level Dashboard tab solely for Phase 3.

## 12. P3-0 validation and review contract

P3-0 changes only:

- `docs/PHASE3_PLAN.md`; and
- `docs/PHASE3_HANDOFF.md` as a non-normative recovery summary.

It does not change application code, tests, dependencies, CI, Snapshot schemas,
Dashboard runtime, tools, Engines, or skills.

Before the P3-0 Draft PR is published:

```text
bun test
bun run typecheck
git diff --check
```

Self-review verifies:

- Source of Truth precedence and V1–V9 immutability;
- exact separation of deterministic, presentation, AI, and export ownership;
- no financial source or calculation hidden in Browser/LLM work;
- missing/unavailable/not-collected/zero preservation;
- no composite score implementation before validation;
- reviewable PR boundaries with no partial runtime contract; and
- `docs/PHASE3_HANDOFF.md` does not redefine this plan.

## 13. Recommended Next Codex Task

After this plan passes independent review and is merged:

```text
P3-H1 — Pure saved-analysis comparison
```

Implement only the explicit metric registry, typed result, deterministic comparison,
and focused unit tests. Do not add the API, Dashboard UI, Evaluator, Radar, PDF,
Snapshot V10, score, or source fetch in P3-H1.
