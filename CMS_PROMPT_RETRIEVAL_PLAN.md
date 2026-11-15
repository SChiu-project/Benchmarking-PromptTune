# CMS prompt retrieval: investigation and development plan

Date: 2026-11-15. Status: implemented and verified locally; hosted credential renewal and production behavior remain to be established. See CMS_PROMPTS.md and the dated CMS section in COMPLETION.md.

## Verdict

Solid foundation. Replace manual JSON entry with a read-only CMS loader, reusing the existing three-section editor and temporary Doc Search overrides. The critical dependency is supported server-side authentication and a verified prompt-read contract, not the editor UI.

Do not describe the result as the complete effective system prompt: CMS stores configuration that the runtime can combine with defaults, location data and other overlays.

## Sources and evidence limits

- Tutorial repository inspected at main commit `9b02b3c7d3435cf165a5c565049918fb3a11690a`:
  - [API docs README](https://github.com/PeterNg2333/VibeCodingTutorial/blob/9b02b3c7d3435cf165a5c565049918fb3a11690a/api-docs/README.md).
  - [Doc Search OpenAPI](https://github.com/PeterNg2333/VibeCodingTutorial/blob/9b02b3c7d3435cf165a5c565049918fb3a11690a/api-docs/specs/doc-search.openapi.yaml), specification dated 2026-11-06.
- The actual directory is `api-docs/`, rather than `API/docs`. Its specifications cover Doc Search, the LLM proxy and OpenRouter. There is no CMS prompt-retrieval specification in this directory.
- Current benchmark code: `components/prompt-editor.tsx`, `components/upload.tsx`, `lib/schema.ts`, `lib/doc-search.ts`, `lib/store.ts`, `app/api/test/route.ts`, `app/api/runs/route.ts`, `lib/access.ts`, and `proxy.ts`.
- Earlier investigation: `../Doc Search prompt testing — findings (2026-11-09).md`. Its controlled dev-call results are historical evidence, not tests repeated in this task.
- Local connector implementation: `../cms-mcp-for-setsail/dist/core/prompt/prompts.js`, `dist/core/client/auth.js`, `dist/core/client/rest-client.js`, and `dist/mcp/handlers.js`. The active handler imports `core/prompt/prompts.js`. An older `core/prompts.js` contains conflicting route information; do not copy it.
- The follow-up below verified authenticated live dev prompt reads using the existing authorized CMS session. No generation calls, CMS writes or deployments were performed. Production behavior and hosted service authentication were not tested.

### Live endpoint probes (2026-11-15 follow-up)

- Unauthenticated GET of the candidate llmGraph latest route for the previously studied project and ROOT returned HTTP 401, JSON `{status: "error", message: "Missing authentication credentials"}`.
- The same route with `exclude_prompts=true` returned the same HTTP 401 envelope.
- The legacy CMS-prefixed latest route returned HTTP 401 with a different failure envelope. This does not establish whether either authenticated route is functional: authentication middleware can run before route resolution.
- `cms_whoami` initially reported an expired session. After the user logged in, it confirmed an active session; authenticated direct GET requests then succeeded using the connector's existing session, without displaying or copying its token into source.
- Verified auth headers: `token`, `uid`, and `x-source: cms`. This verifies a CMS user-session mechanism, not a service-token or renewal contract.
- ROOT returned HTTP 200, `prompt_version:19`, a string `version_id`, and `is_active:true`. The object includes `project_id`, `folder_name`, `source_type`, `prompts`, changelog, author/timestamps, parent/revert fields and `smalltalk_config`.
- `persona_maisie` returned HTTP 200, version 3, a string version ID and active status. Both sources contain all three editable DTOs with string `en`, `zh`, and `sc` values. ROOT also returned `tool_call_prompts`, `reranker_instruction`, and `sensitive_guard_system_prompt`; `messages` was absent in this response.
- ROOT with `exclude_prompts=true` returned HTTP 200 and matching version metadata with no `prompts` property.
- Both `Codex_Benchmark_tool` and an intentionally absent folder returned HTTP 200 with `is_base:true`, `prompt_version:0`, `version_id:null`, and `is_active:true`. The response echoes the requested folder, so that field alone does not prove a folder-specific prompt exists. The three supported DTOs exactly matched ROOT in this sample; the response does not identify ROOT as its resolved version.
- The base response includes broader configuration, including localized `context_dto` and model settings. This corrects the earlier assumption that context cannot be read from this endpoint, but does not establish that context overrides affect execution.
- Crucially, `exclude_prompts=true` for `Codex_Benchmark_tool` returned HTTP 404, with a message that no prompt versions exist for the folder. A metadata 404 must not invalidate a successfully loaded base configuration: use a full read and content fingerprint for base refresh checks.
- The legacy CMS-prefixed latest route still returned HTTP 401 with the same authorized session. Use the verified llmGraph route.
- `cms_list_prompts` returned ROOT plus persona_maisie/persona_riley/persona_tracy. Document-path-derived suggestions remain distinct from version existence.

## What is already built

- CSV review supplies the selected project ID and requires one CSV folder for prompt overrides.
- The editor imports top-level JSON, validates supported fields, keeps baseline/draft values, and sends only changed sections after a manual project/folder confirmation.
- Editable sections are `agent_background_dto`, `custom_instruction_dto`, and `tool_call_context_dto`, each requiring string `en`, `zh`, and `sc` values.
- First-query tests and batch runs already snapshot overrides, include them in submission identity, and send `use_cache: false` when overrides exist.
- Results retain trace IDs and optional reported `_prompt_version`. Runs currently do not retain an authenticated CMS baseline, its source or its numeric CMS version.
- Local JSON and hosted PostgreSQL persist the same validated run structure. New optional fields can preserve old history compatibility.

## API findings

### Generation contract from the tutorial

The documented dev generation endpoint is `POST https://dev.setsailapi.com/nlp/rag/docSearchConvo`. Its current spec says no token is required for that endpoint. This says nothing about CMS read authentication.

The spec documents `agent_background_dto`, `custom_instruction_dto`, `context_dto`, and `config_profile`. It does not document `tool_call_context_dto`, despite the earlier investigation finding that field effective in a dev graph. Preserve the existing supported-field boundary; do not expand override support from this spec alone.

The spec's two-language override example is unsuitable for copying into this app: earlier controlled tests found whole-object replacement, where omitted languages disappeared. Preserve all three languages for each edited DTO.

### Candidate stored-prompt read contract from the active local connector

The following route and CMS-session headers were verified by authenticated dev GET requests on 2026-11-15; production and hosted credential lifecycle still need backend confirmation:

```http
GET https://dev.setsailapi.com/nlp/llmGraph/graph/chatbot-prompts/versions/latest?project_id=<encoded-project-id>&source_type=chatbot&folder_name=<encoded-folder>
token: <server-held-session-token>
uid: <server-held-user-id>
x-source: cms
```

The live response is an object with `prompts`, numeric `prompt_version`, and version/source metadata. Allow nullable `version_id` and optional `is_base`; a base configuration has version 0 and no saved version ID. The connector normalizer also accepts localized `_dict` aliases for `_dto` fields, but aliases were not observed in these reads. Capture sanitized fixtures before defining a strict application adapter; do not invent missing language behavior.

Other candidate reads:

- Metadata: the same latest endpoint with `exclude_prompts=true`, verified for ROOT. Base-folder metadata returned 404 despite successful full retrieval; use full-read content checks for base configurations.
- Folder suggestions: `GET https://dev.setsailapi.com/cms/project/<encoded-project-id>/documentSearch/v2/paths`. The connector parses JSON-encoded path arrays, takes their first element, deduplicates, and adds `ROOT`. This is a document-path inventory, not an authoritative inventory of saved prompt versions.
- The connector has a ROOT-only project-settings fallback on version-read 403. Exclude this from the first release: it lacks version metadata and may mask permission or source differences.

The connector explicitly identifies the older CMS-prefixed `/project/{id}/documentSearch/chatbotPromptVersions/*` routes as obsolete. Its newer implementation also says there is no real `/chatbotPromptVersions/folders` route. Neither should be used as the planned integration.

## Stress test and strongest counter-arguments

1. **A UI button can conceal an unsolved auth dependency.** The connector uses interactive CMS login and custom session headers, with expiry and possible OTP. A token copied from someone's session is fragile hosted infrastructure. Confirm a supported service identity or implement a supported user-session integration; do not assume a bearer token API exists.
2. **A shared workspace can expose too much.** Basic authentication protects the benchmark workspace, but does not establish each viewer's CMS entitlements. A service account must be restricted to the workspace's approved projects; a project allowlist must be enforced server-side. Individual CMS identities require per-user application authentication before broader multi-user rollout.
3. **The CSV folder and prompt source can differ.** Live reads of a benchmark folder and an absent folder returned base configuration matching ROOT's supported DTOs, but did not name a resolved ROOT version. Show the requested document folder and distinguish saved-folder prompt from base configuration. This does not prove document retrieval succeeds. Never silently substitute ROOT on an arbitrary failure.
4. **Stored configuration is not runtime configuration.** Profiles, station context, graph defaults and language fallbacks may affect execution. Loading CMS data cannot establish equivalence to the runtime prompt. Retain trace evidence and label the source accurately.
5. **Missing text is not necessarily an empty instruction.** Preserve missing, null and explicit empty values distinctly. Never manufacture empty languages to satisfy the editor schema; disable editing an incomplete section until semantics are verified.
6. **CMS may change while the user edits.** A changed DTO is frozen in the run, but omitted sections still resolve at runtime. Saving a baseline version improves attribution; it does not make the entire generation configuration reproducible.
7. **Automatically refreshing can destroy work.** Use explicit load/refresh controls, cancellation and stale-response checks. Replacing a dirty draft requires a visible discard action.

The strongest argument against starting with UI development is that the missing CMS specification and auth lifecycle could invalidate the loader design. Resolve those first. The strongest argument against calling this a reproducible A/B system is that untouched runtime configuration is not pinned.

## Recommended product behavior

1. Upload/review CSV and select project as today. Standard benchmarks continue without a CMS connection.
2. Expand “Test revised prompts”; choose “Load from CMS” as the primary input method. Keep manual JSON import under an advanced fallback during rollout.
3. Use the single CSV folder as the requested scope. Fetch folder suggestions if supported, clearly marked as suggestions. Display an exact folder choice and ROOT as separate source choices. If resolution is not verified, require explicit source selection and label runtime matching unverified.
4. Load the stored prompt and show environment, project, document folder, prompt folder, CMS version/version ID, retrieval time, and content fingerprint. Show active status if supplied; do not assume “latest” means active.
5. Prefill the existing three sections with three language tabs. Display missing/unsupported sections with a reason. Preserve exact text and whitespace. Unsupported prompt fields may be summarized as present but are not editable or forwarded.
6. Bind the baseline to its project/environment/source. Invalidate it and drafts when that scope changes. On load failure, show the error and require an explicit choice to run without overrides; never silently downgrade a requested prompt test.
7. Show changed sections before testing; submit only changed DTOs, each with all three languages. A no-change draft sends no overrides. Set `use_cache:false` explicitly for CMS-backed prompt tests, including their no-edit control.
8. Refresh checks metadata for saved versions; for `is_base:true`, perform a full read and compare the canonical supported baseline fingerprint. Base metadata can return 404. A changed version/content requires reload/rebase or explicit acknowledgement to use the saved baseline, recording that choice. Do not promise this eliminates races after the check.
9. The first-query test and batch reference the same immutable baseline snapshot. Later CMS reads and UI edits must not alter queued work. Prompt inspection itself must not generate a Doc Search request.

## Architecture and application contracts (proposed, not existing APIs)

Use existing Next.js route handlers and Zod. This follows the development reference's server-proxy, runtime-validation, and source-of-truth entries. No new framework, state library or CMS MCP dependency is needed.

- `lib/cms-client.ts`: server-only HTTP adapter. Fixed configured service origins; URL-encode IDs; explicit no-store fetching; bounded response size and timeout; sanitized errors. Implement only permitted reads. Do not log auth headers or raw prompt bodies. Validate HTTP-200 failure envelopes as well as HTTP status.
- `lib/cms-prompts.ts`: validate and normalize source, languages and metadata; resolve only verified fallback rules; calculate canonical content fingerprints; create immutable snapshots.
- `POST /api/cms/prompts/load`: same-origin, workspace-authenticated route. Validate project/folder/environment against server configuration, check CMS project permission, fetch and persist a snapshot, then return `snapshotId`, display metadata and supported prompt fields. No client-supplied upstream URL or credential.
- `POST /api/cms/prompts/check`: check the authorized snapshot's current source metadata. Return unchanged/changed/unknown without replacing draft content. Prefer version plus content comparison if metadata alone cannot establish identity.
- An optional folder-list route is secondary; the loader must still support explicitly chosen saved prompt folders absent from document paths.
- Snapshot record: workspace, ID, environment, project ID, requested document folder, prompt source/folder, resolution status, `isBase`, optional version/nullable version ID, retrieval time, canonical supported baseline and fingerprint. Base version 0 must never be presented as a saved version or attributed to ROOT v19 merely because text matches. Avoid storing unrelated project information.
- `prompt-editor.tsx`: replace primary paste interaction with loader states and source metadata, retaining its draft/diff logic. Abort old loads and compare scope/request identity before applying a response.
- `upload.tsx`: own selected scope, snapshot ID and draft validity; pass the same snapshot reference to first-query and batch submissions.
- `schema.ts`, both submission routes and `store.ts`: add optional snapshot references and provenance. Resolve snapshots server-side; reject cross-workspace/project/folder/environment reuse. Compute the actual changed sections against the server baseline. Do not trust client-supplied version labels or hashes.
- Persist the run's full supported baseline and overrides, not just a link to a deletable snapshot. Hash canonical source identity, baseline fingerprint, overrides and effective cache policy into new CMS-backed submission identities. Preserve retry behavior for historical submissions.
- `doc-search.ts`: retain the three-field allowlist and explicit cache bypass for prompt tests. Do not fetch CMS inside each question or worker execution. Keep prompt text out of routine logs.
- Snapshot storage: a separate bounded collection/table using the existing local storage and PostgreSQL infrastructure. Enforce expiry/cleanup for abandoned snapshots, without deleting run-owned copies. Make external CMS reads before acquiring storage locks.

### Authentication decision

Preferred for the current shared-workspace MVP: backend-approved read-only service identity with project restrictions, credentials held in server configuration, and documented expiry/renewal. New environment settings should be documented only after the mechanism is verified; proposed origin/timeout/project-scope settings must not be browser-exposed.

If only interactive login is supported, choose a supported CMS session flow with secure server-side session storage and a suitable identity model before implementing hosted retrieval. The MCP's local in-memory session cannot be assumed available to Vercel. Do not embed account passwords or auto-login using borrowed credentials. Manual import remains available until the supported connection exists.

## Development sequence and acceptance gates

### 1. Verify the upstream contract

- Confirm dev/production origins, read routes, permission names, auth header contract, expiry/renewal and service-identity support.
- Capture sanitized exact-folder and ROOT reads, metadata-only reads, empty/missing language fields, absent folders, denied project/version access, and HTTP-200 error envelopes.
- Establish whether latest is active, whether fallback occurs upstream, and whether resolved source is reported. Confirm graph/profile compatibility separately from stored retrieval.
- Deliverable: reviewed read contract and fixtures. Gate: one supported authenticated hosted read path and explicit folder-resolution semantics, or a documented backend dependency.

### 2. Implement server retrieval and snapshot persistence

- Add adapter, schemas, authorization, load/check routes, and local/PostgreSQL snapshot storage.
- Gate: no credential exposure; correct project enforcement; errors cannot masquerade as empty prompts; historical state remains readable.

### 3. Integrate the editor

- Add load/loading/error/refresh/dirty/missing-field states and provenance display; keep manual import as advanced input.
- Gate: stale responses cannot cross project scopes, dirty drafts survive failed refresh, and a valid load prefills exact baseline text.

### 4. Bind tests and runs to the baseline

- Extend submissions, schema, server diff validation, run provenance and idempotency. Preserve durable workflow execution.
- Gate: the first test and batch use the selected saved baseline; changed localized DTOs retain all languages; unsupported fields never leave the adapter as overrides.

### 5. Verify and roll out

- Unit/route tests: response shapes and aliases; missing versus empty; 401/403/404/429/5xx and failure envelopes; timeout/size bounds; project authorization; source matching; stale-version checks; cross-scope snapshot rejection.
- UI checks: project/upload changes during fetch, cancelled/out-of-order loads, explicit ROOT selection, partial languages, dirty refresh, failed load followed by an intentional standard benchmark.
- Persistence/workflow tests: immutable baseline and DTOs, identity changes for prompt variants, identical retries, local/PostgreSQL parity, old history compatibility, workers making no CMS calls.
- Run existing `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`, and `pnpm test:workflow` after implementation; deployment checks when hosted configuration is available.
- Perform one controlled dev load/edit/test with cache disabled; inspect effective graph/LLM trace evidence rather than relying on HTTP 200 or answer wording. Check no CMS writes and unchanged CMS version/content, accounting for independent edits by others.
- Enable retrieval behind configuration first, verify hosted auth renewal and workspace project restrictions, then make it the primary path. Update README and completion notes with tested environments and limitations.

## Concrete application example

A CSV targets project P and document folder F. The user loads the corresponding CMS prompt at version V. If F has no verified prompt mapping, the UI asks the user to choose ROOT explicitly and shows “Documents: F; prompt source: ROOT; runtime match unverified.” The user edits only Traditional Chinese custom instructions. The app submits the complete baseline `en/zh/sc` custom-instruction DTO with the changed `zh`, omits unchanged sections, disables cache, and saves P/F/ROOT/V, the baseline fingerprint, the override and the trace ID with the run. CMS remains unchanged.

If another user publishes V+1 before submission, the version check flags it. Continuing against V records the stale baseline choice; it does not imply untouched runtime sections are pinned to V.

## First-release scope and definition of done

Deliver automatic stored-prompt retrieval for an authorized project and explicitly identified chatbot source, editing of the existing three DTOs, immutable run provenance, and clear failure states. Keep multi-folder prompt mapping, runtime prompt reconstruction, profile editing, other prompt sections and all CMS writes outside this release.

Done means a user can load, inspect, edit and benchmark without pasting JSON, through a supported authenticated hosted connection, with preserved languages and source attribution. It does not mean complete runtime reproducibility; that requires a separate backend capability to pin or snapshot the effective configuration.


## Implementation decisions (2026-11-15)

- Implemented the existing editor, server-only read adapter, load/check routes, scope enforcement, immutable run provenance and canonical submission identity. The exact prompt folder is entered explicitly; optional folder suggestions were deferred.
- Refresh checks use a full prompt read for both saved and base configurations. This trades a small transfer increase for content comparison and consistent handling of the observed base metadata 404.
- Loader snapshots are a separate bounded collection in the existing transactional workspace state, using the same JSON/PostgreSQL infrastructure; submitted runs keep their own supported baseline copy.
- The verified CMS user-session mechanism is supported through private token/UID configuration or an explicitly configured local connector session file. No unverified automatic refresh or service-account API was invented. Hosted credential provisioning/renewal remains an operational prerequisite.
- Live read and one temporary prompt-generation test passed without CMS changes. Fresh trace inspection was unavailable. The evaluation Workflow fixture was subsequently updated and both storage-mode smoke checks passed; detailed evidence is recorded in COMPLETION.md.
