"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ArrowUpFromLine,
  Layers3,
  Rows3,
  ScanLine,
  ArrowUpRight,
  Monitor,
} from "lucide-react";
export function Shell({
  children,
  hosted = false,
}: {
  children: React.ReactNode;
  hosted?: boolean;
}) {
  const path = usePathname();
  return (
    <div className="workspace">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <aside className="sidebar">
        <Link className="brand" href="/" aria-label="Doc Search Benchmark home">
          <span className="brand-icon">
            <ScanLine size={21} />
          </span>
          <span>
            Doc Search<span className="brand-sub">BENCHMARK</span>
          </span>
        </Link>
        <div className="workspace-label">WORKSPACE</div>
        <nav aria-label="Main navigation">
          {[
            { href: "/", label: "New benchmark", icon: ArrowUpFromLine },
            { href: "/runs", label: "Runs", icon: Layers3 },
            { href: "/records", label: "Records", icon: Rows3 },
          ].map((n) => (
            <Link
              key={n.href}
              href={n.href}
              aria-label={n.label}
              className={path === n.href ? "nav-item active" : "nav-item"}
              aria-current={path === n.href ? "page" : undefined}
            >
              <n.icon size={18} />
              {n.label}
              {path === n.href && <span className="nav-dot" />}
            </Link>
          ))}
        </nav>
        <div className="sidebar-note">
          <div className="note-icon">
            <Monitor size={17} />
          </div>
          <strong>
            {hosted ? "Your hosted workspace" : "Your local workspace"}
          </strong>
          <p>
            {hosted
              ? "Runs and responses are saved"
              : "Runs and responses stay"}
            <br />
            {hosted ? "in your database." : "on this computer."}
          </p>
          <span className="local-tag">
            <i /> {hosted ? "Protected workspace" : "localhost only"}
          </span>
        </div>
        <div className="sidebar-footer">
          <span className="avatar">DS</span>
          <span>
            Benchmark workspace
            <small>{hosted ? "Hosted environment" : "Local environment"}</small>
          </span>
          <ArrowUpRight size={14} />
        </div>
      </aside>
      <div className="main-wrap">
        <header className="topbar">
          <div>
            Workspace <span>/</span>{" "}
            <strong>
              {path === "/runs"
                ? "Runs"
                : path === "/records"
                  ? "Records"
                  : "New benchmark"}
            </strong>
          </div>
          <span className="environment">
            <i /> {hosted ? "Hosted environment" : "Local environment"}
          </span>
        </header>
        <main id="main-content" tabIndex={-1}>
          {children}
        </main>
        <footer className="main-footer">
          DOC SEARCH BENCHMARK<span>Built for better answers.</span>
        </footer>
      </div>
    </div>
  );
}
