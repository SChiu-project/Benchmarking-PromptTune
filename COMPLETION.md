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

## Two-model benchmark implementation (2026-11-23)

Added generation-model selection after CMS login, OpenRouter evaluator discovery with optional corporate restrictions, model-specific records within one paired run, frozen judge/rubric configuration, blind per-dimension comparisons, independent comparison attempts/retries, local and hosted worker integration, paginated comparison details, and results/summary CSV downloads. Generation requests send the documented `ans_model_type` and bypass caches. Model variants are interleaved by question. Completion waits for comparisons; active paired runs block individual retry operations that would invalidate a running comparison generation. Historical runs remain readable without new fields.

Verified on project-local Node 24: 212 tests passed across 21 files; TypeScript; production build/output validation; lint with only the existing unused `base` warning; and compiled Workflow HTTP smoke checks against both local JSON and the production PostgreSQL driver. Workflow checks now exercise two-model forwarding, normal dimension grading, blind comparison, CSV download and comparison-only re-evaluation without new searches. The smoke fixture seeds synthetic paired records to exercise the workers independently of CMS; catalog/auth and model-picker behavior have separate tests. All generation/judge calls in these checks used local mocks. A read-only live OpenRouter catalog fetch returned 307 models with the required advertised capabilities.

Integration status at the initial implementation (superseded by the authenticated checks below): the user-supplied `POST /graph/project-config/binding/get` returned `Missing authentication credentials` without a session. No active CMS browser connection or usable connector session file was available, and secure credential input timed out. The adapter uses this authenticated read endpoint but its model-list mapping is provisional until a real authenticated response is checked. It accepts a `models` list at the root or under `data`, and rejects a binding containing only the current model. No successful live CMS model-list extraction, paid generation-model override test, human judge calibration or deployment is claimed. See EVALUATION_GUIDE.md for the supported mapping and optional alternate catalog route.

### Authenticated CMS binding check (2026-11-23, before catalog discovery)

After the user signed in through the benchmark app, the session was confirmed active and the selected project membership was rechecked. An authenticated read of `/graph/project-config/binding/get` returned HTTP 200. The response contained project/composition revisions, `binding`, `consumers` and `smalltalk_config`, but no model catalog. The existing root/data `models` adapter is therefore still provisional; the CMS model-selector website URL is needed to locate its actual catalog source. No CMS configuration was changed, no new generation calls were made, and credentials were neither printed nor copied into source.


### CMS catalog discovery and live integration (2026-11-23)

Inspected the CMS benchmark page at `https://setsail-dev.web.app/?#/documentSearchBenchmark`. Its model selector calls `GET /cms/project/{projectId}/documentSearchBenchmark/models` and converts `{success:true, models:{modelId:displayName}}` into options. Verified authenticated reads for MTR and Companies Registry: each returned 64 models. Replaced the provisional binding read with this project-scoped GET and added dictionary-response/success-failure coverage. Model IDs remain unchanged, and the optional path override and compatible array responses remain supported. Updated TypeScript, 213 tests, production build and both local/PostgreSQL compiled Workflow smoke checks pass; lint retains its existing unrelated unused-variable warning.

The local UI loaded all 64 choices and started live pilot run `6a4ca909-41a1-4859-b5ff-380cb02b52b3`: one Companies Registry question, model IDs `deepseek-v4-flash-0731-alibaba` and `deepseek-v4.1-flash-1017-alibaba`, evaluator `qwen/qwen3.8-flash`, six default quality dimensions. Both generation requests succeeded and reported the requested IDs. The live run completed; both answers and all six comparative rows were persisted. Four of the twelve individual dimension judgments were rejected by the existing schema/evidence validators and remain explicit errors, so this pilot does not establish judge calibration. No upstream CMS configuration was changed.


The pilot exposed a false-confidence risk: only 20 of 27 retrieved passages reached the judge, and its initial citation comparison treated omitted passages as nonexistent. Added deterministic protection: passage-based comparisons become unassessable when passages are omitted, text is truncated, or content is missing. Added regressions for omission/truncation and explicit randomized-label mappings in the UI and CSV export. Retried only the comparison against saved answers; no generation or individual grading was repeated. The retry completed with three text-based ties and three passage-based unassessable results. Results/summary HTTP exports returned 200; verified all six comparison columns, both models' individual dimension columns, and the judge-label mappings. The original comparison attempt remains in history for audit.

Final validation: 215 tests passed; the updated export-mapping test also passed in a targeted rerun; TypeScript, production build and compiled JSON/PostgreSQL Workflow smoke checks passed. Lint has only the pre-existing unused-variable warning. CMS model discovery and the live technical integration pilot are verified. Human calibration, handling incomplete evidence in the pre-existing individual graders, and deployment remain outside these completed integration checks.

## Evaluator calibration: pilot judge rejections (2026-11-23)

Replayed the four rejected pilot judgments live and captured the raw judge text. Root causes:
- Exact substring quote checks rejected valid evidence. The judge dropped Markdown (`**Form ND2A**`), cleaned PDF-extraction artifacts (`Queensway**  Government`, `╱`) and normalized quotes.
- Enum label drift failed strict schemas: `misattributes`, and `mismatch`, a word taken from the prompt's own "explain the mismatch".
- Only 20 of 27 passages were sent, so the judge called citations to P24–P26 broken.
- The no_answer_detection schema failure did not reproduce in three replays. Raw output was not stored then, so its cause is unknown.

Fixes:
- Normalized quote matching (wording must still match; ellipsis fragments must occur in order).
- Canonicalization of unambiguous labels and blank nullable strings before strict validation.
- Explicit allowed-label lines in the fixed prompt wrapper.
- Schema errors now name the failing field paths.
- Failed attempts keep `rawOutput` (up to 20,000 characters).
- Passage budget raised to 60 passages, 8,000 characters each and 160,000 in total. Typical 27–57-passage retrievals are now sent in full, which also makes passage-based comparisons assessable.
- Individual graders return **review** instead of fail in two cases: the answer cites passages the judge never saw, or a hallucination failure rests only on unsupported claims while evidence was incomplete.

Regraded the pilot's saved answers twice; no generation was repeated. Final campaign `f807d6c3-931d-4095-be8e-f1e08e7e902c`: all 12 individual judgments were scored with no errors, and all six comparisons were assessable (four ties; hallucination and citation quality preferred the deepseek-v4.1 answer). That matches the individual grades: the v4 answer's late-fee claim cites P3, an annual-return passage. The export returned 200. Between the two regrades the v4.1 citation_quality verdict flipped from pass (0.86) to fail (0.93) at temperature 0, over whether P24 (director-focused) supports a company-secretary claim. Run-to-run variance and borderline judgments like this one are what human calibration still has to settle.

Validation: 221 tests, TypeScript, lint (now no warnings), production build and both JSON/PostgreSQL Workflow smoke checks passed. Human-label calibration is still not done.

## Independent human-calibration handoff (2026-11-23)

Confirmed the saved pilot remains completed: two successful answer records, three individual grading attempts each, zero errors in the current twelve dimension judgments, and a completed pairwise comparison. Reused those saved answers; this handoff made no generation, judge or CMS calls.

Added `scripts/calibration-packet.ts` and its read-only packet builder. It creates a new private directory containing full evidence and separate blank reviewer forms, plus coordinator-only identity mapping and the existing adjudication-template format. Reviewer files exclude model identities, provider/trace/raw metadata and machine verdicts. Answer order is randomized. All 27 saved passages per answer are included in full. Both answers share one exact-question family and are marked calibration, because the pilot has already been used for tuning. Domain reviewers must group paraphrases/related cases when expanding the study; exact-question hashes alone do not establish independence.

Generated `reports/calibration-pilot-2026-11-23/` with two anonymous answers in one question family. Verified private file permissions, matching evidence hashes, complete passage counts, blank independent forms, absence of identity/grade leakage, and refusal to overwrite an existing packet without changing its files. Added calibration IDs that distinguish paired records sharing an approved case ID while preserving legacy unique case IDs; collision handling and changed-evidence rejection have regression coverage.

Validation: 230 tests passed across 22 files, TypeScript and lint passed, and `git diff --check` passed. The local app was restarted; its pilot results endpoint returned HTTP 200. Human reviewers have not filled or adjudicated the forms, so no human agreement or release-readiness claim is made. See EVALUATION_GUIDE.md for the handoff and existing calibration-report command.

## Technical release-candidate preparation (2026-11-23)

The two independent human-review forms remain blank. Continued with technical release preparation while keeping human calibration unresolved. This checkout has no Vercel project link, no installed Vercel CLI was found, and the connected GitHub repository returned no deployment records. The local `deploy:check` reports missing DATABASE_URL and a sufficiently long APP_PASSWORD; this does not establish whether an existing hosted project's settings are configured.

Added explicit deployment exclusions for private calibration reports and generated test/build artifacts. The clean-source packager now supports named release candidates under github-ready, preserving prior exports; excludes incremental TypeScript caches; rejects forcibly tracked private review paths; and checks configured token values as well as key/password/secret/database settings before export. Four regression tests cover named exports/non-overwrite, private reports, token leakage and path traversal.

Release validation on project-local Node 24: 234 tests passed across 23 files; TypeScript, lint, production build/output verification, and both local-JSON/PostgreSQL compiled Workflow HTTP smoke checks passed. No live upstream judge/search calls were required for this release check. The local server was restored after the build.

A named clean source/ZIP candidate is prepared under `github-ready/release-candidate-2026-11-23/`, without local Git history or runtime/private files. DEPLOYMENT.md now includes the two-model Preview checklist, hosted function-duration verification and a state-aware rollback rehearsal. Remaining gates are independent human labels, an identified/linked deployment target with its hosted settings verified, current-source CI and live Preview verification. No Git commit, push, public deployment or stakeholder message was performed by this preparation.
