# Dashboard Detail UX Improvement Plan

**Status:** Candidate amended after independent adversarial review; pending re-review

**Baseline:** `main` at `3d391bc5f02211b851a74f53ed2c4559b9bfda1f`

**Scope:** Read-only local Dashboard presentation and its documentation. This plan
does not approve runtime implementation by itself.

## 1. Purpose

Phase 2A through Phase 2F are complete and Snapshot V9 is the current writer. The
single-stock Dashboard presents the stored results, but the detail page currently
places every section in one continuous document. Large report tables and the full
50-bin Volume Profile make related information harder to scan and compare.

This plan reorganizes the existing V1-V9 presentation into a stable information
architecture before Phase 3 adds any new persisted result. The objectives are:

- group related information without removing stored values;
- make important results and data gaps easy to find;
- explain unfamiliar metrics without turning the Dashboard into investment advice;
- improve chart readability using only already-stored Snapshot values;
- provide a safe way to re-read the latest saved Snapshot; and
- leave explicit extension points for reviewed Phase 3 contracts.

## 2. Inherited contracts

The following contracts are fixed throughout this work:

- The Dashboard is a presentation layer for canonical AnalysisSnapshot data.
- The Browser does not perform financial, statistical, technical, score, signal, or
  pattern calculations.
- `unavailable`, `not_collected`, and valid numeric zero remain distinct.
- Snapshot V1-V9 remain readable. This plan does not mutate their schemas or files.
- Existing calculation, provenance, identity, persistence, path-containment, and
  secret-filtering behavior remains unchanged.
- No new dependency is added. Existing React, browser APIs, CSS, and
  `lightweight-charts` are reused.
- Phase 3 runtime behavior is not implemented before P3-0 fixes its contracts.
- The UI does not create Buy/Sell signals, independent thresholds, scores,
  support/resistance claims, or Entry/Stop/Target values.
- A presentation label, badge, color, caption, or chart overlay must not silently
  introduce a new analytical conclusion.

`docs/SPEC.md` remains authoritative for product invariants. The applicable phase
plan remains authoritative for each stored metric. This document controls only the
Dashboard UX changes explicitly listed below.

## 3. Detail-page information architecture

### 3.1 Persistent context

The following context remains visible above the tab panels:

- navigation back to the saved-analysis list;
- canonical ticker and company name;
- Snapshot generation time;
- Snapshot status;
- the existing principal KPI row;
- separate compact counts for unavailable and uncollected sections; and
- the saved-Snapshot reload control after its dedicated implementation step.

The persistent area does not derive a completeness score or investment severity.

### 3.2 Stable tabs

Use a fixed, typed registry with these stable identifiers and labels, in this order:

| ID | Label | Existing content |
| --- | --- | --- |
| `report` | 概要・レポート | Data Freshness, Unavailable, Final Report, Scenarios, Risks |
| `technical` | 株価・テクニカル | Price Structure, Advanced Technical, Volume Profile, Strategy |
| `fundamentals` | 比較・配当 | Peer Position, Advanced Dividend |
| `supply-demand` | 需給・空売り | Supply & Demand, Public Short Position Reports |
| `market` | 市場・セクター | Investor Type Flows, Market Correlation, Sector Benchmark, Sector Short-selling Flow |

All five tabs exist for every readable Snapshot version. A section introduced after
the loaded Snapshot version remains reachable and displays `未収集`; the tab is not
hidden or disabled. Valid zero remains available data.

The initial tab is `report`. Within that tab, Data Freshness and the unavailable /
uncollected summary precede Final Report, Scenarios, and Risks so the user sees the
data boundary before interpreting the narrative.

These five IDs remain stable for V1-V9. The registry is extensible only through a
later reviewed plan. P3-0 decides whether Evaluator, Radar, and historical-diff views
belong in an existing tab or require an additional stable ID; this plan does not
pre-assign them.

### 3.3 URL and navigation state

The detail URL uses the current ticker query together with a stable tab query:

```text
/?ticker=7203&tab=report
```

- Existing ticker normalization and `History API` navigation are reused; no Router
  dependency is added.
- Selecting a tab updates only the `tab` query with `history.replaceState`, avoiding
  a new browser history entry for every tab switch and preserving other recognized
  or future detail-query parameters.
- A valid explicit `tab` deep link is respected on initial load and `popstate`.
- A missing or unknown tab value falls back to `report` and canonicalizes the URL
  with `replaceState`, without an error page or a new history entry.
- Selecting a different ticker from the saved-analysis list resets the tab to
  `report` unless that navigation includes a valid explicit tab.
- Returning to the list removes detail-only ticker and tab state.
- Tab and panel semantics use automatic activation under the ARIA tabs pattern.
  Left/Right Arrow wraps and moves focus, selection, visible panel, and the canonical
  URL together. Home/End activates the first/last tab. Mouse/touch activation follows
  the same state transition; Enter/Space do not introduce a separate manual mode.
- `popstate` changes the selected panel without stealing focus from content outside
  the tablist. If focus is already within the tablist, it moves to the newly selected
  tab.
- Tab activation keeps the viewport anchored at the sticky tablist rather than
  jumping to the document start.
- On narrow screens the sticky tab list scrolls horizontally; it does not change into
  a different control model such as a select element. It provides a visible edge cue
  and scrolls the selected tab fully into view, so the final tab is discoverable.

## 4. Progressive disclosure

Use native `details`/`summary` for large secondary datasets so touch, pointer, and
keyboard users share the same interaction model.

### 4.1 Always-visible summaries

Keep decision-relevant stored summaries visible, including:

- Volume Profile POC, VAL, VAH, target share, and achieved share;
- section availability and unavailable reasons;
- report and observation counts where already available from stored arrays;
- Public Short Position report count, stored `dataDate`, and the existing disclosure
  boundary note;
- Advanced Dividend observation/event counts, stored `dataDate`, and existing
  actual/forecast and component-availability context;
- Investor Type Flow summary before brokerage detail; and
- data dates needed to interpret a result.

Counts may describe the number of stored records rendered by the UI. They are not a
financial aggregation.

### 4.2 Collapsed-by-default content

The following detailed content is fully collapsed by default, with no preview rows:

- all Volume Profile bins;
- Investor Type Flow brokerage breakdown;
- detailed provenance or methodology fields that are not required to identify the
  visible summary.

Public Short Position reports and Advanced Dividend fiscal/event tables may use
native disclosures, but remain open by default in the initial implementation. Their
principal stored facts do not have an approved representative-row selection contract,
so a count/date-only summary must not hide ratio, shares, reporter identity, annual
DPS, payout ratio, or dividend components. Making either table closed by default
requires a later reviewed presentation contract that selects a narrow stored summary
without sorting, aggregating, or calculating in the Browser.

Every stored value currently reachable remains reachable inside a disclosure. Do not
delete, aggregate, sort, filter, paginate, sample, or reorder source report rows as
part of this plan.

Disclosure open state is keyed to displayed Snapshot identity
`canonicalTicker + generatedAt`. It must survive tab changes and an unchanged reload
for that identity. It resets only when the ticker changes or a different Snapshot
identity replaces the display. No disclosure state is persisted to storage or the
URL.

## 5. Availability navigation

Never combine unavailable data with schema-version or collection absence under one
"gap" number. The persistent area and each tab show two neutral labels where the
count is non-zero:

- `利用不可 N` — distinct stored unavailable records whose reason is not
  `not_collected`; and
- `未収集 N` — distinct sections not collected in this Snapshot, including sections
  introduced after its schema version.

The latter is labelled `このSnapshotでは未収集` in its explanation. It does not mean
the Snapshot failed, and it does not change a V1-V8 Snapshot's historical
`complete`/`partial` meaning.

Counts are visible text and included in the tab's accessible name or description;
they are not conveyed by color alone.

### 5.1 Exhaustive section ownership

UX-1 implements an exhaustive typed registry for the V9 section vocabulary:

| Destination | Snapshot sections |
| --- | --- |
| persistent/global-only | `identity`, `fundamental`, `valuation` |
| `technical` | `priceHistory`, `technical`, `advancedTechnical`, `volumeProfile`, `strategy` |
| `fundamentals` | `peerComparison`, `advancedDividend` |
| `supply-demand` | `supplyDemand`, `reportedShortPositions` |
| `market` | `investorTypeFlows`, `marketCorrelation`, `sectorBenchmark`, `sectorShortRatio` |
| `report` | `scenarios`, `risks` |

Adding a section to a future Snapshot union must fail the registry's exhaustiveness
check until a reviewed destination is assigned.

### 5.2 Unavailable-record count

The authoritative source is `snapshot.unavailable`; card-level renderings are not a
second source. Navigation metadata de-duplicates only exact stored record identities:

```text
section + (metric ?? null) + reason + (detail ?? null)
```

Section-level and metric-level records are distinct because their `metric` values
differ. Records that differ by reason or detail also remain distinct. Stored records
with reason `not_collected` are excluded from `利用不可` and handled by the section set
below. The full raw stored array, including exact duplicates and details, remains
visible in the report tab; de-duplication affects navigation counts only.

The global unavailable count is the union of all distinct tab-assigned and
persistent/global-only records. A tab count is the subset assigned by the registry,
so the global count can exceed the sum of tab counts when persistent records exist.

### 5.3 Uncollected-section count

The uncollected set contains each applicable section at most once only when either:

- top-level `snapshot.unavailable` contains a stored record for that section whose
  reason is exactly `not_collected`; or
- the field is absent because the loaded schema predates its introduction:
  `advancedTechnical` (V2), `reportedShortPositions` (V4), `investorTypeFlows` (V5),
  `sectorBenchmark` (V6), `sectorShortRatio` (V7), `advancedDividend` (V8), and
  `volumeProfile` (V9).

Stored `not_collected` records and schema-derived absence for the same section produce
one set member, never two. Field `null` alone is not an uncollected-count source.
In particular, a required section whose `null` value produces stored
`missing_required_section` belongs only to `利用不可`; it is never also counted as
`未収集`. A later-version field with another unavailable reason is likewise not called
uncollected. Valid zero belongs to neither count.

The global uncollected count is the union of these unique sections. Per-tab counts use
the same exhaustive registry; no synthetic persistent section is created. The full
stored reasons and all section states remain accessible in the report tab.

Both count types are navigation metadata only. They do not create a completeness
score, alter Snapshot status, or rank investment risk.

## 6. Metric guidance

### 6.1 Interaction and source

Do not use hover-only tooltips. Use:

- a short section-level context sentence;
- a keyboard- and touch-operable explanation button where a term needs more detail;
  and
- one always-visible `用語集` button near the persistent header, opening a native
  `dialog`.

The glossary is a typed static presentation registry in
`src/dashboard/web/glossary.ts`. It contains explanatory prose only. It does not copy
Snapshot values or formulas into a second calculation path.

Clicking a term explanation button opens that term directly. The dialog must support
labelled title/content, predictable initial focus, Escape to close, native modal focus
containment, and focus return to the invoking control. A tab, route, ticker, or
different-Snapshot change closes it. If the invoker remains connected and visible,
focus returns there; otherwise focus moves to the active tab, or to the destination
page's main heading after leaving detail view. An unchanged reload does not close it.

### 6.2 Explanation content

Each explanation covers only:

1. what the metric measures;
2. its unit and how to read the stored value;
3. its main source or methodology limitation; and
4. that the metric alone is not a Buy/Sell decision.

Prioritize:

- RSI, MACD, Bollinger Bands, and ATR;
- Beta, Alpha, and R-squared;
- margin balance ratio and digestion days;
- public reported short positions;
- Investor Type Flows;
- POC, VAH, and VAL.

Use Japanese-first labels with standard abbreviations retained where they are the
recognized term. UX-2 fixes at least this presentation inventory:

| Current term | Japanese-first presentation |
| --- | --- |
| Price Structure | 株価チャート |
| Advanced Technical | テクニカル指標 |
| Volume Profile | 出来高価格分布（Volume Profile） |
| Strategy | 戦略水準 |
| Peer Position | 同業比較 |
| Advanced Dividend | 配当分析 |
| Supply & Demand | 信用需給 |
| Public Short Position Reports | 公開空売り残高報告 |
| Investor Type Flows | 投資部門別売買 |
| Market Correlation | 市場相関 |
| Sector Benchmark | 業種指数比較 |
| Sector Short-selling Flow | 業種別空売り売買代金 |
| Data Freshness | データ基準日 |
| Unavailable | 利用不可データ |
| Final Report | 総合レポート |

RSI, MACD, ATR, POC, VAH, VAL, Beta, Alpha, and R-squared may retain their standard
abbreviations alongside Japanese explanations. Source identity strings, endpoint
field names, and official categories are not translated, normalized, or
reclassified. User-facing context replaces avoidable standalone English such as
`flow`, `proxy`, `position`, `Advanced`, `Source eligible`, and `Analysis as-of` with
Japanese-first wording while retaining the exact source/audit meaning.

Definitions must preserve the source-specific limits already fixed in the applicable
plans, such as public short-position disclosure not being total short interest and
daily Volume Profile being an estimated distribution proxy.

### 6.3 Number formatting

This UX plan preserves the current exact unit-aware formatting. In particular,
`thousand_JPY` values remain exact 千円 values in both summary and detail views.
Compact 億円/兆円 conversion is removed from this plan because rounding can turn a
small positive or negative value into displayed zero, and Investor Type summary and
brokerage rows are not interchangeable exact-value counterparts.

A future compact formatter requires a separate reviewed contract for thresholds,
divisors, sign, rounding, boundary values, non-zero fallback, and an adjacent exact
rendering of the same source value. It must not be applied generically to stock
prices, shares, adjusted shares, ratios, or other units.

## 7. Chart presentation

UX-3 uses only fields already present in the loaded Snapshot.

- Keep adjusted daily candlesticks in the upper pane, approximately 70% of chart
  height.
- Move existing daily volume into a distinct lower pane, approximately 30% of chart
  height, with a synchronized time scale and crosshair.
- Preserve existing SMA20 and Swing High/Low price lines.
- Display a chart legend with session-only visibility toggles for each existing price
  line. Each toggle is a button with `aria-pressed`; all existing lines are visible
  initially, and toggling changes visibility only, never the stored lines or bars.
- Key toggle state to `canonicalTicker + generatedAt`. Preserve it across tabs and an
  unchanged reload; reset it for a different ticker or Snapshot identity.
- Move the existing latest RSI14, MACD, and Bollinger values into a compact status
  strip adjacent to the chart. Label it `最新値`, include the stored technical data
  date, and state that it is not linked to the chart crosshair. Do not duplicate the
  current Advanced Technical card or imply the values belong to the crosshair date.
- Associate the visual chart with a text description containing the stored date
  range, latest stored close, and currently visible stored price-line labels/levels.
  Selecting and formatting those values is presentation, not a replacement
  calculation.
- On mobile, stack the legend and latest-value strip below the chart. Preserve usable
  minimum plot heights and prevent labels, panes, legend, and status content from
  overlapping.
- Keep the TradingView attribution required by the existing chart dependency.

No dated RSI/MACD/Bollinger or Swing series exists in V1-V9. UX-3 must not synthesize
one from latest values, raw bars, or prompt text.

## 8. Saved-Snapshot reload

UX-4 adds one header control with the exact label:

```text
保存済みSnapshotを再読み込み
```

It means only: reissue the existing `GET /api/analyses/:ticker` request and consider a
validated response for the current display.

- It does not fetch fresh source data, invoke an Agent, call an LLM, save a Snapshot,
  or rerun analysis.
- It preserves the selected tab.
- Loading, updated, unchanged, and error feedback is rendered inline with an
  appropriate `aria-live` region. Every terminal message includes the displayed
  `generatedAt` and states
  `外部ソースからの最新データ取得・再分析は実行していません`.
- At most one reload is authoritative. Starting a new reload aborts the earlier one,
  and an aborted or stale response cannot overwrite a newer response.
- Changing ticker or leaving the detail page aborts the active reload.
- No polling, focus-triggered refresh, section-level refresh, or automatic retry is
  added.

The Browser applies this state machine before changing the displayed object:

```text
HTTP success
  -> JSON decode
  -> AnalysisSnapshotSchema validation
  -> canonicalTicker equals requested route ticker
  -> request token is still current
  -> compare canonicalTicker + generatedAt with displayed identity
```

`canonicalTicker + generatedAt` is the displayed Snapshot identity. The repository's
immutable history contract derives its Snapshot ID from `generatedAt`, so a valid
same-ticker response with the same timestamp is the same persisted analysis identity.

- Invalid JSON/schema, ticker mismatch, HTTP error, and other request failure show an
  error while preserving the current Snapshot, selected tab, disclosure state,
  chart-toggle state, and glossary state.
- The same identity does not replace the Snapshot object. It reports `変更なし` and
  preserves all UI state.
- A different valid identity for the requested ticker replaces the Snapshot, reports
  `更新`, preserves only the selected tab, and resets disclosures and chart toggles;
  an open glossary closes under its lifecycle contract.
- Aborted and stale responses change neither Snapshot/UI state nor current feedback,
  even if a test double or transport ignores `AbortSignal` and resolves later. A
  monotonically increasing request token enforces latest-request-wins independently
  of abort support.

`Usage.md` receives only the minimum wording needed to distinguish this control from
true source-data reanalysis when UX-4 is implemented.

A true reanalysis action needs a separate reviewed contract for credentials, API/LLM
cost confirmation, progress, duplicate execution, cancellation, atomic persistence,
and failure recovery. It is not part of this Dashboard plan.

## 9. Deferred and follow-up visualizations

### 9.1 Volume Profile chart

A dedicated UX PR may visualize the full bins already stored by Snapshot V9 without
waiting for or constraining P3-0:

- price is the vertical axis and stored allocated volume is horizontal;
- stored POC and the stored VAL-VAH area are highlighted;
- the full table remains accessible;
- the Browser does not re-bin, reallocate volume, select POC, or rebuild Value Area;
  and
- the graphic does not label POC/VAH/VAL as support, resistance, Entry, Stop, Target,
  or a signal.

### 9.2 Dated technical series

V1-V9 contain latest Advanced Technical values but no dated RSI, MACD, Bollinger, or
Swing series. This Dashboard plan therefore does not implement an indicator pane or
synthesize dated points from OHLCV/latest values.

Any dated-series formula, warm-up, unavailable, no-look-ahead, result shape, Snapshot
version, and chart placement belongs to a separate future reviewed docs-only design.
P3-0 may evaluate that work if it is relevant to the Phase 3 architecture, but this
plan does not require it or preselect RSI as the first series.

### 9.3 Chart patterns

Automatic triangle and head-and-shoulders detection is deferred to Phase 4 evaluation
and backtesting. These are chart patterns, not RSI indicators. Adoption requires a
separate docs-only contract for pivots and confirmation dates, formation and
invalidation rules, price/time tolerance, overlap, no-look-ahead, structured anchors,
false-positive evaluation, and `no_candidate` versus `unavailable`.

No pattern overlay or signal is implemented by this plan.

## 10. Small reviewable PR sequence

Each implementation PR starts from reviewed current `main`, preserves a usable
Dashboard at its boundary, and does not pull forward later scope.

1. **UX-0 — Dashboard UX contract (docs-only)**
   - add this candidate plan;
   - perform independent architecture, UX, and final-contract reviews against one
     immutable PR head;
   - adopt the reviewed final contract before runtime work.
2. **UX-1a — Detail tabs and section placement**
   - typed/extensible tab registry, exhaustive section ownership, URL state,
     automatic ARIA tab interactions, sticky responsive tab access, and Japanese tab
     and section labels;
   - all existing tables remain expanded and reachable at this boundary;
   - no chart, API, Engine, Snapshot, or stored-value change.
3. **UX-1b — Availability navigation and progressive disclosure**
   - separate unavailable/uncollected metadata, exact de-duplication rules, disclosure
     summaries/lifecycle, and complete responsive overflow handling;
   - collapse by default only content with an existing safe stored summary; Public
     Short and Advanced Dividend remain open by default;
   - no Browser aggregation, representative-row inference, or stored-value change.
4. **UX-2 — Metric guidance**
   - Japanese-first labels, section captions, static glossary, accessible dialog, and
     exact existing unit-aware number formatting;
   - no financial calculation or stored-value change.
5. **UX-3 — Existing chart presentation**
   - price/volume panes, synchronized interaction, existing-line legend/toggles, and
     dated/latest-value accessibility descriptions and latest-indicator status strip;
   - Snapshot-only, with no dated indicator generation.
6. **UX-4 — Saved-Snapshot reload**
   - existing GET-only endpoint, client schema/identity boundary, inline request
     state, request-token/abort handling, state preservation, and minimum `Usage.md`
     clarification;
   - no source fetch or reanalysis endpoint.
7. **UX-5 — Stored Volume Profile visualization**
   - render Snapshot V9 bins and aggregate levels without Browser calculation;
   - remain independent from scores and signals.
8. **UX-C — Dashboard UX closeout gate**
   - run the complete desktop/tablet/mobile, keyboard, screen-reader, V1-V9, and seven
     user-journey acceptance matrix;
   - correct UX regressions before Phase 3 rather than deferring known issues.
9. **P3-0 — Phase 3 source/formula/architecture design (docs-only)**
   - decide Phase 3 result ownership, Snapshot evolution, and Dashboard extension
     points from current `main` without being bound to a dated-series design here;
   - do not implement Phase 3 runtime work in P3-0.
10. **Reviewed Phase 3 runtime steps**
   - follow the P3-0 sequence only after its independent review.

Phase 3 presentation may receive its own later polish, but the Phase 2 Dashboard UX
work must satisfy UX-C before P3-0 begins.

## 11. Test and validation contract

Implementation PRs add focused tests appropriate to their scope. Across the sequence,
the matrix must cover:

- unique tab IDs and deterministic section mapping;
- exhaustive V9 section ownership, including persistent/global-only sections;
- default, explicit, missing, and invalid URL tab state and canonicalization;
- automatic activation, wrap, selected-panel relation, ticker changes, `popstate`,
  Back/Forward, focus, and preservation of non-tab detail queries;
- readable V1-V9 fixtures with all five tabs present;
- `not_collected`, unavailable, and valid-zero distinction;
- fixed V1, V4, V8, and V9 unavailable/uncollected counts;
- exact duplicate, section-level versus metric-level, persistent, and synthetic
  not-collected reconciliation without changing Snapshot status;
- a V9 required `fundamental: null` with stored `missing_required_section` produces
  `利用不可 1 / 未収集 0`;
- a V1 schema without `volumeProfile` contributes exactly one `volumeProfile` member
  to the uncollected set, while V9 `volumeProfile: null` plus stored `not_collected`
  also contributes exactly one;
- Public Short and Advanced Dividend principal values visible before interaction,
  valid-zero/unavailable handling, and unchanged canonical row order;
- complete access to collapsed rows without preview, reordering, or aggregation;
- disclosure preservation across tabs/unchanged reload and reset for different
  identity;
- keyboard tab navigation, Home/End, visible focus, sticky edge cue, and selected-tab
  narrow-screen access;
- glossary direct-term opening, labelling, modal focus, Escape, tab/route/Snapshot
  close, invoker return, and fallback focus;
- exact `thousand_JPY` summary/detail values with no compact conversion;
- Snapshot-only candlestick, volume, line, and latest-indicator presentation;
- chart toggle `aria-pressed`, visibility-only behavior, accessible date/close/line
  description, latest data date/crosshair warning, defaults, and identity reset rules;
- reload uses GET only and never invokes analysis;
- reload updated/unchanged/error feedback with generated time and explicit no-analysis
  wording;
- malformed JSON, schema-invalid response, ticker mismatch, 404, and 500;
- same identity preserves object and all UI state; different identity performs the
  limited reset;
- abort, request-token latest-request-wins, ticker/list navigation, and stale response
  behavior even when a test transport ignores `AbortSignal`;
- current UI preservation when reload fails;
- absence of Browser RSI, MACD, Bollinger, Volume Profile, pattern, score, threshold,
  or signal calculation; and
- existing watchlist, Snapshot V1-V9, API, persistence, and presentation regression
  tests.

Required validation before publishing each PR remains:

```text
bun test
bun run typecheck
git diff --check
```

UX implementation PRs reuse the installed Playwright dependency for a small focused
browser-interaction suite where unit tests cannot establish focus, History API,
overflow, or reload races. Do not add a dependency or broad DOM snapshots.

Manual visual/accessibility QA covers 320, 390, 680, 768 portrait, 980, 1024 landscape,
and 1280px. There must be no document-level horizontal overflow; wide source tables
may keep their own labelled scroll container. Every tab must be discoverable and the
selected tab fully visible. Chart panes, labels, legend, and latest-value strip must
not overlap and must retain usable plot height. Before/after screenshots at 1280px and
390px may be attached to PR descriptions but are not committed as binary artifacts.

UX-C repeats the principal journeys against representative V1, V4, and V9 complete,
partial, unavailable, uncollected, and valid-zero fixtures:

1. first-time reading of overview, data dates, gaps, and final narrative;
2. focused technical review;
3. comparison of margin supply/demand and public short reports without aggregation;
4. market and sector context review without issuer attribution;
5. locating unavailable versus uncollected causes;
6. CLI reanalysis followed by saved-Snapshot reload; and
7. keyboard, screen-reader, touch, and mobile access to all detail content.

## 12. Independent adversarial review gate

Before this candidate becomes the final plan, independent architecture, UX, and
final-contract review tasks inspect the same immutable Draft PR head. Neither review
receives another review's output or the prior conversation's recommendation framing.

### Review A — architecture and contract red team

Focus on Snapshot-only boundaries, V1-V9 compatibility, missing-data semantics,
URL/state and reload races, accessibility state, chart contracts, PR boundary safety,
Phase 3 conflicts, unnecessary complexity, and testability.

### Review B — information architecture and user-flow red team

Focus on discoverability, grouping, hidden critical information, gap visibility,
glossary usability, Japanese labels, number readability, responsive behavior,
keyboard/touch use, chart density, reload misunderstanding, Phase 3 extension points,
and concrete end-to-end research journeys.

### Review C — contract convergence review

Independently inspect the complete candidate against Source of Truth, merged schemas,
builders, API/client boundaries, intermediate PR safety, and testability. It must not
resolve ambiguity merely by choosing one of Reviews A/B; it supplies its own evidence.

Each review reports:

- verdict: `ACCEPT`, `REVISE`, or `REJECT`;
- findings classified under `docs/REVIEW_POLICY.md`;
- plan section and evidence;
- minimum corrective direction;
- tests that would catch the risk; and
- plan elements that should be preserved.

Synthesis applies these fixed rules:

- every BLOCKING or MAJOR finding is corrected or rebutted with repository evidence;
- the same risk found independently by both reviews is normally corrected;
- a demonstrated Source of Truth or compatibility violation is corrected even when
  raised by only one reviewer;
- preference-only suggestions are adopted only when they do not materially increase
  scope or complexity;
- review does not automatically add features, Snapshot changes, Engine work, POST
  endpoints, Agent execution, or Phase 3 runtime work; and
- conflicting findings are resolved against repository contracts and explicit user
  journeys, not by majority vote.

The amended plan remains in this Draft PR and receives final independent re-review.
Runtime work begins only after the plan satisfies the Merge Gate and the user merges
it.

## 13. Explicit non-goals

- Snapshot V10 or any schema change
- deterministic Engine or Agent Tool changes
- source-data retrieval or analysis execution from the Dashboard
- POST API, background jobs, polling, WebSocket, login, or cloud deployment
- new chart or UI dependency
- dated technical series in V1-V9
- Browser or LLM financial calculation
- automatic chart-pattern detection
- support/resistance or Entry/Stop/Target derivation from POC/VAH/VAL
- score, threshold, ranking, classification, alert, or Buy/Sell signal
- Phase 3 Independent Evaluator, composite score, Radar chart, PDF, or historical diff
- unrelated watchlist redesign
