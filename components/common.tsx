"use client";
import { useEffect, useRef, useState, useId } from "react";
import { X, Copy, Check } from "lucide-react";
export { api } from "../lib/api-client";
export function Badge({ value }: { value: string }) {
  return (
    <span className={`badge ${value}`}>
      {value === "succeeded"
        ? "Succeeded"
        : value.replaceAll("_", " ").replace(/^./, (s) => s.toUpperCase())}
    </span>
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
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  onClose: () => void;
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
    return () => {
      dialog.close();
      previous?.focus();
    };
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
