# Doc Search Benchmark

A benchmark workspace for uploading test questions, calling Doc Search, inspecting answers/sources/traces, and grading fulfillment with approved requirements and a separate LLM where needed. Built with Next.js App Router, React, strict TypeScript, Zod, and pnpm.

**Hosting on Vercel:** follow [DEPLOYMENT.md](DEPLOYMENT.md). The hosted mode uses PostgreSQL and durable Vercel Workflows. Local mode keeps JSON storage and the independent process worker. The fulfillment explanation column works with existing saved evaluations.

## UI branding and implementation

Use the [UI handbook](UI_HANDBOOK.md) for the shared visual identity, design tokens, component patterns, responsive rules, artwork shuffling, and guidance for related web apps.

## Requirement evaluation

New benchmarks support approved requirement checklists, deterministic fulfillment scoring, critical pass/fail gates, review decisions for incomplete evidence, source grounding, and versioned regrading without rerunning Doc Search. Import criteria in the CSV review dialog; without approved requirements, new answers are saved and grading is skipped. Historical scores remain labeled as legacy holistic scores. See [EVALUATION_GUIDE.md](EVALUATION_GUIDE.md) for criteria examples, calibration, paired comparison reports and operational limits.

## Local start

Node.js 24.x and pnpm 10.28.2:

```sh
pnpm install --frozen-lockfile
cp .env.example .env.local
pnpm dev
```

Open http://127.0.0.1:3000. `pnpm dev` starts the web server and local queue worker. The existing `Start Benchmark.command` launcher can use the project-local tools installed on the original Mac checkout. The clean GitHub export omits those installed tools, so a fresh checkout needs Node and pnpm installed normally.

Leave `DATABASE_URL` and `JOB_BACKEND` unset for the original local JSON/process mode. `pnpm build` writes the standard `.next` directory and verifies its deployment manifests; `pnpm start` serves that build locally with the same queue worker. Vercel uses the same standard output directory.

## Environment

Use ignored `.env.local` or `.env`, and restart after changes. Configuration is server-only.

| Variable                       | Purpose                                                                    |
| ------------------------------ | -------------------------------------------------------------------------- |
| `DOC_SEARCH_ENDPOINT`          | Full POST endpoint; defaults to the service in the brief                   |
| `DOC_SEARCH_PROJECT_ID`        | Defaults to `mtr-air-kiosk-05emf61`                                        |
| `DOC_SEARCH_TIMEOUT_MS`        | 60000 default; hosted recommended maximum 180000                           |
| `EVALUATOR_ENDPOINT`           | Full OpenAI-compatible chat-completions URL                                |
| `EVALUATOR_MODEL`              | Model ID                                                                   |
| `EVALUATOR_API_KEY`            | Bearer credential                                                          |
| `EVALUATOR_TIMEOUT_MS`         | 60000 default; hosted recommended maximum 180000                           |
| `DATA_DIR`                     | Local JSON storage directory; defaults to `./data`                         |
| `PORT`                         | Local server port; defaults to 3000                                        |
| `DATABASE_URL`                 | PostgreSQL connection URL; required on Vercel, optional locally            |
| `APP_PASSWORD`, `APP_USERNAME` | Shared workspace Basic auth; password required on Vercel, optional locally |
| `APP_URL`                      | Full HTTPS address for a custom hosted domain                              |
| `BENCHMARK_NAMESPACE`          | Database workspace override; production/previews otherwise separate        |
| `JOB_BACKEND`                  | Optional `workflow` to test durable execution locally                      |

The evaluator supports bearer authentication, JSON mode, and a JSON string in `choices[0].message.content`. Missing settings or criteria skip grading with a reason. **Retry evaluation** grades saved answers without rerunning Doc Search, preserving attempt history. Invalid model output is a grading failure. Credentials are never browser props or committed source.

## Upload and results

Columns: required `query`; optional `folder`, `expected_answer`, `evaluation_comments`. Download `public/example.csv`. UTF-8, BOM, quoted commas, escaped quotes and multiline fields are supported. Unknown/duplicate/missing headers are errors. Maximum 1,000 input data rows; local upload limit 5 MB, hosted limit 1 MB. Oversized review/request payloads are rejected with an actionable error.

Headers and values are trimmed; empty queries are counted/skipped. An empty folder becomes `ROOT` before exact, case-sensitive deduplication using JSON tuple keys. The first occurrence wins. Conflicting duplicate criteria block starting until explicitly resolved or corrected in a reupload. Identical queries in different folders remain; previous runs are never deduplicated.

Review shows row/folder counts, preview, errors/conflicts, an editable Doc Search project ID, a separate first-query test, and concurrency 1–5 (default 3). The project ID starts with the server's `DOC_SEARCH_PROJECT_ID` default and applies to both the test and batch; each run retains its selected ID. Starting a batch still runs every retained question. A connectivity test uses the same concurrency/storage protections but is hidden from benchmark history.

The optional **Test revised prompts** editor loads stored CMS prompts through a server-side read-only connection. Choose a prompt source folder (default ROOT), click **Load from CMS**, and inspect the source/environment/version before confirming it. ROOT is the base of every folder (CMS appends a folder's prompt and documents after ROOT's), so a revised ROOT prompt applies to every question, while a revised folder prompt applies only to that folder's questions; the rest run with their normal CMS prompts. The source dropdown remains switchable after loading, with an explicit discard choice for unsaved edits. Agent background, custom instructions and tool-call context appear as separate cards, each with independent English, Traditional Chinese and Simplified Chinese tabs. Only complete three-language sections are editable; missing/null sections are explained rather than filled with empty text. Manual JSON import remains available as an advanced fallback.

Loaded baselines are scoped to the workspace/project/document folder/prompt source and environment. The app checks the CMS again before a first-query test or batch; changed sources require reloading or an explicit acknowledgement to use the saved baseline. An unknown folder may return **base configuration**, identified by `is_base:true`, version 0 and no saved version ID. Base checks use a full read because metadata-only reads can return 404. A matching text does not identify a ROOT version. Dirty drafts are replaced only through explicitly labeled discard/reload controls; failed checks preserve the draft and block prompt testing until retried or cleared.

Only changed sections are sent, each as a complete `en`/`zh`/`sc` object, with `use_cache:false`. Unedited CMS-backed controls also bypass the answer cache. Tests and batches retain immutable supported baseline text, fingerprint, source and version metadata alongside overrides; results retain trace IDs and reported `_prompt_version`. Unedited runtime sections are still resolved by Doc Search, so this does not pin the complete effective prompt. No CMS write endpoint is used. Three-section override behavior was previously verified only on a development graph; inspect the trace for your project/environment. Other prompt sections are not forwarded as overrides.

See [CMS_PROMPTS.md](CMS_PROMPTS.md) for direct CMS login, emailed supervisor approval, email-service configuration, session expiry/revocation, and local read-only connectivity checks. Project IDs remain configurable in the UI and are authorized by CMS membership or a project-scoped supervisor grant, without a project allowlist environment variable. Prompt bodies are private workspace data, stored with local/PostgreSQL history and visible to workspace users. Abandoned loader snapshots expire after seven days and are capped at 20; run-owned baseline copies remain with history.

Runs show terminal search progress, separate execution/grading counts, and averages. Records support run/folder/status filters, full-dataset query search, pagination, score explanations and expandable dimension weights/evidence. Details include full answers, references/comments, sources/metadata, raw JSON, timing, trace copy, discrepancies and evaluation history. Text renders as plain React text; source links allow HTTP(S) only.

## Execution and persistence

- One active run or connectivity test per workspace. Search concurrency is strictly capped at 1–5; grading has an independent maximum of 2. One failure does not stop other questions.
- Questions, criteria, generated IDs, configuration, and queued records are persisted before dispatch. Submission keys/payload hashes prevent accidental duplicate batches. UI polling is independent of execution.
- Local mode uses private, fsynced, atomically replaced JSON snapshots with cross-process locks. The process worker continues through browser navigation/tab closure and Next hot reload. A full worker restart marks unfinished searches interrupted, unfinished evaluations skipped, and interrupted attempts failed; it never silently resends them.
- Hosted mode uses a PostgreSQL JSONB snapshot and Vercel Workflows. Writes use transactions and workspace row locks; only first-time schema creation uses an advisory lock. Routine page reads use plain SELECTs, so they can read committed state while a writer holds the row. Pool/query/cancellation deadlines and transaction-local lock/statement/idle limits bound database stalls. Functions can restart without losing state. Search answers are committed before grading is released. Workflow logs carry IDs rather than full uploaded answers/credentials. Work is signaled between search/evaluator lanes, avoiding routine per-record readiness polling.
- To reduce database transfer, a warm server instance checks the PostgreSQL row revision and reuses its validated snapshot if unchanged. Pages pause polling while hidden and refresh every 30 seconds when idle; active runs refresh more often. Cold instances and changes to the saved state still transfer the full snapshot, and writes still use the existing full-state transaction.
- Retries of durable transport/steps cannot resend a dispatched Doc Search POST: persisted record state gates each external call. Unconfirmed running work waits for its lease, then becomes interrupted. Ambiguous external POST timeouts are never automatically repeated. A new search requires an intentional new batch.
- Completed answers survive queue interruptions. Explicit evaluation retries create a new generation; older workflow generations cannot overwrite it. Retry grading after the run finishes. Dispatch/recovery controls are described in the deployment guide.

State is one atomic snapshot per workspace, suitable for a single-workspace MVP rather than unlimited history. Large histories increase parsing/transaction cost. PostgreSQL writes explicitly pass JSON text before casting to JSONB, avoiding a second serialization by the driver. Valid string-encoded snapshots from earlier builds are validated and normalized automatically in the same transaction; invalid saved data is preserved and returns a server error. Back up local data only while stopped; use your database provider's backups for hosted data. `.gitignore` excludes credentials, runs, tools, generated Workflow routes, deployment metadata and build output.

## Response adapter and scoring

The live sample was observed on 6 November 2026. `tests/fixtures/doc-search.observed.json` is a **sanitized excerpt** of that response for deterministic mapping tests; corpus/configuration inventory and original trace identifiers are omitted. It is not served as a live answer.

Answer mapping is `message.series[].text`; optional trace is `langsmith_trace_id`; sources are retrieved passages in `used_sections`. `doc_names` is corpus inventory and is not counted as sources. Missing/unrecognized source arrays are unknown (“—”); a recognized empty list is zero. Unexpected answer shapes and `answering_failed` become execution failures. Runtime raw responses are retained in protected local/database state.

Rubric `fulfillment-v1.0`: correctness 40%, coverage 30%, relevance/intent 20%, instruction compliance 10%. Each validated dimension is 0–100 or null/unassessable with an explanation. Application code renormalizes applicable weights and computes the weighted mean to one decimal. If nothing is assessable, grading is skipped rather than assigning zero.

Anchors: 0 no fulfillment/contradictory; 20 mostly wrong; 40 useful fragments/major gaps; 60 core partly satisfied; 80 mostly complete; 100 complete without material issues. **60 is an anchor, not a required mean.** Scores are not probabilities, curved distributions, or random values. For example, a correct toilet location without a required accessible route loses coverage points.

Evaluations include assessment, fulfilled/missing requirements, contradictions, unsupported claims, evidence-based discrepancies, improvements and limitations. Uploaded criteria and API text are untrusted data and cannot override evaluator/scoring instructions. Only observable differences are requested, not hidden reasoning. Model assessments remain fallible and should be spot-checked.

Progress counts terminal searches, including failed/interrupted records. Average latency uses successful search requests only, excluding queue wait/grading. Average score includes successfully graded records only; unscored records are not zero. A run stays active until both queues finish.

## Checks and packaging

```sh
pnpm build
pnpm typecheck
pnpm lint
pnpm test
pnpm test:workflow
pnpm deploy:check
pnpm package:github
```

`test:workflow` checks both local JSON storage and PostgreSQL through the production driver, using disposable local servers and mock upstream APIs. Driver regression tests also reproduce the earlier JSONB encoding error, verify automatic repair without data loss, and deliberately silence an established database connection to check bounded failure and reconnection. Browser refreshes wait for completion, back off after failures, and abort outstanding reads on cleanup. These checks make no live search/evaluator calls. `deploy:check` checks required hosted settings; it does not provision resources or prove live connectivity. `package:github` requires Python 3 and Git and produces a clean source folder plus ZIP, deliberately without the original local Git history.

For an optional real service smoke test using your configured evaluator (which may incur charges), run `pnpm exec tsx scripts/smoke.ts`. Optional completed local history migration is available with `pnpm data:import`; see the deployment guide. Actual verification and remaining live-cloud checks are recorded in [COMPLETION.md](COMPLETION.md).
