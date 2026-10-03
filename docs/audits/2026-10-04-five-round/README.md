# Five-round product audit

Status: Tide round 1 is **in progress**, not accepted. Rounds 2–5 have not started. Route rendering alone is not a functional-journey pass, and this report makes no zero-defect claim.

## Baseline and boundaries

The new `audit/five-round-product-20261004` branch descends from accepted `0b2afb7da45db7fe46d17711c7646c4c2dd71c48`, which includes the newer backup development lineage. It does not reset to the older default branch.

Testing uses disposable, seeded local/CI databases and synthetic accounts. No production data, deployment, merge, live payment, real OAuth, live LLM quality evaluation or native-device screen interaction is included. Native CI provides build/policy evidence only.

## Required matrix for every round

- Anonymous and learner: route/resource readiness, discovery, lessons and embedded content, notes, review, account/preferences, error/retry and persisted readback
- Author/buyer/community roles: creator and market publication/collection, author handoff, demand author/voter/follower/moderator state changes
- Administrative roles: actual user/admin/content manager/demand moderator/support/finance/reviewer permission matrix, legitimate landing/navigation and interrupted authority changes
- UI: phone 390×844, tablet 820×1180, desktop 1440×1000; light/dark; normal/reduced motion; full and lower content, visible control names, keyboard/focus/close behavior
- Regression: complete unit suite, lint, typecheck, migration/upgrade, build, runtime contracts, embedded learning, backup/restore, dependency gate, exact-commit CI

The first round combines fresh execution of `runtime-critical.mjs`, `audit-role-journeys.mjs`, login/modal/product scripts and the new `audit-five-round.mjs`; internal case labels in older scripts do not represent completion of any of these five requested rounds.

## Round 1 findings and repairs so far

1. A completed capture could dismiss a newer draft. Persistent-completion refresh now remains separate from the currently mounted editor's close/error notification. Write/link submission locks and disabled submitted fields prevent same-tick duplicate/edit races. Actual React tests cover stale success/error and link/upload replacement. Client upload cancellation does not establish server rollback.
2. In an empty notebook, the empty-state button owned its own dialog. The first saved note removed that button during server refresh and unmounted draft B. A page-level editor provider now outlives both entry buttons. The test reconciles the actual `NotebookDetailPage` tree empty→nonempty, verifies the same B textarea/draft, valid second submission and focus fallback.
3. SSR notes pagination used the first excluded row as cursor while GET used `skip: 1`, omitting the boundary note. The cursor now refers to the last displayed row. Actual async page→GET pagination checks 30/31/32/61 IDs in order, with no omissions or duplicates.
4. Relative timestamps could differ across SSR/hydration time boundaries. Initial rendering now shares a server timestamp; the clock updates after hydration with timer cleanup. Minute/hour/day/week boundary hydration tests assert no recoverable hydration error.
5. Malformed notes/tag requests could produce 500 or false successful updates. Invalid JSON and non-object bodies now return 400 before mutation; tag names are type-checked. Valid retry remains supported.
6. Actual phone screenshots showed the note-detail action row overflowing by 96px, a recent-note summary overflowing by about 31px, and reduced-motion AI advice losing its negative-z background. Responsive wrapping/minimum widths and an explicit stacking context address these. Replacement browser pixels are still required.
7. Market database projections dropped `sortOrder`, even though it contributes to the stored presentation fingerprint. Thus a valid published course could be rejected by listing/collection/search/request/review. Readers now use a shared complete lesson projection and deterministic ordering. Actual route tests honor Prisma's requested projection, accept a current contract and still reject a stale one; revision-cache reads have the same check.

## Current evidence and remaining work

- Prior candidate `d7b5e701c646deb177c6adaf6d3d9de798af8d04`, CI [37137427087](https://github.com/leoyb1010/tide-learning/actions/runs/37137427087), completed failure. All 36 note interaction journeys passed on that run, but its pre-response diagnostic wait may have changed the timing of an earlier intermittent draft failure. Causality is not closed; the new capture removes that wait and adds the empty-notebook path.
- That run had 600 route/variant records, including 12 explicitly blocked preview fixtures; 12 market-fixture failures, 8 overflow failures and one hydration error remained. A route pass does not imply all controls were exercised.
- Valid rendered course fixtures now replace invalid seed assumptions for positive preview/market tests. The buyer checks actual collection/repeated request/hide/restore readback and a 61-note browser pagination journey.
- Earlier full-page images contained offscreen reveal content that had not settled; those regions are rejected as visual-pass evidence. The next capture scrolls through content, waits for visible finite animations, records lower content before keyboard navigation and captures failure images. Theme assertions check the effective surface token, not just the requested browser setting.
- The final local candidate aggregate has 886 passing, 13 skipped, and 7 failing tests caused by missing `sqlite3`; supported Node 22 CI remains the authoritative aggregate. This includes the new market-projection tests; a fresh supported-Node CI aggregate is still required.
- Keyboard menu interactions and broader positive business outcomes remain under review. No round is closed from the current evidence.

## Dependency gate

The strict `npm audit --audit-level=low` gate is preserved and executes after successful dependency installation even if an earlier ordinary product check fails. The observed failure is the development dependency chain `eslint-config-next → @next/eslint-plugin-next → fast-glob → micromatch → braces`. The [official advisory GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) reports no patched version as checked on 2026-10-03. There is no allowlist or suppressed failure. Cancellation/whole-job timeout can still stop later steps; actual terminal step results must be checked on each run.
