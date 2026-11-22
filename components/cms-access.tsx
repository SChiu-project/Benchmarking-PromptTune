"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api-client";
import { CmsLoginForm } from "./cms-login-form";

type SessionStatus = {
  connected: boolean;
  connection: {
    kind: "direct" | "supervisor";
    email: string;
    projects: string[];
    expiresAt: number;
  } | null;
  pending: {
    id: string;
    email: string;
    projectId: string;
    status: string;
    expiresAt: number;
  }[];
  otpRequired: boolean;
  emailConfigured: boolean;
};
const post = (body: unknown) =>
  api<{ status?: string }>("/api/cms/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
export function CmsAccess({
  projectId,
  disabled,
  onAccessChange,
}: {
  projectId: string;
  disabled: boolean;
  onAccessChange?: (authorized: boolean) => void;
}) {
  const [status, setStatus] = useState<SessionStatus | null>(null);
  const [option, setOption] = useState<"login" | "request">("login");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [reconnect, setReconnect] = useState(false);
  async function refresh() {
    setStatus(await api<SessionStatus>("/api/cms/session"));
  }
  useEffect(() => {
    const abort = new AbortController();
    api<SessionStatus>("/api/cms/session", { signal: abort.signal })
      .then(setStatus)
      .catch((e) => {
        if (!abort.signal.aborted) setError(e.message);
      });
    return () => abort.abort();
  }, []);
  const pending = Boolean(
    status?.pending.some((a) => ["pending", "sending"].includes(a.status)),
  );
  useEffect(() => {
    if (!pending) return;
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const next = await api<SessionStatus>("/api/cms/session", {
          signal: abort.signal,
        });
        if (!abort.signal.aborted) setStatus(next);
      } catch {
        /* The explicit Check access button reports connectivity failures. */
      } finally {
        if (!abort.signal.aborted) timer = setTimeout(poll, 5000);
      }
    };
    timer = setTimeout(poll, 5000);
    return () => {
      abort.abort();
      clearTimeout(timer);
    };
  }, [pending]);
  async function act(body: unknown, success = "") {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await post(body);
      await refresh();
      if (result.status === "ok") setReconnect(false);
      setMessage(
        result.status === "otp_required"
          ? "Enter the verification code from your CMS two-factor method."
          : success,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "CMS access failed.");
    } finally {
      setBusy(false);
    }
  }
  const authorized =
    status?.connected && status.connection?.projects.includes(projectId);
  useEffect(() => {
    onAccessChange?.(Boolean(authorized));
  }, [authorized, onAccessChange]);
  return (
    <section className="cms-access" aria-label="CMS access">
      <h3>Connect to CMS</h3>
      <p>
        Sign in yourself, or ask a supervisor to approve prompt reads for the
        selected project. Passwords are not stored.
      </p>
      {status?.connected && status.connection && (
        <p role="status">
          {status.connection.kind === "supervisor"
            ? "Approved by"
            : "Signed in as"}{" "}
          <strong>{status.connection.email}</strong>. Access expires{" "}
          {new Date(status.connection.expiresAt).toLocaleTimeString()}.
          {authorized
            ? " This session can read the selected project."
            : " This session does not cover the selected project."}
        </p>
      )}
      <div className="cms-access-actions">
        {authorized && (
          <button
            type="button"
            className="button secondary small"
            disabled={disabled || busy}
            onClick={() => setReconnect((value) => !value)}
          >
            Renew or change CMS access
          </button>
        )}
        <button
          type="button"
          className="button secondary small"
          disabled={disabled || busy}
          onClick={() => {
            setError("");
            void refresh().catch((e) => setError(e.message));
          }}
        >
          Check access
        </button>
        {status?.connected && (
          <button
            type="button"
            className="button secondary small"
            disabled={disabled || busy}
            onClick={() =>
              void act(
                { action: "logout" },
                "CMS access disconnected. Existing prompt drafts are preserved.",
              )
            }
          >
            Disconnect CMS
          </button>
        )}
      </div>
      {(!authorized || reconnect) && (
        <>
          <div
            className="cms-access-actions"
            aria-label="CMS connection options"
          >
            <button
              type="button"
              className="button secondary small"
              aria-pressed={option === "login"}
              onClick={() => setOption("login")}
              disabled={disabled || busy}
            >
              1. Direct CMS login
            </button>
            <button
              type="button"
              className="button secondary small"
              aria-pressed={option === "request"}
              onClick={() => setOption("request")}
              disabled={disabled || busy}
            >
              2. Ask a supervisor
            </button>
          </div>
          {!projectId && <p>Enter a project ID above to connect.</p>}
          {option === "login" ? (
            <>
              <CmsLoginForm
                otpRequired={Boolean(status?.otpRequired)}
                disabled={disabled || busy || !projectId}
                onSubmit={(input) =>
                  act(
                    "code" in input
                      ? { action: "otp", ...input }
                      : { action: "login", projectId, ...input },
                    "CMS access connected. You can now load the prompt.",
                  )
                }
              />
              {status?.otpRequired && (
                <button
                  type="button"
                  className="button secondary small"
                  disabled={busy || disabled}
                  onClick={() =>
                    void act(
                      { action: "logout" },
                      "Verification cleared. Sign in again.",
                    )
                  }
                >
                  Restart login
                </button>
              )}
            </>
          ) : (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                const form = new FormData(event.currentTarget);
                void act(
                  {
                    action: "request",
                    projectId,
                    email: String(form.get("email")),
                    requester: String(form.get("requester")),
                  },
                  "Approval email sent. Keep this browser open; access will update after your supervisor approves.",
                );
              }}
            >
              <fieldset
                disabled={
                  disabled || busy || !projectId || !status?.emailConfigured
                }
              >
                <legend>Request one hour of prompt-read access</legend>
                <label>
                  Your name
                  <input
                    name="requester"
                    required
                    maxLength={100}
                    autoComplete="name"
                  />
                </label>
                <label>
                  Supervisor email
                  <input
                    name="email"
                    type="email"
                    required
                    maxLength={320}
                    autoComplete="off"
                  />
                </label>
                <p>
                  The supervisor must use this CMS email, have access to{" "}
                  <strong>{projectId || "the selected project"}</strong>, and
                  explicitly approve. Requests expire in 30 minutes.
                </p>
                <button className="button primary small" type="submit">
                  {busy ? "Sending…" : "Email supervisor"}
                </button>
              </fieldset>
              {status && !status.emailConfigured && (
                <p className="prompt-warning">
                  Supervisor email is not enabled in this workspace yet. Ask the
                  workspace administrator to enable email delivery, or sign in
                  directly.
                </p>
              )}
            </form>
          )}
        </>
      )}
      {status?.pending.map((a) => (
        <p key={a.id}>
          {a.projectId} · {a.email} · <strong>{a.status}</strong>
          {["pending", "sending"].includes(a.status) && (
            <button
              type="button"
              className="button secondary small"
              disabled={disabled || busy}
              onClick={() =>
                void act(
                  { action: "cancel", id: a.id },
                  "Approval request cancelled.",
                )
              }
            >
              Cancel request
            </button>
          )}
        </p>
      ))}
      {message && <p role="status">{message}</p>}
      {error && (
        <p role="alert" className="prompt-warning">
          {error}
        </p>
      )}
      <p className="muted">
        Loaded prompts and saved run history are visible to other benchmark
        workspace users. Supervisor approval permits reads through this app; it
        does not create a CMS account or grant CMS write access.
      </p>
    </section>
  );
}
