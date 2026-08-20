---
name: mvp-analysis
description: >
  Runs one requested deterministic Japanese-stock analysis workflow: technical
  indicators, margin supply-demand, peer comparison, TOPIX correlation, or
  Entry/Stop/Target strategy. Use for questions about chart trend,
  SMA/ATR/Swing levels, credit balances, peer valuation/quality ranking,
  market beta/correlation, or evidence-based trade levels.
---

# MVP Deterministic Analysis

Use only the workflow requested by the user. Do not run every workflow or create a comprehensive report unless explicitly requested; comprehensive orchestration belongs to a later workflow.

For a broad whole-company request such as `7203を分析して`, use the `comprehensive-analysis` skill instead.

## Non-negotiable rules

- Data tools acquire facts; `analyze_*` tools perform every financial or statistical calculation.
- Never calculate or repair SMA, ATR, percentiles, correlation, beta, alpha, R², Entry, Stop, Target, or reward/risk in prose.
- Preserve null values and source dates. Do not forward-fill market dates or infer missing API fields.
- If a tool reports an unavailable metric, disclose it instead of estimating it.
- Interpret the structured result only after the deterministic tool returns.

## Technical analysis

1. Call `get_stock_price` for enough chronological adjusted OHLCV history. Use at least 60 trading days when available.
2. Map the returned rows without changing dates or nulls and call `analyze_technical`.
3. Explain trend, price versus SMA20, ATR14, Swing High/Low, and volume only from that result.
4. State `dataDate` and every unavailable metric.

## Supply and demand

1. Call `get_margin_data` for at least 52 weekly observations when the plan and history allow.
2. Call `get_stock_price` for daily volume covering at least the latest 20 trading days and the margin data date.
3. Pass the histories to `analyze_supply_demand` in chronological order.
4. Interpret margin ratio, weekly changes, 13/52-week position, percentile, and digestion days. State both `dataDate` and `volumeDataDate`.

## Peer comparison

1. Use `get_financials` to verify the target company, TSE 33-sector, market cap, data date, and available comparison metrics.
2. Use `company_screener` to obtain a broad same-sector candidate set. Do not choose peers by memory.
3. Map only sourced values into `target` and `candidates`, then call `analyze_peer_comparison`. The engine performs the 0.3x–3x prioritization, 5–10 peer selection, sector-leader inclusion, median, rank, and percentile.
4. Separate valuation metrics from profitability/growth metrics and disclose `tooFewPeers` or unavailable metrics.

## TOPIX correlation

1. Call `get_stock_price` and `get_topix` over the same range, with at least 251 common closes when available.
2. Pass the two chronological close series to `analyze_market_correlation`.
3. Interpret the 60-day and 250-day results separately. Do not align or forward-fill dates yourself.
4. State `dataDate`, `alignedPriceCount`, observation counts, and unavailable reasons.

## Entry / Stop / Target

1. Complete the Technical analysis workflow first.
2. Pass `dataDate`, `latestSwingHigh`, `latestSwingLow`, and `atr14` from `analyze_technical` to `analyze_strategy`.
3. Supply `tickSize` or `resistanceLevels` only when they come from a reliable source. Otherwise omit them.
4. Present each candidate's price, reason, risk, reward, and reward/risk. Never invent an alternative price.

## Output

Keep Fact, Interpretation, and Risk distinct. Include the relevant data dates, deterministic results, unavailable data, and a concise explanation of what the calculations do and do not imply.
