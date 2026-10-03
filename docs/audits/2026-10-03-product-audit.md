# Tide: two-round functional and product audit, 2026-10-03

## Scope and preservation

Existing branch `codex/audit-tide-learning-20261001`, exact starting commit `3aa82c9f3897a1bccd7a5523b0285843890ef10a`. The remote was reverified before work. It already contains newer development `backup/air-master-unpushed-2026-09-06` at `7bc284abed7b3fb2cb23aec5b7b2b0178d8ae95c`; the old default `master` remains `34612f4c58f638d51bdee77183489312c2586ba6` and was not substituted. Prior role revocation, market request recovery, payment, generation, native session and backup protections remain in the aggregate suite.

No production database, real learner account, payment, provider key, external AI call, production migration, main-branch write, merge or deployment. All data and login fixtures were in freshly migrated local/CI SQLite. No dependency or schema change. The existing branch workflow has CI and unsigned native-build jobs only; no deployment hook was introduced.

## Inventory and evidence language

`2026-10-03-coverage-ledger.json` inventories all 50 discovered App Router pages, 150 API route files/methods, Web button/form declarations and native control-bearing files. Counts are from this exact checkout, not copied from an old report. Static discovery is not a claim that every button was clicked. Dynamic lists, paid providers, native-only controls and deployment behavior cannot be exhaustively proven by a route crawl.

| Capability group | Round-1 checks | Round-2 checks / limitation |
|---|---|---|
| Login, signup, recovery, account/settings | Existing input/session/reset/CSRF suites; real HTTP auth contracts and disposable account lifecycle | Prior delayed/repeated login and native-generation guards retained; password/email external delivery not exercised |
| Courses, search, desk, market, roles | Existing access, private-media, search and role suites; real HTTP course/lesson/shelf/desk/search contracts | Existing seven-role revocation/Back/session-expiry hosted journeys retained; no real users |
| Learning/player/focus | New focus input, failed persistence, early exit and optional-service-failure regressions | Real SQLite three-way finish race, replay timestamp, note-window bound, next-visit preservation; hosted late-POST/late-PATCH, Escape, reopen and Cancel |
| Notes/notebooks/forms | Existing write/import/attachment boundaries plus malformed notebook POST/PATCH and valid retry | Omitted fields and ownership remain preserved; shared guard reset/timeout/success/rejection tested through real React hook lifecycle |
| Review/exam/AI/creator | Existing SRS, request-id, generation fencing, content, billing and fail-closed suites retained | Provider requests are not made; external model quality and paid generation are not claimed tested |
| Community/demands/notifications | Existing demand lifecycle and recipient checks in isolated HTTP runtime; static control/API inventory | All rendered controls inventoried; not every social action exercised in this run |
| Subscription/billing/redemption | Existing payment/IAP/refund/reconciliation/credit regression matrix; synthetic mock purchase HTTP flow | No Apple store, production webhook, real charge or real refund |
| Admin/native/backup | Role and admin guards; all existing recovery/encryption tests; native source/control inventory | CI unsigned iOS/macOS builds and offline policies; no device/simulator interaction or VoiceOver claim |

Hosted `audit-product-journeys.mjs` additionally renders each discovered page on desktop (1440×1000) and mobile (390×844), records its resolved URL/HTTP status/visible controls/JS errors/overflow, and captures screenshots. `/checkout/mock` is excluded from this read-only crawl because it needs a transaction fixture; existing runtime-critical tests cover its mock-payment lifecycle. A rendered page is explicitly marked `rendered-not-all-controls-exercised`. Dynamic missing/not-published fixture pages are recorded honestly, not silently treated as a healthy user journey.

## Round 1: reproduced failures and conservative repairs

1. **An old submit can unlock a newer submit.** After request A times out (or reset is pressed), B begins; A's `finally` cleared B's lock/timer, allowing C concurrently. Three deterministic real-React tests failed on the original hook. Every request now owns its generation and only releases its own lock. Existing 20-second fallback, signature and return behavior are preserved. This covers notebook/profile/community/subscription/mock-payment consumers without changing their payloads. Timeout remains a UI retry mechanism, not a guarantee of server-side mutation idempotency.
2. **Leaving focus before its start response orphaned that visit.** Player now retains a per-visit promise so an early leave finishes the exact visit once after creation resolves. A late POST/PATCH cannot install or clear a newer visit's state. Same-tick repeated leave is fenced. Each lesson mounts its own keyed Player to prevent state crossing lesson changes. Escape also works while focus is active and a note input owns keyboard focus.
3. **Focus finish was not replay/concurrency safe.** Previously it checked `endAt` before optional AI, then overwrote it with an unconditional update. An atomic `endAt: null` update claims the first finish before optional work. Only its winner may request a summary. Retries return saved statistics; note queries use both start and end bounds. Optional entitlement/rate/AI failures do not prevent the core visit from ending. Malformed bodies return 400. Intentional compatibility improvement: finishing an already-completed owned visit returns 200 with its existing response shape instead of the previous 400. No fields were removed or renamed.
4. **Malformed notebook forms became 500s.** Null, arrays and wrong-typed title/description/icon now fail with recoverable 400 before mutation. Valid trimming, null optional values, omitted-field preservation, and owner-only lookup remain compatible.

## Round 2: independent challenge and retest

The coordinator independently reviewed the consequential focus/guard diff. Follow-up requirements were implemented: real Prisma/SQLite concurrency, preserved first `endAt`, exclusion of notes created after the visit, isolation of the next visit, lesson-key remount, late POST/PATCH browser contracts and explicit limits for full tab closure/network failure. New tests include success and rejection after timeout, explicit reset, same-tick repeats, disabled timeout, failed storage claim, unauthorized visit, optional entitlement outage, and malformed-input retry.

The real SQLite test invokes the actual route handler against a disposable migrated database, with only identity/entitlement/LLM integrations stubbed. Three concurrent requests all return 200 but only one invokes the synthetic summary function. Later replay preserves the database end time, does not generate again, excludes a later note, and leaves a second visit active.

## Verification

- Node 22.23.3; locked npm dependencies; Prisma client and 19 empty-database migrations succeeded
- Baseline aggregate: 814 passed, 13 skipped, seven blocked by missing SQLite CLI. Official Debian SQLite CLI was then materialized locally; the next aggregate passed all 845 executed tests (113 files), with 13 runtime-dependent tests separately exercised through real HTTP
- New notebook suite: 15/15; full final aggregate is recorded in the exact-SHA CI result
- Real HTTP baseline: 13/13 contracts/search tests, 22/22 repository contract-smoke assertions, and runtime-critical private-media/account/mock-payment/demand lifecycle succeeded
- Lint and TypeScript passed on the focus/guard candidate; final checks cover notebook and harness additions as well
- Baseline production build passed. A subsequent local build was terminated by the shared executor (SIGKILL); this is not reported as a product assertion failure or a completed build. Final hosted build is required
- Hosted browser and native results, screenshots and terminal CI are tied to the final published SHA. Pending CI is not a pass

## Screenshot steps and acceptance

New evidence is stored in the workflow artifact `tide-audit-<FINAL_SHA>/browser-qa/product-20261003/`:

1. Desktop and mobile route crawl: route state and actual visible controls; inspect each screenshot before drawing visual conclusions
2. `*-focus-interrupted-review.png`: delayed creation followed by Escape; database visit is ended exactly once
3. `*-focus-new-visit-after-late-response.png`: old finish response cannot erase a new active visit
4. Existing login/error/retry/preview/role screenshots remain part of the same exact-SHA artifact

The cloud browser/local browser IPC constraints prevent a local interactive screenshot acceptance claim. Hosted images must be downloaded and visually inspected before reporting visual acceptance. Automated overflow and control inventories do not prove WCAG compliance, correct screen-reader order or all-controls usability.

## Remaining boundaries

Closing a tab, process termination, offline networking or a never-settling request can still prevent a remote finish from reaching the server; no keepalive/beacon/durable retry guarantee was added. If optional summary work fails after the completion claim, replay returns the saved completion without automatically generating a new summary. A concurrent replay can briefly observe a completed visit whose optional summary is still pending. All of these favor preserving the completed learning record and avoiding duplicate optional work.

Provider quality, live payments, distributed production load, complete native UX, hardware media, accessibility certification and every conditional button remain outside runtime evidence. This is a bounded comprehensive inventory plus targeted deep functional repair and regression audit, not a claim of exhaustive production acceptance.

## Hosted visual follow-up

Initial candidate 8ab1fca7 passed CI 37079220949. Inspection of its actual 102 PNGs and 100 route records found a mobile layout defect: all 14 admin pages inherited a 273px-wide horizontal document overflow from the grid's implicit minimum track size. The admin layout now explicitly uses a zero-minimum flexible content track and the navigation grid item can shrink, retaining its own horizontal navigation scrolling. A hosted assertion now fails if an admin route exceeds the viewport by more than 2px. This is a presentation-only correction; guards and navigation items are unchanged. Four focus interruption/re-entry journeys passed in the initial hosted candidate. Final hosted screenshots must be rechecked after this correction.
