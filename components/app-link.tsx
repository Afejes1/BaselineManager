"use client";

import { useMemo, type AnchorHTMLAttributes, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";

type AppLinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  href: string;
  children: ReactNode;
};

/**
 * Uses a standard document navigation until the RSC client router is stable.
 * Every destination is server-renderable, and the page-level data hooks then
 * reload the same durable workspace context from D1.
 */
export default function AppLink({ href, children, ...props }: AppLinkProps) {
  const searchParams = useSearchParams();
  const destination = useMemo(() => {
    const release = searchParams.get("release");
    if (!release || !href.startsWith("/") || href.startsWith("//") || href.startsWith("/api/")) return href;
    const [pathAndQuery, hash = ""] = href.split("#", 2);
    const [path, query = ""] = pathAndQuery.split("?", 2);
    const nextQuery = new URLSearchParams(query);
    if (!nextQuery.has("release")) nextQuery.set("release", release);
    return `${path}?${nextQuery.toString()}${hash ? `#${hash}` : ""}`;
  }, [href, searchParams]);
  return <a href={destination} {...props}>{children}</a>;
}
