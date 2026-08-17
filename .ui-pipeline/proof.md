# UI Proof

## Verification scope

- Route: `/create`, `/api/ai/generate-course`, `/api/ai/models`
- Runtime: Next.js production server on `127.0.0.1:3101`
- Public tunnel: `https://learn.leonote.top`

## Evidence

- Root cause DB record: 2026-08-17 13:07:21 request aborted at 60.044s with `provider_timeout`; reservation fully refunded.
- Real model benchmark:
  - legacy 6000 tokens: 81.451s
  - 4000 tokens: 64.230s
  - 3500 tokens + `reasoning_effort=low`: 29.020s, valid JSON, 8 lessons
- Final authenticated E2E: HTTP 200 in 39.996s, valid 5-lesson outline, `gpt-5.6-sol`, checkpoint persisted; exact test course deleted afterward.
- Terminal compliance E2E: source-policy 422 returned `COURSE_OUTLINE_FAILED` and `preserveRequestId:false`.
- Browser: `/create` correctly redirected unauthenticated session to `/login?next=/create`; accessible form DOM present; console warnings/errors: 0.
- Tests: 82 files passed, 720 passed, 13 skipped.
- ESLint: 0 warnings/errors. Production build: passed.
- Local routes: `/`, `/create`, `/api/health`, `/api/version`, `/api/ai/models` all 200.
- External probes: 5/5 nodes returned HTTP 200, 0.357-0.586s.

## Remaining risk

- One `LlmBillingReconciliation` row remains `pending` for the original ambiguous provider timeout. User credits are already fully refunded; operations runbook requires manual provider-bill reconciliation.
