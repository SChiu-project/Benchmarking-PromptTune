# Doc Search Benchmark

A localhost benchmark workspace built with Next.js App Router, React, strict TypeScript, Zod, and pnpm. Upload → review → test connectivity → run → inspect → grade saved answers.

## Start

Install Node.js 22+ (24 LTS recommended) and pnpm 10.28.2. From this folder:

```sh
pnpm install --frozen-lockfile
cp .env.example .env.local
pnpm dev
```

Open http://127.0.0.1:3000. One command starts the queue worker and web server, bound to `127.0.0.1`. Stop with Ctrl+C. This checkout also has a `Start Benchmark.command` launcher that uses the project-local development tools installed during implementation if system tools are unavailable. No authentication, deployment, cloud storage, or database is included.

`pnpm build` creates `.next-production/`; `pnpm start` serves that build with the same worker. Development uses a separate `.next/` directory. Run one application instance per data directory. Worker lock conflicts cause startup to fail safely.

## Configuration

All variables below are **server-only**. Use `.env.local` (takes precedence) or `.env`. Restart the app after changing settings. Never prefix secrets with `NEXT_PUBLIC_` or `VITE_`.

| Variable                | Purpose                                                                                      |
| ----------------------- | -------------------------------------------------------------------------------------------- |
| `DOC_SEARCH_ENDPOINT`   | Full POST URL; defaults to the endpoint in the brief                                         |
| `DOC_SEARCH_PROJECT_ID` | Defaults to `mtr-air-kiosk-05emf61`                                                          |
| `DOC_SEARCH_TIMEOUT_MS` | 60000 by default, 100–300000 allowed                                                         |
| `EVALUATOR_ENDPOINT`    | Full OpenAI-compatible chat completions URL, including `/v1/chat/completions` as appropriate |
| `EVALUATOR_MODEL`       | Provider model ID                                                                            |
| `EVALUATOR_API_KEY`     | Bearer credential; never returned to the browser                                             |
| `EVALUATOR_TIMEOUT_MS`  | 60000 by default, 100–300000 allowed                                                         |
| `DATA_DIR`              | Optional absolute storage directory; defaults to `./data`                                    |
| `PORT`                  | 3000 by default                                                                              |

Your supplied proxy’s published usage examples confirm OpenAI chat format with bearer authentication and `/v1/chat/completions`. The supplied settings were mapped into this checkout’s ignored `.env.local`; the original files were not changed. `#usage` is a documentation anchor, not an API path. This adapter requires JSON mode (`response_format: {type: "json_object"}`) and a text response in `choices[0].message.content`. Configure another provider only if it supports that contract. No automatic model substitution occurs.

Missing evaluator configuration keeps search operational and marks grading skipped with a reason. With configuration supplied, use **Retry evaluation** in record details to grade a saved answer, preserving prior attempt history without another Doc Search call. A malformed model output is a grading failure, never a score. Missing criteria are skipped as well.

## CSV and review

Download `public/example.csv` from the UI. Columns: required `query`; optional `folder`, `expected_answer`, `evaluation_comments`. Unknown, duplicate, and missing headers are validation errors. UTF-8/BOM, quoted commas, escaped quotes, and multiline fields are supported. Limit: 5 MB / 1,000 input data rows per upload.

Headers/values are trimmed. Empty queries are counted and skipped, including physically blank lines. Empty folders resolve to `Codex_Benchmark_tool` **before** exact, case-sensitive query/folder deduplication. Pairs use JSON tuple keys to prevent delimiter collisions. The first duplicate wins; identical queries in different folders are retained. Conflicting duplicate references/comments block starting until the user explicitly keeps the first criteria or edits/reuploads the CSV. Repeat runs are never deduplicated against history.

The review shows all row counts, resolved folder counts, preview, errors/conflicts, test result, and concurrency. The first-query connectivity test is an independent saved test job, hidden from benchmark history; batch creation still includes every retained question. Tests share the same global worker limits and cannot run beside an active batch.

## Queues, persistence, and restart behavior

- A separate `tsx` Node worker owns both queues; browser navigation, tab closure, and Next.js hot reload do not stop them. Worker code changes require a full restart.
- One active run (or connectivity test) per data directory. Search concurrency is strictly capped at the selected 1–5; grading has its own cap of 2. Failures do not stop the other questions.
- Run/record IDs, criteria, search configuration, and queued state are saved before dispatch. Browser submission keys prevent accidental duplicate batches and are checked against a payload hash. The API responds promptly with a run ID; UI polling tracks progress.
- `data/state.json` stores validated run/record snapshots and raw responses. Each operation uses a cross-process filesystem lock; unchanged reads and idle queue ticks do not rewrite the state; writes use private temporary files, fsync, and atomic rename. Internal filenames never contain uploaded query/folder text. A separate worker lease prevents a second processor.
- Completed search responses are committed before evaluation becomes eligible. HTTP, network, timeout, invalid JSON, and schema failures are recorded independently of grading. Failed requests preserve available raw request/response data.
- After a full server restart, queued/running searches become **interrupted**, unfinished evaluations become **skipped**, and in-flight grading attempts become failed. Successful answers remain available. Nothing is silently resent. A stale lease after a hard crash can take approximately 10–15 seconds to expire.
- Timed-out Doc Search POSTs are **never automatically retried**, because remote delivery is ambiguous. Make an intentional new batch to run them again. Evaluation retries also require an explicit action.
- `.gitignore` excludes runtime data, dependencies, build output, tools, and local environment/secrets. Keep the local data folder if you want history to survive restarting. Back it up only while the app is stopped.

This is a single-machine MVP: state is a single atomic JSON snapshot, not an indexed database. Large histories make list/poll operations slower; archive data while stopped if needed. File corruption or invalid stored schemas fail closed and appear as a server error; data is not silently replaced.

## Observed Doc Search adapter

A real sample POST succeeded on 6 November 2026. The complete observed response is captured in `tests/fixtures/doc-search.observed.json` (a live capture used **only as a deterministic test fixture**, never served as a benchmark answer).

- Answer: concatenated `message.series[].text`.
- Trace: optional `langsmith_trace_id`; missing/empty is unavailable.
- Sources: `used_sections`, preserving passage content and source metadata. Counts are retrieved **passages**, not unique documents or verified citations. `doc_names` is a corpus inventory and is not counted as sources.
- Absent/unrecognized source arrays are unknown, displayed as “—”; an explicit recognized empty array is zero. An unexpected answer shape or `answering_failed` flag is an execution failure. Full raw JSON is retained.

Uploaded and returned text is rendered as plain React text, not HTML. Source links only allow HTTP(S). Mutations reject cross-origin requests; the server binds loopback only. External requests go from the server to the configured services, with query/folder to Doc Search and query/reference/comments/answer to the evaluator. Saved state stays on this computer.

## Scoring and metrics

Rubric version: `fulfillment-v1.0`. Correctness 40%, coverage 30%, relevance/intent 20%, explicit instruction compliance 10%. Validated dimension scores are 0–100 or `null` when unassessable, with an explanation. The application renormalizes only applicable weights and computes the weighted mean rounded to one decimal. If all dimensions are unassessable, grading is skipped and no score is shown.

Anchors: 0 no fulfillment/contradictory; 20 mostly incorrect; 40 useful fragments with major gaps; 60 core partly satisfied; 80 mostly correct/complete; 100 complete with no material errors. **60 is an anchor, not a required mean.** Scores are never curved, randomized, or described as probabilities. E.g., correct toilet location without a required accessible route loses coverage points.

Evaluation includes dimension explanations, assessment, fulfilled/missing requirements, contradictions, unsupported claims, evidence-based discrepancies, improvements, limitations, and versioned attempt history (model, endpoint, timestamps, result/error). Untrusted content is isolated in the data message and cannot override the system rubric; only observable answer/reference differences are requested. LLM grading remains fallible and merits human review.

Run progress counts terminal searches, including failures/interruption. Latency averages use successful search round-trip time only, including response parsing, excluding queue wait and grading. Score averages use successfully graded records only. Unscored records are not zero; unavailable means “—”. Runs stay active while either queue has pending/running work. Execution failures, interruptions, and grading failures are separate counts.

## Verification

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm build
# Optional real calls using configured services; may incur evaluator charges:
pnpm exec tsx scripts/smoke.ts
```

Unit/integration tests use deterministic mocks and temporary storage, including real child-worker process restart tests. `scripts/smoke.ts` calls the real services, writes its local report to the OS temporary directory, and prints only status/metrics (never credentials). See `COMPLETION.md` for checks actually run and the browser verification limit.
