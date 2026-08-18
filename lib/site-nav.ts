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
  { href: "/pbs", label: "PBS Explorer", icon: "⌘", enabled: true },
  { href: "/products", label: "Products", icon: "◦", enabled: true },
  { href: "/configuration", label: "Configuration", icon: "⚙", enabled: true },
  { href: "/organizations", label: "Suppliers", icon: "🏭", enabled: true },
  { href: "/capabilities", label: "Capabilities", icon: "★", enabled: true },
  { href: "/initiatives", label: "Initiatives & WBS", icon: "🗂", enabled: true },
  { href: "/evidence", label: "Change & Evidence", icon: "◫", enabled: true },
  { href: "/briefs", label: "Executive Briefs", icon: "✦", enabled: true },
];
