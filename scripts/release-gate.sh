#!/usr/bin/env bash
set -Eeuo pipefail

echo '[release-gate] dependency audit'
npm audit --audit-level=moderate
echo '[release-gate] lint'
npm run lint
echo '[release-gate] typecheck'
npx tsc --noEmit
echo '[release-gate] full test suite'
npm test -- --reporter=dot
echo '[release-gate] production build'
npm run build
echo '[release-gate] encrypted backup/restore drill'
npm run check:backup
echo '[release-gate] production commercial readiness'
NODE_ENV=production npm run check:commercial -- --json
echo '[release-gate] PASS: production release prerequisites verified'
