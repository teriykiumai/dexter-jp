# Dexter JP Research Rules

These rules apply to every Japanese equity research request.

## Evidence and data integrity

- Never guess or fabricate financial data, market data, company identifiers, API fields, or event details.
- If required data is missing, stale, restricted by an API plan, or unavailable, state that explicitly and do not substitute an estimate that looks factual.
- Preserve and report the source date or data date for every material dataset. Distinguish the data date from the retrieval date when both are available.
- Prefer primary or official sources. When sources conflict, describe the conflict instead of silently choosing one.
- Do not infer units, currencies, reporting periods, or accounting standards when the source does not establish them.

## Analysis discipline

- Separate important conclusions into Fact, Interpretation, and Risk. Do not present an interpretation as a sourced fact.
- Use deterministic tools or code for financial and statistical calculations. The AI may interpret results but must not replace calculations such as CAGR, technical indicators, peer statistics, correlation, or risk/reward.
- Disclose missing analysis phases and material data limitations in the final report.
- Avoid a simple Buy/Sell conclusion when the evidence supports only a conditional view.

## Peer comparison

- Compare the target with companies in the same TSE 33-sector classification when reliable sector data is available.
- Prefer peers with market capitalization between 0.3x and 3x the target and use 5-10 peers when sufficient candidates and metrics are available.
- Prefer medians over means, and report the target's rank or percentile only when calculated by a deterministic tool.
- If peer selection or comparable metrics are insufficient, disclose the limitation rather than broadening the peer set without explanation.

## Entry, Stop, Target, and scenarios

- Entry, Stop, and Target prices require a sourced market level or a deterministic calculation with an explicit reason.
- Never invent an Entry, Stop, Target, resistance level, or reward/risk ratio. If the required calculation is unavailable, mark the value unavailable.
- Bull, Base, and Bear cases must be conditional and must identify the facts or calculated thresholds that would support or invalidate each case.
- Scenario prices must derive from sourced facts or deterministic Technical/Strategy results, never from narrative judgment alone.

## Historical analysis

- Prevent look-ahead bias. For analysis as of a historical date, use only filings, prices, events, and revisions that were available by that date.
- Do not forward-fill missing market dates or financial information unless an approved deterministic method explicitly requires it and the report discloses it.

## Report requirements

- Lead with a concise summary, followed by Data Dates and the analysis sections relevant to the request.
- Include material risks, contradictory evidence, and missing-data disclosures before the conclusion.
- Keep claims traceable to retrieved facts or deterministic calculation results.
