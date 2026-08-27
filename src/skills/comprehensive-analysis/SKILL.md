---
name: comprehensive-analysis
description: >
  Performs a complete Japanese listed-company analysis across company identity,
  fundamentals, valuation, peers, technicals, margin supply-demand, public
  short-position reports, investor-type market context, TOPIX correlation,
  as-of TSE 33-sector benchmark comparison and short-selling flow context,
  as-of advanced dividend context, deterministic Entry/Stop/Target,
  Bull/Base/Bear scenarios, and risks. Use for broad requests such as
  "7203を分析して", "この銘柄を総合分析",
  "full analysis", or "investment analysis" rather than a single metric.
---

# Comprehensive Japanese Stock Analysis

Run the complete MVP workflow for one company. Reuse retrieved datasets between phases and do not repeat equivalent calls.

## Tool surface

- Standard Agent: call `get_financials` once with a complete request for company identity, six-year financial history, latest valuation/quality ratios, and recent earnings. Use `company_screener` for the same-sector candidate set.
- Claude Agent SDK: use the available leaf tools `get_company_info`, `get_financial_statements`, `get_key_ratios`, and `get_earnings`; use `screen_companies` for the candidate set.
- Both modes: use `read_filings`, `get_stock_price`, `get_margin_data`, `get_topix`, and the available `analyze_*` tools.

Never call a tool name that is absent from the current tool list.

## Progress checklist

```text
- [ ] Company identity and listing status
- [ ] Fundamental and valuation facts
- [ ] Advanced dividend context
- [ ] Peer comparison
- [ ] Stock, margin, and TOPIX histories
- [ ] Technical analysis
- [ ] Supply and demand analysis
- [ ] Public short-position reports
- [ ] Investor-type market context
- [ ] Market correlation analysis
- [ ] TSE 33-sector benchmark analysis
- [ ] TSE 33-sector short-selling flow context
- [ ] Strategy candidates
- [ ] Bull / Base / Bear and risks
- [ ] Final report and missing-data audit
```

## 1. Verify the company

Resolve the user-supplied identifier with a company-data tool before repeating a securities code or EDINET code. Confirm company name, listing status, TSE 33-sector, and the latest company-data date. Lock that verified four-character securities code, including a valid JPX alphanumeric code when applicable, as the target ticker for the rest of the run. Every target-company source and `analyze_*` call must use that ticker; only peer candidates may use different tickers. Stop presenting the company as an active investment candidate if it is delisted.

## 2. Fundamental and valuation

Acquire up to six annual periods when available, the latest ratios, and recent earnings disclosures. Cover only sourced metrics:

- revenue, operating income, ordinary income, net income, and EPS trends
- operating margin, ROE, ROA, equity ratio, operating cash flow, and free cash flow
- PER, PBR, dividend yield, payout ratio, PSR, EV/EBITDA, or FCF yield only when returned by a tool
- current versus company history and later versus Peer median when comparable observations exist

After acquiring the latest adjusted close, map the chronological annual rows into `analyze_financial_metrics`. Use its PER, PBR, dividend yield, and revenue CAGR in the report. Do not calculate or repair these values in prose. If the Engine marks one unavailable, report the sourced inputs and limitation without inventing the derived value.

Use `read_filings` for material business risks and management context when available. Treat tool-provided AI analysis as a secondary interpretation, not a replacement for reported facts.

## 3. Peer comparison

Obtain a broad same-sector candidate set from `company_screener` or `screen_companies`; never choose peers from memory. Map only sourced sector, market cap, metric, and data-date fields into `analyze_peer_comparison`. Let the engine select 5–10 peers, prioritize the 0.3x–3x market-cap range, include the sector leader where applicable, and calculate median/rank/percentile.

For the Standard Agent, explicitly request `peer_cohort` behavior for the verified
industry, sorted by revenue with a limit of 20. The screener retrieves each Peer
metric independently and merges the same-sector union by securities code. Do not
replace this with combined PER/PBR/profitability/growth AND conditions, because a
company missing one metric must remain eligible for every other metric. Map the
merged sourced fields into `analyze_peer_comparison`; do not stop at listing names.

Disclose `tooFewPeers`, missing target metrics, and insufficient peer data.

## 4. Acquire market histories

Use one common range long enough for at least 251 common trading closes and 52 weekly margin observations when the subscription and listing history allow:

- `get_stock_price`: chronological adjusted OHLCV
- `get_margin_data`: chronological weekly long and short balances
- `get_topix`: chronological TOPIX closes

Preserve dates and nulls. Do not forward-fill, interpolate, or silently remove missing API fields.

## 5. Run deterministic engines

1. Pass the verified target `ticker`, latest adjusted close, and chronological annual financial rows to `analyze_financial_metrics`.
2. Call `analyze_advanced_dividend` with the verified target `ticker` and an explicit `analysisAsOfDate`. For historical analysis, use the simulated as-of date. Otherwise use the current analysis date. Interpret only its as-of/correction-processed structured result.
3. Pass adjusted OHLCV to `analyze_technical`; use its existing Technical fields and its structured `advancedTechnical` companion from the same call.
4. Pass margin balances and stock volume to `analyze_supply_demand`.
5. Call `analyze_reported_short_positions` with the verified target `ticker` and the same explicit `analysisAsOfDate`. Treat `disclosedDate` as the information-availability date and `calculatedDate` only as the position reference date.
6. Call `analyze_investor_type_flows` with the verified target `ticker` and the same explicit `analysisAsOfDate`. Interpret only its correction/as-of-processed structured result.
7. Pass stock and TOPIX closes to `analyze_market_correlation`.
8. Call `get_sector_index` once with the verified target `ticker`, the same history start, and the explicit `analysisAsOfDate`. Pass its full structured source result to `analyze_sector_benchmark` and interpret only the deterministic result.
9. Call `analyze_sector_short_ratio` with the verified target `ticker`, the same history start, and the explicit `analysisAsOfDate`. Supply only the structured `sectorIdentity` envelope returned by that `get_sector_index` call. Never construct or pass a bare classification. Caller-supplied provenance is not proof: the tool re-resolves the target and source boundary through the official resolver and requires every identity/classification field to match before use. Interpret only its structured deterministic result.
10. Pass the verified target `ticker` plus `dataDate`, `latestSwingHigh`, `latestSwingLow`, and `atr14` from the Technical result to `analyze_strategy`.
11. Supply Strategy `tickSize` or `resistanceLevels` only when a reliable source provided them; otherwise omit them. Without a sourced tick size, report the strictly-above trigger but no exact entry or 2R target.

Never reproduce or repair the Engine calculations in narrative reasoning. Carry every `unavailable` reason into the report.
When `mean4w` is available, interpret it as the recent buying-balance baseline alongside
the current balance and existing 13-week mean; do not derive an unprovided deviation or signal.
Interpret the 20-day market-correlation window as recent context alongside the existing
60-day and 250-day windows; do not derive a threshold, regime label, or trading signal.

Interpret only the structured `analyze_advanced_dividend` result. Keep actual and
company-forecast fiscal observations separate, including current versus next fiscal
year source fields. Distinguish `disclosedDate`/`disclosedTime`,
`sourceEligibleDate`, fiscal-year end, and `dataDate`; do not use a disclosure before
its processed eligibility boundary or back-apply a current forecast. Annual dividend
per share is a source JPY-per-share amount, source payout ratio is a ratio, and the
existing dividend yield is the separate deterministic value from
`analyze_financial_metrics`. Do not calculate or repair payout ratio, yield, growth,
CAGR, increase/cut streak, or split adjustment in the LLM.

Keep optional event rows separate after deterministic correction/deletion replay.
Distinguish total, ordinary, commemorative, and special JPY-per-share fields; do not
sum events into an annual dividend or merge them with the financial-summary annual
value. A null component or `component_breakdown_unavailable` is unavailable, not
zero. `event_source_plan_unavailable` or other event unavailability does not mean
ordinary-only, no special dividend, or no dividend. Do not infer payout policy, DOE,
combined capital return, threshold, score, Entry/Stop/Target, or Buy/Sell signal.
Carry every core, event, and component unavailable reason into the report and make no
dividend claim from missing data.

Interpret only the structured `analyze_sector_benchmark` result. This compares the
issuer's adjusted returns with the single official TSE 33-sector price index resolved
at `analysisAsOfDate`; it does not attribute sector-index values or flows to the
issuer. Distinguish `analysisAsOfDate`, `classificationDate`, and `dataDate`. The one
as-of sector benchmark is fixed across every 20/60/250 return window. Do not claim
that the issuer belonged to that sector throughout each lookback, stitch multiple
sector indices, or apply a current classification to a historical analysis. Use only
the Engine-provided observations, correlation, beta, annualized alpha, R-squared,
volatilities, excess return, and unavailable reasons; do not recalculate or repair
them in the LLM. Do not combine the result with Supply/Demand, public short-position
reports, or investor-type flows. Do not derive a sector rank, rotation/momentum or
composite score, threshold, risk-on/off classification, Entry/Stop/Target, or Buy/Sell
signal. If classification, sector-index data, or a metric is unavailable, state the
gap and make no sector-based investment claim.

Interpret only the structured `analyze_sector_short_ratio` result. It is daily
selling-turnover context for the one TSE 33-sector resolved at `analysisAsOfDate`,
not the analyzed issuer's short position, short-interest balance, or margin-interest
selling balance. Keep `analysisAsOfDate`, `classificationDate`, sector identity,
observation `date`, and `dataDate` distinct. Preserve the three source JPY components
and use only the Engine-provided `shortSellingValue`, `totalSellingValue`, and
`shortSellingRatio`; do not recalculate or repair them in the LLM. Do not forward-fill
missing dates or values, aggregate sectors or dates, or derive a mean, rank, trend,
threshold, squeeze/crowding label, composite score, or Buy/Sell signal. Do not add or
combine this result with the sector benchmark, issuer public short-position reports,
Supply/Demand, or investor-type flows. If source data or an observation is unavailable,
state the exact gap and make no sector-flow investment claim.

Interpret only the structured `analyze_reported_short_positions` result. J-Quants
short-sale-report covers public reports for short-position ratios of 0.5% or more;
it is neither total market short interest nor the weekly margin-interest selling
balance. Keep every reporter/fund report separate, including reports with the same
`calculatedDate`. Do not aggregate, normalize, merge, forward-fill, or locate a
previous report. Use only the Engine-provided `ratioDelta`; do not calculate or
repair it in prose. `no_public_disclosure_data` means only that no qualifying public
report was obtained, not that short positions or short sellers are absent, positions
below 0.5% are absent, or covering is complete. Carry `invalid_data` and null previous
values as unavailable. Do not derive a short-squeeze threshold, score, classification,
or Buy/Sell signal from these reports. Missing or unavailable report data must not
support an investment claim.

Interpret only the structured `analyze_investor_type_flows` result. It is weekly
`TokyoNagoya` market-section context for the Tokyo/Nagoya market as a whole, not
evidence that an investor category bought or sold the analyzed issuer. Because the
data has a publication lag, distinguish `periodStartDate` and `periodEndDate` from
`publishedDate`; use `publishedDate` as the selected result's publication/data date.
Use only the correction/as-of-processed period returned by the Engine. Preserve the
source `summary` and `brokerageBreakdown` hierarchy and exact category names. Do not
reclassify, merge, or aggregate categories, and do not recalculate or repair source
`sell`, `buy`, `total`, or `balance` values in the LLM. Do not add, net, normalize,
or reconcile this market context with issuer-level Supply/Demand or reported short
positions. Do not forward-fill a missing week or attribute a market-section value
to the issuer. Do not derive a threshold, rank, crowding score, risk-on/off
classification, or Buy/Sell signal. If the result is unavailable, state the data
gap and make no investment claim from it.

Pass the complete retrieved histories to the Engines. Do not shorten OHLCV to the
latest 20 bars before Technical, do not omit any weekly margin observations, and
do not reuse a Technical-only slice for Supply & Demand or Market Correlation.
When stock and TOPIX histories are available, call `analyze_market_correlation`
before writing the report.

For comprehensive analysis, prefer the direct ticker mode supported by
`analyze_advanced_dividend`, `analyze_technical`, `analyze_supply_demand`, and
`analyze_market_correlation`. Pass the verified company ticker to each; for the
history-based tools, also pass the same `from` and `to` dates used for retrieval.
This reuses the existing J-Quants tools inside each deterministic analysis tool
and avoids re-serializing or accidentally shortening large histories.
Use the same explicit `analysisAsOfDate` for `analyze_advanced_dividend` and preserve
its structured source-availability result; do not substitute a fiscal or record date.
Use the same direct ticker boundary for `analyze_reported_short_positions`, with the
explicit `analysisAsOfDate`; do not substitute `calculatedDate` for that boundary.
Use that explicit boundary for `analyze_investor_type_flows` as well; do not substitute
`periodEndDate` for publication availability.
Use one `get_sector_index` source result for both sector consumers: pass the complete
source result to `analyze_sector_benchmark` and its structured `sectorIdentity` envelope
to `analyze_sector_short_ratio`. Keep the same history start and explicit
`analysisAsOfDate`; do not reconstruct a bare classification, change `issuerCode`,
replace source provenance, or substitute a current classification for a historical
analysis. The short-ratio source re-resolves and exactly matches the envelope against
the official equity master; literal provenance fields alone are never authentication.
If the envelope is unavailable, let the analysis tool resolve the target rather than
inventing identity fields.

## 6. Build conditional scenarios

AI may synthesize conditions and implications from facts and Engine results, but may not create prices.

- Bull: state the fundamental, peer, technical, supply-demand, and market conditions required for upside. A price may be shown only when it is a sourced resistance or a calculated Strategy target.
- Base: state the conditions under which the current evidence remains mixed or stable. Omit a scenario price unless an existing sourced/calculated level genuinely represents it.
- Bear: state deterioration and invalidation conditions. A price may be shown only when it is a calculated Strategy stop or another sourced level.

Each scenario must distinguish its trigger, supporting evidence, invalidation condition, and material risks. Do not convert a narrative scenario into Buy/Sell advice.

## 7. Missing-data audit

Before writing the report, verify every phase. If a tool, endpoint, plan, history window, or metric is unavailable:

- name the missing phase or metric
- retain the phases that succeeded
- explain the resulting limitation
- make no substitute claim

## 8. Required output

Use these headings exactly and in this order:

```markdown
# Summary
# Data Dates
# Fundamental
# Valuation
# Advanced Dividend
# Peer Comparison
# Technical
# Supply & Demand
# Reported Short Positions
# Investor Type Flows
# Market Correlation
# Sector Benchmark
# Sector Short-selling Flow
# Entry / Stop / Target
# Bull / Base / Bear
# Risks
# Conclusion
```

Under `Data Dates`, list the basis date for company financials, earnings, stock prices, margin data, advanced dividend, public short-position reports, investor-type flows, TOPIX, sector benchmark, sector short-selling flow, and each Engine result when available. For advanced dividend, show `analysisAsOfDate`, `dataDate`, and each used `disclosedDate`/`notifiedDate` separately from `sourceEligibleDate`; do not present a fiscal, record, ex, or payment date as the information date. For public short-position reports, label `disclosedDate` as the information-availability date and do not present `calculatedDate` as the disclosure date. For investor-type flows, show `section = TokyoNagoya`, `publishedDate`, `periodStartDate`, and `periodEndDate` separately and identify the values as market context rather than issuer flow. For the sector benchmark, show `analysisAsOfDate`, `classificationDate`, sector code/name, index code, and `dataDate` separately. For sector short-selling flow, show `analysisAsOfDate`, `classificationDate`, sector code/name, and `dataDate` separately and identify the observations as sector-wide turnover rather than issuer data. Within the report, separate Fact, Interpretation, and Risk. The conclusion must summarize the evidence and limitations without inventing a recommendation or price.
