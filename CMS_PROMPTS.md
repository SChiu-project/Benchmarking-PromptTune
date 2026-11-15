# CMS prompt loading

The benchmark can read stored chatbot prompt sections from the verified llmGraph API. It never saves/publishes prompts to CMS. Existing benchmarks and manual JSON imports work without a CMS connection.

## Local setup

1. Sign in to the CMS connector using its normal login page.
2. Set these server-side values in ignored `.env.local`:

```dotenv
CMS_PROJECT_IDS=mtr-air-kiosk-05emf61
CMS_GRAPH_BASE_URL=https://dev.setsailapi.com/nlp/llmGraph
CMS_READ_TIMEOUT_MS=15000
CMS_SESSION_FILE=/absolute/path/to/cms-mcp/session.json
```

`CMS_PROJECT_IDS` is a comma-separated allowlist enforced by the server. Add only projects approved for every user of this shared workspace. The local connector's default session path is `cms-mcp/session.json` under Node's OS temporary directory; the current checkout has been configured with its actual absolute path. The app reads that file on each CMS call, so connector re-login can renew the session without copying tokens. Restart the app after changing environment settings.

Alternatively set `CMS_READ_TOKEN` and `CMS_READ_UID` on the server. They must both belong to the same valid CMS session. These take precedence over the file. Never use browser-exposed `NEXT_PUBLIC_*` credentials. The app does not accept arbitrary upstream URLs or credentials from the browser.

## Hosted configuration

Set `CMS_PROJECT_IDS`, `CMS_GRAPH_BASE_URL`, `CMS_READ_TOKEN`, and `CMS_READ_UID` in the deployment's private environment configuration, along with the existing required workspace password/database configuration. Local session files are disabled on hosted deployments.

The verified upstream authentication mechanism is a CMS user session with `token`, `uid` and `x-source: cms` headers. There is no verified automatic refresh or service-identity contract yet. Renew the session and replace the server settings when CMS returns 401; this implementation does not promise unattended long-term credentials. Production CMS behavior and credential renewal still require backend-owner validation. Do not substitute a broadly privileged personal account for a restricted shared-workspace identity.

All workspace viewers can inspect loaded prompts. The allowlist narrows the projects available through the configured CMS identity, and CMS still enforces that identity's permissions. This is not per-viewer CMS authorization; broader multi-user deployment requires an appropriate individual identity model.

The configured CMS base and Doc Search endpoint must have the same HTTPS service origin for CMS-backed runs. Dev is the verified environment. A server configuration change invalidates existing snapshots rather than silently reusing them against another service.

## Use

Upload a CSV with one document folder, choose its project, and expand **Test revised prompts**. Enter the exact prompt source folder or ROOT and click **Load from CMS**. The source is chosen explicitly; it is not inferred from a document folder list.

Inspect the source, version, fingerprint and three language tabs. Confirm the project/document/source mapping, then edit the supported sections. A changed DTO always sends all three languages; unchanged sections are omitted. The first-query test and batch receive the same saved baseline reference, and cache bypass applies even if no section was edited.

**Check CMS for changes** preserves edits. **Discard draft and reload from CMS** replaces them. If the source changed, reload or explicitly acknowledge using the saved baseline. A failed read/check keeps the draft but blocks testing until retried or cleared. **Clear prompt test / run without overrides** explicitly returns to normal benchmark behavior.

Unknown folders can return base configuration: `is_base:true`, version 0 and null version ID. The app displays this without claiming it is a saved ROOT version. Both refresh and submission checks perform a full read, avoiding the base metadata endpoint's observed 404. Stored values can differ from effective runtime instructions; unchanged sections still use runtime configuration and may drift after a read.

Incomplete, null and missing localized sections cannot be edited. Explicit empty strings are preserved. Other fields, including context, reranker and structured tool definitions, are not sent as overrides.

## Storage and failure behavior

Loaded snapshots are scoped to the namespace, project, document folder, prompt folder, CMS service base and exact search endpoint. They are stored in a separate bounded collection within the existing transactional workspace snapshot, using JSON locally and PostgreSQL when configured. At most 20 loader snapshots are retained, expiring after seven days; older drafts may require reloading. Each submitted run owns a complete copy of its supported baseline/provenance, so cleanup does not remove history.

Submission checks scope, computes changed sections against the server-owned baseline, and rechecks the current CMS source before taking the run-creation storage lock. External calls are GET-only, no-store, do not follow redirects, have a 1–30 second configurable timeout, and reject responses above 2 MB. HTTP-200 error envelopes are failures. Credential-bearing errors and raw upstream prompt bodies are not logged. Workers never load CMS while processing questions.

An accepted submission can be retried with its original idempotency key even if CMS login later expires; it returns the saved run and does not repeat CMS/generation calls. Different baseline IDs or prompt edits are different submissions. Both old run history and manual overrides remain supported.

## Verify

```sh
pnpm cms:check
# Optional explicit scope:
pnpm cms:check mtr-air-kiosk-05emf61 persona_maisie
```

This makes one real read-only CMS call and prints metadata, supported section names and a fingerprint, never prompt text or credentials. It does not start Doc Search or mutate CMS. Tests in `tests/cms.test.ts` and `tests/cms-routes.test.ts` exercise failures, project/workspace scoping, snapshot immutability, stale checks, old history compatibility and PostgreSQL JSONB persistence.
