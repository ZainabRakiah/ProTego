import * as React from "react";
import { Link } from "react-router-dom";
import {
  Navigation,
  Building2,
  ShieldCheck,
  FileWarning,
  Camera,
  Users,
  ArrowUpRight,
  MapPin,
  Clock,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/misc";
import { SafetyMeter } from "@/components/SafetyMeter";
import { SosButton } from "@/components/SosButton";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { FALLBACK_POSITION, useGeolocation } from "@/lib/geo";
import { formatDistance, normalizeScore, safetyBand, BAND_META } from "@/lib/utils";

function greeting() {
  const h = new Date().getHours();
  if (h < 5) return "You're out late";
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  if (h < 21) return "Good evening";
  return "Travelling tonight";
}

const SHORTCUTS = [
  {
    to: "/map",
    icon: Navigation,
    title: "Plan a safe route",
    body: "Score every path before you walk it.",
  },
  {
    to: "/report",
    icon: FileWarning,
    title: "Report an incident",
    body: "Your report retrains the safety model.",
  },
  {
    to: "/contacts",
    icon: Users,
    title: "Trusted circle",
    body: "Places you travel and who to notify.",
  },
  {
    to: "/evidence",
    icon: Camera,
    title: "Evidence vault",
    body: "Capture a timestamped, located photo.",
  },
];

export default function Dashboard() {
  const { user } = useAuth();
  const { position, error: geoError, loading: geoLoading } = useGeolocation();
  const here = position ?? FALLBACK_POSITION;

  const [safety, setSafety] = React.useState(null);
  const [hospitals, setHospitals] = React.useState(null);
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState(null);

  React.useEffect(() => {
    let alive = true;
    setLoading(true);
    setLoadError(null);

    Promise.allSettled([
      api.safetyPoint(here.lat, here.lng, new Date().getHours()),
      api.hospitalsNearby(here.lat, here.lng),
    ]).then(([s, h]) => {
      if (!alive) return;
      if (s.status === "fulfilled") setSafety(s.value);
      else setLoadError(s.reason?.message ?? "Could not load the safety score.");
      if (h.status === "fulfilled") setHospitals(h.value.hospitals ?? []);
      setLoading(false);
    });

    return () => {
      alive = false;
    };
    // Re-score only on a meaningful move (~100m), not on every GPS jitter.
  }, [here.lat.toFixed(3), here.lng.toFixed(3)]);

  const score = normalizeScore(safety?.score);
  const band = safetyBand(score);
  const nearestPolice = safety?.nearest_police_km;
  const nearestHospital = hospitals?.[0];

  return (
    <div className="animate-rise space-y-6">
      {/* ---- Header ---- */}
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-muted-foreground">{greeting()},</p>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            {user?.name?.split(" ")[0] ?? "there"}
          </h1>
        </div>
        <Button asChild size="lg" className="w-full sm:w-auto">
          <Link to="/map">
            <Navigation className="size-4" />
            Plan a safe route
          </Link>
        </Button>
      </header>

      {/* ---- Live status: score + SOS ---- */}
      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <Card className="overflow-hidden">
          <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
            <div>
              <CardTitle>Where you are right now</CardTitle>
              <CardDescription className="mt-1 flex items-center gap-1.5">
                <MapPin className="size-3.5" />
                {geoLoading
                  ? "Locating…"
                  : position
                    ? `${here.lat.toFixed(4)}, ${here.lng.toFixed(4)}`
                    : "City centre (location unavailable)"}
              </CardDescription>
            </div>
            <Badge variant={band === "unknown" ? "outline" : band}>
              <span
                className="size-1.5 rounded-full"
                style={{ background: BAND_META[band].color }}
              />
              {BAND_META[band].label}
            </Badge>
          </CardHeader>

          <CardContent className="flex flex-col items-center gap-6 sm:flex-row sm:items-center sm:gap-8">
            {loading ? (
              <Skeleton className="size-[148px] shrink-0 rounded-full" />
            ) : (
              <SafetyMeter score={score} className="shrink-0" />
            )}

            <div className="w-full flex-1 space-y-3">
              <StatRow
                icon={ShieldCheck}
                label="Nearest police station"
                value={loading ? null : formatDistance(nearestPolice)}
              />
              <StatRow
                icon={Building2}
                label="Nearest hospital"
                value={
                  loading
                    ? null
                    : nearestHospital
                      ? `${formatDistance(nearestHospital.distance_km)} · ${nearestHospital.name}`
                      : "No data"
                }
              />
              <StatRow
                icon={Clock}
                label="Scored for"
                value={
                  loading
                    ? null
                    : new Date().toLocaleTimeString(undefined, {
                        hour: "numeric",
                        minute: "2-digit",
                      })
                }
              />

              {geoError ? (
                <p className="rounded-lg border border-caution/30 bg-[color-mix(in_oklab,var(--caution)_12%,transparent)] px-3 py-2 text-xs text-[var(--caution)]">
                  {geoError}
                </p>
              ) : null}
              {loadError ? (
                <p
                  role="alert"
                  className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive"
                >
                  {loadError}
                </p>
              ) : null}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Emergency</CardTitle>
            <CardDescription>
              Logs your exact location and the nearest help.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col items-center justify-center pb-7">
            <SosButton position={position ?? FALLBACK_POSITION} kind="safety" />
          </CardContent>
        </Card>
      </div>

      {/* ---- Shortcuts ---- */}
      <section>
        <h2 className="mb-3 text-sm font-medium text-muted-foreground">Quick actions</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {SHORTCUTS.map(({ to, icon: Icon, title, body }) => (
            <Link
              key={to}
              to={to}
              className="group surface flex flex-col gap-2 rounded-xl border border-border/70 p-4 transition-all hover:-translate-y-0.5 hover:border-primary/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              <div className="flex items-start justify-between">
                <span className="grid size-9 place-items-center rounded-lg bg-primary/12 text-primary">
                  <Icon className="size-4" />
                </span>
                <ArrowUpRight className="size-4 text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
              </div>
              <div>
                <p className="text-sm font-medium">{title}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{body}</p>
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* ---- Nearby help ---- */}
      <Card>
        <CardHeader>
          <CardTitle>Nearest hospitals</CardTitle>
          <CardDescription>Ranked by straight-line distance from you.</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-2">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : hospitals?.length ? (
            <ul className="divide-y divide-border">
              {hospitals.slice(0, 5).map((h, i) => (
                <li key={`${h.name}-${i}`} className="flex items-center gap-3 py-2.5">
                  <span className="tnum w-5 text-xs text-muted-foreground">{i + 1}</span>
                  <span className="flex-1 truncate text-sm">{h.name}</span>
                  <span className="tnum shrink-0 text-sm text-muted-foreground">
                    {formatDistance(h.distance_km)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="py-4 text-sm text-muted-foreground">
              No hospital dataset is loaded on the server.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StatRow({ icon: Icon, label, value }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border/60 bg-background/30 px-3 py-2.5">
      <Icon className="size-4 shrink-0 text-muted-foreground" />
      <span className="flex-1 text-sm text-muted-foreground">{label}</span>
      {value === null ? (
        <Skeleton className="h-4 w-20" />
      ) : (
        <span className="tnum max-w-[55%] truncate text-sm font-medium">{value}</span>
      )}
    </div>
  );
}
