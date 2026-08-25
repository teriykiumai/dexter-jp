# Repository Operating Guide

## Repository and stack

- Repository: `teriykiumai/dexter-jp`; upstream: `edinetdb/dexter-jp`.
- Dexter JP is a Japanese-stock research agent; product scope is defined in
  `docs/SPEC.md`.
- Runtime and package manager: Bun.
- Language: TypeScript ESM in strict mode; React is used by the CLI and local Dashboard.
- Main code is under `src/`; finance tools are under `src/tools/finance/`, canonical
  analysis artifacts under `src/analysis/`, Dashboard code under `src/dashboard/`,
  and built-in skills under `src/skills/`.
- Local settings and analysis artifacts live under `.dexter/`; credentials belong in
  `.env` or the existing interactive configuration path and must remain untracked.

## Source of Truth

- `AGENTS.md` — repository operating, safety, validation, and Git/PR rules.
- `docs/SPEC.md` — product scope and invariants, including deterministic calculation,
  missing-data, no-look-ahead, AI responsibility, and local-use constraints.
- `docs/MVP_IMPLEMENTATION_PLAN.md` — completed MVP step contracts and baseline.
- `docs/VISUALIZATION_MVP_PLAN.md` — inherited Phase 1.5 Snapshot, persistence,
  local API, and Dashboard contracts.
- The applicable `docs/*_PLAN.md` — the requested phase/step contract, formulas,
  sequence, source rules, schema evolution, and phase-specific non-goals. Phase 2
  work uses `docs/PHASE2_PLAN.md`.
- `docs/REVIEW_POLICY.md` — Implementer/Reviewer responsibilities, severity,
  re-review, and the Merge Gate.
- `docs/*_HANDOFF.md` — non-normative context recovery only. A handoff never overrides
  a source plan, merged code, or tests.
- `Usage.md` and `docs/USER_SETUP.md` — current user operation and environment setup.

Use repository documents by authority and subject, not merely by recency:

1. `AGENTS.md` controls repository operations and safety.
2. `docs/SPEC.md` controls product scope and invariant behavior.
3. The applicable plan controls only its requested phase/step and must preserve
   inherited contracts unless it explicitly defines an approved versioned change.
4. Merged code and tests define the current implemented baseline.
5. Handoff documents summarize context and are never normative.

If an applicable plan appears to conflict with `AGENTS.md`, `docs/SPEC.md`, or an
inherited merged/tested contract without an explicit migration, do not silently pick
one. Stop, identify the conflict with evidence, and request direction.

At the start of a task:

1. Read `AGENTS.md` and `docs/SPEC.md`.
2. Read the requested scope in the applicable plan and any predecessor plan whose
   contract it inherits.
3. Use the relevant handoff only to recover context.
4. Read `docs/REVIEW_POLICY.md` for PR work.
5. Inspect the current implementation and relevant tests before proposing changes.
6. Before major edits, state the minimal approach and affected scope.

## Commands

- Install: `bun install`
- Run: `bun run start` or `bun run src/index.tsx`
- Develop: `bun run dev`
- Test: `bun test`
- Type-check: `bun run typecheck`
- Evals: `bun run src/evals/run.ts` or `bun run src/evals/run.ts --sample 10`
- Dashboard: `bun run dashboard`

Use Bun for repository commands unless an applicable plan explicitly requires
otherwise.

## Scope and implementation discipline

- Implement only the requested scope from the applicable project plan. Do not
  opportunistically implement a later step or future phase.
- Reuse the existing implementation before adding code. Inspect utilities, engines,
  clients, registries, types, and tests before creating an abstraction.
- Keep diffs minimal and reviewable. Do not mix unrelated refactors, cleanup,
  formatting, documentation, or behavioral changes into the task.
- Preserve existing behavior unless the requested contract explicitly changes it.
- Keep upstream updates practical: avoid broad rewrites of upstream files, prefer
  existing extension points and additive modules, and do not create a parallel
  architecture without a demonstrated need.
- Do not create new README or documentation files, add logging, or perform unrelated
  cleanup unless explicitly requested.

Product calculation, data-integrity, historical-analysis, AI-output, Entry/Stop/
Target, and deployment invariants are defined in `docs/SPEC.md`. Formula-, source-,
Snapshot-, and presentation-specific rules belong to the applicable plan; do not
duplicate or weaken them in implementation.

## TypeScript and error handling

- Use TypeScript ESM and strict typing; avoid `any`.
- Keep files concise and extract helpers only when that reduces real duplication.
- Prefer pure functions for deterministic non-I/O logic.
- Add brief comments for non-obvious decisions, not narration of straightforward code.
- Prefer explicit, useful errors. Do not swallow failures, fabricate successful
  defaults, or mask parsing/source failures as valid financial results.
- For EDINET DB, J-Quants, or another external API, inspect existing clients and
  authentication first, reuse existing authentication/error conventions, and verify
  the current official specification. Never guess endpoint fields, availability, or
  plan behavior.

## Dependencies and runtimes

- Do not add dependencies by default. Prefer the TypeScript/JavaScript standard
  library and already-installed packages.
- Add a dependency only when the requested scope genuinely requires it; explain the
  need and wait for any required authorization before changing package files.
- Do not introduce Python, another runtime, a framework, or infrastructure merely for
  convenience when Bun/TypeScript and the current architecture suffice.

## Secrets and local data

- Never commit or expose `.env`, real API keys, tokens, credentials, or secret-bearing
  local configuration.
- Never include secrets in logs, errors, Snapshot data, HTTP responses, Browser
  bundles, fixtures, PR text, or test output.
- Preserve existing gitignore, local-only storage, path-containment, identity, and
  secret-filtering protections when working near them.

## Tests and validation

- Use Bun's test runner and colocated `*.test.ts` files unless the existing area has a
  different established convention.
- Add meaningful tests for changed behavior. Non-trivial deterministic financial or
  statistical calculations require unit tests covering the applicable normal,
  insufficient/missing, zero-denominator, invalid, and boundary cases.
- Reuse existing regression tests and avoid tests that only inflate coverage or lock
  incidental implementation details.
- Run the relevant focused tests while working. Before publishing a PR, run the
  task-required validation; unless a narrower task says otherwise, this includes:

```text
bun test
bun run typecheck
git diff --check
```

- Never claim a command passed if it was not run. Report unavailable validation and
  its risk.
- If a baseline test already fails, report it clearly. Do not hide it, rewrite the
  test, or attribute it to the current change without evidence.
- Before committing, inspect the complete diff and stage only in-scope files.

## Git, pull requests, and review

- Follow `docs/REVIEW_POLICY.md`; do not restate or redefine its severity levels or
  Merge Gate here.
- As Implementer, complete required validation before marking a PR Ready for review,
  address findings on the same PR, rerun relevant validation, and respect an
  independent Reviewer's Merge Gate decision. Do not fix the Reviewer role to a
  particular human, AI system, product, or agent.
- Before a dependent step, confirm the preceding PR is merged and update local `main`
  from `origin/main` with a fast-forward-only pull.
- Delete a previous local step branch only after confirming it is merged. Never delete
  a remote branch without explicit user authorization.
- Create a dedicated branch from updated `main`. For implementation steps, use
  `feat/<short-scope>-step<number>` unless the task specifies another name.
- Use a Conventional Commit-style title and keep one clear purpose per PR.
- Obtain explicit user authorization before pushing, publishing or creating a PR,
  marking it Ready, releasing, or merging. Never merge a PR yourself without that
  authorization.
- Create Draft PRs against `main`, confirm CI runs the required tests/typecheck, and
  disclose any failure or missing check. Releases use SemVer.
- After the user merges, fast-forward local `main`; only then remove the merged local
  branch.

## Completion and report

A task is complete only when the requested behavior or document change exists, the
appropriate tests and validation pass or baseline failures are disclosed, the diff
is minimal, and no future scope was implemented.

Report the changed files, validation commands and results, and any remaining issue or
risk.
