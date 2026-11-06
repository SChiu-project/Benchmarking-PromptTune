# Completion report

Verified on 6 November 2026 (Asia/Hong_Kong).

## Implemented

- Upload/review with proper CSV parsing, default-folder normalization, exact-pair deduplication, conflict resolution, previews, counts, concurrency, and example download.
- Independent first-query connectivity jobs and batch queues, server-side requests, prompt run IDs, durable state, idempotency, strict search/evaluator limits, partial failure isolation, and explicit interrupted-run recovery.
- Upload, Runs, and Records interfaces, polling, filters/search, full details, raw JSON, sources/metadata, trace copy, evaluation results and saved-answer retries.
- Actual observed Doc Search response adapter, server-only OpenAI-compatible evaluator, strict Zod output validation, application-calculated weighted scores, limitations, and attempt history.
- Setup instructions, ignored secrets/data, example environment, lockfile, and local launcher.

## Checks run

- `pnpm typecheck`: passed.
- `pnpm lint`: passed.
- `pnpm test`: 20 tests passed in 2 files. Covers CSV/BOM/quoting/multiline/blank rows/header errors/defaults/dedup/conflicts/collision-safe keys; observed response mapping; unknown source counts; HTTP/JSON/network/timeout errors without retry; evaluator validation/renormalization/unassessable basis/missing config; concurrent persistence; idempotent creation; active-run and strict queue limits; partial batch failure; saved-answer regrading; correct averages; and real child-process worker restart/lease regression.
- `pnpm build`: passed (production App Router pages and all Node route handlers).
- Local app HTTP response: 200. Browser verified rendered Upload layout, Runs and Records navigation, empty states, and presence of record filters. No static mock API responses are presented in the running application.

## Live services

- Initial required sample request: **HTTP 200**. Captured complete response in `tests/fixtures/doc-search.observed.json`. Answer at `message.series[].text`, source passages in `used_sections`, optional `langsmith_trace_id`.
- Separate live smoke with the implementation’s adapter: **succeeded**, 57 retrieved passages, 7.366 seconds, trace `ca11f2605eecbcd49a6c7046007d889d`.
- Supplied proxy evaluator (`qwen/qwen3.8-flash`): **succeeded**. Valid dimension output; app calculated 65.5/100 for that particular live answer/reference. This is one smoke-test observation, not a fabricated benchmark or a target mean. Actual responses/scores can vary between calls.
- Original supplied credential files were left untouched; only an ignored server-only environment file was created in the application.

## Verification limitation

The browser’s file-upload permission was declined. No alternative upload route was attempted. Therefore the complete browser sequence **upload → review → connectivity test → batch → watch progress → inspect populated details → copy trace → reload** was **not** verified interactively. CSV, persistence, concurrency, evaluation, restart behavior, and integration adapters were verified separately as above. No integration configuration remains blocked, but that browser acceptance check remains outstanding.

To complete it manually: start the app, choose `tests/fixtures/live-smoke.csv`, inspect review, test the first query, start the batch, wait for both queues, open the record, copy its trace ID, then reload and confirm the same run and answer remain.

## Assumptions / limits

One local application instance and one active run per data directory; no cloud hosting/authentication. UTF-8 CSV only; unknown columns are rejected to catch typos. Source count means retrieved passages, not unique cited documents. The evaluator must support the documented OpenAI-compatible JSON-mode response contract. State is one atomic JSON file, suitable for an MVP rather than unlimited history. LLM assessments can be wrong and should be spot-checked against their evidence.
