# GitHub / Vercel preparation report

Prepared 7 November 2026 (Asia/Hong_Kong).

## Deployed benchmark database fix

Reproduced the reported `Invalid input: expected object, received string` using the production `postgres` connection driver against an isolated PostgreSQL wire-protocol server. The earlier JSONB parameter caused the driver to serialize already-serialized state again. Direct SQL-engine tests had missed this driver behavior.

Writes now use text parameters followed by a server-side JSONB cast. Reads recognize the known legacy string encoding, decode and validate it, and normalize it within the existing locked transaction. Saved runs, records and evaluation criteria are retained. Undecodable or invalid saved state remains unchanged and returns a distinct server error rather than a CSV validation error.

Six production-driver regressions cover the original failure, new snapshots, nested question persistence and duplicate submissions, legacy repair, and preservation of malformed/schema-invalid data. The complete HTTP/Workflow smoke now runs against both JSON storage and PostgreSQL through the real driver. No user database or live upstream API was used for these checks. The fix still requires updating GitHub and redeploying the hosted application.

## Deployment output-directory fix

The deployment reported `NEXT_OUTPUT_DIR_MISSING` after successful compilation because the earlier configuration produced `.next-production` while Vercel expected `.next`. The custom `distDir` has been removed. Builds now use `.next` and run `scripts/verify-build-output.mjs` to check the build ID, route manifests, application pages and Workflow handler before reporting success. TypeScript paths and setup instructions now follow the standard output. Generated upload copies are excluded from TypeScript checking.

Verification for this fix: production build and output-artifact check, strict type checking, lint, and the protected Workflow HTTP smoke test passed locally. A fresh extraction of the corrected ZIP also installed with the frozen lockfile and built successfully with Vercel-targeted settings, producing `.next`. A negative check confirmed the build verifier rejects a missing `.next` directory. The corrected package must be pushed to the user's GitHub repository and redeployed in Vercel; a successful live deployment has not been observed here.

## Ready in source

- Existing CSV review, Doc Search adapter, fulfillment scoring/explanations, Runs/Records screens and local JSON/process-worker mode retained.
- Vercel hosted mode: PostgreSQL JSONB snapshots with atomic transaction/row/advisory locks; managed durable Workflows; persisted search/evaluator concurrency caps; no automatic resend of ambiguous search POSTs; generation-aware grading retries; dispatch retry and stopped-workflow recovery controls.
- Hosted Basic auth, fail-closed missing database/password handling, same-origin/host checks, server-side secrets, explicit hosted environment labels, bounded upload/request sizes, and paginated records with full-dataset filtering.
- `vercel.json`, Node/pnpm version declarations, lockfile, `.vercelignore`, GitHub Actions workflow, clean-source packaging, deployment guide, configuration check and optional completed-history importer.
- Clean export omits all original Git history, local credentials, saved runs, installed tools and generated/build output. Test fixture is a sanitized response excerpt rather than the original full corpus/configuration payload.

## Checks run

- Production `pnpm build`: passed, including compiled Workflow and Next.js proxy routes.
- `pnpm typecheck`: passed.
- `pnpm lint`: passed; generated Workflow routes are excluded from authored-source lint checks.
- `pnpm test`: 34 tests passed across 5 files. Includes original 20 regressions plus cross-invocation queue limits, duplicate/ambiguous dispatch handling, workflow generations, hosted auth/origins, fail-closed database config, full-dataset pagination, actual PostgreSQL SQL/JSONB/namespace/rollback behavior, and production-driver serialization/legacy-repair checks using an isolated PGlite engine and wire-protocol server.
- `pnpm test:workflow`: passed for both local JSON and PostgreSQL production-driver storage. Each path exercises a real local HTTP route → SDK dispatch → durable workflow → two mock Doc Search calls → two mock LLM evaluations → persisted terminal run → paginated records. Duplicate submission retained the same run ID and caused no duplicate upstream requests. Temporary data and mock credentials only; no real service calls.
- Vercel-targeted production compilation with a dummy deployment identity: passed; generated managed queue trigger configuration was inspected. This does not exercise a real Vercel deployment.
- Previous output-directory-fix ZIP extraction: frozen dependency install, production build, the then-current 28 tests, and protected Workflow HTTP smoke passed without the original environment file or saved data. The database-fix export includes the updated 34-test suite and both Workflow storage checks.
- Browser check: existing six saved records and their fulfillment explanations still render with the new paginated API.
- Server function tracing: no local credentials, saved data, or installed local tools included.
- Existing real-service integration was smoke-tested during the initial local build on 6 November. Those live API calls were not repeated for the hosting preparation.

## Still requires your hosted setup

No GitHub repository was created/pushed and no Vercel resources were provisioned or deployed. Follow `DEPLOYMENT.md` to import the clean source, connect a PostgreSQL database, set `DATABASE_URL`, a strong `APP_PASSWORD`, and the existing evaluator settings, enable Vercel System Environment Variables, and deploy.

Not verified without that live project: hosted PostgreSQL network/TLS connectivity, Vercel OIDC/queue execution, GitHub-hosted Actions execution, and the public HTTPS user flow. A passing local production build is not a claim that deployment already succeeded. Platform plan/resource availability and billing are governed by your provider accounts.

## Deliberate limits

One shared authenticated workspace; no per-user accounts, tenancy or roles. One active run per workspace. Database snapshots are an MVP persistence model and become slower with very large histories. Source counts are retrieved passages, not unique verified citations. Hosted uploads are capped at 1 MB, local uploads at 5 MB; input row cap is 1,000. Records use 50-row pages. LLM assessments remain evidence-based but fallible; unavailable/unscored values are not zeros. Local history is not automatically uploaded.
