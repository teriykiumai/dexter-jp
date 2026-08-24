---
name: comprehensive-analysis
description: >
  Performs a complete Japanese listed-company analysis across company identity,
  fundamentals, valuation, peers, technicals, margin supply-demand, TOPIX
  correlation, deterministic Entry/Stop/Target, Bull/Base/Bear scenarios, and
  risks. Use for broad requests such as "7203を分析して", "この銘柄を総合分析",
  "full analysis", or "investment analysis" rather than a single metric.
---

# Comprehensive Japanese Stock Analysis

Run the complete MVP workflow for one company. Reuse retrieved datasets between phases and do not repeat equivalent calls.

## Tool surface

- Standard Agent: call `get_financials` once with a complete request for company identity, six-year financial history, latest valuation/quality ratios, and recent earnings. Use `company_screener` for the same-sector candidate set.
- Claude Agent SDK: use the available leaf tools `get_company_info`, `get_financial_statements`, `get_key_ratios`, and `get_earnings`; use `screen_companies` for the candidate set.
- Both modes: use `read_filings`, `get_stock_price`, `get_margin_data`, `get_topix`, and the six `analyze_*` tools when available.

Never call a tool name that is absent from the current tool list.

## Progress checklist

```text
- [ ] Company identity and listing status
- [ ] Fundamental and valuation facts
- [ ] Peer comparison
- [ ] Stock, margin, and TOPIX histories
- [ ] Technical analysis
- [ ] Supply and demand analysis
- [ ] Market correlation analysis
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
2. Pass adjusted OHLCV to `analyze_technical`; use its existing Technical fields and its structured `advancedTechnical` companion from the same call.
3. Pass margin balances and stock volume to `analyze_supply_demand`.
4. Pass stock and TOPIX closes to `analyze_market_correlation`.
5. Pass the verified target `ticker` plus `dataDate`, `latestSwingHigh`, `latestSwingLow`, and `atr14` from the Technical result to `analyze_strategy`.
6. Supply Strategy `tickSize` or `resistanceLevels` only when a reliable source provided them; otherwise omit them. Without a sourced tick size, report the strictly-above trigger but no exact entry or 2R target.

Never reproduce or repair the Engine calculations in narrative reasoning. Carry every `unavailable` reason into the report.

Pass the complete retrieved histories to the Engines. Do not shorten OHLCV to the
latest 20 bars before Technical, do not omit any weekly margin observations, and
do not reuse a Technical-only slice for Supply & Demand or Market Correlation.
When stock and TOPIX histories are available, call `analyze_market_correlation`
before writing the report.

For comprehensive analysis, prefer the direct ticker mode supported by
`analyze_technical`, `analyze_supply_demand`, and `analyze_market_correlation`:
pass the company ticker plus the same `from` and `to` dates used for retrieval.
This reuses the existing J-Quants tools inside each deterministic analysis tool
and avoids re-serializing or accidentally shortening large histories.

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
# Peer Comparison
# Technical
# Supply & Demand
# Market Correlation
# Entry / Stop / Target
# Bull / Base / Bear
# Risks
# Conclusion
```

Under `Data Dates`, list the basis date for company financials, earnings, stock prices, margin data, TOPIX, and each Engine result when available. Within the report, separate Fact, Interpretation, and Risk. The conclusion must summarize the evidence and limitations without inventing a recommendation or price.
