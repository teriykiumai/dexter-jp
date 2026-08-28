# Dashboard Detail UX Improvement Plan

**Status:** Candidate for independent adversarial review

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
- a compact count of recorded data gaps; and
- the saved-Snapshot reload control after UX-4.

The persistent area does not derive a completeness score or investment severity.

### 3.2 Stable tabs

Use a fixed, typed registry with these stable identifiers and labels, in this order:

| ID | Label | Existing content |
| --- | --- | --- |
| `technical` | 株価・テクニカル | Price Structure, Advanced Technical, Volume Profile, Strategy |
| `fundamentals` | 業績・比較・配当 | Peer Position, Advanced Dividend |
| `supply-demand` | 需給・空売り | Supply & Demand, Public Short Position Reports |
| `market` | 市場・セクター | Investor Type Flows, Market Correlation, Sector Benchmark, Sector Short-selling Flow |
| `report` | レポート・データ | Scenarios, Risks, Final Report, Data Freshness, Unavailable |

All five tabs exist for every readable Snapshot version. A section introduced after
the loaded Snapshot version remains reachable and displays `未収集`; the tab is not
hidden or disabled. Valid zero remains available data.

The initial tab is `technical`.

### 3.3 URL and navigation state

The detail URL uses the current ticker query together with a stable tab query:

```text
/?ticker=7203&tab=technical
```

- Existing ticker normalization and `History API` navigation are reused; no Router
  dependency is added.
- Selecting a tab updates the URL with `history.replaceState`, avoiding a new browser
  history entry for every tab switch.
- A valid explicit `tab` deep link is respected on initial load and `popstate`.
- A missing or unknown tab value falls back to `technical` without an error page.
- Selecting a different ticker from the saved-analysis list resets the tab to
  `technical` unless that navigation includes a valid explicit tab.
- Returning to the list removes detail-only ticker and tab state.
- Tab and panel semantics follow the ARIA tabs pattern. Arrow keys move between
  adjacent tabs, Home/End move to the first/last tab, and focus behavior is tested.
- On narrow screens the tab list scrolls horizontally; it does not change into a
  different control model such as a select element.

## 4. Progressive disclosure

Use native `details`/`summary` for large secondary datasets so touch, pointer, and
keyboard users share the same interaction model.

### 4.1 Always-visible summaries

Keep decision-relevant stored summaries visible, including:

- Volume Profile POC, VAL, VAH, target share, and achieved share;
- section availability and unavailable reasons;
- report and observation counts where already available from stored arrays;
- Investor Type Flow summary before brokerage detail; and
- data dates needed to interpret a result.

Counts may describe the number of stored records rendered by the UI. They are not a
financial aggregation.

### 4.2 Collapsed-by-default content

The following detailed content is fully collapsed by default, with no preview rows:

- all Volume Profile bins;
- all Public Short Position reports;
- Investor Type Flow brokerage breakdown;
- Advanced Dividend fiscal observations and dividend events when presented as large
  tables; and
- detailed provenance or methodology fields that are not required to identify the
  visible summary.

Every stored value currently reachable remains reachable inside a disclosure. Do not
delete, aggregate, sort, filter, paginate, sample, or reorder source report rows as
part of this plan.

Disclosure open state may survive tab changes while the same ticker and Snapshot are
displayed. It resets when the ticker changes or a saved Snapshot is successfully
replaced. No disclosure state is persisted to storage or the URL.

## 5. Data-gap visibility

Show a compact recorded-gap count in the persistent area and a per-tab count on each
tab. Counts follow these presentation rules:

- use top-level stored unavailable records as the authoritative gap records;
- count a section shown as `not_collected` once when no corresponding top-level
  record exists;
- do not count the same stored gap again because it is also rendered inside a card;
- do not treat valid zero as a gap;
- keep the full stored reason and detail accessible in the report/data tab; and
- use neutral presentation rather than investment-risk colors or severity scores.

This count is navigation metadata only. It does not change Snapshot `complete` or
`partial` semantics.

## 6. Metric guidance

### 6.1 Interaction and source

Do not use hover-only tooltips. Use:

- a short section-level context sentence;
- a keyboard- and touch-operable explanation button where a term needs more detail;
  and
- one global glossary opened in a native dialog or equivalent accessible drawer.

The glossary is a typed static presentation registry in
`src/dashboard/web/glossary.ts`. It contains explanatory prose only. It does not copy
Snapshot values or formulas into a second calculation path.

The dialog must support labelled title/content, predictable initial focus, Escape to
close, focus containment while open, and focus return to the invoking control.

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
recognized term. Definitions must preserve the source-specific limits already fixed
in the applicable plans, such as public short-position disclosure not being total
short interest and daily Volume Profile being an estimated distribution proxy.

### 6.3 Number formatting

Compact Japanese currency notation is limited to summary displays whose stored unit
is `thousand_JPY`:

- use `億円` or `兆円` with at most two decimal places;
- retain the exact stored source-unit value in the corresponding detail table; and
- never compact an unavailable value into zero.

Do not apply compact currency formatting generically to stock prices, shares,
adjusted shares, ratios, or other units.

## 7. Chart presentation

UX-3 uses only fields already present in the loaded Snapshot.

- Keep adjusted daily candlesticks in the upper pane, approximately 70% of chart
  height.
- Move existing daily volume into a distinct lower pane, approximately 30% of chart
  height, with a synchronized time scale and crosshair.
- Preserve existing SMA20 and Swing High/Low price lines.
- Display a chart legend with session-only visibility toggles for each existing price
  line. All existing lines are visible initially.
- Reset toggle state when the ticker or loaded Snapshot changes.
- Move the existing latest RSI14, MACD, and Bollinger values into a compact status
  strip adjacent to the chart. Do not duplicate the current Advanced Technical card.
- Keep the TradingView attribution required by the existing chart dependency.

No dated RSI/MACD/Bollinger or Swing series exists in V1-V9. UX-3 must not synthesize
one from latest values, raw bars, or prompt text.

## 8. Saved-Snapshot reload

UX-4 adds one header control with the exact label:

```text
保存済みSnapshotを再読み込み
```

It means only: reissue the existing `GET /api/analyses/:ticker` request and replace
the displayed Snapshot if that read succeeds.

- It does not fetch fresh source data, invoke an Agent, call an LLM, save a Snapshot,
  or rerun analysis.
- It preserves the selected tab.
- A successful response with a different `generatedAt` is presented as updated; the
  same `generatedAt` is presented as unchanged.
- An error or invalid response leaves the currently displayed Snapshot intact.
- Loading, updated, unchanged, and error feedback is rendered inline with an
  appropriate `aria-live` region.
- At most one reload is authoritative. Starting a new reload aborts the earlier one,
  and an aborted or stale response cannot overwrite a newer response.
- Changing ticker or leaving the detail page aborts the active reload.
- A successful replacement resets disclosure and chart-toggle state, even when the
  selected tab is retained.
- No polling, focus-triggered refresh, section-level refresh, or automatic retry is
  added.

`Usage.md` receives only the minimum wording needed to distinguish this control from
true source-data reanalysis when UX-4 is implemented.

A true reanalysis action needs a separate reviewed contract for credentials, API/LLM
cost confirmation, progress, duplicate execution, cancellation, atomic persistence,
and failure recovery. It is not part of this Dashboard plan.

## 9. Deferred visualizations and Phase 3 boundary

### 9.1 Volume Profile chart

After P3-0 is reviewed, but independently of Phase 3 scoring work, a dedicated UX PR
may visualize the full bins already stored by Snapshot V9:

- price is the vertical axis and stored allocated volume is horizontal;
- stored POC and the stored VAL-VAH area are highlighted;
- the full table remains accessible;
- the Browser does not re-bin, reallocate volume, select POC, or rebuild Value Area;
  and
- the graphic does not label POC/VAH/VAL as support, resistance, Entry, Stop, Target,
  or a signal.

### 9.2 Dated technical series

P3-0 must decide the versioned deterministic series contract before a technical
indicator pane is added. The first candidate is RSI14 only:

- available points have the shape `{ date, value }`;
- warm-up dates are omitted rather than represented as fabricated zero or ambiguous
  null points;
- the final point equals the existing latest RSI14 result for the same canonical
  calculation sequence;
- missing or invalid data in that canonical sequence makes the whole series typed
  unavailable; it is not skipped, filled, interpolated, or restarted; and
- Snapshot evolution remains additive and versioned.

After RSI is evaluated, MACD, Bollinger, and dated Swing markers are reconsidered
independently. They are not bundled automatically.

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
   - perform two independent adversarial reviews against one immutable PR head;
   - adopt the reviewed final contract before runtime work.
2. **UX-1 — Detail information architecture**
   - typed tab registry, URL state, stable section placement, progressive disclosure,
     gap navigation, responsive behavior, and ARIA interactions;
   - no metric wording/formatting, chart, API, Engine, or Snapshot change.
3. **UX-2 — Metric guidance**
   - Japanese-first labels, section captions, static glossary, accessible dialog, and
     narrowly scoped compact summary formatting;
   - no financial calculation or stored-value change.
4. **UX-3 — Existing chart presentation**
   - price/volume panes, synchronized interaction, existing-line legend/toggles, and
     latest-indicator status strip;
   - Snapshot-only, with no dated indicator generation.
5. **UX-4 — Saved-Snapshot reload**
   - existing GET-only endpoint, inline request state, abort/stale-response handling,
     state preservation, and minimum `Usage.md` clarification;
   - no source fetch or reanalysis endpoint.
6. **P3-0 — Phase 3 source/formula/architecture design (docs-only)**
   - coordinate the next Snapshot version and evaluate the dated RSI series contract;
   - do not implement Phase 3 runtime work in P3-0.
7. **UX-5 — Stored Volume Profile visualization**
   - render Snapshot V9 bins and aggregate levels without Browser calculation;
   - remain independent from scores and signals.
8. **Reviewed Phase 3 runtime steps**
   - follow the P3-0 sequence only after its independent review.

Perform final cross-tab visual polish after Phase 3 presentation is present, so a
single styling pass can address the complete information architecture without
blocking the structural UX work above.

## 11. Test and validation contract

Implementation PRs add focused tests appropriate to their scope. Across the sequence,
the matrix must cover:

- unique tab IDs and deterministic section mapping;
- default, explicit, missing, and invalid URL tab state;
- ticker changes, `popstate`, and history behavior;
- readable V1-V9 fixtures with all five tabs present;
- `not_collected`, unavailable, and valid-zero distinction;
- gap-count de-duplication and unchanged Snapshot status semantics;
- complete access to collapsed rows without preview, reordering, or aggregation;
- disclosure state reset/preservation rules;
- keyboard tab navigation, Home/End, visible focus, and horizontal narrow-screen tab
  access;
- glossary dialog labelling, focus containment, Escape, and focus return;
- compact `thousand_JPY` summaries with exact detail values preserved;
- Snapshot-only candlestick, volume, line, and latest-indicator presentation;
- chart toggle defaults and reset rules;
- reload uses GET only and never invokes analysis;
- reload updated/unchanged/error feedback;
- abort, latest-request-wins, ticker-change, and stale-response behavior;
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

UX implementation PRs also include manual visual/accessibility QA at desktop and
mobile widths. Before/after screenshots at 1280px and 390px may be attached to PR
descriptions but are not committed as binary test artifacts. Check at least 980px and
680px intermediate widths. Do not add a visual-test dependency or broad DOM snapshots
solely for this work.

## 12. Independent adversarial review gate

Before this candidate becomes the final plan, two independent review tasks inspect
the same immutable Draft PR head. Neither review receives the other review's output or
the prior conversation's recommendation framing.

### Review A — architecture and contract red team

Focus on Snapshot-only boundaries, V1-V9 compatibility, missing-data semantics,
URL/state and reload races, accessibility state, chart contracts, PR boundary safety,
Phase 3 conflicts, unnecessary complexity, and testability.

### Review B — information architecture and user-flow red team

Focus on discoverability, grouping, hidden critical information, gap visibility,
glossary usability, Japanese labels, number readability, responsive behavior,
keyboard/touch use, chart density, reload misunderstanding, Phase 3 extension points,
and concrete end-to-end research journeys.

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
