"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import Link from "./app-link";
import { usePathname } from "next/navigation";
import { APP_NAV_ITEMS } from "../lib/site-nav";

type DomainPageShellProps = {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
  releaseScope?: string;
};

function isActiveItem(pathname: string, itemHref: string) {
  if (pathname === itemHref) return true;
  return pathname.startsWith(`${itemHref}/`) && itemHref !== "/";
}

export function DomainPageShell({ title, subtitle, actions, children, releaseScope }: DomainPageShellProps) {
  const pathname = usePathname();
  const [railCollapsed, setRailCollapsed] = useState(() => typeof window !== "undefined" && window.localStorage.getItem("v3-rail-collapsed") === "true");
  const navigationSections = ["Baseline", "Views", "Decisions"] as const;

  function toggleRail() {
    setRailCollapsed((current) => {
      const next = !current;
      window.localStorage.setItem("v3-rail-collapsed", String(next));
      return next;
    });
  }

  return (
    <main className="shell">
      <aside className={railCollapsed ? "rail rail-collapsed" : "rail"}>
        <div className="brand">
          <span className="brand-mark">V3</span>
          <span className="brand-name">JSF Baseline</span>
          <button className="rail-toggle" type="button" onClick={toggleRail} aria-label={railCollapsed ? "Expand navigation" : "Collapse navigation"} title={railCollapsed ? "Expand navigation" : "Collapse navigation"}>{railCollapsed ? "›" : "‹"}</button>
        </div>
        <nav aria-label="Primary navigation">
          {navigationSections.map((section) => <div className="nav-section" key={section}>
            <p className="rail-label">{section}</p>
            {APP_NAV_ITEMS.filter((item) => item.section === section && item.enabled).map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`nav-item ${isActiveItem(pathname, item.href) ? "active" : ""}`}
                title={item.label}
              >
                <span className="nav-icon">{item.icon}</span>
                <span className="nav-label">{item.label}</span>
                {item.tag ? <em>{item.tag}</em> : null}
              </Link>
            ))}
          </div>)}
        </nav>
        <div className="rail-context">
          <span className="context-dot" />
          <div>
            <strong>Page scope</strong>
            <small>{releaseScope || "All records"}</small>
          </div>
        </div>
        <Link className="profile" href="/" title="Open workspace controls">
          <span>WS</span>
          <div><strong>Workspace</strong><small>Baseline data and demo controls</small></div>
          <b>→</b>
        </Link>
      </aside>

      <section className="workspace page-workspace">
        <header className="topbar">
          <div>
            <span className="eyebrow">TECHNICAL BASELINE</span>
            <h1>{title}</h1>
            {subtitle ? <div className="top-subtitle">{subtitle}</div> : null}
          </div>
          {actions ? <div className="top-actions">{actions}</div> : null}
        </header>
        <section className="domain-content">{children}</section>
      </section>
    </main>
  );
}
