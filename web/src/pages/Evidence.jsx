import * as React from "react";
import {
  Camera,
  Trash2,
  ShieldAlert,
  Image as ImageIcon,
  Download,
  Square,
  Flashlight,
  FlashlightOff,
  Moon,
  CloudUpload,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardDescription } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState, Skeleton } from "@/components/ui/misc";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useGuardian, CAPTURE_INTERVAL_MS } from "@/lib/guardian";
import { cn, formatTime } from "@/lib/utils";

const EVERY_S = Math.round(CAPTURE_INTERVAL_MS / 1000);

export default function Evidence() {
  const { user } = useAuth();
  const { burst, panic, streamId, startBurst, stopBurst, setTorch, attachPreview } =
    useGuardian();

  const [items, setItems] = React.useState(null);
  const [error, setError] = React.useState(null);
  const [preview, setPreview] = React.useState(null);
  const videoRef = React.useRef(null);

  const load = React.useCallback(async () => {
    if (!user?.id) return;
    try {
      setError(null);
      setItems(await api.listEvidence(user.id));
    } catch (err) {
      setError(err.message);
      setItems([]);
    }
  }, [user?.id]);

  React.useEffect(() => {
    load();
  }, [load]);

  // Point the preview at the shared stream once it is actually open.
  React.useEffect(() => {
    if (burst.active) attachPreview(videoRef.current);
  }, [burst.active, streamId, attachPreview]);

  // Refresh the grid when capture ends. Not per frame: every item carries its
  // full base64 image, so re-fetching the vault every 5s would be brutal.
  const wasActive = React.useRef(false);
  React.useEffect(() => {
    if (wasActive.current && !burst.active) load();
    wasActive.current = burst.active;
  }, [burst.active, load]);

  async function remove(id) {
    if (!confirm("Delete this evidence permanently?")) return;
    try {
      await api.deleteEvidence(id);
      toast.success("Evidence deleted");
      load();
    } catch (err) {
      toast.error("Could not delete", { description: err.message });
    }
  }

  function stop() {
    stopBurst();
    toast.success(`Capture stopped · ${burst.saved} photo${burst.saved === 1 ? "" : "s"} saved`);
  }

  return (
    <div className="animate-rise space-y-5">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Evidence vault</h1>
      </header>

      {/* ---- Recorder ---- */}
      <Card className="overflow-hidden p-0">
        <div className="relative aspect-video w-full bg-black sm:aspect-[21/9]">
          {burst.active ? (
            <>
              <video
                ref={videoRef}
                playsInline
                muted
                autoPlay
                className="size-full object-cover"
              />
              <div className="absolute top-3 left-3 flex items-center gap-1.5 rounded-full bg-black/65 px-2.5 py-1 text-[11px] font-medium text-white backdrop-blur-sm">
                <span className="size-2 animate-pulse rounded-full bg-destructive" />
                Recording · every {EVERY_S}s
              </div>
              <div className="absolute right-3 bottom-3 flex flex-wrap justify-end gap-1.5">
                <Chip icon={Camera} label={`${burst.saved} saved`} />
                {burst.pending ? <Chip icon={CloudUpload} label={`${burst.pending}↑`} /> : null}
                {burst.night ? <Chip icon={Moon} label="Night mode" /> : null}
              </div>
            </>
          ) : (
            <div className="flex size-full flex-col items-center justify-center gap-3 px-6 text-center">
              <Camera className="size-8 text-white/35" />
              {burst.error ? (
                <p className="max-w-sm text-sm text-white/60">{burst.error}</p>
              ) : null}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-border/70 p-3 sm:p-4">
          {burst.active ? (
            <>
              <Button variant="destructive" onClick={stop} className="flex-1 sm:flex-none">
                <Square className="size-4" />
                Stop capture
              </Button>
              <Button
                variant="outline"
                onClick={() => setTorch(!burst.torch)}
                disabled={!burst.torchSupported}
                title={burst.torchSupported ? undefined : "This device exposes no flash control"}
              >
                {burst.torch ? (
                  <Flashlight className="size-4" />
                ) : (
                  <FlashlightOff className="size-4" />
                )}
                Flash
              </Button>
            </>
          ) : (
            <>
              <Button onClick={() => startBurst("NORMAL")} className="flex-1 sm:flex-none">
                <Camera className="size-4" />
                Start capturing
              </Button>
              <Button variant="destructive" onClick={() => startBurst("SOS")}>
                <ShieldAlert className="size-4" />
                Capture as SOS
              </Button>
            </>
          )}
          {burst.failed ? (
            <span className="tnum text-xs text-[var(--caution)]">
              {burst.failed} held offline — they upload when the server is back
            </span>
          ) : null}
          {panic.active ? (
            <span className="text-xs text-destructive">Emergency mode is driving the camera</span>
          ) : null}
        </div>
      </Card>

      {/* ---- Vault ---- */}
      {items === null ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="aspect-4/3 w-full rounded-xl" />
          ))}
        </div>
      ) : error ? (
        <p
          role="alert"
          className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          {error}
        </p>
      ) : items.length === 0 ? (
        <EmptyState
          icon={ImageIcon}
          title="Your vault is empty"
          description="Start capturing and every photo is stored with a timestamp and your exact coordinates, so it holds up later."
          action={
            <Button onClick={() => startBurst("NORMAL")}>
              <Camera className="size-4" />
              Start capturing
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => (
            <Card key={item.id} className="overflow-hidden p-0">
              <button
                type="button"
                onClick={() => setPreview(item)}
                className="group relative block aspect-4/3 w-full overflow-hidden bg-black focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                <img
                  src={item.image_base64}
                  alt={`Evidence captured ${formatTime(item.timestamp)}`}
                  loading="lazy"
                  className="size-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                />
                {item.type === "SOS" ? (
                  <Badge variant="risk" className="absolute top-2 left-2 backdrop-blur-sm">
                    <ShieldAlert />
                    SOS
                  </Badge>
                ) : null}
              </button>

              <div className="flex items-center justify-between gap-2 px-3.5 py-2.5">
                <span className="tnum truncate text-xs text-muted-foreground">
                  {formatTime(item.timestamp)}
                </span>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Delete this evidence"
                  onClick={() => remove(item.id)}
                >
                  <Trash2 className="size-3.5 text-muted-foreground" />
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={Boolean(preview)} onOpenChange={(v) => !v && setPreview(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              Evidence
              {preview?.type === "SOS" ? <Badge variant="risk">SOS</Badge> : null}
            </DialogTitle>
            <CardDescription className="tnum">{formatTime(preview?.timestamp)}</CardDescription>
          </DialogHeader>
          {preview ? (
            <>
              <img
                src={preview.image_base64}
                alt="Evidence full size"
                className="w-full rounded-lg border border-border"
              />
              <Button asChild variant="outline" className="mt-4 w-fit">
                <a href={preview.image_base64} download={`protego-evidence-${preview.id}.jpg`}>
                  <Download className="size-4" />
                  Download
                </a>
              </Button>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Chip({ icon: Icon, label }) {
  return (
    <span
      className={cn(
        "tnum inline-flex items-center gap-1.5 rounded-full bg-black/65 px-2.5 py-1",
        "text-[11px] font-medium text-white backdrop-blur-sm",
      )}
    >
      <Icon className="size-3.5" />
      {label}
    </span>
  );
}
