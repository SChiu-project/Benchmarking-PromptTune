# Upload to GitHub and deploy on Vercel

The application is prepared for Vercel. Creating accounts/resources and the live deployment remain setup steps; no Vercel or database credentials were provided for this preparation.

## 1. Use the clean upload folder

Use the contents of `github-ready/doc-search-benchmark/` produced by `pnpm package:github`, or extract `github-ready/doc-search-benchmark-github.zip`. This export includes the code, lockfile, tests, and `.github` workflow, with no local Git history, credentials, installed tools, saved runs, or build output. The original local repository history contains an early full API capture; use the clean export for the new remote.

Create a new GitHub repository (private is a suitable starting point). Make the exported application's files the repository root: `package.json`, `app/`, `lib/`, and `vercel.json` should be at the top level. GitHub Desktop can create a repository from the exported folder and publish it. Alternatively, initialize Git there and push it to your new repository. Preserve dotfiles, including `.github`, `.gitignore`, `.vercelignore`, and `.env.example`.

Do not upload the ZIP as a single repository file. Upload or push its extracted contents. Do not upload the neighboring `.env` files from `Codex_Benchmark_tool`.

## 2. Import into Vercel

1. In Vercel, choose **Add New → Project** and import that GitHub repository.
2. Use framework **Next.js**, Node.js **24.x**, and the repository root as Root Directory.
3. Keep the install/build settings supplied by `vercel.json`: `pnpm install --frozen-lockfile` and `pnpm build`. Keep the Output Directory override **unset** (Next.js defaults to `.next`), or use `.next` if an override is required. Do not set it to `.next-production`. Vercel runs the generated Functions and Workflow routes, not `pnpm start` or a persistent local worker.
   `vercel.json` also sets an internal hosted-mode flag so database/auth protection cannot silently fall back to local mode when system variables are missing.

4. Under project settings, enable **access to System Environment Variables**. Workflow needs Vercel's deployment identity at build and runtime. Do not manually set `VERCEL`, `VERCEL_DEPLOYMENT_ID`, or `WORKFLOW_TARGET_WORLD`.

The Workflow SDK selects Vercel's managed execution backend during deployment. Review the current platform/Workflow allowances for your account; this preparation does not create a subscription or guarantee free usage. [Vercel Workflows](https://vercel.com/docs/workflows), [Workflow deployment guide](https://workflow-sdk.dev/docs/deploying), [pricing and limits](https://vercel.com/docs/workflows/pricing).

## 3. Connect PostgreSQL

Add a PostgreSQL integration through Vercel's Marketplace, for example **Neon**, or use an existing compatible PostgreSQL database. Connect it to the project and provide its pooled TLS-enabled connection string as `DATABASE_URL`.

The application creates its `doc_benchmark_state` table on first use and a workspace row on the first write. The database role needs permission to create this table and read/write it. State updates run in transactions with workspace row locks; the schema bootstrap alone uses an advisory lock. Routine page reads avoid those write locks and schema changes. Queued questions, responses, raw JSON, scores, and attempt history survive serverless restarts. There is no hosted fallback to JSON files. [Neon's Vercel integration guide](https://neon.com/docs/guides/vercel-overview).

Use a separate database/branch for Preview where possible. The app also separates default workspace namespaces: `production` for production, `preview:<branch>` for previews. Set `BENCHMARK_NAMESPACE` only when you intentionally want a different workspace. Do not give previews the production namespace against the same database.

## 4. Add environment variables

Set these in Vercel, not in GitHub source. Redeploy after configuration changes.

| Variable                | Required       | Value                                                                                                                     |
| ----------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`          | Yes            | Pooled PostgreSQL connection URL with TLS                                                                                 |
| `APP_PASSWORD`          | Yes            | A unique shared password, at least 16 characters                                                                          |
| `APP_USERNAME`          | No             | Defaults to `benchmark`                                                                                                   |
| `APP_URL`               | Custom domains | Full HTTPS address, e.g. `https://benchmark.example.com`; standard Vercel deployment addresses are detected automatically |
| `EVALUATOR_ENDPOINT`    | For grading    | Full chat-completions URL, including `/v1/chat/completions` where applicable                                              |
| `EVALUATOR_MODEL`       | For grading    | Your model ID                                                                                                             |
| `EVALUATOR_API_KEY`     | For grading    | Your server-side bearer credential                                                                                        |
| `DOC_SEARCH_ENDPOINT`   | No             | Defaults to the supplied Doc Search service                                                                               |
| `DOC_SEARCH_PROJECT_ID` | No             | Defaults to `mtr-air-kiosk-05emf61`                                                                                       |
| `DOC_SEARCH_TIMEOUT_MS` | No             | Defaults to 60000; keep below 180000 for hosted Functions                                                                 |
| `EVALUATOR_TIMEOUT_MS`  | No             | Defaults to 60000; keep below 180000 for hosted Functions                                                                 |

Your existing evaluator settings are in the original app's ignored `.env.local`. Copy those values directly into Vercel's environment settings; the clean export intentionally omits them. Never use `NEXT_PUBLIC_` or `VITE_` for credentials.

This is a single shared workspace, protected with HTTP Basic authentication. The browser asks for the configured username/password. Hosted requests fail closed until a sufficiently long password is set. This is not a multi-tenant account system. All holders of that password can see and manage the workspace's runs. Vercel's own Workflow routes use SDK/platform authentication and are intentionally excluded from application Basic auth. The CMS supervisor approval page (`/cms/approve`) and its API (`/api/cms/approval`) also bypass Basic auth, but require a valid emailed capability and authenticated CMS identity for approval decisions. No other CMS route bypasses workspace authentication.

## 5. Deploy and check

Deploy, sign in, and use `public/example.csv` for a small first batch. Check upload review, first-query test, batch progress, saved record details, score explanations, trace copy, and persistence after reload. The hosted CSV limit is 1 MB / 1,000 data rows; Records are paginated in groups of 50 with filtering across all records. Split larger inputs into batches.

Inspect the **Workflows** section in Vercel if a batch does not progress. A dispatch error in Records or the upload review offers **Retry queue dispatch**. The dispatch token prevents another workflow for the same submission/generation. A job whose Doc Search POST was already dispatched is not resent after an ambiguous interruption; it becomes interrupted once its lease expires.

If you canceled a workflow in Vercel or the platform marked it failed, use **Recover stopped workflow** in that run's Records view. Recovery verifies the workflow is terminal and waits for any in-flight request leases to expire. It marks unfinished work interrupted/skipped and preserves saved answers. It does not repeat searches. You can then start an intentional new batch or retry grading saved answers. Never clear an active database row by hand.

The automated GitHub check builds the app, checks TypeScript/lint, runs deterministic tests, and exercises the Workflow HTTP path with both JSON and PostgreSQL storage against isolated local mock services. PostgreSQL checks use the actual production connection driver with a disposable local PostgreSQL engine. No real evaluator key is needed for CI.

## CMS login and supervisor emails

Users sign into CMS through **Test revised prompts → Connect to CMS**. Their selected project is checked against their CMS account; do not set `CMS_PROJECT_IDS`, `CMS_READ_TOKEN`, or `CMS_READ_UID` for hosted users. Tokens are encrypted in the existing PostgreSQL workspace snapshot, using optional `CMS_SESSION_SECRET` or the existing `APP_PASSWORD` as a fallback. Changing the encryption secret invalidates sessions and requires new sign-ins.

For **Ask a supervisor**, set `RESEND_API_KEY` and `CMS_EMAIL_FROM` (an authorized sender in that account), then redeploy. Direct CMS login works without email delivery. An optional `APP_URL` must match the deployment host used by the requester so approval decisions reach the same namespace/database. See [CMS_PROMPTS.md](CMS_PROMPTS.md) for the flow, limits, revocation, known OTP validation gap, and shared-workspace visibility.

## Optional: bring existing local results

Local history is not uploaded automatically. To migrate it, stop the local app, set the destination `DATABASE_URL` and explicit `BENCHMARK_NAMESPACE=production` in its local environment, then run:

```sh
pnpm data:import
```

The importer requires an empty destination workspace and rejects active source runs. It copies saved runs without scheduling searches or grading. Remove those hosted settings from the local environment afterward if you want to return to the local JSON mode. Keep local and hosted databases separate during development.

## What has and has not been verified

The production Workflow build, isolated PostgreSQL SQL tests, mock-service durable queue HTTP smoke test, and local regression suite can be run without a cloud account. Actual GitHub Actions execution, hosted PostgreSQL network connectivity, Vercel OIDC/queue dispatch, and the public HTTPS deployment require your connected project and must be checked after deployment. See `COMPLETION.md` for the checks actually run during preparation.

## Fixing NEXT_OUTPUT_DIR_MISSING

If your log shows a successful Next.js build followed by Vercel looking for `/vercel/path0/.next`, use the corrected `next.config.ts` from this package. The earlier package set a custom `.next-production` directory, which did not match the deployment collector's expected `.next` path. The corrected configuration uses the Next.js default; the build command now verifies `.next/BUILD_ID` and the deployment manifests.

Push the corrected files to GitHub, check that Vercel's Framework Preset is **Next.js**, leave its Output Directory override off (or `.next`), and redeploy the new commit without the previous build cache. Root Directory must be the folder containing `package.json`. This fixes the reported output-folder failure; a successful live deployment still needs to be confirmed in Vercel.

## Fixing “Invalid input: expected object, received string” when starting a batch

An earlier build passed already-serialized JSON to a JSONB-typed driver parameter. The PostgreSQL driver serialized it a second time, so saved state was a JSON string instead of an object. The CSV could parse successfully while starting a run failed with this validation error.

Update the repository with the corrected source from this package and redeploy. The corrected database writes avoid double serialization. On the next read, existing string-encoded state is decoded, validated, and normalized in a locked transaction, preserving its saved runs and records. No database reset, table deletion, or credential change is needed for this error. Reload the application after deployment and retry the batch.

If saved content cannot be decoded or fails validation, the application preserves it and reports `STORED_STATE_INVALID` as a server error. Inspect Vercel server logs before making any manual database changes. The automatic repair is covered by production-driver regression tests; repair of the user's live database must still be confirmed after redeployment.

## “Unexpected token 'A', 'An error o' ... is not valid JSON”

This message means the browser received a non-JSON response and the earlier client tried to parse it as JSON. It does not identify the server failure. A hosting error page, timeout, access restriction, or failed function can return plain text or HTML. The CSV may already have parsed successfully.

The updated client handles these responses and shows the HTTP status, platform error code, and Vercel request ID when available. It preserves normal JSON application errors and never automatically repeats a failed submission. A response failure does not prove the batch was not saved: check Runs before creating another batch.

To find the underlying failure without redeploying, open the Vercel project → **Logs**, reproduce the problem once, and select the failed `POST /api/runs` request (or `POST /api/test` if testing connectivity). Copy its HTTP status, error code, and server exception/stack trace, omitting credentials. The browser's Network panel can also show the failed request's status, response body, and `x-vercel-id` header. A function crash or timeout may occur before application error handling can return JSON. Diagnose the recorded error rather than resetting the database or changing credentials based on this parser message alone.

The response-handling fix is verified with text/HTML/empty failures, authentication failures, timeouts, and ambiguous submission results. The subsequently supplied logs show five-minute timeouts on both `/api/runs` and `/api/status`; see the following section for the database and polling fix.

## Repeated “Task timed out after 300 seconds” on status and run routes

Both these routes read benchmark state. The old implementation took a global write lock, ran table initialization and inserted a workspace row on every read. It also had no query or pool-queue deadline. Browser intervals kept sending more requests while earlier requests were still waiting. This made a stalled connection or database lock capable of blocking routine page refreshes and building a large backlog. The `42P07` notice saying the table already exists is informational; it is not the timeout error.

The corrected implementation reads existing state with plain SELECTs, initializes the schema once per application client, and locks the workspace row only for mutations or legacy format repair. Driver limits are 8 seconds for connection/query waits, 5 seconds for waiting for a pool connection, and 2 seconds for an unanswered cancellation. Writes set transaction-local lock (2s), statement (5s), and idle-in-transaction (10s) timeouts. These are individual operation limits, not a guarantee that every multi-query request finishes within 8 seconds. Failed database operations return a sanitized JSON `503 DATABASE_UNAVAILABLE` with a database error code. Work is never automatically resubmitted after an ambiguous failure.

Browser refreshes now wait for all current reads to settle, then schedule the next refresh. Failed refreshes back off up to 30 seconds. Reads have a 15-second browser deadline; submissions have 45 seconds and retain the warning that work may already be saved. Leaving a view aborts its outstanding read requests.

Update the GitHub source and redeploy this version. Close old application tabs while deploying, then open the new deployment and check Runs before starting another batch. Existing state is retained. If a run is still active, inspect its Workflow status; use the existing recovery control only after that workflow is stopped and its in-flight leases expire. A longer Vercel function timeout does not remove the database backlog.

If the new deployment reports `DATABASE_UNAVAILABLE`, its server log includes a safe database code such as `55P03` (lock wait) or `QUERY_TIMEOUT`. In the database provider's SQL editor, this read-only query can identify blocking sessions without displaying uploaded content:

```sql
SELECT pid, application_name, state, wait_event_type, wait_event,
       now() - xact_start AS transaction_age,
       pg_blocking_pids(pid) AS blocking_pids
FROM pg_stat_activity
WHERE datname = current_database() AND pid <> pg_backend_pid()
ORDER BY xact_start NULLS LAST;
```

Old deployments can leave sessions that do not have the new idle timeout. Have the database owner inspect any persistent blocker before terminating it; do not delete saved benchmark rows. The supplied logs establish the timeout pattern but do not identify the original blocking session or prove a specific connection-provider fault. Local fault tests verify bounded failure and reconnection; live recovery still needs confirmation after redeployment. [PostgreSQL timeout behavior](https://www.postgresql.org/docs/current/runtime-config-client.html), [Neon transaction pooling](https://neon.com/docs/connect/connection-pooling).

## Two-model release candidate: verification and rollback

Create a named clean export without replacing an earlier export:

```sh
pnpm package:github --name release-candidate-YYYY-MM-DD
```

The candidate is written under `github-ready/<name>/`. Exported source has no local Git history, configured credentials, saved benchmark state, human-review packets, installed tools or incremental TypeScript cache. The packager refuses forcibly tracked private report paths and refuses an existing destination. Keep `reports/` excluded from deployments as well: it contains private evidence, reviewer identities and model mappings.

For the two-model feature, verify these flows in a separate Preview workspace/database before production:

1. Workspace authentication rejects unauthenticated access. CMS login grants reads only for authorized projects; expired/revoked sessions fail closed. OpenRouter discovery never receives the corporate proxy key.
2. Both CMS model picklists load from `/cms/project/{projectId}/documentSearchBenchmark/models`. Changing project invalidates old selections. The submitted model IDs match the IDs reported by Doc Search; mismatches remain explicit.
3. A one-question comparison saves two answers, individual dimension results and six comparative verdict/reason fields. Missing/incomplete evidence stays explicit rather than becoming a fabricated failure or winner. Inspect randomized A/B reason mappings.
4. Reloads and workflow recovery preserve answers. A comparison-only retry increases comparison history without issuing new generation calls. Ambiguous generation timeouts are not resent automatically.
5. Results and summary downloads retain both models, unscored/errors/review outcomes, all selected dimension columns, judge identity and rubric metadata. Keep a pre-change saved run to check history compatibility.
6. Check actual hosted request durations and account limits. The current hosted evaluator step processes a whole dimension suite, with per-call timeouts/retries; mock workflow checks do not establish that worst-case slow upstream calls fit the deployed Function duration. Verify the deployment's duration allowance and a realistic full-evidence grading run before approving hosted release.

Local test success is not evidence that hosted secrets, database networking, platform dispatch or current-source CI have passed. This checkout's local `deploy:check` only inspects local environment variables; a failure there does not prove an existing Vercel project's settings are missing. Verify that project's settings separately once the deployment target is identified. Do not reuse the corporate proxy key as the workspace password.

**Human calibration gate:** the completed two-answer pilot is one tuned case family. The independent reviewer forms remain the source of human labels; unknown/default values must not be treated as reviewed. Review the borderline director/company-secretary citation attribution, then add representative independent case families and a frozen held-out split before claiming calibrated judge accuracy. A Preview may demonstrate software behavior while its grading remains explicitly uncalibrated.

**Rollback preparation:** before promotion, let active benchmarks finish and take a consistent backup of the workspace snapshot plus the configuration required to decrypt CMS sessions. Preserve the last known good deployment and its matching state backup. The JSON snapshot has additive fields, but older application versions may strip unfamiliar model/comparison fields on their next write; code-only rollback is therefore not a proven data-preserving procedure. Stop mutation/worker traffic first, preserve the latest state separately, and rehearse restoring the matching old state into an isolated rollback workspace before applying it to production. A forward fix may preserve more recent results than restoring old state.

Stop promotion or start recovery if access controls fail, a requested model silently changes, duplicate generation dispatch occurs, saved answers disappear, or durable execution cannot complete within the hosted limits. Establish hosted latency/error baselines during Preview verification rather than inventing numerical thresholds from the local pilot. No stakeholder notification or production promotion is implied by preparing this candidate.
