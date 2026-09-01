# Dexter JP Phase 4 Handoff

**Status:** P4-X closeout candidate; Phase 4 is not Done until this exact candidate passes independent review, is merged, and local `main` is fast-forwarded

**Last Updated:** 2026-09-01

## 1. How to use this file

This handoff restores context only. It does not approve work, override
`AGENTS.md` / `docs/SPEC.md` / `docs/PHASE4_PLAN.md`, replace merged code and tests,
or prove a PR passed review. Resolve conflicts in favor of the applicable Source of
Truth and the exact merged implementation.

Before acting, verify the current checkout, `origin/main`, applicable PR head, CI,
independent review, and Merge Gate. Do not infer live Git or GitHub state from this
file.

## 2. Merged Phase 4 baseline

P4-X starts from local and `origin/main` at:

```text
14d6fad0c2248e012da0e97338cd3a890c244765
Merge pull request #92 from teriykiumai/feat/phase4-dashboard-validation-step8
```

The required implementation steps were independently reviewed and merged in order:

| Step | PR | Merge commit | Implemented boundary |
| --- | --- | --- | --- |
| P4-0 | #84 | `e4cb9fb` | Source of Truth and detailed design |
| P4-I0 | #85 | `9691bfa` | pure point-in-time/calendar/adjustment/tick/source primitives |
| P4-I1 | #86 | `b727ea7` | strict J-Quants adapter, bounded runtime, feasibility gate |
| P4-V1 | #87 | `1acdbab` | pure daily-OHLC outcome validator |
| P4-R1 | #88 | `82a73f5` | manifest, immutable run repository, aggregation |
| P4-S1 | #89 | `a412904` | saved-Snapshot audit CLI |
| P4-C1 | #90 | `ebb8203` | `technical_251_strategy_v1` campaign CLI |
| P4-J1 | #91 | `03aed7f` | local job/CSRF/read API |
| P4-D1 | #92 | `14d6fad` | sixth Dashboard tab and explicit run/case inspection |

This list records the predecessor baseline only. P4-X itself remains unmerged while
this handoff is a candidate.

## 3. Implemented operational surface

### 3.1 Saved-Snapshot audit

An exact stored Snapshot is selected without latest fallback:

```bash
bun run validate:strategy -- --ticker <ticker> --snapshot-id <snapshotId>
```

The run uses the `precommitted` confidence track. Local date/candidate failures that
need no source request do not prompt for J-Quants. Any path that requires external
requests remains default-No and shows the bounded execution plan before acceptance.

### 3.2 Historical campaign

A strict UTF-8, no-BOM, at-most-1-MiB manifest is selected explicitly:

```bash
bun run validate:strategy -- --manifest <campaign.json>
```

The run uses `reconstructed_251_as_of` and
`technical_251_strategy_v1`. It is a standardized retrospective policy, not a replay
of the current full-history production analysis and not exact historical correction-
vintage reproduction.

Non-interactive external execution requires the explicit flag:

```text
--confirm-external-fetch
```

### 3.3 Storage

Only complete, self-contained runs are atomically published under:

```text
.dexter/research/strategy-validation/runs/<runId>/
```

Runs are create-only. Equal reruns receive new publication UUIDs while canonical
candidate identities/order remain stable. Mutable job records are separate recovery
state. Cancellation, failure, timeout, or interruption before promotion never
publishes a partial run. The default no-replace directory promotion is supported on
Windows; other platforms fail closed with `publish_unsupported`.

### 3.4 Dashboard

The Single Stock Dashboard has six stable tabs. The added identity is:

```text
validation / 戦略検証
```

The tab supports saved-Snapshot or Campaign JSON preflight, an explicit default-No
quota/external-send confirmation, one global background job, polling, cancellation,
and explicit run/case selection. Completion does not auto-open or auto-select a run.

Selection is hierarchical and URL-backed:

```text
?ticker=<ticker>&tab=validation&validationRun=<runId>&validationCase=<caseId>
```

Campaign aggregates remain `campaign_global`; only the case list/detail is scoped to
the current ticker. The Browser renders persisted research artifacts and does not
derive ticker-local aggregates or replay financial calculations.

### 3.5 Local API boundary

`/api/analyses/*` remains GET-only. Strategy validation adds only the reviewed local
session, preflight, job, cancellation, and run/case routes. Mutations require exact
same-origin checks and a process-local CSRF token. Credentials and filesystem paths
are never returned to the Browser.

## 4. External-source feasibility evidence

P4-I1 recorded a successful manual, default-No live smoke on 2026-08-31 after explicit
authorization:

```text
ticker: 7203
anchor: 2026-01-05
worst-case maturity: t79 / 2026-05-01
requested outcome-through: 2026-05-15
actual attempts: 3 of the 10-attempt cap
result: usable official calendar, exact historical master identity, and raw daily
        bars through t79 with UL/LL, AdjFactor, and ExRT fields
```

No credential, raw response body, request ID, or external-source artifact was placed
in Git, PR text, or test output. This evidence belongs to merged PR #86 and is not
rerun by P4-X merely to restate the gate.

## 5. Preserved product boundaries

- Analysis Snapshot V9 remains the only writer; V1-V9 remain readable. There is no
  V10, migration, or backfill.
- `analyzeTechnical`, `analyzeStrategy`, their reasons/defaults, and the production
  single-`tickSize` interface remain unchanged.
- Outcome labels and R values are observations, not Strategy PASS/FAIL, predictive
  proof, ranking, recommendation, or a new Buy/Sell/Hold signal.
- There is no runtime composite score, score field, weighting, or Dashboard score.
- No normal CI path calls J-Quants or an external AI provider.
- There is no scheduled run, concurrent queue, automatic replay, WebSocket/SSE, or
  automatic latest-result selection.
- Evaluator runtime and PDF/export remain deferred.

## 6. P4-X candidate

The P4-X branch is:

```text
feat/phase4-closeout-step9
```

The intended diff is limited to:

- `Usage.md` — exact CLI, manifest, confirmation, Dashboard, API, storage, and
  limitation guidance;
- `docs/USER_SETUP.md` — J-Quants history/rate/quota and Windows publication setup;
- `env.example` — the already-implemented optional J-Quants validation rate setting;
- this handoff — merged baseline, feasibility evidence, operational surface, and
  closeout gate.

P4-X adds no runtime code, test fixture, dependency, environment-variable reader,
Snapshot field, API route, Dashboard behavior, research artifact, or external
request. It does not rewrite predecessor plans or declare Phase 4 Done before merge.

## 7. P4-X validation and remaining Merge Gate

Local candidate validation on 2026-09-01 produced:

| Validation | Result |
| --- | --- |
| `bun test` | 925 passed, 0 failed |
| `bun node_modules/typescript/bin/tsc --noEmit` | passed |
| Playwright with the configured suite and bundled Node | 38 passed |
| `git diff --check` | passed |

On this Windows checkout, `bun run typecheck` stopped before TypeScript execution
because Bun could not remap the local `tsc` bin, and
`bun run test:dashboard-browser` stopped before Playwright execution because Bun
could not start the local `node` command. The direct commands above ran the same
TypeScript compiler and Playwright config without changing dependencies. The exact
P4-X PR must still pass the canonical `bun run typecheck` and `bun test` CI jobs;
these local launcher failures are not treated as a product-code pass or hidden.

Before publication, also require `git diff --check origin/main...HEAD` on the committed
candidate. Browser coverage is the recorded 38-test local Playwright run because it
is not a normal CI job.

Also confirm from merged code/tests that:

- Snapshot writer/read compatibility remains V9/V1-V9;
- saved-Snapshot and campaign fixture runs publish and reload under their distinct
  confidence labels;
- campaign reruns retain candidate IDs/order but receive new publication UUIDs;
- cancellation/failure never publishes a partial run;
- no runtime score, Strategy PASS/FAIL, recommendation signal, scheduled external
  job, or external-request CI path exists; and
- all Phase 4 predecessor PRs and the P4-X exact head have green CI and independent
  review.

After the P4-X exact head satisfies the Merge Gate and the user authorizes merge:

1. merge the P4-X PR;
2. fast-forward local `main` to the merged `origin/main`;
3. confirm a clean checkout and green final CI; and
4. only then report Phase 4 Done.

## 8. Deferred scope and remaining risks

- J-Quants can return later-corrected historical rows; reconstructed runs do not
  prove the exact correction vintage visible at the historical anchor.
- The 251-session policy can differ from the current production input window.
- Daily OHLC cannot prove intraday sequence or queue priority; ambiguity remains a
  first-class result.
- Source retention and subscription limits can make a requested anchor unavailable.
- The current default run publication is Windows-only and intentionally fails closed
  elsewhere.
- Broad backtests, portfolio/P&L simulation, transaction costs, Strategy V2,
  per-ticker aggregates, 2027 STR ticks, runtime score adoption, scheduled jobs,
  Evaluator runtime, and PDF/export require separate reviewed plans.

## 9. Maintenance boundary

Update this file only at an explicit Phase 4 recovery or closeout boundary. Current
branch, PR, CI, review, merge, and external-source state must always be rechecked
directly.
