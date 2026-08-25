# Repository Guidelines

- Repo: https://github.com/edinetdb/dexter-jp
- Dexter JP is a CLI-based AI agent for deep financial research on Japanese listed companies, built with TypeScript, pi-tui, and LangChain. Powered by EDINET DB API.
- This fork extends Dexter JP for a personal, local-only Japanese stock analysis system.

## Project Structure

- Source code: `src/`
  - Agent core: `src/agent/` (agent loop, prompts, scratchpad, token counting, types)
  - CLI interface: `src/cli.ts` (pi-tui), entry point: `src/index.tsx`
  - Components: `src/components/` (pi-tui UI components)
  - Controllers: `src/controllers/` (agent runner, model selection, input history)
  - Model/LLM: `src/model/llm.ts` (multi-provider LLM abstraction)
  - Tools: `src/tools/` (financial search, web search, browser, skill tool)
  - Finance tools: `src/tools/finance/` (financials, text-blocks, earnings, shareholders, key-ratios, screening)
  - Search tools: `src/tools/search/` (Exa, Perplexity, Tavily, LangSearch fallback chain)
  - Browser: `src/tools/browser/` (Playwright-based web scraping)
  - Skills: `src/skills/` (SKILL.md-based extensible workflows, e.g. DCF valuation)
  - Utils: `src/utils/` (env, config, caching, token estimation, markdown tables)
  - Evals: `src/evals/` (LangSmith evaluation runner with Ink UI)
- Config: `.dexter/settings.json` (persisted model/provider selection)
- Environment: `.env` (API keys; see `env.example`)
- Project docs:
  - `docs/SPEC.md`
  - `docs/MVP_IMPLEMENTATION_PLAN.md`
  - `docs/USER_SETUP.md`

## Build, Test, and Development Commands

- Runtime: Bun (primary). Use `bun` for all commands.
- Install deps: `bun install`
- Run: `bun run start` or `bun run src/index.tsx`
- Dev (watch mode): `bun run dev`
- Type-check: `bun run typecheck`
- Tests: `bun test`
- Evals: `bun run src/evals/run.ts` (full) or `bun run src/evals/run.ts --sample 10` (sampled)

## Coding Style & Conventions

- Language: TypeScript (ESM, strict mode). JSX via React (Ink for CLI rendering).
- Prefer strict typing; avoid `any`.
- Keep files concise; extract helpers rather than duplicating code.
- Add brief comments for tricky or non-obvious logic.
- Do not add logging unless explicitly asked.
- Do not create additional README or documentation files unless explicitly asked.
- Prefer small, reviewable changes.
- Do not refactor unrelated code.
- Preserve existing behavior unless the requested task requires a change.

## LLM Providers

- Supported: OpenAI (default), Anthropic, Google, xAI (Grok), Moonshot, DeepSeek, OpenRouter, Ollama (local), Claude Agent SDK.
- Default model: `gpt-5.6-terra`.
- Provider detection is prefix-based (`claude-` -> Anthropic, `gemini-` -> Google, etc.).
- Fast models for lightweight tasks: see provider `fastModel` values in `src/providers.ts`.
- Users switch providers/models via `/model` command in the CLI.
- LLM task profiles are provider-neutral orchestration intent: `deep_analysis`, `balanced`, and `fast_structured`.
- An omitted task profile must preserve the selected model and legacy provider behavior without adding reasoning parameters.
- Resolve a task profile once at the LLM boundary. `fastModel` selection belongs only to the central runtime resolver; call sites must not route to it manually.
- Standard Agent streaming and blocking fallback must share the same immutable resolved runtime for each model turn.

## Tools

- `get_financials`: meta-tool for all financial data queries (financials, metrics, earnings, analysis). Routes to sub-tools internally.
- `read_filings`: reads text from annual securities reports (有価証券報告書) and shareholder data.
- `company_screener`: screens ~3,800 Japanese listed companies by 100+ financial metrics.
- `web_search`: general web search with a configurable fallback chain across available Exa, Perplexity, Tavily, and LangSearch keys.
- `browser`: Playwright-based web scraping for reading pages the agent discovers.
- `skill`: invokes SKILL.md-defined workflows (e.g. DCF valuation).
- Tool registry: `src/tools/registry.ts`. Tools are conditionally included based on env vars.

## Financial Data Source

- **EDINET DB API** (edinetdb.jp): Structured financial data from ~3,800 Japanese listed companies
- Data sourced from EDINET annual securities reports (有価証券報告書) and TDNet earnings disclosures (決算短信)
- Coverage: up to 6 fiscal years, 100+ screening metrics, full report text, AI analysis
- Note: Stock price data is NOT available from EDINET DB; complement with J-Quants or other supported providers.

## Skills

- Skills live as `SKILL.md` files with YAML frontmatter (`name`, `description`) and markdown body (instructions).
- Built-in skills: `src/skills/dcf/SKILL.md` (adapted for Japanese market: JGB rates, JPY, TSE PBR context).
- Discovery: `src/skills/registry.ts` scans for SKILL.md files at startup.

## Environment Variables

- LLM keys: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_API_KEY`, `XAI_API_KEY`, `MOONSHOT_API_KEY`, `DEEPSEEK_API_KEY`, `OPENROUTER_API_KEY`
- Ollama: `OLLAMA_BASE_URL` (default `http://127.0.0.1:11434`)
- Finance: `EDINETDB_API_KEY`
- J-Quants: `JQUANTS_API_KEY`
- Search: `EXASEARCH_API_KEY` (preferred), `TAVILY_API_KEY` (fallback)
- Tracing: `LANGSMITH_API_KEY`, `LANGSMITH_ENDPOINT`, `LANGSMITH_PROJECT`, `LANGSMITH_TRACING`
- Never commit `.env` files or real API keys.

## Version & Release

- Version format: SemVer.
- Do not push or publish without user confirmation.

## Testing

- Framework: Bun's built-in test runner (primary), Jest config exists for legacy compatibility.
- Tests colocated as `*.test.ts`.
- Run `bun test` before pushing when you touch logic.
- Add tests for non-trivial financial and statistical calculations.
- At minimum, cover:
  - normal case
  - insufficient history
  - missing data where applicable
  - zero denominator where applicable
  - relevant boundary cases
- If a baseline test already fails before the current change, report it clearly instead of hiding it.

## Security

- API keys stored in `.env` (gitignored). Users can also enter keys interactively via the CLI.
- Config stored in `.dexter/settings.json` (gitignored).
- Never commit or expose real API keys, tokens, or credentials.
- Do not expose API keys in logs or error messages.

# Project Development Rules

This repository extends `edinetdb/dexter-jp` for a personal, local-only Japanese stock analysis system.

These rules apply to all implementation work unless a task explicitly says otherwise.

## 1. Core principle

> Reuse before build.

Inspect the existing implementation before writing new code.

Do not reimplement functionality that already exists in Dexter JP.

## 2. Scope discipline

- Implement only the requested Step from `docs/MVP_IMPLEMENTATION_PLAN.md`.
- Do not opportunistically implement future Steps.
- Do not refactor unrelated code.
- Keep diffs minimal.
- Prefer small, reviewable changes.
- Preserve existing behavior unless the requested Step requires a change.

## 3. Upstream compatibility

The project should remain easy to update from:

```text
edinetdb/dexter-jp
```

Therefore:

- Avoid large rewrites of upstream files.
- Prefer additive modules where appropriate.
- Reuse existing registries, tools, types, and conventions.
- Do not introduce a parallel architecture without a clear need.

## 4. Dependencies

- Do not add new dependencies by default.
- Prefer TypeScript / JavaScript standard capabilities.
- Reuse already-installed dependencies when suitable.
- If a new dependency is genuinely necessary, explain why before adding it.
- Do not introduce Python or a second runtime for the MVP unless explicitly requested.

## 5. Financial calculations

> Code calculates, AI interprets.

Core financial and statistical calculations must be implemented as deterministic code.

Examples:

- CAGR
- moving averages
- ATR
- RSI / MACD
- swing detection
- percentile / Z-score
- correlation / beta / alpha / R²
- peer statistics
- margin statistics
- risk / reward

Do not rely on an LLM to perform these calculations.

Prefer pure functions for non-I/O calculation logic.

## 6. Data integrity

- Never guess missing financial data.
- Never silently fabricate or infer API fields.
- Never silently fill missing market dates.
- Handle division by zero explicitly.
- Handle insufficient history explicitly.
- Preserve source dates / data dates where available.
- Missing data should produce a clear missing / unavailable state.

## 7. APIs

Do not guess API specifications.

For EDINET DB or J-Quants:

- Inspect existing repository implementation first.
- Verify current API specifications before adding endpoints if needed.
- Preserve existing authentication conventions where possible.
- Return understandable errors for unavailable endpoints or plan restrictions.
- Do not expose API keys in logs or errors.

## 8. Historical analysis

Prevent look-ahead bias.

For historical or backtest logic:

- Use only data available as of the simulated date.
- Do not use future filings, future prices, or future revisions.
- Do not forward-fill information across dates unless explicitly justified.

## 9. AI output rules

The AI may:

- plan research
- select tools
- interpret calculated values
- compare results
- explain risks
- synthesize Bull / Base / Bear scenarios

The AI must not:

- invent unavailable data
- invent Entry / Stop / Target prices
- substitute narrative reasoning for deterministic calculations
- hide important data gaps

Entry / Stop / Target values must come from deterministic rules or sourced facts.

## 10. Tests

Add tests for non-trivial calculation logic.

At minimum test:

- normal case
- insufficient data
- missing data where applicable
- zero denominator where applicable
- relevant boundary cases

Do not add meaningless tests only to increase coverage.

Before finishing a Step:

- run relevant unit tests
- run typecheck
- run existing tests appropriate to the change

If a baseline test was already failing before the change, report it clearly instead of hiding it.

## 11. Error handling

Prefer explicit and useful errors.

Do not:

- swallow errors silently
- return fabricated defaults that look valid
- mask parser failures as successful financial results

## 12. Project usage constraints

This project is:

- personal-use only
- local-execution only
- single-user

MVP does not require:

- public web deployment
- multi-user auth
- billing
- cloud infrastructure
- external public APIs
- Docker
- database servers

Do not build infrastructure for these non-goals.

## 13. Codex workflow

For each Step:

1. Read this file.
2. Read `docs/SPEC.md`.
3. Read the requested Step in `docs/MVP_IMPLEMENTATION_PLAN.md`.
4. Inspect relevant existing code.
5. Before major edits, state the minimal implementation approach.
6. Implement only the Step.
7. Add / update tests.
8. Run validation.
9. Review the diff for unnecessary changes.
10. Report:
   - changed files
   - tests run
   - results
   - remaining issues

### Git branch and pull request workflow

Pull request review follows `docs/REVIEW_POLICY.md`, the Single Source of Truth
for review roles and the Merge Gate. When acting as the Implementer:

- follow the Implementer responsibilities defined in that policy;
- run the required tests and validation before marking a pull request Ready for review;
- address review findings on the same pull request and rerun relevant validation;
- obtain an independent Reviewer's Merge Gate determination before merge;
- do not assign the Reviewer role to a specific human, AI system, product, or agent by default.

For each implementation Step:

1. Confirm that the previous Step is merged, then update local `main` from `origin/main` with a fast-forward-only pull.
2. Delete the previous Step's local branch only after confirming that it is merged into `main`.
3. Create a new branch from the updated `main` using `feat/<short-scope>-step<number>`.
4. Before committing, inspect the diff and stage only the files that belong to the current Step.
5. Run the required tests and typecheck before publishing the branch.
6. Commit, push, and create a draft pull request to `main` only after explicit user authorization for each publishing action.
7. Use a Conventional Commit-style title that summarizes the Step, for example `feat: add deterministic supply-demand analysis engine`.
8. Confirm that the pull request CI runs both typecheck and tests. Do not merge the pull request without user approval.
9. After the user merges the pull request, update local `main` with a fast-forward-only pull and delete the merged local Step branch.

Do not delete remote branches unless the user explicitly requests it.

## 14. Completion standard

A Step is not complete merely because code was written.

It is complete when:

- requested behavior exists
- tests cover the non-trivial logic
- typecheck passes, or baseline failures are documented
- unrelated behavior is unchanged
- the diff is minimal
- out-of-scope work was not added
