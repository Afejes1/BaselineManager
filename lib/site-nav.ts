export type NavItem = {
  href: string;
  label: string;
  icon: string;
  enabled: boolean;
  section: "Baseline" | "Views" | "Decisions";
  tag?: string;
};

export const APP_NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Baseline Records", icon: "▦", enabled: true, section: "Baseline" },
  { href: "/intake", label: "Import & Data Quality", icon: "⇣", enabled: true, section: "Baseline" },
  { href: "/releases", label: "Releases", icon: "▤", enabled: true, section: "Baseline" },
  { href: "/products", label: "Products", icon: "◦", enabled: true, section: "Views" },
  { href: "/platforms", label: "Platforms", icon: "⌂", enabled: true, section: "Views" },
  { href: "/topology", label: "Deployment Topology", icon: "⌘", enabled: true, section: "Views" },
  { href: "/changes", label: "Change Requests", icon: "◫", enabled: true, section: "Decisions" },
  { href: "/objectives", label: "LM Objectives", icon: "▣", enabled: true, section: "Decisions" },
  { href: "/delivery", label: "Delivery WBS", icon: "⌗", enabled: true, section: "Decisions" },
  { href: "/initiatives", label: "Initiatives", icon: "◆", enabled: true, section: "Decisions" },
  { href: "/reports", label: "Leadership Reports", icon: "✦", enabled: true, section: "Decisions" },
];
