import * as React from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import {
  LayoutDashboard,
  Map as MapIcon,
  FileWarning,
  Users,
  Camera,
  User as UserIcon,
  LogOut,
  Menu,
  X,
  Wifi,
  WifiOff,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, Separator } from "@/components/ui/misc";
import { MeshBackground, StaticMeshBackground } from "@/components/ui/background-shader";
import { MagneticCursor } from "@/components/ui/magnetic-cursor";
import { Logo } from "@/components/Logo";
import { LogoutDialog } from "@/components/LogoutDialog";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { MobileNav } from "@/components/MobileNav";
import { useAuth } from "@/lib/auth";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/map", label: "Safe route", icon: MapIcon },
  { to: "/report", label: "Report", icon: FileWarning },
  { to: "/contacts", label: "Trusted circle", icon: Users },
  { to: "/evidence", label: "Evidence vault", icon: Camera },
  { to: "/profile", label: "Profile", icon: UserIcon },
];

/** Re-exported so pages can keep importing Brand from the shell. */
export function Brand({ className }) {
  return <Logo className={className} />;
}

/** Live backend reachability — a red dot here explains any failing page at a glance. */
function BackendStatus({ compact = false }) {
  const [online, setOnline] = React.useState(null);

  React.useEffect(() => {
    let alive = true;
    const check = () =>
      api
        .health()
        .then(() => alive && setOnline(true))
        .catch(() => alive && setOnline(false));
    check();
    const id = setInterval(check, 20000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const label =
    online === null ? "Checking server" : online ? "Server connected" : "Server offline";

  return (
    <div
      className="flex items-center gap-2 text-xs text-muted-foreground"
      title={label}
      aria-live="polite"
    >
      {online === false ? (
        <WifiOff className="size-3.5 text-destructive" />
      ) : (
        <Wifi className={cn("size-3.5", online ? "text-[var(--safe)]" : "opacity-50")} />
      )}
      {!compact && <span>{label}</span>}
    </div>
  );
}

function NavItems({ onNavigate }) {
  return (
    <nav className="flex flex-col gap-1">
      {NAV.map(({ to, label, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          data-magnetic
          onClick={onNavigate}
          className={({ isActive }) =>
            cn(
              "group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
              "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
              isActive
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
            )
          }
        >
          {({ isActive }) => (
            <>
              <span
                aria-hidden
                className={cn(
                  "absolute top-1/2 left-0 h-5 w-0.5 -translate-y-1/2 rounded-r-full bg-primary transition-opacity",
                  isActive ? "opacity-100" : "opacity-0",
                )}
              />
              <Icon className="size-4 shrink-0" />
              {label}
            </>
          )}
        </NavLink>
      ))}
    </nav>
  );
}

export function AppShell() {
  const { user } = useAuth();
  const location = useLocation();
  // A continuously running WebGL shader costs battery, and on a safety app the
  // phone needs to last. Off is a real choice, remembered per device.
  const [animatedBg, setAnimatedBg] = React.useState(
    () => localStorage.getItem("protego.animatedBg") !== "0",
  );
  React.useEffect(() => {
    const sync = () => setAnimatedBg(localStorage.getItem("protego.animatedBg") !== "0");
    window.addEventListener("protego:bg-changed", sync);
    return () => window.removeEventListener("protego:bg-changed", sync);
  }, []);
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const [logoutOpen, setLogoutOpen] = React.useState(false);

  // Lock the page behind the drawer, otherwise scrolling the drawer scrolls the
  // page underneath it and the drawer appears to drift.
  React.useEffect(() => {
    if (!mobileOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onEsc = (e) => e.key === "Escape" && setMobileOpen(false);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener("keydown", onEsc);
    };
  }, [mobileOpen]);

  function handleSignOut() {
    setMobileOpen(false);
    setLogoutOpen(true);
  }

  return (
    <MagneticCursor magneticFactor={0.3} cursorSize={26} blendMode="exclusion">
    <div className="min-h-dvh">
      {/*
        App-wide backdrop. It sits behind the content, never over it, so the
        map and route colours stay legible on top of their own card surfaces.
      */}
      <div aria-hidden className="fixed inset-0 -z-10">
        {animatedBg ? <MeshBackground speed={0.45} /> : <StaticMeshBackground />}
        {/*
          Holds text contrast steady as the gradient drifts underneath, but
          lighter than it was: at 78% the colour flattened to a uniform murk and
          the palette may as well not have existed. Text sitting directly on the
          backdrop still clears contrast at 68%, since anything denser than a
          heading sits on a card.
        */}
        <div className="absolute inset-0 bg-[color-mix(in_oklab,var(--background)_68%,transparent)]" />
      </div>

      {/* ---- Desktop sidebar ---- */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-border/70 bg-card px-4 py-5 lg:flex">
        <Brand className="px-2" />
        <Separator className="my-5" />
        <NavItems />
        <div className="mt-auto space-y-3">
          <BackendStatus />
          <Separator />
          <div className="flex items-center gap-3 rounded-lg px-2 py-1.5">
            <Avatar name={user?.name} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{user?.name ?? "Guest"}</p>
              <p className="truncate text-xs text-muted-foreground">{user?.email}</p>
            </div>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={handleSignOut}
              data-magnetic
              aria-label="Sign out"
              title="Sign out"
            >
              <LogOut className="size-4" />
            </Button>
          </div>
        </div>
      </aside>

      {/* ---- Mobile top bar ---- */}
      <header className="sticky top-0 z-40 flex h-14 items-center justify-between border-b border-border/70 bg-card px-4 pt-[env(safe-area-inset-top)] lg:hidden">
        <Brand />
        <div className="flex items-center gap-2">
          <BackendStatus compact />
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setMobileOpen(true)}
            aria-label="Open menu"
            aria-expanded={mobileOpen}
          >
            <Menu className="size-5" />
          </Button>
        </div>
      </header>

      {/* ---- Mobile drawer ---- */}
      {mobileOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            aria-label="Close menu"
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setMobileOpen(false)}
          />
          <div className="animate-rise surface absolute inset-y-0 left-0 flex w-72 flex-col border-r border-border px-4 py-5">
            <div className="flex items-center justify-between">
              <Brand />
              <Button variant="ghost" size="icon-sm" onClick={() => setMobileOpen(false)}>
                <X className="size-4" />
              </Button>
            </div>
            <Separator className="my-5" />
            <NavItems onNavigate={() => setMobileOpen(false)} />
            <div className="mt-auto">
              <Separator className="mb-3" />
              <div className="flex items-center gap-3">
                <Avatar name={user?.name} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{user?.name ?? "Guest"}</p>
                  <p className="truncate text-xs text-muted-foreground">{user?.email}</p>
                </div>
                <Button variant="ghost" size="icon-sm" onClick={handleSignOut} aria-label="Sign out">
                  <LogOut className="size-4" />
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <LogoutDialog open={logoutOpen} onOpenChange={setLogoutOpen} />

      <main className="lg:pl-64">
        {/* pb clears the fixed bottom bar (its height plus the home indicator). */}
        <div className="mx-auto w-full max-w-6xl px-4 py-6 pb-[calc(4.5rem+env(safe-area-inset-bottom))] sm:px-6 lg:px-8 lg:py-8 lg:pb-8">
          <ErrorBoundary resetKey={location.pathname}>
            <Outlet />
          </ErrorBoundary>
        </div>
      </main>

      <MobileNav />
    </div>
    </MagneticCursor>
  );
}
