# GitHub / Vercel preparation report

Prepared 7 November 2026 (Asia/Hong_Kong).

## Database timeout and polling fix

The supplied Vercel Runtime Logs show repeated 300-second timeouts on `/api/status` and `/api/runs`, both of which read stored benchmark state. Inspection found that every read previously entered a global locked write transaction, repeated schema initialization, and had no database query/pool deadline. Browser interval polling could overlap indefinitely. The logs alone do not identify the original stalled connection or blocking session.

Routine database reads now use plain SELECTs. Schema creation is checked once per client; only first-time schema bootstrap needs the global advisory lock. Writes and legacy normalization retain transaction/workspace row locking and gain transaction-local lock, statement and idle limits. Driver connection, pool, query and cancellation deadlines bound a silent database. Recognized transient failures return a sanitized JSON 503. Browser polling waits for the entire refresh, backs off after failures, aborts reads on cleanup and applies finite request deadlines without repeating mutations.

Verification includes eight concurrent read calls traced through the production driver with no DDL/INSERT/write locks, transaction limit ordering, an empty workspace read without a row write, polling overlap/backoff/cleanup, and an established connection deliberately silenced through a local TCP proxy. That fault returned `QUERY_TIMEOUT`/HTTP 503 in about ten seconds and a following read reconnected successfully after service resumed. The test uses the actual production driver and an isolated PostgreSQL engine; it does not exercise real Neon pool contention or access the user's database. Complete mock benchmark workflows passed with both JSON and PostgreSQL storage. A live redeployment and any investigation of existing blocking sessions remain the user's hosted checks.

## Hosting error response diagnostics

The second screenshot shows a client JSON parsing failure after a response beginning `An error o`. The client previously parsed every response as JSON before checking HTTP status. This masked non-JSON platform/access errors. The underlying live server failure cannot be identified from that truncated parser message; Vercel Runtime Logs or the complete failed HTTP response are required.

The browser request helper now handles text, HTML, empty responses and network failures; preserves application JSON errors; reports status/platform code/request ID when available; and reminds users that a failed submission response may still have saved work. It never retries submissions automatically or displays arbitrary server response bodies. Eleven regressions cover these scenarios and request deadlines. The later database timeout fix is described above; recovery of the live deployment has not been observed here.

## Deployed benchmark database fix

Reproduced the reported `Invalid input: expected object, received string` using the production `postgres` connection driver against an isolated PostgreSQL wire-protocol server. The earlier JSONB parameter caused the driver to serialize already-serialized state again. Direct SQL-engine tests had missed this driver behavior.

Writes now use text parameters followed by a server-side JSONB cast. Reads recognize the known legacy string encoding, decode and validate it, and normalize it within the existing locked transaction. Saved runs, records and evaluation criteria are retained. Undecodable or invalid saved state remains unchanged and returns a distinct server error rather than a CSV validation error.

Six production-driver regressions cover the original failure, new snapshots, nested question persistence and duplicate submissions, legacy repair, and preservation of malformed/schema-invalid data. The complete HTTP/Workflow smoke now runs against both JSON storage and PostgreSQL through the real driver. No user database or live upstream API was used for these checks. The fix still requires updating GitHub and redeploying the hosted application.

## Deployment output-directory fix

The deployment reported `NEXT_OUTPUT_DIR_MISSING` after successful compilation because the earlier configuration produced `.next-production` while Vercel expected `.next`. The custom `distDir` has been removed. Builds now use `.next` and run `scripts/verify-build-output.mjs` to check the build ID, route manifests, application pages and Workflow handler before reporting success. TypeScript paths and setup instructions now follow the standard output. Generated upload copies are excluded from TypeScript checking.

Verification for this fix: production build and output-artifact check, strict type checking, lint, and the protected Workflow HTTP smoke test passed locally. A fresh extraction of the corrected ZIP also installed with the frozen lockfile and built successfully with Vercel-targeted settings, producing `.next`. A negative check confirmed the build verifier rejects a missing `.next` directory. The corrected package must be pushed to the user's GitHub repository and redeployed in Vercel; a successful live deployment has not been observed here.

## Ready in source

- Existing CSV review, Doc Search adapter, fulfillment scoring/explanations, Runs/Records screens and local JSON/process-worker mode retained.
- Vercel hosted mode: PostgreSQL JSONB snapshots with atomic transaction/workspace row locks, lock-free routine reads and advisory locking for schema bootstrap only; bounded database waits; sequential browser polling with backoff; managed durable Workflows; persisted search/evaluator concurrency caps; no automatic resend of ambiguous search POSTs; generation-aware grading retries; dispatch retry and stopped-workflow recovery controls.
- Hosted Basic auth, fail-closed missing database/password handling, same-origin/host checks, server-side secrets, explicit hosted environment labels, bounded upload/request sizes, and paginated records with full-dataset filtering.
- `vercel.json`, Node/pnpm version declarations, lockfile, `.vercelignore`, GitHub Actions workflow, clean-source packaging, deployment guide, configuration check and optional completed-history importer.
- Clean export omits all original Git history, local credentials, saved runs, installed tools and generated/build output. Test fixture is a sanitized response excerpt rather than the original full corpus/configuration payload.

## Checks run

- Production `pnpm build`: passed, including compiled Workflow and Next.js proxy routes.
- `pnpm typecheck`: passed.
- `pnpm lint`: passed; generated Workflow routes are excluded from authored-source lint checks.
- `pnpm test`: 53 tests passed across 8 files. Includes original 20 regressions plus cross-invocation queue limits, duplicate/ambiguous dispatch handling, workflow generations, hosted auth/origins, fail-closed database config, full-dataset pagination, actual PostgreSQL SQL/JSONB/namespace/rollback behavior, production-driver serialization/legacy-repair checks, read/query-limit tracing, silent-connection recovery, browser request errors/deadlines, and sequential polling/backoff/cleanup.
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

## CMS prompt loading — 2026-11-15

Implemented read-only CMS loading in the existing prompt editor, with exact source selection, three language views, changed-section labels, reset/reload controls, base-configuration labeling and manual JSON fallback. New `/api/cms/prompts/load` and `/check` routes use workspace authentication, same-origin validation, a server-side project allowlist and the verified llmGraph session headers. Local setup uses an explicitly configured connector session file; hosted deployments require private token/UID configuration and manual renewal.

Baselines live in a bounded, expiring collection within the transactional local/PostgreSQL workspace state. Each test/run owns immutable baseline/provenance and changed DTOs. Server submission checks reject cross-scope/stale snapshots, calculate changes against the stored baseline, and preserve all three languages. New CMS-backed submission identities include canonical source identity, baseline fingerprint/version, edits and cache policy. Workers use the persisted configuration without retrieving CMS per question. Old history/manual overrides remain supported.

Verification for this feature:

- 22 CMS-specific tests passed, including route authentication/errors, limits, language validation, base checks, stale acknowledgement, scope isolation, idempotency, PostgreSQL JSONB and worker behavior after credentials disappear.
- Full release unit/integration suite: 108 tests passed across 12 files. Production build, standard-output verification, TypeScript and lint checks passed.
- Live `pnpm cms:check` loaded MTR ROOT v19 with all supported fields. A controlled dev call loaded persona_maisie v3, persisted a temporary baseline, sent only custom instructions with unchanged zh/sc values and `use_cache:false`, returned the requested harmless marker, and left CMS content/version unchanged on follow-up read. Temporary benchmark state was removed; no CMS write was made. Trace ID: `57890a9b92e7ee8014069a4b46e7e8e7`.
- The fresh trace was not inspected: this connector has no Langfuse trace server configured. Answer-marker evidence is weaker than effective-LLM-input trace evidence, and is not presented as complete runtime verification. A prompt version was not reported in this response.
- The initial Workflow smoke failed against the old evaluation fixture. After updating that fixture for the evaluation upgrade, the release check passed for both local JSON and the PostgreSQL production driver, including saved-answer campaign regrading. CMS persistence/worker tests also pass independently.
- No new interactive browser QA or live hosted deployment was performed. Hosted auth renewal, production CMS semantics, and full effective-prompt reproducibility remain outside what was verified. Setup and limits: `CMS_PROMPTS.md`.

## Browser CMS login and supervisor approval (2026-11-22)

Implemented benchmark-hosted CMS login/OTP forms, server-encrypted browser sessions, and emailed supervisor approval for a single project and requester browser. The supervisor page is standalone and does not require the shared workspace password. It requires the emailed capability and the matching authenticated CMS account with project membership, followed by explicit consent. Grants are limited to one hour (and the remaining browser lifetime), support denial/cancellation/revocation, and cannot be replayed. Direct logins cancel pending approvals. New browser-loaded prompt snapshots are bound to their browser session; loading, change checks, and new benchmark submissions resolve current CMS access and recheck membership. Accepted idempotent submissions remain retryable without another CMS read. Project selection remains editable; `CMS_PROJECT_IDS` is no longer consulted. Hosted mode never falls back to a shared CMS token in environment variables.

Verified on the project's Node 24 runtime: production build and output validation; TypeScript; lint (only the pre-existing unused `base` warning in evaluation-dimensions); 141 existing regressions plus 22 new auth/approval tests; JSON and production-PostgreSQL-driver Workflow HTTP smoke checks. New tests cover wrong-account/project access, explicit consent, cross-browser snapshot use, OTP challenge isolation/replay, expiry, revocation after reauthentication, late decisions after cancellation/direct login, email rate limits and uncertain failures, ciphertext persistence through PostgreSQL SQL, cookie/tamper handling, and idempotent retry after logout. CMS/email services in these tests are controlled mocks.

The dev CMS login endpoint answered an OPTIONS reachability check with HTTP 204. Successful real-account login/OTP, live supervisor email delivery, and hosted deployment were not exercised: no valid CMS session, email provider configuration, or Vercel connection was available in this environment. The bundled connector explicitly labels its OTP body as inferred, so live OTP compatibility remains to be checked. Email delivery uses Resend and requires private `RESEND_API_KEY` and an authorized `CMS_EMAIL_FROM` in Vercel. Direct login needs no new CMS credential/project environment settings. See CMS_PROMPTS.md for setup and limitations; this is app-level read authorization, not native CMS delegation or an organizational supervisor-role check.
