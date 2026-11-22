"use client";
import { useState, type FormEvent } from "react";

export function CmsLoginForm({
  otpRequired,
  email,
  disabled = false,
  onSubmit,
}: {
  otpRequired: boolean;
  email?: string;
  disabled?: boolean;
  onSubmit: (
    input: { username: string; password: string } | { code: string },
  ) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const input = otpRequired
      ? { code: String(values.get("code") || "") }
      : {
          username: String(values.get("username") || ""),
          password: String(values.get("password") || ""),
        };
    // Keep secrets out of React state and clear the input as soon as it is submitted.
    for (const field of ["password", "code"]) {
      const element = form.elements.namedItem(field);
      if (element instanceof HTMLInputElement) element.value = "";
    }
    setBusy(true);
    try {
      await onSubmit(input);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="cms-login-form" onSubmit={(event) => void submit(event)}>
      <fieldset disabled={disabled || busy}>
        <legend>
          {otpRequired ? "CMS verification" : "Sign in with your CMS account"}
        </legend>
        {otpRequired ? (
          <label>
            Verification code
            <input
              name="code"
              autoComplete="one-time-code"
              inputMode="numeric"
              required
              maxLength={20}
            />
          </label>
        ) : (
          <>
            <label>
              CMS email
              <input
                name="username"
                type="email"
                autoComplete="username"
                defaultValue={email}
                readOnly={Boolean(email)}
                required
                maxLength={320}
              />
            </label>
            <label>
              CMS password
              <input
                name="password"
                type="password"
                autoComplete="current-password"
                required
                maxLength={1000}
              />
            </label>
          </>
        )}
        <button type="submit" className="button primary small">
          {busy
            ? "Signing in…"
            : otpRequired
              ? "Verify code"
              : "Sign in to CMS"}
        </button>
      </fieldset>
    </form>
  );
}
