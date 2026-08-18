import type { AnchorHTMLAttributes, ReactNode } from "react";

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
  return <a href={href} {...props}>{children}</a>;
}
