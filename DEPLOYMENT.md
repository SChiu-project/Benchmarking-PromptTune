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

The application creates its `doc_benchmark_state` table and workspace row on first use. The database role needs permission to create this table and read/write it. State updates run in transactions with advisory/row locks; queued questions, responses, raw JSON, scores, and attempt history survive serverless restarts. There is no hosted fallback to JSON files. [Neon's Vercel integration guide](https://neon.com/docs/guides/vercel-overview).

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

This is a single shared workspace, protected with HTTP Basic authentication. The browser asks for the configured username/password. Hosted requests fail closed until a sufficiently long password is set. This is not a multi-tenant account system. All holders of that password can see and manage the workspace's runs. Vercel's own Workflow routes use SDK/platform authentication and are intentionally excluded from application Basic auth.

## 5. Deploy and check

Deploy, sign in, and use `public/example.csv` for a small first batch. Check upload review, first-query test, batch progress, saved record details, score explanations, trace copy, and persistence after reload. The hosted CSV limit is 1 MB / 1,000 data rows; Records are paginated in groups of 50 with filtering across all records. Split larger inputs into batches.

Inspect the **Workflows** section in Vercel if a batch does not progress. A dispatch error in Records or the upload review offers **Retry queue dispatch**. The dispatch token prevents another workflow for the same submission/generation. A job whose Doc Search POST was already dispatched is not resent after an ambiguous interruption; it becomes interrupted once its lease expires.

If you canceled a workflow in Vercel or the platform marked it failed, use **Recover stopped workflow** in that run's Records view. Recovery verifies the workflow is terminal and waits for any in-flight request leases to expire. It marks unfinished work interrupted/skipped and preserves saved answers. It does not repeat searches. You can then start an intentional new batch or retry grading saved answers. Never clear an active database row by hand.

The automated GitHub check builds the app, checks TypeScript/lint, runs deterministic tests, and exercises the Workflow HTTP path with both JSON and PostgreSQL storage against isolated local mock services. PostgreSQL checks use the actual production connection driver with a disposable local PostgreSQL engine. No real evaluator key is needed for CI.

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
