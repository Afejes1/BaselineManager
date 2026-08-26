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
  { href: "/intake", label: "Import Hub & Quality", icon: "⇣", enabled: true, section: "Baseline" },
  { href: "/control", label: "Analyst Control", icon: "◎", enabled: true, section: "Baseline" },
  { href: "/stewardship", label: "Identity Stewardship", icon: "≡", enabled: true, section: "Baseline" },
  { href: "/evidence", label: "Calls & Evidence", icon: "◇", enabled: true, section: "Baseline" },
  { href: "/releases", label: "Releases", icon: "▤", enabled: true, section: "Baseline" },
  { href: "/workspace", label: "Workspace Transfer", icon: "⇄", enabled: true, section: "Baseline" },
  { href: "/products", label: "Products", icon: "◦", enabled: true, section: "Views" },
  { href: "/platforms", label: "Platforms", icon: "⌂", enabled: true, section: "Views" },
  { href: "/topology", label: "Deployment Topology", icon: "⌘", enabled: true, section: "Views" },
  { href: "/pbs", label: "Product Deployment", icon: "⌗", enabled: true, section: "Views" },
  { href: "/analytics", label: "Analytics", icon: "◈", enabled: true, section: "Views" },
  { href: "/dependencies", label: "Dependency Board", icon: "⇢", enabled: true, section: "Views" },
  { href: "/changes", label: "Change Requests", icon: "◫", enabled: true, section: "Decisions" },
  { href: "/objectives", label: "LM Objectives", icon: "▣", enabled: true, section: "Decisions" },
  { href: "/delivery", label: "Initiative Work Plan", icon: "⌗", enabled: true, section: "Decisions" },
  { href: "/initiatives", label: "Initiatives", icon: "◆", enabled: true, section: "Decisions" },
  { href: "/analysis", label: "AI Analysis", icon: "AI", enabled: true, section: "Decisions" },
  { href: "/reports", label: "Leadership Reports", icon: "✦", enabled: true, section: "Decisions" },
  { href: "/briefs", label: "Saved One-Pagers", icon: "▧", enabled: true, section: "Decisions" },
];
