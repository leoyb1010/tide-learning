# tide-learning: two-round security and product audit

Date: 2026-10-01 UTC. Status: both source/adversarial rounds complete; final-commit hosted CI and screenshot/native acceptance pending.

## Exact scope and lineage

- Repository: `leoyb1010/tide-learning`, isolated from the other five repositories in this audit.
- Repair branch: `codex/audit-tide-learning-20261001` (or collision-safe suffixed equivalent).
- Baseline: `backup/air-master-unpushed-2026-09-06` at `7bc284abed7b3fb2cb23aec5b7b2b0178d8ae95c`, tree `3269dbd66267fc772838ecfbba023a889ffafa91`.
- This baseline is a clean descendant of default `master` at `34612f4c58f638d51bdee77183489312c2586ba6`, 48 commits ahead and zero behind. It also contains security branch `34d2dce98ddcd030b28ca1814897e1d03e3b42de` (26 commits ahead, zero behind).
- The three unique commits on `codex/courseware-leohtml-audit` at `1a5947b3168e388f1d32e4cd1a1d98f874597c9f` diverge from history, but 160 of their 183 changed paths are byte-identical in the newer baseline. The remaining 23 paths contain subsequent generation, billing, query, documentation and test changes. No branch was blindly merged and no newer backup work was discarded.
- All source/configuration files and small assets were retrieved by immutable ref and checked against their Git blob hashes. Large videos and one large icon/design source could not be materialized through the connector; their original remote hashes are preserved unchanged. Local media tests used disposable synthetic video fixtures, never uploaded as replacements.
- Stack: Next.js 15 App Router, React 19, TypeScript, Prisma 6/SQLite, Tailwind 4, Vitest, Playwright, plus Swift/iOS sources. No production accounts, databases, provider credentials, real charges, deployments or user computers were used.

## Method and coverage

This is a manual source/runtime/adversarial audit. The dedicated Codex Security scan runner and its report generator were not available here; this document does not represent an automated Codex Security deep scan or a guarantee of an exploit-free product.

Inventoried 151 API route files, all package/configuration/CI entry points, data models/migrations, authentication and permissions, course/lesson ownership and entitlements, import/upload and SSRF boundaries, generated HTML/SCORM isolation, payment/IAP and credit settlement, generation fencing/reconciliation, account lifecycle, backup/restore, and key Web/native DTO contracts. Existing broad regression suites were run alongside new adversarial tests. No production traffic or external LLM/payment calls were generated.

Visual evaluation requires actual screenshots. The cloud browser refused the isolated localhost preview with `ERR_BLOCKED_BY_CLIENT`. No visual quality or accessibility pass is claimed from source inspection. The dedicated branch runs the existing isolated GitHub-hosted browser audit, desktop/tablet/mobile screenshots, keyboard checks, axe checks, and embed flows; screenshot acceptance remains pending until those artifacts are inspected.

## Round 1: baseline, adversarial reproduction, fixes

### Confirmed findings

| Finding | Risk and reproduction | Repair and regression |
| --- | --- | --- |
| Stored session digests accepted as bearer tokens | High: lookup hashed the presented token, then fell back to raw database IDs, undoing the protection of hashing session tokens at rest | Removed the expired legacy fallback; accept only issued token syntax; `session-adversarial.test.ts` rejects digest replay |
| Native logout left the bearer session valid | Medium: logout read only the cookie while native authentication uses Authorization | Resolve and revoke the same selected identity for cookie/native requests; test verifies deletion of the token hash |
| Invalid Authorization silently used cookie identity | Medium: an explicitly malformed header could authenticate an unintended cookie session | Explicit headers fail closed instead of falling back to another identity |
| Revoking a role's final grant restored defaults | High: an empty override table was indistinguishable from “use defaults” | Persist a non-grant override marker; initialize and mutate in one transaction; regression revokes reviewer's sole permission |
| Permission database outage restored stale/default access | High: cold/stale permission-cache failures were logged and ignored | Permission-sensitive requests fail with 503; explicit outage regression |
| Browser-normalized external return URLs | Medium: `/\\host`, tabs and newlines passed the simple slash-prefix check | Reject ambiguous control/backslash paths and verify parsed same origin; redirect adversarial corpus |
| Password reset was reusable concurrently | High: token was read outside the transaction and updated unconditionally | Atomic unused/unexpired claim, active-user check, invalidate other reset links, and session revocation in one transaction; real isolated SQLite race test |
| Password change and session revocation were not atomic | High: a partial failure could retain old sessions after changing the password; concurrent stale requests could overwrite a newer password | Conditional password-hash update, session and reset-link revocation in one transaction; literal spaces are preserved rather than trimming passwords |
| Malformed auth/profile requests produced 500s | Medium: typed casts did not validate null, arrays, objects and string fields | Explicit body/type checks and bounded new-password length; auth/reset regressions |
| Recovery email success was fictional in production | Medium: no email-delivery adapter exists, but the API said mail was sent | Return an explicit 503 without minting tokens; development-only token response remains available; delivery-truth test |
| Restore destroyed assets before validating archive structure | High data-loss risk: empty tar failed after deleting the existing asset directory | Validate and extract completely first, require exactly one root, retain asset/database safety copies, roll back assets if database commit fails |
| Restore leaked temporary plaintext after failed decryption | Medium confidentiality risk: EXIT cleanup was installed too late | Install cleanup before any plaintext temporary file; clear temporary SQLite sidecars; bad-key/corrupt-input test |
| Encrypted backup failure could retain plaintext | High confidentiality risk when encrypted-only policy was expected | Build and encrypt in private staging; publish only a complete snapshot; deterministic cipher-provider failure regression |
| Apple notification retries could be permanently lost | High billing integrity: receipt marker committed before refund transaction; all errors were treated as duplicates | Receipt, refund, revocation marker and processed state share a single transaction; transient-failure retry regression |
| Duplicate Apple refund UUIDs could remove multiple paid periods | High billing integrity: transaction already refunded was still applied to the subscription | Refund each actual transaction once even when delivery UUID changes |
| Apple refund could claw back unrelated original transactions | High billing integrity: both specific and original transaction credits were removed, and missing renewal orders fell back to the original order | Refund only the specific transaction when supplied; preserve unrelated prior purchases |
| Refund-before-purchase notification could later grant value | High billing integrity: an early refund left no durable transaction revocation | Persist a revocation tombstone and check it both before and inside purchase-grant transactions |
| Login repeated/interrupted submissions | Medium UX: mode could change during an in-flight request and same-tick repeated submission had no synchronous guard | Synchronous request guard, disabled mode switching, abort on unmount and bounded request timeout; browser verification pending |
| Profile nickname cooldown race | Medium integrity: cooldown read preceded the write transaction | Recheck cooldown inside the same transaction as profile mutation |

### Dependency and toolchain upgrade

Baseline `npm audit` reported 7 affected packages: 1 critical, 4 high, 2 moderate. Applied compatible fixes, without a framework-major migration:

- Next.js / eslint-config-next: 15.5.27
- Vitest: 4.1.11
- sharp: 0.35.5 through patched override floor
- brace-expansion: 5.0.12
- js-yaml: 4.3.2
- undici: 7.29.1, now an explicit dependency because application code imports it directly
- Node 22 LTS >=22.13; `.nvmrc`, package engine and CI aligned

Updated lockfile audit: zero reported vulnerabilities at every severity at audit time. This is the advisory database result, not proof that dependencies have no unknown vulnerabilities.

### Verification snapshot

- Baseline build, ESLint and TypeScript passed.
- Supported Node 22 baseline ran the original suites and new failing repros; one pre-existing release-gate test incorrectly depended on a local `dev.db`. It now uses a disposable missing database and asserts the actual fail-closed conditions.
- First repaired aggregate: 102 files passed; 775 tests passed, 13 skipped because their external/runtime preconditions were absent. Later IAP/backup/input regressions are recorded in the final evidence snapshot.
- Isolated HTTP contracts: 10/10 passed when server and client ran in the same sandbox invocation.
- Runtime-critical flows passed: four private-media lessons with distinct assets, account lifecycle, mock purchase, and five demand-state transitions with recipient checks. Media was synthetic and all database state disposable.
- Encrypted backup/restore drill passed SQLite integrity and exact asset-byte comparisons. Empty/multi-root/corrupt archives, failed decryption and failed encryption were exercised separately.
- High-confidence credential/private-key pattern scan found no matches in the audited source/diff. Existing public Apple trust certificates are not secrets.

## Round 2

Round 1 was frozen as local audit snapshot `edf8be68270ae6154a8fb6a887146a05cb8a357b` before the independent review. The reviewer reran all 31 new adversarial tests (8 files) under Node 22 and an offline guard, and examined session authentication, role overrides, Apple grants/refunds, and restore/encryption boundaries.

Round-2 followups:

1. Administrator password reset and disable now invalidate outstanding reset links inside the existing transaction. Three admin lifecycle/body regressions and the explicit-runtime check were reproduced failing before repair.
2. Permission and user-management routes reject null/non-object request bodies with 400, including the independently identified permissions-body case.
3. Explicit runtime targets now make an unavailable server or failed fixture login a failing suite, rather than a falsely green skipped run. The three search contracts also run in the required HTTP stage and no longer silently pass a 429 with zero assertions.
4. Added delayed/repeated login, visible server error, retry and return-to-login browser contracts, plus preview Escape/Close/Back checks and screenshots of login/lesson states. Browser traffic is intercepted to permit only the disposable loopback app; service workers and sockets are blocked. The login endpoint is stubbed and no provider credentials are used.
5. Native iOS/macOS authentication now ignores stale 401s and successful data responses from previous session generations. Suspended login completions cannot reinstall a session after logout. Bootstrap results are tied to the initiating token; logout clears local state before suspension and revokes only its captured credential. Debug token injection is excluded from release builds. Added eight offline XCTest cases for the shared invalidation policy.
6. Added unsigned GitHub-hosted macOS builds for both native targets and an offline XCTest job using the repository's existing XcodeGen project. No Apple account, signing identity or live app launch is involved.

Local round-2 aggregate before the small browser-network tests: 107 files passed, 793 tests passed, 13 skipped. Standalone required-runtime checks, 22/22 HTTP smoke contracts and runtime-critical flows passed. Typecheck under unrestricted concurrent load was killed by the shared environment; bounded heap/CPU reruns and the exact-commit hosted checks are tracked separately. All pending or skipped stages remain explicit; browser screenshots and native builds are not claimed passed until their CI evidence is inspected.

No branch push occurred before the round-1 review handoff and deployment-trigger check.

## CI and deployment boundary

The existing workflow has no deployment steps. The change adds only this dedicated repair-branch push pattern, read-only repository permissions, bounded hosted-runner time, concurrency cancellation and seven-day screenshot/report artifacts, plus unsigned hosted native builds/tests. Production master, backup and prior repair branches are unchanged. No merge, force-push, live release or production SSH was performed. Third-party integrations outside repository-visible configuration were not administratively inspected.

## Remaining constraints and release notes

- Production password-recovery email needs a real, approved delivery integration before enabling the endpoint; the API now accurately reports unavailability.
- Any genuinely pre-hash legacy sessions must sign in again. The historical migration grace period was at most 30 days and is already past the audit date.
- Node 22 LTS is required. Unsigned iOS/macOS compilation and offline policy XCTest are delegated to the isolated hosted macOS job; native-facing HTTP DTO contracts were exercised locally. Real-device UI, Keychain/StoreKit/APNs behavior remain separate acceptance requirements. `AppConfig.apiBaseURL` still targets localhost and must be configured for the intended deployment before real-device/release use.
- Real Stripe/Apple purchases, App Store delivery, external LLM quality, video-provider generation and production topology need controlled staging acceptance with operator-provided accounts. Mock tests do not prove those services are configured or commercially ready.
- Restore is an offline operation. Stop the application and ensure no SQLite connections remain before replacing an existing database. Safety copies require operator retention/cleanup. The database/asset pair cannot be made power-loss atomic across arbitrary separate filesystems by a shell script.
- Current backup encryption is the existing AES-256-CBC/PBKDF2 format plus SHA-256 corruption checks. It is not an authenticated-encryption guarantee against an adversary able to rewrite both ciphertext and manifests; protect backup storage and keys separately.
- Visual design, accessibility and embedded rendering conclusions remain provisional until exact-commit browser screenshots and checks are inspected.
