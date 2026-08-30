# Dexter JP Composite-score Evaluation Plan

**Status:** P3-C0 research protocol only; no runtime authorization

**Plan version:** `score_evaluation_plan_v1`

**Last Updated:** 2026-08-30

## 1. Purpose and authority

This document is the only P3-C0 deliverable. It fixes the evidence protocol that a
future Phase 4 score-validation campaign must follow before a composite score may be
considered for Dexter JP.

This plan inherits, and does not weaken:

- `AGENTS.md` for repository operation, safety, validation, and review;
- `docs/SPEC.md` for deterministic calculation, missing-data, no-look-ahead, and
  AI-responsibility boundaries;
- `docs/MVP_IMPLEMENTATION_PLAN.md` and `docs/PHASE3_PLAN.md` for the roadmap and
  Phase 3 non-goals;
- the applicable source and availability contracts in `docs/PHASE2_PLAN.md`; and
- the existing deterministic peer-comparison Engine contract in
  `src/tools/finance/peer-comparison-engine.ts`.

P3-C0 adds no executable evaluation, source fetch, dependency, command, Snapshot
field, persisted research artifact, Dashboard element, product threshold, or
financial signal. A future campaign must first receive its own reviewed Phase 4
implementation plan and user approval for any bulk source access or incremental cost.

## 2. Decision fixed by this plan

The only candidate authorized for evaluation by version 1 is a research-only,
equal-contribution composite of the seven existing direction-normalized peer
percentiles. It is evaluated against a 60-TSE-session forward TOPIX-excess price
return.

The candidate is not an adopted product score. Its formula is fixed here only to
prevent development- or holdout-driven weight selection:

```text
candidateId = peer_percentile_equal_contribution_v1

features, in registry order:
  per
  pbr
  roe
  roic
  operatingMargin
  revenueGrowth
  dividendYield

researchComposite = 100 * (
  perPercentile
  + pbrPercentile
  + roePercentile
  + roicPercentile
  + operatingMarginPercentile
  + revenueGrowthPercentile
  + dividendYieldPercentile
) / 7
```

Each percentile is the existing Engine's zero-to-one, worst-to-best value. PER and
PBR retain `lower_is_better`; the other five retain `higher_is_better`. Calculation
uses the unrounded binary numeric inputs and returns a finite number in `[0, 100]`.
Zero is valid. Presentation rounding, if any, is never used in evaluation.

There is no fitted coefficient, intercept, sector adjustment, missing-feature
substitution, reweighting, clipping, LLM input, or optimization. Any different
formula is a new candidate version and cannot be tested on the version 1 locked
split.

## 3. Prediction question and label

### 3.1 Observation time

An observation is anchored to the last official TSE business day of a calendar
month. The hypothetical calculation time is after that session's official close.

`t0` is that anchor session. `t60` is the 60th later official TSE business session;
`t0` itself is not counted. The official J-Quants market calendar determines both
dates. Weekend inference, forward fill, exchange-day counting from price rows, and
calendar-day substitution are prohibited.

### 3.2 Primary target

```text
targetId = topix_excess_log_price_return_60_sessions_v1

stockReturn = ln(stockAdjustedClose[t60] / stockAdjustedClose[t0])
topixReturn = ln(topixClose[t60] / topixClose[t0])
target = stockReturn - topixReturn
```

Both stock adjusted closes and both TOPIX closes must be present, finite, and greater
than zero on the exact sessions. Stock and benchmark dates are inner-joined. No
forward fill, interpolation, stale close, nearest-date substitution, or current
price is permitted.

The label measures relative **price** performance, not total shareholder return.
Dexter JP's current stock-price and TOPIX contracts do not establish a common
dividend-reinvestment basis, so no total-return claim is allowed.

The adjusted-price basis must be internally common through `t60`. A Phase 4 source
plan must prove how delistings, mergers, code changes, and corporate actions within
the label horizon are represented. An issue that was eligible at `t0` must not be
removed because its outcome is inconvenient or unavailable. If a lawful source
cannot produce a valid terminal outcome for every such scored observation, source
feasibility fails; do not apply a made-up `-100%`, last-price, or cash-consideration
default.

### 3.3 Secondary horizons

The same formula at 20 and 120 later TSE sessions is required only for preregistered
sensitivity analysis:

- `topix_excess_log_price_return_20_sessions_v1`; and
- `topix_excess_log_price_return_120_sessions_v1`.

They cannot replace the 60-session primary target after results are seen.

## 4. Point-in-time research panel

### 4.1 Snapshots are not the evaluation population

Persisted V1-V9 Snapshots reflect analyses that the user chose to run. Their dates,
issuers, input completeness, and collection vintages are sparse and selection-biased.
They may be used only as compatibility fixtures. They must not be treated as the
historical population, duplicated to fill months, relabelled with current data, or
used as train, development, or locked observations.

Phase 4 must construct a separate local research panel. It does not change a
Snapshot schema and must not write to `.dexter/analyses/` or
`.dexter/evaluations/`.

### 4.2 Universe

For each monthly anchor, the universe is the point-in-time set of domestic ordinary
shares listed on a TSE market at `t0`. ETFs, ETNs, REITs, preferred shares, funds,
foreign listings, TOKYO PRO Market issues, and any category not proven to be an
ordinary domestic share are excluded by an exact allowlist of official issue-type
codes frozen in the dataset manifest.

Eligibility is determined from records whose listing interval and classification
were knowable at `t0`; a current constituent list is prohibited. IPOs are not
excluded merely for being new. Delisted names remain in observations anchored while
they were eligible. Entity/code transitions must use an explicit point-in-time
identity mapping; ticker text alone must not join different issuers.

The future Phase 4 source plan must enumerate the exact official fields and allowed
values. If the source cannot reproduce listing intervals, issue type, sector, and
identity at each anchor, Gate 0 fails rather than silently narrowing the universe.

### 4.3 Permitted source boundary

Only official or already-approved repository sources may be proposed. Unofficial
scraping and a current screener response back-applied to history are prohibited.

| Required fact | Permitted source boundary | Eligibility rule |
| --- | --- | --- |
| TSE sessions | J-Quants `/v2/markets/calendar` | exact returned official calendar rows |
| issuer universe and sector | J-Quants `/v2/equities/master` | point-in-time record whose availability and effective interval cover `t0` |
| stock closes and turnover | J-Quants `/v2/equities/bars/daily` | exact dated rows; adjusted-close basis must be proven |
| TOPIX closes | J-Quants `/v2/indices/bars/daily/topix` | exact dated rows on the same official sessions |
| disclosure-driven fundamentals | existing J-Quants `/v2/fins/summary` or existing EDINET DB data | exact disclosure/filed vintage with an auditable source-eligible boundary |
| seven peer inputs and market cap | the preceding permitted facts or another separately reviewed official mapping | every component must retain value, source date, eligible date, method, and unit |

The existing EDINET DB screener and peer-comparison Tool can provide current
candidates to an interactive analysis, but they do not by themselves prove a
historical point-in-time panel. Phase 4 must not infer historical eligibility from a
current response.

No source fact is accepted merely because its period end is before `t0`. For
date-only disclosures, use the first official business day on which the repository's
reviewed source contract says the record was eligible. If that boundary cannot be
resolved, the fact is unavailable. Current restated/corrected values must not be
back-applied to an earlier anchor unless the source preserves the exact historical
vintage then available.

Price and calendar observations dated `t0` may be used after close. A
disclosure-driven fact must have `sourceEligibleDate <= t0`; when the source does not
prove same-day availability by the calculation time, require
`sourceEligibleDate < t0`. Future records are filtered before parsing or validation
and must not influence eligibility, cohort membership, values, or missingness.

### 4.4 Dataset feasibility minimum

Before bulk collection or metric calculation, a read-only feasibility report must
prove all of the following:

1. the permitted sources and configured plan lawfully provide every required field;
2. historical vintages, corrections, listing identities, and terminal outcomes are
   reproducible without current-constituent or survivor leakage;
3. the calendar can form at least 48 train, 24 development, and 24 locked monthly
   anchors after the purges in section 6;
4. the seven features can be calculated from the same versioned source mapping; and
5. incremental source cost is zero or has separate explicit user approval and a
   fixed request/cost cap.

Failure of any item is `source_feasibility_rejected`. It ends the version 1 campaign
before a paid request or locked-label access. It is an acceptable and final evidence
outcome: Dexter JP continues without a composite score.

## 5. Feature and missingness contract

### 5.1 Historical Engine parity

For every target and anchor, Phase 4 must recreate the existing peer Engine input
from point-in-time facts, then call the same deterministic rules:

- exact same TSE 33-sector candidates;
- target excluded from peer candidates and included once in statistics;
- positive target market cap required;
- 0.3x-3x target market-cap peers prioritized;
- 5-10 peers, deterministic identity ordering, and sector-leader inclusion; and
- the current per-metric value rules and directions.

Market cap must have one reviewed, versioned point-in-time formula and source mapping
for every company in the candidate set. Missing or non-positive market cap makes the
target observation unscored; it must not disable prioritization or fall back to an
unversioned ordering for this campaign.

The seven metric values must each carry their own source and eligibility date. A
single company-level `dataDate` is insufficient evidence for the research panel.
Every disclosure-driven input used by a metric must be no more than 550 calendar
days old at `t0`; otherwise that metric is unavailable. The limit is fixed before
the development split and is not relaxed to increase coverage.

### 5.2 Complete-case candidate

An observation is score-eligible only when all of these conditions hold:

- at least five peers are selected;
- market-cap priority was applied from complete valid values;
- all seven target metric values satisfy the existing Engine's validity rules;
- every metric has at least five valid selected-peer values;
- each `peerSampleSize >= 5` and `cohortSize = peerSampleSize + 1`;
- each percentile is finite and in `[0, 1]`;
- metric, direction, rank, percentile, sample size, and cohort size are structurally
  consistent; and
- the primary target can be resolved under section 3.

If one feature is unavailable, the entire research composite is unavailable for that
observation. Do not impute a value, substitute a sector median, treat missing as zero
or 0.5, carry a prior value forward, reduce the denominator, or reweight the other
features. A raw dividend yield of zero and a percentile of zero remain valid values.

The panel records a closed reason for every excluded target-anchor pair, including at
least `universe_ineligible`, `identity_unavailable`, `source_vintage_unavailable`,
`stale_feature`, `market_cap_unavailable`, `too_few_peers`,
`peer_metric_unavailable`, `target_unavailable`, and `invalid_data`. Reasons are
counts for coverage audit; they are never inputs to the candidate.

### 5.3 Coverage gate

Splits are assigned before feature or label exclusions. Calendar anchors are never
backfilled or moved between splits.

For train, development, and locked splits separately:

- at least 90% of assigned anchors must be valid evaluation months;
- a valid month requires at least 100 scored issuers;
- scored issuers must be at least 60% of the price-and-identity-eligible ordinary-
  share universe for that month; and
- 100% of score-eligible observations must have a resolved primary label, including
  issuers that cease listing during the horizon.

A constant candidate, an undefined monthly correlation, an overlapping top/bottom
group, or fewer than 20 issuers in either extreme group makes that month invalid.
Failure of a split-level coverage threshold rejects the campaign. Do not discard the
month and substitute an earlier one.

## 6. Train, development, and locked split

### 6.1 Exact split construction

Let `F` be the latest month-end anchor for which the 120-session sensitivity label is
fully observable when the dataset manifest is frozen. Starting from `F`:

1. assign the latest 24 consecutive monthly anchors to `locked`;
2. remove every earlier anchor whose 120th future session is on or after the first
   locked anchor; these anchors are `purged_before_locked`;
3. assign the latest 24 remaining consecutive anchors to `development`;
4. remove every earlier anchor whose 120th future session is on or after the first
   development anchor; these anchors are `purged_before_development`; and
5. assign all earlier anchors to `train`, requiring at least 48 consecutive anchors.

The 120-session purge is used even though the primary label is 60 sessions, so none
of the required sensitivity labels crosses into the next split. Splits are based on
calendar anchors before inspecting issuer coverage or outcomes. Random, ticker,
sector, stratified, and rolling reassignment are prohibited.

### 6.2 Permitted use

| Split | Permitted use | Prohibited use |
| --- | --- | --- |
| train | pipeline construction, deterministic tests, descriptive diagnostics | fitting weights or changing the candidate formula |
| development | one complete dry run of the fixed protocol; decide whether to stop | lowering gates, choosing features/horizons from outcomes |
| locked | one final execution after all identities, code, manifests, and thresholds are frozen | debugging, tuning, rerunning a failed candidate |

Before locked labels are read, freeze and digest the source manifest, observation
universe, feature mapping, candidate version, target version, split assignment,
evaluation code commit, deterministic seed, and complete development report. Locked
labels remain in a separately identified local artifact and normal CI never reads
them.

The locked split may be unsealed once for this candidate version. A crash before any
locked label is read may be retried from the same immutable inputs. Any partial or
complete access to locked labels consumes the split. Operational failure after that
point is reported as `locked_campaign_invalid`; it does not authorize another run or
manual repair.

## 7. Baselines and exact statistics

### 7.1 Baselines

All comparisons use the exact complete-case issuer-month panel of the composite:

1. `no_score_v1`: every issuer has the same prediction; expected rank information
   and top-minus-bottom spread are zero;
2. seven `single_peer_percentile_<metric>_v1` baselines, one for each existing
   percentile with its already-normalized direction; and
3. `best_single_metric_v1`: selected on development by highest mean monthly primary-
   target Spearman correlation, with registry order breaking exact ties.

No external reference score, current Snapshot score, sector return, LLM judgment,
Buy/Sell label, or fitted model is a baseline. The best-single identity is frozen
before locked access.

### 7.2 Monthly cross-sectional statistics

For every valid anchor:

- compute Spearman correlation between the unrounded candidate and primary target;
  ties use average ranks;
- define an issuer's score percentile as
  `(count(lower score) + 0.5 * count(equal score)) / issuerCount`;
- the bottom group has score percentile `<= 0.20` and the top group has score
  percentile `>= 0.80`; all equal scores stay in the same group; and
- compute the equal-weight mean target of each group and
  `topMinusBottom = topMean - bottomMean`.

These are ranking diagnostics, not an investable portfolio or a trading instruction.
No issuer is shorted, bought, or assigned an action by the product.

Across months, report the arithmetic mean, median, standard deviation, positive-month
fraction, and a two-sided 95% moving-block-bootstrap confidence interval. Resample
whole months in consecutive blocks of four and use 10,000 replicates. For every
replicate and required block, derive the block-start index from the first unsigned
64-bit big-endian word of
`SHA-256(campaignId + ":" + statisticId + ":" + replicateIndex + ":" + blockIndex)`,
modulo the number of valid starts. Concatenate blocks and truncate to the original
month count. Use the sorted replicate values at zero-based indices 249 and 9749 as
the percentile interval endpoints. The four-month block covers overlap in the
60-session target. The same resampled month indices and `statisticId` are used for
paired candidate-minus-baseline statistics.

## 8. Calibration and sensitivity

### 8.1 Rank calibration

The candidate is not a probability and must not be described as one. Calibration
means only that higher research-score groups have better observed relative price
outcomes.

For each split, aggregate issuer-month observations into five score-percentile groups
using `[0,.2]`, `(.2,.4]`, `(.4,.6]`, `(.6,.8)`, and `[.8,1]`, preserving score ties.
Report observation count and mean primary target per group. Required locked behavior:

- all five groups contain at least 100 total observations;
- Spearman correlation between group order and group mean target is at least `0.90`;
- the top-group mean exceeds the bottom-group mean; and
- no adjacent higher group underperforms the preceding group by more than `0.01`
  log-return units.

Do not isotonic-fit, rescale, clip, or remap the candidate to make this check pass.

### 8.2 Preregistered sensitivity table

The development and locked reports must repeat mean monthly Spearman and
top-minus-bottom for:

- 20-, 60-, and 120-session targets;
- primary unmodified labels and labels winsorized cross-sectionally at the 1st and
  99th percentiles within each month;
- all eligible issuers and a diagnostic excluding the bottom quintile of 20-session
  median official traded value; and
- minimum per-metric peer samples of 5 and 8.

Cross-sectional winsorization uses the sorted finite monthly targets and the linear
quantile `h = (n - 1) * p`: interpolate between `floor(h)` and `ceil(h)` for
`p = 0.01` and `p = 0.99`, then replace only values beyond those limits. The
liquidity diagnostic applies the same average-rank score-percentile rule as section
7.2 to the 20-session median official traded value and excludes values at or below
the 0.20 boundary; tied values are never split.

The liquidity and eight-peer variants are diagnostics only; they do not change the
primary population or candidate. Every variant must be computable from facts already
in the frozen panel. Missing sensitivity input is a protocol failure, not permission
to omit the row.

For 20 and 120 sessions, the locked mean monthly candidate Spearman must be positive.
For every other diagnostic, the 60-session Spearman and top-minus-bottom signs must
remain positive. A sign reversal rejects adoption even if the primary gate passes.

As a non-adoption trading-cost stress, subtract four times a one-way cost of 10, 25,
and 50 basis points from each 60-session gross top-minus-bottom observation (entry and
exit on both hypothetical legs). Report it clearly as a conservative arithmetic
stress with no borrow, capacity, or execution model. The mean stressed spread at 25
basis points must remain positive; it never creates a trading recommendation.

## 9. Acceptance gates

Gates execute in order. A later gate cannot cure an earlier failure.

### Gate 0 — source feasibility

Section 4.4 passes in full, exact source mappings and cost limits are reviewed, and
no bulk fetch has occurred before approval.

### Gate 1 — deterministic dataset and audit

- split construction matches section 6 exactly;
- identity, chronology, source-vintage, corporate-action, and terminal-outcome audits
  have zero unexplained errors;
- duplicates and cross-split observations are zero;
- future-record injection leaves every pre-injection feature and cohort unchanged;
- all source, mapping, panel, and label digests reproduce; and
- section 5.3 coverage passes for all three splits.

### Gate 2 — development go/no-go

Run the complete fixed report on development. Continue to locked only if development
meets every locked numerical threshold in Gate 3 and every required sensitivity sign
in section 8. No threshold, candidate, exclusion reason, split, or baseline may be
changed after this result. A development failure rejects version 1 without opening
locked labels.

### Gate 3 — locked evidence

All of the following are required on the locked split:

| Measure | Required result |
| --- | --- |
| mean monthly primary-target Spearman | `>= 0.03` and 95% CI lower bound `> 0` |
| positive monthly Spearman fraction | `>= 0.60` |
| mean 60-session top-minus-bottom | `>= 0.02` and 95% CI lower bound `> 0` |
| candidate minus `best_single_metric_v1` mean Spearman | `>= 0.005` and paired 95% CI lower bound `> 0` |
| candidate minus no-score spread | positive with 95% CI lower bound `> 0` |
| calendar-year stability | every represented year mean Spearman `> 0` |
| rank calibration | every requirement in section 8.1 passes |
| sensitivity | every required sign and 25-basis-point stress in section 8.2 passes |
| deterministic/no-look-ahead audit | 100% pass; zero unexplained exceptions |

These thresholds are conjunctive. There is no overall average, severity waiver,
rounded pass, “near pass,” or post-hoc subgroup exclusion.

### Gate 4 — adoption decision

Passing Gate 3 establishes evidence only. It does not authorize a runtime field or
UI. Adoption additionally requires a documented user need, acceptable maintenance
cost, and an independently reviewed Phase 4 implementation plan that updates
`docs/SPEC.md` and the roadmap before code.

If any Gate 3 threshold fails, record `reject_peer_percentile_equal_contribution_v1`.
Do not lower a threshold, alter a weight, remove a feature, select a favorable
horizon, or reuse the consumed locked split. A materially different candidate needs
a new plan version and a fresh future locked period not used for any prior decision.

## 10. No-look-ahead audit

The Phase 4 implementation plan must include automated fixtures and an auditable
campaign report proving at least:

- universe membership, sector, and issuer identity are reconstructed at each `t0`;
- every feature input was source-eligible at the after-close calculation boundary;
- later disclosures, corrections, deletions, classifications, price rows, and peers
  cannot change an earlier feature or cohort;
- feature values are parsed only after the availability filter;
- targets use only exact `t0`, `t20`, `t60`, and `t120` outcome rows;
- labels, label availability, and delisting handling never affect features, universe,
  candidate calculation, or split assignment;
- current Snapshot contents and current screener membership are absent from the
  research panel;
- train/development/locked observations and target horizons do not overlap across
  purged boundaries;
- development chooses only the best-single baseline identity and cannot modify the
  preregistered candidate or gates; and
- normal CI uses synthetic/local fixtures and performs no network or paid-provider
  request.

One hundred percent of sampled source rows and all boundary fixtures must pass.
Sampling may supplement but never replace exhaustive machine checks for dates,
digests, split membership, duplicates, and source-eligible inequalities.

## 11. Versioned campaign artifacts

A future Phase 4 campaign stores local research artifacts outside Snapshot and
Evaluator repositories. Its reviewed plan must use a create-only directory such as:

```text
.dexter/research/score-evaluations/<campaignId>/
```

At minimum, the immutable campaign manifest records:

- UUIDv4 `campaignId` and UTC creation time;
- `score_evaluation_plan_v1`;
- `peer_percentile_equal_contribution_v1`;
- all three target IDs;
- split algorithm version and exact anchor lists;
- exact source endpoints, source-plan entitlements, field mappings, availability
  rules, retrieval windows, and collection times;
- eligible issue-type allowlist and issuer-identity mapping version;
- peer Engine source commit and all calculation-version identities;
- observation, feature, label, exclusion-ledger, and code-commit digests;
- deterministic bootstrap seed;
- development report digest and locked-unseal state; and
- cost/request cap and actual source request count/cost.

Use the repository's `CanonicalJsonV1` and `sha256:<lowercase hex>` digest contract
for JSON manifests. Raw provider prompts or LLM responses do not exist. Credentials,
API keys, source URLs containing secrets, and unbounded source payloads must not be
persisted in the manifest or committed.

Available campaign states are:

```text
feasibility_rejected
development_rejected
locked_campaign_invalid
locked_rejected
locked_passed_pending_adoption_decision
adopted_by_separate_phase4_plan
```

There is no `passed` alias that implies runtime adoption.

## 12. Required Phase 4 implementation sequence

P3-C0 does not start these steps. A future Phase 4 plan must keep them separately
reviewable and ordered:

1. **S0 — source feasibility and cost review**
   - read-only entitlement/coverage proof and exact source mapping;
   - no bulk fetch and no score runtime.
2. **S1 — deterministic point-in-time panel**
   - local fixture-first universe, vintage, identity, peer, target, split, and digest
     implementation;
   - no locked-label read.
3. **S2 — train/development campaign**
   - freeze panel and run the complete development gate once.
4. **S3 — locked campaign authorization**
   - user explicitly approves the one-time unseal after reviewing cost, manifests,
     source audit, code commit, and development result.
5. **S4 — locked execution and evidence report**
   - one immutable result; no tuning or automatic rerun.
6. **S5 — adoption or rejection plan**
   - reject by default on any failed gate;
   - on full pass, decide separately whether a user-facing score is useful before
     changing SPEC, Snapshot, Dashboard, or analysis behavior.

Each implementation PR must run `bun test`, `bun run typecheck`, and
`git diff --check`. S1 adds deterministic unit/integration fixtures for all normal,
missing, invalid, zero, duplicate, chronology, future-injection, split-boundary,
corporate-action, identity-transition, and delisting cases. S2/S4 statistical tests
must verify hand-calculable ranks, ties, groups, bootstrap determinism, paired
statistics, coverage, and every gate boundary. Normal CI never accesses locked data
or external APIs.

## 13. P3-C0 acceptance and deferred scope

P3-C0 is complete when this document is independently reviewed and merged, required
repository validation passes, and inspection confirms that the PR contains no
runtime score, weight implementation, Snapshot/schema change, Dashboard output,
source fetch, dependency, CLI, or research artifact.

Explicitly deferred to a separately approved Phase 4 sequence:

- source feasibility execution and bulk historical collection;
- construction of a point-in-time research panel;
- statistical evaluation and locked-label access;
- any alternative feature, weight, model, target, or horizon;
- runtime score naming, storage, API, UI, explanation, threshold, or refresh policy;
- changes to Peer Radar;
- Buy/Sell, Entry, Stop, Target, portfolio, backtest, or execution behavior; and
- score-driven LLM interpretation.

Evaluator runtime and PDF remain independently deferred under
`docs/PHASE3_PLAN.md`; neither is a score input or a prerequisite for this protocol.
