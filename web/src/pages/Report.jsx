import * as React from "react";
import { Camera, Loader2, MapPin, Send, Check, X, Info } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CameraCapture } from "@/components/CameraCapture";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { FALLBACK_POSITION, useGeolocation } from "@/lib/geo";
import { cn } from "@/lib/utils";

/** The categories the safety model cares about, in rough severity order. */
const CATEGORIES = [
  { id: "harassment", label: "Harassment" },
  { id: "stalking", label: "Being followed" },
  { id: "poor-lighting", label: "Poor lighting" },
  { id: "theft", label: "Theft / snatching" },
  { id: "unsafe-crowd", label: "Unsafe crowd" },
  { id: "other", label: "Something else" },
];

export default function Report() {
  const { user } = useAuth();
  const { position } = useGeolocation({ watch: false });
  const here = position ?? FALLBACK_POSITION;

  const [category, setCategory] = React.useState("harassment");
  const [label, setLabel] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [photo, setPhoto] = React.useState(null);
  const [cameraOpen, setCameraOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [done, setDone] = React.useState(false);
  const [error, setError] = React.useState(null);

  async function onSubmit(e) {
    e.preventDefault();
    setError(null);

    if (description.trim().length < 10) {
      setError("Add a bit more detail — at least a sentence helps the model learn.");
      return;
    }

    setBusy(true);
    try {
      const chosen = CATEGORIES.find((c) => c.id === category);
      await api.createReport({
        user_id: user?.id ?? 0,
        location_label: label.trim() || chosen.label,
        lat: here.lat,
        lng: here.lng,
        // Prefix the category so it survives into the free-text field the model reads.
        description: `[${chosen.label}] ${description.trim()}`,
        image_base64: photo,
        timestamp: Math.floor(Date.now() / 1000),
      });

      setDone(true);
      toast.success("Report submitted", {
        description: "The safety model retrains shortly and this area gets rescored.",
      });
      setDescription("");
      setLabel("");
      setPhoto(null);
      setTimeout(() => setDone(false), 5000);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="animate-rise mx-auto max-w-2xl space-y-5">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Report an incident</h1>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>What happened?</CardTitle>
        </CardHeader>

        <CardContent>
          <form onSubmit={onSubmit} className="space-y-5" noValidate>
            <fieldset className="space-y-2">
              <legend className="mb-2 text-sm leading-none font-medium">Category</legend>
              <div className="flex flex-wrap gap-2">
                {CATEGORIES.map((c) => {
                  const active = category === c.id;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => setCategory(c.id)}
                      aria-pressed={active}
                      className={cn(
                        "rounded-full border px-3.5 py-1.5 text-sm transition-colors",
                        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                        active
                          ? "border-primary bg-primary/15 text-primary"
                          : "border-border text-muted-foreground hover:bg-accent hover:text-foreground",
                      )}
                    >
                      {c.label}
                    </button>
                  );
                })}
              </div>
            </fieldset>

            <div className="space-y-2">
              <Label htmlFor="place">
                Place name <span className="font-normal text-muted-foreground">(optional)</span>
              </Label>
              <Input
                id="place"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="e.g. Underpass near MG Road metro"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                required
                rows={5}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What did you see or experience? Time of day, lighting, how many people around…"
              />
              <p className="text-xs text-muted-foreground">
                {description.trim().length} characters
              </p>
            </div>

            <div className="space-y-2">
              <Label>Photo evidence (optional)</Label>
              {photo ? (
                <div className="relative overflow-hidden rounded-lg border border-border">
                  <img src={photo} alt="Attached evidence" className="max-h-56 w-full object-cover" />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon-sm"
                    className="absolute top-2 right-2"
                    onClick={() => setPhoto(null)}
                    aria-label="Remove photo"
                  >
                    <X className="size-3.5" />
                  </Button>
                </div>
              ) : (
                <Button type="button" variant="outline" onClick={() => setCameraOpen(true)}>
                  <Camera className="size-4" />
                  Add a photo
                </Button>
              )}
            </div>

            <div className="flex items-start gap-2.5 rounded-lg border border-border/60 bg-background/30 px-3 py-2.5 text-xs text-muted-foreground">
              <MapPin className="mt-0.5 size-3.5 shrink-0" />
              <span>
                Attaching{" "}
                <span className="tnum font-medium text-foreground">
                  {here.lat.toFixed(5)}, {here.lng.toFixed(5)}
                </span>
                {position ? "" : " — city centre, since your location is unavailable"}
              </span>
            </div>

            {error ? (
              <p
                role="alert"
                className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
              >
                {error}
              </p>
            ) : null}

            <Button type="submit" size="lg" className="w-full" disabled={busy || done}>
              {busy ? (
                <Loader2 className="size-4 animate-spin" />
              ) : done ? (
                <Check className="size-4" />
              ) : (
                <Send className="size-4" />
              )}
              {busy ? "Submitting…" : done ? "Report received" : "Submit report"}
            </Button>
          </form>
        </CardContent>
      </Card>

      <div className="flex items-start gap-2.5 rounded-lg border border-border/60 px-4 py-3 text-xs text-muted-foreground">
        <Info className="mt-0.5 size-3.5 shrink-0" />
        <p>
          Reports are stored locally in the project database. This is a prototype — in an
          emergency, call your local emergency number first.
        </p>
      </div>

      <CameraCapture open={cameraOpen} onOpenChange={setCameraOpen} onCapture={setPhoto} />
    </div>
  );
}
