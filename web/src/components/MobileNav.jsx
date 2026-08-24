import { NavLink } from "react-router-dom";
import { LayoutDashboard, Map as MapIcon, FileWarning, Users, Camera } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Bottom tab bar for phones.
 *
 * Without this, every move between the six sections meant opening the drawer
 * first — three taps to reach the map on a device you are holding one-handed.
 * The five most-used destinations sit here; Profile stays in the drawer.
 *
 * Each tab is a full-height target so it clears the 44px minimum, and the bar
 * pads for the home indicator on notched phones.
 */
const TABS = [
  { to: "/", label: "Home", icon: LayoutDashboard, end: true },
  { to: "/map", label: "Route", icon: MapIcon },
  { to: "/report", label: "Report", icon: FileWarning },
  { to: "/contacts", label: "Circle", icon: Users },
  { to: "/evidence", label: "Vault", icon: Camera },
];

export function MobileNav() {
  return (
    <nav
      aria-label="Main"
      className={cn(
        "fixed inset-x-0 bottom-0 z-40 lg:hidden",
        "border-t border-border/70 bg-card",
        "pb-[env(safe-area-inset-bottom)]",
      )}
    >
      <ul className="mx-auto grid max-w-lg grid-cols-5">
        {TABS.map(({ to, label, icon: Icon, end }) => (
          <li key={to}>
            <NavLink
              to={to}
              end={end}
              className={({ isActive }) =>
                cn(
                  "relative flex min-h-14 flex-col items-center justify-center gap-1 px-1 py-2 text-[11px] font-medium transition-colors",
                  "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                  isActive ? "text-primary" : "text-muted-foreground",
                )
              }
            >
              {({ isActive }) => (
                <>
                  <span
                    aria-hidden
                    className={cn(
                      "absolute top-0 h-0.5 w-8 rounded-b-full bg-primary transition-opacity",
                      isActive ? "opacity-100" : "opacity-0",
                    )}
                  />
                  <Icon className="size-5 shrink-0" />
                  {label}
                </>
              )}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
