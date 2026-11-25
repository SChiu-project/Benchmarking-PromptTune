"use client";
import { useEffect, useRef, useState, useId } from "react";
import { X, Copy, Check } from "lucide-react";
export { api } from "../lib/api-client";
export type BadgeTone = "success" | "active" | "warning" | "danger" | "neutral";
// Statuses are designed explicitly; anything not listed renders neutral.
const badgeTones: Record<string, BadgeTone> = {
  succeeded: "success",
  completed: "success",
  pass: "success",
  active: "active",
  running: "active",
  queued: "warning",
  pending: "warning",
  review: "warning",
  failed: "danger",
  fail: "danger",
  interrupted: "danger",
  error: "danger",
};
export const badgeTone = (value: string): BadgeTone =>
  badgeTones[value] ?? "neutral";
export const statusLabel = (value: string) =>
  value.replaceAll("_", " ").replace(/^./, (s) => s.toUpperCase());
export function Badge({ value }: { value: string }) {
  return (
    <span className={`badge ${badgeTone(value)}`}>{statusLabel(value)}</span>
  );
}
export const latency = (n: number | null | undefined) =>
  n == null ? "—" : `${(n / 1000).toFixed(2)}s`;
export const percent = (n: number | null | undefined) =>
  n == null ? "—" : `${Math.round(n * 10) / 10}%`;
export const date = (s: string) => new Date(s).toLocaleString();
export function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false),
    [error, setError] = useState("");
  return (
    <span className="copy-control">
      <button
        className="icon-button"
        title="Copy trace ID"
        aria-label="Copy trace ID"
        onClick={async (e) => {
          e.stopPropagation();
          try {
            await navigator.clipboard.writeText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 1800);
          } catch {
            setError("Copy failed. Select the trace ID manually.");
          }
        }}
      >
        {copied ? <Check size={14} /> : <Copy size={14} />}
      </button>
      <span role="status" className={error ? "error-text" : "sr-only"}>
        {error || (copied ? "Trace ID copied" : "")}
      </span>
    </span>
  );
}
export function Modal({
  title,
  subtitle,
  children,
  onClose,
  returnFocus,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  onClose: () => void;
  /** Where focus goes on close when the opener can't take it back (e.g. it
   * was disabled while the dialog loaded). */
  returnFocus?: React.RefObject<HTMLElement | null>;
}) {
  const headingId = useId(),
    descriptionId = useId();
  const ref = useRef<HTMLDialogElement>(null),
    close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const dialog = ref.current!,
      previous = document.activeElement as HTMLElement | null;
    dialog.showModal();
    close.current?.focus();
    const fallback = returnFocus?.current;
    return () => {
      dialog.close();
      const target =
        previous && previous !== document.body && previous.isConnected
          ? previous
          : fallback;
      target?.focus();
    };
    // Focus handling runs once per dialog lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <dialog
      ref={ref}
      aria-labelledby={headingId}
      aria-describedby={subtitle ? descriptionId : undefined}
      className="modal"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <div className="modal-heading">
        <div>
          <h2 id={headingId}>{title}</h2>
          {subtitle && <p id={descriptionId}>{subtitle}</p>}
        </div>
        <button
          ref={close}
          className="icon-button"
          aria-label="Close dialog"
          onClick={onClose}
        >
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function ErrorBox({ message }: { message: string }) {
  return message ? (
    <div role="alert" className="alert error">
      {message}
    </div>
  ) : null;
}
