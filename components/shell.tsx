"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ArrowUpFromLine,
  Layers3,
  Rows3,
  ArrowUpRight,
  Monitor,
} from "lucide-react";
import { PaintedField } from "./painted-field";

const nav = [
  { href: "/", label: "New benchmark", icon: ArrowUpFromLine },
  { href: "/runs", label: "Runs", icon: Layers3 },
  { href: "/records", label: "Records", icon: Rows3 },
];

/** Brabant sun over sage: the nameplate mark. Decorative. */
function Sunmark() {
  return (
    <svg className="sunmark" viewBox="0 0 22 22" aria-hidden="true">
      <circle cx="11" cy="11" r="10" fill="#7f9a7a" />
      <path
        d="M3 14c3-3 5 1 8-1s5-3 8 0"
        fill="none"
        stroke="#d1a93a"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <circle cx="11" cy="9" r="4" fill="#d1a93a" />
    </svg>
  );
}

export function Shell({
  children,
  hosted = false,
}: {
  children: React.ReactNode;
  hosted?: boolean;
}) {
  const path = usePathname();
  // The emailed approval page is standalone: no protected workspace navigation
  // or link prefetches should trigger Basic-auth requests for a supervisor.
  if (path === "/cms/approve")
    return (
      <main id="main-content" className="cms-approval-shell">
        {children}
      </main>
    );
  const current = nav.find((n) => n.href === path) ?? nav[0];
  return (
    <div className="workspace">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <aside className="sidebar">
        <Link className="brand" href="/" aria-label="Doc Search benchmark home">
          <span className="brand-icon">
            <Sunmark />
          </span>
          <span>
            Doc Search <span className="brand-sub">benchmark</span>
          </span>
        </Link>
        <div className="workspace-label">Workspace</div>
        <nav aria-label="Main navigation">
          {nav.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              aria-label={n.label}
              className={path === n.href ? "nav-item active" : "nav-item"}
              aria-current={path === n.href ? "page" : undefined}
            >
              <n.icon size={18} aria-hidden="true" />
              <span className="nav-text">{n.label}</span>
            </Link>
          ))}
        </nav>
        <div className="sidebar-note">
          <div className="note-icon">
            <Monitor size={17} aria-hidden="true" />
          </div>
          <strong>
            {hosted ? "Your hosted workspace" : "Your local workspace"}
          </strong>
          <p>
            {hosted
              ? "Runs and responses are saved in your database."
              : "Runs and responses stay on this computer."}
          </p>
          <span className="local-tag">
            <i aria-hidden="true" />{" "}
            {hosted ? "Protected workspace" : "localhost only"}
          </span>
        </div>
        <div className="sidebar-footer">
          <span className="avatar" aria-hidden="true">
            DS
          </span>
          <span>
            Benchmark workspace
            <small>{hosted ? "Hosted environment" : "Local environment"}</small>
          </span>
          <ArrowUpRight size={14} aria-hidden="true" />
        </div>
      </aside>
      <div className="main-wrap">
        <header className="topbar">
          <div className="breadcrumb">
            Workspace <span aria-hidden="true">/</span>{" "}
            <strong>{current.label}</strong>
          </div>
          <span className="environment">
            <i aria-hidden="true" />
            <span className="environment-text">
              {hosted ? "Hosted environment" : "Local environment"}
            </span>
          </span>
        </header>
        <main id="main-content" tabIndex={-1}>
          {children}
        </main>
        <footer className="main-footer">
          <div className="main-footer-text">
            <span className="main-footer-name">Doc Search Benchmark</span>
            <span>Built for better answers.</span>
          </div>
          <PaintedField mode="foot" seed={1890} className="footer-paint" />
        </footer>
      </div>
    </div>
  );
}
