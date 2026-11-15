# Handover: prompt testing for Doc Search

## Objective

Build a feature in the existing Doc Search Benchmark app that lets a user choose a project ID, retrieve its chatbot prompt sections, edit one or more sections in a free-text interface, and run benchmark questions using those temporary edits. Unedited sections must retain their original behavior. This is a testing feature: it must not update, save, publish, or otherwise change prompts in the CMS.

## Two questions blocking implementation

1. **Prompt retrieval:** How can the application retrieve the complete effective prompt configuration for a given project ID? Identify the read-only API or CMS MCP tools, authentication and permissions, exact request/response schema, section names, languages, defaults, versions, and any project/environment scope. Determine whether the effective prompts are assembled dynamically or inherited from other configuration.
2. **Temporary overrides:** How can a generation request override one prompt section without changing the CMS or affecting the other sections? Identify the exact request fields and semantics for agent background, custom instructions, clarification behavior, tool calls, and any other relevant sections. Determine whether partial language or nested-object overrides replace the entire object, how templates are expanded, and whether caching must be disabled.

Distinguish **accepted by the API** from **actually used by the generation pipeline**. A 200 response or a changed natural-language answer alone does not prove an override was applied; a trace, effective-prompt inspection, or a controlled repeatable test is stronger evidence.

## Evidence already available

- The repository's current integration is `lib/doc-search.ts`. `searchRequest` sends `user_queries`, `folder_names`, `project_id`, `doc_search_version`, `stream`, and `with_reference` to the configured Doc Search endpoint. It has no prompt retrieval or override implementation. `tests/fixtures/doc-search.observed.json` illustrates an observed response containing an answer, retrieved passages, and a trace ID; it does not establish a prompt-read contract.
- The app already supports a per-run project ID in the CSV review dialog. `lib/store.ts` snapshots that ID in the run configuration and includes an explicit override in the submission idempotency hash. Existing background workflows and run records should remain compatible.
- In `/Users/simpochiu/Downloads/Codex_Benchmark_tool/session-1-full-deck.pptx`, slides **52, 57 and 60** describe the existing Doc Search call and a proposed prompt-editor add-on. Slide 60 identifies optional request fields `agent_background_dto` and `context_dto`, each shown as `{en, zh}`, and optional `ans_model_type`. It says to omit empty fields, set `use_cache: false`, and avoid CMS changes. These are leads, not independently verified API guarantees.
- Slide 60's speaker notes reference `mtr-api/src/service/ApiService.ts`, `callDocSearchApiV2`, and `StationController.parseConfig`. The notes say that some fields may be accepted but not used by every graph. Inspect the actual code and deployment version if accessible; do not infer the missing fields or behavior.
- The deck does **not** document retrieval of all prompts by project ID or override fields for tool calls, clarification, or custom instructions. An attempt to find an OpenAPI specification at the service root returned 404; this does not prove no specification exists elsewhere.
- The prior session did not expose a CMS MCP tool, so no CMS data or CMS API contract was inspected. No CMS configuration was changed.

## Suggested investigation

1. Discover the CMS MCP's available tools and their input/output schemas. Use read-only calls first; select a project the user is authorized to inspect. Never include credentials in the handover or application source.
2. Locate the project configuration, effective prompt sections, and any relevant API documentation or source. Record precise, sanitized examples and state which prompt sections are absent, inherited, generated, or inaccessible.
3. Inspect the Doc Search generation contract and implementation for per-request overrides and precedence rules. Check whether the project ID and selected graph/model affect support, how `use_cache` works, and whether overriding one section can inadvertently replace sibling sections.
4. If supported, perform a controlled test on a suitable project: capture the baseline configuration/version, run one baseline and one test with a distinctive, harmless override and cache disabled, then inspect trace/effective prompt evidence. Verify the CMS configuration is unchanged afterward. Avoid publishing or saving CMS changes.
5. Report each section as **verified supported**, **documented but unverified**, or **unsupported/unknown**. Specify the exact inputs and evidence needed before implementation. If some sections cannot be read or overridden, describe the required backend/API changes rather than presenting a simulated test as the real chatbot.

## Implementation acceptance criteria

- A selected project ID loads the available effective prompt sections and clearly identifies their source/version and any unavailable or unsupported fields.
- The user can edit only the sections they intend to test. Unchanged sections are preserved according to verified server semantics; no CMS mutation occurs.
- The selected project and overrides are snapshotted with each test/run so subsequent UI edits cannot change a running batch. Idempotency distinguishes different prompt variants.
- Cache behavior is explicit and based on the verified API contract. The interface makes it clear when there is no evidence that an override was applied.
- Existing benchmarks continue to work. Add meaningful tests for retrieval, validation, omission versus explicit empty values, partial overrides, run persistence, idempotency, and failures; test a realistic request/response path without exposing credentials.
- Hosted deployment must use the app's existing durable PostgreSQL/workflow storage, not local-only files on Vercel. Preserve history and existing user data.

## Handover deliverables

Return the discovered MCP tool names, sanitized API examples, supported sections and limitations, trace or controlled-test evidence, and a recommended implementation plan. Do not include API keys, passwords, private customer data, or full sensitive prompts.
