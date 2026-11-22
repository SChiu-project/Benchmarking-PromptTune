"use client";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api-client";
import { CmsLoginForm } from "./cms-login-form";

type Details = {
  id: string;
  projectId: string;
  requester: string;
  email: string;
  status: string;
  expiresAt: number;
  grantExpiresAt?: number;
  authenticated: boolean;
  otpRequired: boolean;
};
export function CmsApproval() {
  const token = useRef("");
  const [details, setDetails] = useState<Details | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [reauthenticate, setReauthenticate] = useState(false);
  async function call<T>(input: Record<string, unknown>, signal?: AbortSignal) {
    return api<T>("/api/cms/approval", {
      method: "POST",
      signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...input, token: token.current }),
    });
  }
  useEffect(() => {
    token.current =
      new URLSearchParams(window.location.hash.slice(1)).get("token") || "";
    const abort = new AbortController();
    call<Details>({ action: "inspect" }, abort.signal)
      .then(setDetails)
      .catch((e) => {
        if (!abort.signal.aborted) setError(e.message);
      });
    return () => abort.abort();
  }, []);
  async function act(input: Record<string, unknown>) {
    setBusy(true);
    setError("");
    try {
      const result = await call<{ status?: string }>(input);
      if (result.status === "ok") setReauthenticate(false);
      setDetails(await call<Details>({ action: "inspect" }));
      setConfirmed(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Approval failed.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <article className="cms-approval cms-access">
      <h1>Approve CMS prompt-read access</h1>
      <p>
        Signing in does not approve access. Review the request, then make an
        explicit decision.
      </p>
      {error && (
        <p role="alert" className="prompt-warning">
          {error}
        </p>
      )}
      {!details && !error && <p role="status">Loading request…</p>}
      {details && (
        <>
          <dl>
            <dt>Requester (self-reported)</dt>
            <dd>{details.requester}</dd>
            <dt>Project</dt>
            <dd>{details.projectId}</dd>
            <dt>Supervisor CMS account</dt>
            <dd>{details.email}</dd>
            <dt>Requested access</dt>
            <dd>
              Read stored prompts through this benchmark app for one hour.
            </dd>
            <dt>Status</dt>
            <dd>{details.status}</dd>
          </dl>
          <p>
            All users of this benchmark workspace can view loaded prompts and
            saved run history. Approve only if you recognize the requester and
            are authorized to share this project’s prompts.
          </p>
          {details.status === "pending" && (
            <p>
              This request expires{" "}
              {new Date(details.expiresAt).toLocaleString()}.
            </p>
          )}
          {details.status === "approved" && (
            <p role="status">
              Access approved until{" "}
              {new Date(details.grantExpiresAt!).toLocaleString()}. The
              requester can now use their original browser session.
            </p>
          )}
          {["pending", "approved"].includes(details.status) && (
            <>
              {!details.authenticated || reauthenticate ? (
                <CmsLoginForm
                  email={details.email}
                  otpRequired={details.otpRequired}
                  disabled={busy}
                  onSubmit={(input) =>
                    act({ action: "code" in input ? "otp" : "login", ...input })
                  }
                />
              ) : details.status === "pending" ? (
                <>
                  <label className="checkbox">
                    <input
                      type="checkbox"
                      checked={confirmed}
                      disabled={busy}
                      onChange={(event) => setConfirmed(event.target.checked)}
                    />
                    I recognize this requester and authorize prompt-read access
                    for this project for one hour.
                  </label>
                  <div className="cms-access-actions">
                    <button
                      className="button primary"
                      disabled={busy || !confirmed}
                      onClick={() =>
                        void act({ action: "approve", confirmed: true })
                      }
                    >
                      Approve access
                    </button>
                    <button
                      className="button secondary"
                      disabled={busy}
                      onClick={() => void act({ action: "deny" })}
                    >
                      Deny request
                    </button>
                  </div>
                </>
              ) : (
                <button
                  className="button secondary"
                  disabled={busy}
                  onClick={() => void act({ action: "revoke" })}
                >
                  Revoke access now
                </button>
              )}
              {details.authenticated && !reauthenticate && (
                <button
                  className="button secondary small"
                  disabled={busy}
                  onClick={() => setReauthenticate(true)}
                >
                  Sign in again
                </button>
              )}
            </>
          )}
          {["denied", "revoked", "cancelled", "failed"].includes(
            details.status,
          ) && (
            <p>
              This request is closed. No further access can be granted through
              this link.
            </p>
          )}
        </>
      )}
    </article>
  );
}
