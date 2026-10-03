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
6. Actual phone screenshots showed the note-detail action row overflowing by 96px, a recent-note summary overflowing by about 31px, and reduced-motion AI advice losing its negative-z background. Responsive wrapping/minimum widths and an explicit stacking context address these. Subsequent 1b and 3594 captures confirm the note actions fit 390px and settled desk sections retain readable backgrounds.
7. Market database projections dropped `sortOrder`, even though it contributes to the stored presentation fingerprint. Thus a valid published course could be rejected by listing/collection/search/request/review. Readers now use a shared complete lesson projection and deterministic ordering. Actual route tests honor Prisma's requested projection, accept a current contract and still reject a stale one; revision-cache reads have the same check.

8. Export and AI action menus lacked complete keyboard behavior; notes AI actions only listened to pointer-down, so native button activation did nothing. Menus now share focus ownership, arrow/Home/End handling, Escape return, normal Tab exit and non-stealing outside dismissal. Actual component tests also preserve single submission and error retry. The [WAI menu button pattern](https://www.w3.org/WAI/ARIA/apg/patterns/menu-button/) and [menu keyboard pattern](https://www.w3.org/WAI/ARIA/apg/patterns/menubar/) informed the interaction contract; real-browser Tab and focus-pixel evidence is still pending.
9. An AI request that timed out could later replace the result of a newer retry and clear its busy state. Each request now has an owner; timeout/unmount invalidates the old owner. Actual React deferred-response tests reproduce the old overwrite and retain the new result after the fix. Notebook transformations also invalidate results/toasts after unmount or a scope change; late successes and failures cannot contaminate a new notebook. This does not undo any server-side work already completed.
10. The phone notebook header compressed action labels into awkward two-line/vertical text. The primary action now has its own mobile row and secondary actions retain unbroken labels. This follows the captured 390px notebook page; after-pixels are pending.

11. The remaining nonempty-notebook B failure was not a remount or an old request clearing text: the trace shows 11 intended body characters appended to the title before A's response was released. The dialog's unconditional opening animation frame could steal focus between selecting a field and input. The initial-focus frame now respects focus already inside the dialog and is cancelled on close. Controlled-frame tests fail 2/3 before and pass 3/3 after; the original rapid-input browser case remains unchanged for retest.
12. Two controls lacked names: the phone desk submit button hides its text, and the discussion send button is icon-only. The native desk button now has an explicit name; discussion uses visually hidden text within the actual shared button so the name reaches the DOM.

13. After-pixels revealed a separate dark-mode contrast issue in course labels: a fixed white trial pill used theme-lightened text, and success badges used a static dark green. Trial text/background now use the matched ink/surface tokens, and success badges use ok/ok-soft. The next real-browser capture records computed opaque foreground/background colors and requires [text contrast ≥4.5:1](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html) for these labels; no numerical before/after claim is made before that run.

14. Global AI tidy also needed filter ownership. Actual NotesClient interaction reproduced A's pending summary appearing as “current notes” after a starred filter loaded B. The request scope now includes the filter intent immediately, as well as loaded note IDs. Pending/failed list loads disable AI so old data cannot be summarized under a new filter. Deferred old success/error before and after B loads cannot open results, emit old toasts or clear B's busy state. A completed result saved as a note still keeps its confirmation through its own list refresh. Six actual-component cases cover these outcomes; the new browser cases retain real filter GETs and synthetic AI responses.

## Current evidence and remaining work

- Prior candidate `d7b5e701c646deb177c6adaf6d3d9de798af8d04`, CI [37137427087](https://github.com/leoyb1010/tide-learning/actions/runs/37137427087), completed failure. All 36 note interaction journeys passed on that run, but its pre-response diagnostic wait may have changed the timing of an earlier intermittent draft failure. Causality is not closed; the new capture removes that wait and adds the empty-notebook path.
- That run had 600 route/variant records, including 12 explicitly blocked preview fixtures; 12 market-fixture failures, 8 overflow failures and one hydration error remained. A route pass does not imply all controls were exercised.
- Valid rendered course fixtures now replace invalid seed assumptions for positive preview/market tests. The buyer checks actual collection/repeated request/hide/restore readback and a 61-note browser pagination journey.
- Earlier full-page images contained offscreen reveal content that had not settled; those regions are rejected as visual-pass evidence. The next capture scrolls through content, waits for visible finite animations, records lower content before keyboard navigation and captures failure images. Theme assertions check the effective surface token, not just the requested browser setting.
- The latest completed local candidate aggregate has 913 passing, 13 skipped, and 7 failing tests caused by missing `sqlite3`; supported Node 22 CI remains the authoritative aggregate. This includes the new market-projection, menu, dialog focus and context-guard tests; a fresh supported-Node CI aggregate is still required.
- The 3594 full matrix exercised keyboard navigation, synthetic AI error/retry with a real saved-note readback, manual author creation/editing/rendering/cancel/reentry and reviewer approval/retry/cancel/readback. The two focus failures listed below remain pending a new browser retest. No round is closed from the current evidence.

## Dependency gate

The strict `npm audit --audit-level=low` gate is preserved and executes after successful dependency installation even if an earlier ordinary product check fails. The observed failure is the development dependency chain `eslint-config-next → @next/eslint-plugin-next → fast-glob → micromatch → braces`. The [official advisory GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) reports no patched version as checked on 2026-10-03. The latest npm report suggests a forced downgrade to `eslint-config-next@14.2.35` (a breaking change), not an in-range patched `braces`; no blind downgrade was applied. There is no allowlist or suppressed failure. Cancellation/whole-job timeout can still stop later steps; actual terminal step results must be checked on each run.

### Additional round-1 candidate evidence

Candidate `1b238574b9062c0762d66b2a500c027487972395`, [CI 37142110553](https://github.com/leoyb1010/tide-learning/actions/runs/37142110553), completed failure. Node 22: 893 passing/13 skipped tests; lint/type/build/migration passed; native, embedded 13/13 and backup/restore passed. The strict dependency audit actually ran and failed.

The fresh matrix recorded 600 routes and 72 business checks: 71 passed and one rapid-input case failed. Every 61-note pagination, free collection/repeat/hide/restore, and empty→nonempty A/B check passed across all 12 variants. There were zero measured horizontal overflows and zero hydration errors. Remaining route findings were 20 unnamed-control observations and 12 preview errors caused by Playwright's own service-worker blocking init script reading the forbidden getter in opaque sandbox frames.

The next capture uses a fresh nonpersistent context, installs an explicit rejecting service-worker registration guard before page code, and catches only the platform's opaque-origin `SecurityError`. All external HTTP/WebSockets remain blocked. Production iframe sandbox flags are unchanged. A separate original-instrumentation calibration preserves the upstream error stack, while actual product pages continue to require zero page errors and zero service workers. This is a capture correction, not a production permission change.

Actually inspected after-pixels from 1b include the 390px phone note-detail action row (`1a398ee5746157b7bd92a4a53f7c3883197bc73bece969c86ef74adf6095a0ca`) and desktop dark/reduced-motion desk lower content (`5c4868388feb8737e7480abcb41bfb5c3306fddd5ae8340d0c85d002cbc9f6e8`). Settled lower sections are present with recorded bounds/opacity 1; the earlier unscrolled full-page blank regions were not valid visual evidence. The next full capture still must verify the new controls, keyboard behavior, and all requested variants.

The focus/menu/context candidate `3594da4a6d165ded2ba3694af1f633fc60e87228` is published; [CI 37145550101](https://github.com/leoyb1010/tide-learning/actions/runs/37145550101) completed failure: see the next attempt summary. The global-filter repair is a later candidate.

### Keyboard/focus retest and dependency compatibility assessment

The 3594 run completed with all 600 routed surfaces passing, including 12 real previews with zero page errors and zero service workers. There are 96 passed and 24 failed business cases, plus 72 diagnostic records which are not counted as business passes. The remaining 24 failures are menu-reopening focus and AI result-dialog return focus in each of the 12 variants; author creation/editing, actual reviewer approvals, notes persistence and rapid A/B capture passed.

All 408 computed label samples passed: light success 5.265384:1, dark success 7.459959:1, light trial 14.582842:1, dark trial 14.666179:1. Every sampled surface requires both label types. The actual dark/reduced-motion lower desk image and phone notebook image were inspected; trial text is readable and notebook actions no longer split into vertical labels.

Two new controlled component cases reproduce the remaining focus contracts: a reopened menu should own focus when its DOM commits, and an asynchronously opened result dialog must know its trigger even if loading blurred it. Menu focus now uses a layout effect rather than a later animation frame. Both AI result dialogs pass an explicit return-focus ref. The next browser matrix will verify native Tab/Shift+Tab and result dismissal after the saved-note list has settled.

The dependency gate remains a real failure (5 affected-package findings from the same braces advisory). Registry metadata checked on 2026-10-03: braces 3.0.3, micromatch 4.0.8, fast-glob 3.3.3 still form the affected chain; latest Next ESLint plugin 16.3.8 also uses fast-glob. The proposed full eslint-config-next 14.2.35 downgrade has ESLint 7/8 peers, incompatible with this project's ESLint 9 contract. Official 14.2.35 vs 15.5.27 plugin source comparison also shows a plugin-only downgrade would remove App Router URL checking from no-html-link-for-pages. No dependency downgrade, audit threshold reduction or allowlist was applied; no compatible patched pin was identified. This is a dependency compatibility assessment, not a repository exploitability claim.


### Latest pixel and accessibility follow-up

Selected original screenshots from every requested viewport/theme/motion combination were inspected. This is a sampled manual pixel review, not a claim that every image was individually reviewed. The per-image paths and hashes are in `round1-pixel-review-3594.json`.

- The phone author workspace squeezed its explanatory caption into a one-character-wide column and clipped the lesson name to its opening character. The caption and lesson title now receive a full mobile row, with wrapping actions and 44px targets. The next browser run measures their real widths and captures the changed layout.
- The dark My Courses ready-status label combined a white background with dark-theme white text. It now uses a matched semantic surface/ink pair, and that page joins the nonempty computed-contrast checks.
- The administrator permission table compressed metadata/reset labels vertically. A contained horizontally scrollable table with minimum column widths preserves legible labels. Every checkbox now has a role-and-permission accessible name and a 44px label target; the existing granted/locked behavior is unchanged. All 48 controls are asserted in each browser variant.
- One AI result image captured an unfinished entry fade. It is rejected as visual evidence. Every interaction screenshot now waits for visible finite animations to settle, just as route screenshots already did. This does not add a wait before the rapid A/B input sequence.

Local lint and typecheck pass after these edits. The latest aggregate is 913 passing, 13 skipped and 7 missing-sqlite3 environment failures. The exact-commit Node 22/browser retest is pending; unresolved dependency audit failures remain visible.
