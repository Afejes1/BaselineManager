"use client";

import Link from "./app-link";

export type AnalyticsContextKind = "product" | "platform" | "release" | "change_request" | "objective" | "initiative" | "organization" | "capability";

export function analyticsHref(kind: AnalyticsContextKind, id: string) {
  return `/analytics?kind=${encodeURIComponent(kind)}&id=${encodeURIComponent(id)}`;
}

export function AnalyticsLink({ kind, id, label = "Analytics", className = "ghost-button" }: { kind: AnalyticsContextKind; id: string | null | undefined; label?: string; className?: string }) {
  if (!id) return null;
  return <Link className={className} href={analyticsHref(kind, id)}>{label}</Link>;
}
