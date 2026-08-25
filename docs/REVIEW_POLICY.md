# Pull Request Review Policy

## 1. Purpose

This document defines the review and merge policy for pull requests in this repository.

The policy is based on **roles and responsibilities**, not on whether a participant is a human, AI system, coding agent, or any particular product or tool.

The two primary roles are:

- **Implementer** — responsible for planning, implementation, testing, validation, and preparing the pull request.
- **Reviewer** — responsible for independently evaluating the pull request and making the final Merge Gate determination.

Roles are defined by responsibility, not by the identity or type of participant.

For a given pull request, the Implementer and Reviewer should be independent roles whenever practicable.

---

## 2. Workflow

The standard development and review workflow is:

```text
Implementer
    ↓
Requirements
    ↓
Planning
    ↓
Implementation
    ↓
Tests and validation
    ↓
Commit / push to feature branch
    ↓
Draft PR
    ↓
Self-validation
    ↓
Ready for review
    ↓
Independent Reviewer
       │
       ├─ Merge Gate satisfied
       │       ↓
       │     Merge
       │
       └─ Changes required
               ↓
          Review findings
               ↓
          Implementer fixes
               ↓
              Push
               ↓
          Reviewer re-review
```

Self-review by the Implementer is encouraged but does not replace independent review.

---

## 3. Implementer Responsibilities

The Implementer is responsible for delivering a change that is ready for independent review.

### Requirements

The Implementer should:

- understand the requested behavior;
- identify relevant assumptions and constraints;
- define the intended scope of the pull request;
- avoid unnecessary scope expansion.

### Planning

Before or during implementation, the Implementer should:

- determine an appropriate implementation approach;
- consider compatibility with the existing architecture;
- identify affected components;
- keep the proposed change as focused as reasonably possible.

### Implementation

The Implementer should:

- implement the requested behavior correctly;
- follow existing project conventions;
- preserve appropriate separation of responsibilities;
- avoid unrelated refactoring or cleanup;
- avoid introducing unnecessary complexity.

### Tests

The Implementer should:

- add or update tests for new or changed behavior;
- add boundary-condition tests where appropriate;
- add error-case tests where appropriate;
- add regression tests when fixing defects;
- run relevant existing tests.

### Validation

Where applicable to the repository, validation may include:

- unit tests;
- integration tests;
- linting;
- formatting checks;
- type checks;
- builds;
- static analysis;
- other project-specific checks.

A validation step that was not run must not be represented as successful.

Any relevant validation that could not be performed should be disclosed in the pull request.

### Pull Request Preparation

A pull request should provide enough information for an independent Reviewer to understand and evaluate the change.

Where relevant, the pull request should describe:

- purpose of the change;
- major implementation changes;
- important design decisions;
- tests and validation performed;
- validation that could not be performed;
- known limitations or remaining risks.

---

## 4. Reviewer Responsibilities

The Reviewer independently evaluates whether the pull request is safe and appropriate to merge.

The review should consider the pull request as a whole rather than only individual lines of code.

At minimum, the following areas should be considered when relevant.

### Requirements

Verify that:

- the requested behavior is implemented;
- the implementation matches the stated purpose of the pull request;
- important requirements have not been omitted;
- the scope has not expanded unnecessarily.

### Correctness

Check for issues such as:

- incorrect logic;
- missing boundary conditions;
- inappropriate error handling;
- invalid state transitions;
- unintended side effects;
- incorrect handling of empty, null, invalid, or exceptional inputs;
- off-by-one errors or similar implementation defects.

### Architecture and Design

Evaluate whether:

- the change is consistent with the existing architecture;
- responsibilities are appropriately separated;
- unnecessary coupling has been introduced;
- unnecessary abstractions have been introduced;
- public APIs or interfaces are changed appropriately;
- the design creates avoidable future maintenance problems.

### Maintainability

Consider whether:

- the intent of the code is understandable;
- naming is appropriate;
- unnecessary duplication exists;
- complexity is proportionate to the problem;
- comments explain non-obvious decisions where necessary.

### Tests

Verify whether:

- changed behavior is adequately tested;
- tests verify behavior rather than incidental implementation details;
- important boundary cases are covered;
- important failure cases are covered;
- regression tests exist where appropriate.

### CI and Validation

Verify:

- required automated checks have completed successfully;
- required tests have passed;
- required build, lint, type-check, or similar checks have passed;
- any unavailable validation is explicitly understood and its risk assessed.

### Scope

Check for:

- unrelated code changes;
- unrelated refactoring;
- accidental dependency changes;
- temporary or debug code;
- generated or temporary files that should not be committed;
- large unrelated formatting changes.

### Git and Branch Integrity

Where relevant, verify:

- the pull request targets the intended base branch;
- unrelated commits or changes are not included;
- changes from previous or separate work have not been unintentionally mixed into the pull request.

### Security

Consider whether the change introduces:

- secrets, credentials, or tokens;
- unsafe handling of untrusted input;
- inappropriate permission changes;
- insecure defaults;
- obviously dangerous dependency or configuration changes.

---

## 5. Review Severity

Review findings should normally be classified using the following severity levels.

### BLOCKING

A problem that must prevent merge.

Examples include:

- clear requirement violations;
- functional defects;
- data corruption risk;
- serious security vulnerabilities;
- required test failures;
- required CI failures;
- defects likely to cause runtime failure.

A pull request with an unresolved BLOCKING finding does not satisfy the Merge Gate.

### MAJOR

A significant issue that should normally be corrected before merge.

Examples include:

- important missing boundary handling;
- significant missing test coverage;
- substantial architectural inconsistency;
- designs likely to cause defects or serious maintenance problems.

A pull request with an unresolved MAJOR finding does not normally satisfy the Merge Gate.

### MINOR

An improvement that is desirable but does not normally prevent merge.

Examples include:

- small design improvements;
- readability improvements;
- non-critical test improvements;
- clearer naming.

### NIT

A very small and optional improvement.

Examples include:

- wording;
- comments;
- minor naming preferences;
- minor style improvements.

---

## 6. Merge Gate

A pull request may be merged when all applicable conditions below are satisfied:

- the requested requirements are met;
- there are no unresolved BLOCKING findings;
- there are no unresolved MAJOR findings;
- required tests have passed;
- required CI checks have passed;
- no unintended regression is known;
- the pull request scope is appropriate;
- no serious security issue is known;
- the Reviewer determines that the pull request is suitable for merge.

MINOR and NIT findings may remain unresolved when the Reviewer determines they do not justify delaying the change.

If the repository has no CI, the Reviewer should use the available tests, builds, static analysis, and other relevant evidence.

If a validation step cannot be performed for legitimate technical reasons, this does not automatically prohibit merge. The missing validation and associated risk must instead be explicitly considered in the Merge Gate decision.

---

## 7. Review Outcome

A completed review should result in one of two primary outcomes.

### Mergeable

The pull request satisfies the Merge Gate.

There are no unresolved BLOCKING or MAJOR findings.

MINOR or NIT observations may still be recorded.

### Changes Required

The pull request does not satisfy the Merge Gate.

BLOCKING or MAJOR findings should clearly identify, where practical:

- the affected location or behavior;
- why it is a problem;
- the likely impact;
- the expected direction of the fix.

---

## 8. Re-review

When changes are requested, the Implementer should normally update the same pull request.

The Implementer should:

- address the review findings;
- consider related code affected by the change;
- add or update tests as necessary;
- rerun relevant validation;
- push the corrections to the pull request branch.

During re-review, the Reviewer should verify:

1. previous BLOCKING and MAJOR findings have been resolved;
2. the resolution addresses the underlying issue rather than only its visible symptom;
3. the correction has not introduced new defects;
4. relevant tests and CI checks pass;
5. the pull request as a whole now satisfies the Merge Gate.

Re-review should not be limited mechanically to the previously commented lines when the correction may affect other behavior.

---

## 9. Pull Request Scope

As a general rule:

> **One pull request should have one clear purpose.**

A pull request should remain reasonably understandable and independently reviewable.

Avoid combining unrelated:

- features;
- refactoring;
- dependency updates;
- formatting changes;
- cleanup;
- behavioral changes.

Large changes should be divided into smaller pull requests when doing so improves reviewability without creating artificial or unsafe boundaries.

---

## 10. Draft Pull Requests

A Draft pull request represents work that is not yet ready for final independent review.

Draft pull requests may be created early to expose implementation progress or support collaboration.

Before requesting final review, the Implementer should normally ensure that:

- the intended implementation is complete;
- relevant tests and validation have been performed;
- the pull request description reflects the current change;
- known issues have been addressed or explicitly documented.

The pull request should then be marked Ready for review.

---

## 11. Independence of Review

The final Merge Gate should not normally rely solely on the judgment of the participant that implemented the change.

The Implementer and Reviewer should be independent roles whenever practicable.

This principle applies regardless of whether either role is performed by:

- a human;
- an AI system;
- an automated agent;
- another development tool.

The relevant distinction is responsibility, not identity or implementation technology.

> **Implementation responsibility and final Merge Gate responsibility should be separated whenever practicable.**

---

## 12. Policy Authority

This file is the repository's Single Source of Truth for pull request review and Merge Gate policy.

Changes to this policy should themselves be made through version-controlled changes and reviewed through the repository's normal pull request process.

Repository-level policy should take precedence over temporary participant-specific workflow preferences when the two conflict, unless a higher-priority project or security requirement requires otherwise.