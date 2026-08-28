import * as React from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/misc";
import { SafetyMeter } from "@/components/SafetyMeter";
import { SosButton } from "@/components/SosButton";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { FALLBACK_POSITION, useGeolocation } from "@/lib/geo";
import { normalizeScore, safetyBand, BAND_META } from "@/lib/utils";

function greeting() {
  const h = new Date().getHours();
  if (h < 5) return "You're out late";
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  if (h < 21) return "Good evening";
  return "Travelling tonight";
}

/**
 * Deliberately two things only: how safe it is where you are, and the button
 * that calls for help. Everything else lives one tap away in the nav — a
 * dashboard someone opens mid-walk should not need reading.
 */
export default function Dashboard() {
  const { user } = useAuth();
  const { position } = useGeolocation();
  const here = position ?? FALLBACK_POSITION;

  const [safety, setSafety] = React.useState(null);
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState(null);

  React.useEffect(() => {
    let alive = true;
    setLoading(true);
    setLoadError(null);

    api
      .safetyPoint(here.lat, here.lng, new Date().getHours())
      .then((s) => alive && setSafety(s))
      .catch((err) => alive && setLoadError(err?.message ?? "Could not load the safety score."))
      .finally(() => alive && setLoading(false));

    return () => {
      alive = false;
    };
    // Re-score only on a meaningful move (~100m), not on every GPS jitter.
  }, [here.lat.toFixed(3), here.lng.toFixed(3)]);

  const score = normalizeScore(safety?.score);
  const band = safetyBand(score);

  return (
    <div className="animate-rise mx-auto max-w-3xl space-y-5">
      <header>
        <p className="text-sm text-muted-foreground">{greeting()},</p>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          {user?.name?.split(" ")[0] ?? "there"}
        </h1>
      </header>

      <Card>
        <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
          <div>
            <CardTitle>Safety score</CardTitle>
            <CardDescription className="mt-1">Scored for right here, right now.</CardDescription>
          </div>
          <Badge variant={band === "unknown" ? "outline" : band}>
            <span className="size-1.5 rounded-full" style={{ background: BAND_META[band].color }} />
            {BAND_META[band].label}
          </Badge>
        </CardHeader>
        <CardContent className="flex justify-center pb-7">
          {loading ? (
            <Skeleton className="size-[148px] rounded-full" />
          ) : (
            <SafetyMeter score={score} />
          )}
        </CardContent>
        {loadError ? (
          <CardContent className="pt-0">
            <p
              role="alert"
              className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive"
            >
              {loadError}
            </p>
          </CardContent>
        ) : null}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Emergency</CardTitle>
          <CardDescription>
            Logs your exact location, turns on the flash and starts capturing evidence.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex justify-center pb-8">
          <SosButton />
        </CardContent>
      </Card>
    </div>
  );
}
