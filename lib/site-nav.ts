export type NavItem = {
  href: string;
  label: string;
  icon: string;
  enabled: boolean;
  tag?: string;
};

export const APP_NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Baseline Manager", icon: "▦", enabled: true },
  { href: "/intake", label: "Intake & quality", icon: "⇣", enabled: true },
  { href: "/releases", label: "Releases", icon: "🗂", enabled: true },
  { href: "/platforms", label: "Platforms", icon: "⌂", enabled: true },
  { href: "/topology", label: "Topology", icon: "▤", enabled: true },
  { href: "/pbs", label: "PBS Explorer", icon: "⌘", enabled: true },
  { href: "/products", label: "Products", icon: "◦", enabled: true },
  { href: "/configuration", label: "Configuration", icon: "⚙", enabled: true },
  { href: "/organizations", label: "Suppliers", icon: "🏭", enabled: true },
  { href: "/capabilities", label: "Capabilities", icon: "★", enabled: true },
  { href: "/changes", label: "Change Requests", icon: "◫", enabled: true },
  { href: "/reports", label: "Decision Reports", icon: "✦", enabled: true },
  { href: "/initiatives", label: "Initiatives & Decisions", icon: "🗂", enabled: true },
  { href: "/evidence", label: "Evidence Library", icon: "▣", enabled: true },
  { href: "/briefs", label: "Saved Briefs", icon: "◇", enabled: true },
];
