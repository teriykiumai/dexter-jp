# Dexter JP Phase 4 Handoff

**Status:** P4-0 candidate context; non-normative and not yet merged

**Last Updated:** 2026-08-31

## 1. How to use this file

This handoff restores context only. It does not approve work, override
`AGENTS.md`/`docs/SPEC.md`/`docs/PHASE4_PLAN.md`, replace merged code and tests, or
prove a PR passed review. Resolve any conflict in favor of the applicable Source of
Truth and the exact merged implementation.

Before acting, verify the current checkout, `origin/main`, applicable PR head, CI,
independent review, and Merge Gate. Do not infer current state from this file alone.

## 2. Predecessor baseline

P4-0 started from local and `origin/main` at:

```text
2da7062805a666654d3aafba761063eca0820c79
Merge pull request #83 from teriykiumai/feat/phase3-closeout-step9
```

At that baseline Phase 3 is closed. Its relevant retained behavior is:

- immutable, backward-readable Analysis Snapshot V1-V9 with V9 as writer;
- canonical Snapshot JSON/digest and create-only history;
- deterministic saved-analysis Comparison and Peer Radar;
- five stable Dashboard tabs and inherited History API/race/focus/mobile behavior;
- a dormant Evaluator evidence/sidecar foundation with no runtime producer/UI; and
- a docs-only score protocol with no runtime score.

Phase 3 does not authorize PDF, Evaluator runtime, composite score, Strategy signal,
Snapshot V10, or a Phase 4 research run automatically.

## 3. P4-0 candidate

The user approved the Phase 4 design direction. The P4-0 branch is:

```text
feat/phase4-design-step0
```

The candidate changes only:

- `docs/SPEC.md` — narrows Phase 4 to point-in-time Strategy outcome validation and
  states the research-only/no-score boundary;
- `docs/PHASE4_PLAN.md` — normative decision-complete implementation contract; and
- this handoff — non-normative recovery context.

No code, package, command, environment, Snapshot, `.dexter` artifact, API, Dashboard,
Usage, setup, Phase 3 plan, or historical predecessor plan changes in P4-0.

The candidate must not be described as approved by independent review, merged, or
implemented until those facts are verified on the exact head.

## 4. Phase 4 decision summary

### 4.1 Two evidence tracks

Phase 4 keeps two separate confidence tracks:

```text
precommitted
reconstructed_as_of
```

The first audits Entry / Stop / Target already stored in an immutable Snapshot. The
second reconstructs the current deterministic Strategy from official J-Quants rows
bounded at a historical anchor. Current source access does not prove the exact
correction vintage delivered at that past time, so the second track is not called a
full historical point-in-time reproduction and is never combined with the first.

### 4.2 Source boundary

Only these endpoints feed version 1:

```text
/v2/markets/calendar
/v2/equities/master
/v2/equities/bars/daily
```

Only `ProdCat === "011"` is eligible. The dedicated adapter maps exact allowlisted
fields, filters future rows before domain parsing, uses official sessions, and
preserves normalized source evidence and canonical digests without raw HTTP data or
credentials.

Technical input is exactly t0 plus 250 preceding official sessions. Raw historical
OHLC is adjusted only through t0 using cumulative `AdjFactor`; current API AdjOHLC is
not reused. Any action after t0 through evaluation end fails the case closed.

Local preflight freezes `startedAt`; outcome uses only rows through the greatest
official session strictly before its Tokyo date. The derived
`outcomeAsOfSession` is persisted, so crossing a same-day J-Quants publication time
cannot add a bar to an already confirmed run.

Campaign resistance accepts only persisted `resistance_level` target prices from a
digest-valid Snapshot whose Strategy date is not later than that Snapshot's own
Tokyo generation date and exactly matches the anchor.

### 4.3 Existing Engine boundary

`analyzeTechnical`, `analyzeStrategy`, Strategy reasons/defaults, and the production
single-`tickSize` interface remain unchanged. Reconstruction resolves the entry's
next quote, calls the existing Engine, then validates every produced level against
its own price-band tick. An invalid cross-band level is `non_executable_tick`, not
silently re-rounded.

Tick rules support 2015-09-24 through 2027-02-28 only. The 2027 STR regime is
explicitly deferred.

### 4.4 Outcome boundary

Entry waits t1-t20. Entry day is holding day 1 and a filled case observes through
holding day 60, so a t20 entry can require evaluation session 79. Daily OHLC applies
fixed conservative gap rules. Same-bar sequence that daily data cannot prove is
bounded as `ambiguous_intraday`. `UL`/`LL` are evidence flags, not generic execution
flags: only a buy Entry exactly at flagged `H` or a sell Stop exactly at flagged `L`
is `limit_queue_ambiguous`. Opposite-side and boundary-inside fills remain governed
by the OHLC algorithm. No-trade rows count as sessions but not touches.

For an entry bar with open below entry and a stop touch, close at or below stop makes
the stop provable after entry; only a close above stop permits the optimistic
low-before-entry branch to remain open. Target-plus-stop remains bounded between the
two terminal outcomes.

The result union is:

```text
not_triggered
stop_hit
target_hit
horizon_expired
ambiguous_intraday
unavailable
```

Exact R, horizon mark R, and ambiguity bounds remain distinct. No outcome is a
Strategy PASS/FAIL or recommendation.

### 4.5 Storage and operation

Completed runs are immutable and self-contained under:

```text
.dexter/research/strategy-validation/runs/<runId>/
```

Equal reruns get new UUIDv4 run IDs. Partial runs are never published. Jobs alone are
mutable, atomic state records; one global job may run, cancellation is bounded, and
each job reserves its run ID before collection. Startup reconciles `publishing`: a
promoted run whose recomputed canonical payload digest and identities match the
publishing record completes the job, an absent run becomes interrupted, and a
mismatched/corrupt run is retained and surfaced as a hard failure. Other nonterminal
work becomes interrupted without automatic resume.

Aggregation is hierarchical. Track-level coverage includes every requested anchor
and all `anchor_unavailable` cases. Target/stop/resistance strata contain only
candidate cases and use separately named candidate-bearing denominators; unavailable
anchors are never omitted, replicated, or placed in a null candidate stratum.

CLI external fetches and Dashboard jobs require explicit default-No confirmation.
Normal CI never calls J-Quants. Rate/timeout/retry/attempt limits are fixed in the
normative plan.

### 4.6 Dashboard boundary

P4-D1 appends:

```text
validation / 戦略検証
```

Run and case selection is explicit in the URL; there is no automatic latest run or
auto-open on completion. The local mutation API uses exact same-origin validation
and a process-local CSRF token. The Browser never receives the J-Quants credential
or a local filesystem path.

## 5. Implementation order

The only permitted order is:

1. P4-0 — docs and detailed design
2. P4-I0 — pure point-in-time/calendar/adjustment/tick/source-envelope primitives
3. P4-I1 — strict J-Quants adapter and manual feasibility gate
4. P4-V1 — pure outcome validator
5. P4-R1 — manifest/run repository/aggregation
6. P4-S1 — saved-Snapshot audit CLI
7. P4-C1 — historical reconstruction CLI
8. P4-J1 — local job/CSRF/read API
9. P4-D1 — sixth Dashboard tab
10. P4-X — Usage/setup/handoff/final validation

Every step is a separately reviewed PR and starts only after the prior exact head is
merged and local `main` is fast-forwarded.

P4-I1 is a hard feasibility gate. Before P4-V1 it must prove, under the configured
J-Quants plan and a default-No manual smoke of at most 10 attempts, at least one
matured anchor with usable calendar, master, raw OHLC, `UL/LL`, `AdjFactor`, and
`ExRT`. Failure stops dependent implementation; no fallback or relaxed source rule
is authorized.

## 6. Next-step checklist

For the P4-0 candidate:

1. inspect the complete diff and verify only the three intended docs changed;
2. run full Bun tests, type-check, and `git diff --check`;
3. confirm historical Phase 3/predecessor plans are unchanged;
4. commit and publish a Draft PR only with explicit user authorization;
5. obtain independent review on the exact PR head and satisfy the Merge Gate; and
6. after the user merges, fast-forward local `main` before creating the P4-I0 branch.

For P4-I0 after that gate:

- reread the merged `docs/PHASE4_PLAN.md`, applicable predecessor contracts, and
  current tests;
- implement only pure no-I/O primitives;
- do not contact J-Quants, create the research repository, add CLI/API/UI, change
  Strategy/Snapshot, or implement any later step; and
- use official-source golden vectors and explicit boundary/error tests.

## 7. Risks to keep visible

- Historical J-Quants responses may contain later corrections; the confidence label
  and warning are mandatory, not cosmetic.
- Daily bars cannot establish intraday order or queue priority; ambiguity must remain
  first-class rather than being forced into a win/loss.
- A daily stop-high/stop-low flag does not censor unrelated fills; queue ambiguity is
  limited to adverse-side fills exactly at the flagged OHLC boundary.
- Same-day outcome bars are excluded even if a job crosses their publication time;
  otherwise the immutable cutoff would be false.
- Historical master/tick evidence and plan retention may fail feasibility; this is an
  acceptable stop result.
- A t20 entry requires data through evaluation session 79, not merely t60 from t0.
- Existing Strategy uses one tick for generation; cross-band invalid output must be
  rejected rather than repaired within Phase 4.
- Selection-biased saved Snapshots cannot establish general predictive validity.
- Broad campaign limits, sparse unavailable data, and multiple candidates per anchor
  make naive win-rate interpretation misleading; mandatory strata and denominators
  must remain intact.
- A crash after run promotion must reconcile the reserved run rather than create an
  orphan or erase a suspect artifact.

## 8. Maintenance boundary

Update this file only at an explicit Phase 4 recovery or closeout boundary. Do not
use it as a live status ledger. Current branch, PR, CI, review, merge, and source-smoke
state belongs in Git/GitHub and must be rechecked directly.
