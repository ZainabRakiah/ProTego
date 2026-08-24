import * as React from "react";
import { Lightbulb, Cctv, ShieldCheck, TriangleAlert, MapPinned } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/misc";
import { SafetyBar } from "@/components/SafetyMeter";
import { api } from "@/lib/api";
import { reverseGeocode } from "@/lib/geo";
import { BAND_META, formatDistance, normalizeScore, safetyBand } from "@/lib/utils";

/**
 * "Geographic" read-out for a point: where it is administratively, and the raw
 * features the safety model used to score it. Shows the model's reasoning
 * rather than just its verdict.
 */
export function AreaPanel({ position }) {
  const [place, setPlace] = React.useState(null);
  const [safety, setSafety] = React.useState(null);
  const [loading, setLoading] = React.useState(true);

  const key = position ? `${position.lat.toFixed(3)},${position.lng.toFixed(3)}` : null;

  React.useEffect(() => {
    if (!position) return;
    const ctl = new AbortController();
    let alive = true;
    setLoading(true);

    Promise.allSettled([
      reverseGeocode(position, ctl.signal),
      api.safetyPoint(position.lat, position.lng, new Date().getHours()),
    ]).then(([p, s]) => {
      if (!alive) return;
      if (p.status === "fulfilled") setPlace(p.value);
      if (s.status === "fulfilled") setSafety(s.value);
      setLoading(false);
    });

    return () => {
      alive = false;
      ctl.abort();
    };
  }, [key]);

  const score = normalizeScore(safety?.score);
  const band = safetyBand(score);
  const f = safety?.features ?? {};

  const rows = [
    {
      icon: Lightbulb,
      label: "Street lamps",
      value: f.lamp_count_500m,
      hint: "within 500 m",
      good: (v) => v >= 5,
    },
    {
      icon: Cctv,
      label: "Surveillance cameras",
      value: f.camera_count_500m,
      hint: "within 500 m",
      good: (v) => v >= 10,
    },
    {
      icon: ShieldCheck,
      label: "Police presence",
      value: f.police_count_500m,
      hint: "within 500 m",
      good: (v) => v >= 1,
    },
    {
      icon: TriangleAlert,
      label: "Reported incidents",
      value: f.incident_count_500m,
      hint: "within 500 m",
      good: (v) => v <= 10,
    },
  ];

  const locationLine = place
    ? [place.locality, place.city, place.state].filter(Boolean).join(", ")
    : null;

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
        <div className="min-w-0">
          <CardTitle>Area details</CardTitle>
          <CardDescription className="mt-1 flex items-start gap-1.5">
            <MapPinned className="mt-0.5 size-3.5 shrink-0" />
            <span className="min-w-0 truncate">
              {loading ? "Looking up this area…" : (locationLine ?? "Unknown area")}
            </span>
          </CardDescription>
        </div>
        {!loading && score !== null ? (
          <Badge variant={band === "unknown" ? "outline" : band}>{BAND_META[band].label}</Badge>
        ) : null}
      </CardHeader>

      <CardContent className="space-y-4">
        <div>
          <div className="mb-1.5 flex items-baseline justify-between">
            <span className="text-xs text-muted-foreground">Safety score</span>
            {safety?.nearest_police_km !== undefined ? (
              <span className="text-xs text-muted-foreground">
                Police {formatDistance(safety.nearest_police_km)}
              </span>
            ) : null}
          </div>
          {loading ? <Skeleton className="h-4 w-full" /> : <SafetyBar score={score} />}
        </div>

        <dl className="space-y-1.5">
          {rows.map(({ icon: Icon, label, value, hint, good }) => (
            <div
              key={label}
              className="flex items-center gap-3 rounded-lg border border-border/60 bg-background/30 px-3 py-2"
            >
              <Icon className="size-4 shrink-0 text-muted-foreground" />
              <dt className="min-w-0 flex-1">
                <span className="block truncate text-sm">{label}</span>
                <span className="block text-xs text-muted-foreground">{hint}</span>
              </dt>
              <dd className="shrink-0">
                {loading || value === undefined ? (
                  <Skeleton className="h-5 w-8" />
                ) : (
                  <span
                    className="tnum text-sm font-semibold"
                    style={{ color: good(value) ? "var(--safe)" : "var(--caution)" }}
                  >
                    {value}
                  </span>
                )}
              </dd>
            </div>
          ))}
        </dl>

        {f.is_night !== undefined && !loading ? (
          <p className="text-xs text-muted-foreground">
            Scored as {f.is_night ? "night-time" : "daytime"} conditions.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
