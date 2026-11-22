# CMS prompt loading

The benchmark can read stored chatbot prompt sections from the verified llmGraph API. It never saves/publishes prompts to CMS. Existing benchmarks and manual JSON imports work without a CMS connection.

## Direct CMS login

The project ID stays editable in the benchmark UI. **`CMS_PROJECT_IDS` is no longer used.** A direct login checks the selected project against the authenticated CMS user's `/user/me` project list, and each prompt operation rechecks membership with CMS.

After uploading a CSV, expand **Test revised prompts → Connect to CMS → Direct CMS login**. Enter your CMS username (any non-empty account string, including an email address) and password. Direct accounts do not need a contact email in their CMS profile. If CMS requests a verification code, enter it in the next form. The benchmark server calls CMS; this is a benchmark-hosted sign-in form, not an OAuth redirect or a CMS-native delegated grant.

Passwords and verification codes are never persisted. CMS `token`/`uid` values are encrypted with AES-256-GCM before storage; the browser receives only a random HttpOnly, SameSite=Lax cookie (Secure on Vercel). Direct connections last at most eight hours and still depend on the upstream CMS session remaining valid. Use **Renew or change CMS access** to sign in again, or **Disconnect CMS** to remove access without discarding prompt drafts.

Hosted mode uses the existing PostgreSQL workspace snapshot for sessions and approval state, so separate Vercel invocations see the same decisions. No per-user `CMS_READ_TOKEN`/`CMS_READ_UID` environment variables are needed or used in hosted mode. The existing required `APP_PASSWORD` supplies session encryption unless a separate `CMS_SESSION_SECRET` of at least 16 characters is set. A dedicated random 32-byte secret is recommended. Changing the secret, app password used as its fallback, namespace, or CMS environment requires a new CMS sign-in. Existing stored prompts/run history remain intact.

The default CMS auth base is `https://dev.setsailapi.com/cms`; the prompt base is `https://dev.setsailapi.com/nlp/llmGraph`. Optional `CMS_API_BASE_URL` and `CMS_GRAPH_BASE_URL` overrides must have the same HTTPS origin. The configured Doc Search endpoint must also use that origin for CMS-backed runs.

## Supervisor approval by email

A requester without a CMS account selects **Ask a supervisor**, enters their name and any supervisor email, and sends a request for the currently selected project. Names are explicitly self-reported, not verified identities.

1. The server emails a random approval capability in the URL fragment. It is not returned to the requester, stored in plaintext, or included in the page URL sent to the server. Requests expire after 30 minutes.
2. The supervisor opens `/cms/approve`, which does not require the shared benchmark password. Only that page and `/api/cms/approval` bypass workspace Basic authentication. A link inspection or CMS login cannot grant access by itself.
3. The supervisor may sign in with a username or email. The server checks the authenticated account's contact email against the email recipient and verifies project membership through `/user/me`; the login username itself is not used as proof of email ownership. This establishes project access; it does not establish an organizational supervisor role. The supervisor must recognize the requester and be authorized by their organization to share prompts.
4. A separate consent checkbox and **Approve access** action grant prompt reads for that one project to the requester's original browser, for at most one hour. **Deny request** closes the request without access. A successful decision cannot be replayed to grant more access.
5. The requester sees approval automatically, or can use **Check access**. Changing the project requires another authorization. The supervisor can use the same link to **Revoke access now** while the grant is active, including after signing in again from another browser. Requesters can cancel pending requests or disconnect to revoke their connection. New direct logins cancel outstanding approvals.

The app holds the supervisor's CMS session on the server and exposes only its fixed read endpoints. This is app-level authorization, not a CMS-issued restricted credential or a new CMS account. The raw upstream token may have broader permissions, but no publishing, write API, token export, arbitrary upstream URL, or general CMS proxy is exposed. Session expiry, CMS logout/token rotation, removed project membership, or revocation blocks subsequent reads/checks/submissions. Already loaded prompts and saved run history remain visible in this shared workspace; revocation cannot retract copies already read or cancel an upstream request already in flight.

### Email configuration on Vercel

Set private server variables, then redeploy:

| Variable | Purpose |
| --- | --- |
| `RESEND_API_KEY` | API key for the Resend email delivery service |
| `CMS_EMAIL_FROM` | Sender authorized by your Resend account, such as `Benchmark <access@example.com>` |
| `APP_URL` | Optional canonical HTTPS URL of this deployment; must match the requester's host. Standard Vercel domains work without it. |
| `CMS_SESSION_SECRET` | Optional dedicated encryption secret; otherwise existing `APP_PASSWORD` is used |

There is no project-ID environment requirement and no CMS user credential to copy into Vercel. Resend requires an account and an authorized sender; availability and sending limits depend on that account. Without email configuration, the UI explains that supervisor email is unavailable and direct login remains usable. Delivery failures do not activate an approval. An uncertain delivery can leave an email in the recipient's inbox, but its failed request cannot be approved.

Requests are bounded to three emails per requester browser and three per recipient per hour, with a workspace-wide cap of 20 per hour. Password attempts are limited per browser, account, and workspace; verification codes have a separate limit. The counters and a bounded audit trail are persisted with the workspace. Approval decisions are atomic under the existing transaction lock. Browser credentials, link tokens, passwords, and upstream bodies are excluded from public errors and application logs.

## Local setup and CLI compatibility

The same direct-login and supervisor flows work locally. Without `APP_PASSWORD` or `CMS_SESSION_SECRET`, local mode creates a private `data/.cms-session-key`, excluded from Git. Do not remove that key while sessions are active. Supervisor links must be reachable by the recipient; a `localhost` URL cannot be used remotely.

For local read-only CLI checks, the existing connector session remains supported:

```dotenv
CMS_GRAPH_BASE_URL=https://dev.setsailapi.com/nlp/llmGraph
CMS_READ_TIMEOUT_MS=15000
CMS_SESSION_FILE=/absolute/path/to/cms-mcp/session.json
```

Alternatively, local scripts may use `CMS_READ_TOKEN` and `CMS_READ_UID` from the same session. These legacy local credentials are never used as a hosted fallback. The CLI's project is an argument, not an environment allowlist. CMS enforces the local user's upstream project permissions. Refresh the connector login when its session expires; local file paths do not work on Vercel. Never expose credentials through `NEXT_PUBLIC_*`.

## Authentication evidence and limits

The bundled CMS connector uses `POST /auth/login` with `{ username, password }`, returns `token`/`uid`, and reads accessible project strings from `GET /user/me` with `token`, `uid`, and `x-source: cms` headers. Its OTP flow uses `/auth/oneTimePassword` or `/auth/totp/confirm` with `{ twoFactorAuthChallengeToken, code }`. The connector explicitly marks the OTP body as inferred and requiring live validation. No supported OAuth callback, native delegation, or refresh contract was found in the supplied integration.

During implementation the dev login endpoint was reachable (OPTIONS returned 204). Automated tests exercise the complete login/OTP/approval flows against controlled CMS and email responses. A real successful CMS login, OTP account, and delivered supervisor email still require live credentials and email-service configuration; they have not been claimed as verified here. In particular, production OTP compatibility must be checked with a real enabled account before rollout to those users.

## Use

Upload a CSV, choose its project, and expand **Test revised prompts**. Connect to CMS using either option above. With multiple CSV folders, choose the document folder for the prompt test. Enter the exact prompt source folder or ROOT and click **Load from CMS**. Prompt-backed benchmark submissions still require questions from one document folder; split a mixed-folder CSV before submitting overrides. The source is chosen explicitly; it is not inferred from a document folder list.

Inspect the source, version, fingerprint and three language tabs. Confirm the project/document/source mapping, then edit the supported sections. A changed DTO always sends all three languages; unchanged sections are omitted. The first-query test and batch receive the same saved baseline reference, and cache bypass applies even if no section was edited.

**Check CMS for changes** preserves edits. **Discard draft and reload from CMS** replaces them. If the source changed, reload or explicitly acknowledge using the saved baseline. A failed read/check keeps the draft but blocks testing until retried or cleared. **Clear prompt test / run without overrides** explicitly returns to normal benchmark behavior.

Unknown folders can return base configuration: `is_base:true`, version 0 and null version ID. The app displays this without claiming it is a saved ROOT version. Both refresh and submission checks perform a full read, avoiding the base metadata endpoint's observed 404. Stored values can differ from effective runtime instructions; unchanged sections still use runtime configuration and may drift after a read.

Incomplete, null and missing localized sections cannot be edited. Explicit empty strings are preserved. Other fields, including context, reranker and structured tool definitions, are not sent as overrides.

## Storage and failure behavior

Loaded snapshots are scoped to the namespace, project, document folder, prompt folder, CMS service base and exact search endpoint. Browser-loaded snapshots are additionally bound to the browser session that loaded them; another user must load their own baseline. They are stored in a separate bounded collection within the existing transactional workspace snapshot, using JSON locally and PostgreSQL when configured. At most 20 loader snapshots are retained, expiring after seven days; older drafts may require reloading. Each submitted run owns a complete copy of its supported baseline/provenance, so cleanup does not remove history.

Submission checks scope, computes changed sections against the server-owned baseline, and rechecks the current CMS source before taking the run-creation storage lock. Prompt reads are GET-only, no-store, do not follow redirects, have a 1–30 second configurable timeout, and reject responses above 2 MB. CMS authentication uses the fixed POST login/verification routes; user profiles use GET. Email delivery uses the fixed Resend endpoint. HTTP-200 error envelopes are failures. Credential-bearing errors and raw upstream prompt bodies are not logged. Workers never load CMS while processing questions.

An accepted submission can be retried with its original idempotency key even if CMS login later expires; it returns the saved run and does not repeat CMS/generation calls. Different baseline IDs or prompt edits are different submissions. Both old run history and manual overrides remain supported.

## Verify

```sh
pnpm cms:check
# Optional explicit scope:
pnpm cms:check mtr-air-kiosk-05emf61 persona_maisie
```

This makes one real read-only CMS call and prints metadata, supported section names and a fingerprint, never prompt text or credentials. It does not start Doc Search or mutate CMS. Tests in `tests/cms.test.ts` and `tests/cms-routes.test.ts` exercise failures, project/workspace scoping, snapshot immutability, stale checks, old history compatibility and PostgreSQL JSONB persistence.
