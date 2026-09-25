import { Camera, Trash2, ShieldAlert, Loader2, Image as ImageIcon, Download, Timer } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardDescription } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState, Skeleton } from "@/components/ui/misc";
import { CameraCapture } from "@/components/CameraCapture";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { FALLBACK_POSITION, useGeolocation } from "@/lib/geo";
import { formatTime } from "@/lib/utils";

export default function Evidence() {
  const { user } = useAuth();
  const { position, accuracy } = useGeolocation({ watch: false });

  const [items, setItems] = React.useState(null);
  const [error, setError] = React.useState(null);
  const [cameraOpen, setCameraOpen] = React.useState(false);
  const [pendingType, setPendingType] = React.useState("NORMAL");
  const [initialAutoMode, setInitialAutoMode] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [preview, setPreview] = React.useState(null);

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

  function startCapture(type, auto = false) {
    setPendingType(type);
    setInitialAutoMode(auto);
    setCameraOpen(true);
  }

  async function onCapture(dataUrl, captureType) {
    const p = position ?? FALLBACK_POSITION;
    const finalType = captureType === "AUTO" ? "AUTO_CAPTURE" : (pendingType || "NORMAL");
    setSaving(true);
    try {
      await api.saveEvidence({
        user_id: user?.id,
        image_base64: dataUrl,
        lat: p.lat,
        lng: p.lng,
        accuracy: accuracy ?? null,
        type: finalType,
        timestamp: Math.floor(Date.now() / 1000),
      });
      toast.success(
        finalType === "SOS"
          ? "SOS evidence saved"
          : finalType === "AUTO_CAPTURE"
          ? "10s Auto-captured photo saved to vault"
          : "Evidence saved to your vault",
      );
      load();
    } catch (err) {
      toast.error("Could not save evidence", { description: err.message });
    } finally {
      setSaving(false);
    }
  }

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

  return (
    <div className="animate-rise space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Evidence vault</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Photos stamped with the time, your coordinates and GPS accuracy.
          </p>
        </div>
        <div className="flex flex-wrap w-full gap-2 sm:w-auto">
          <Button
            variant="outline"
            className="flex-1 sm:flex-none"
            onClick={() => startCapture("NORMAL", false)}
            disabled={saving}
          >
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Camera className="size-4" />}
            Capture
          </Button>
          <Button
            variant="secondary"
            className="flex-1 sm:flex-none border border-red-500/30 text-foreground"
            onClick={() => startCapture("AUTO_CAPTURE", true)}
            disabled={saving}
          >
            <Timer className="size-4 text-red-500" />
            10s Auto-Capture
          </Button>
          <Button
            variant="destructive"
            className="flex-1 sm:flex-none"
            onClick={() => startCapture("SOS", false)}
            disabled={saving}
          >
            <ShieldAlert className="size-4" />
            SOS capture
          </Button>
        </div>
      </header>

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
          description="Capture a photo and ProTego stores it with a timestamp and your exact coordinates, so it holds up later."
          action={
            <Button onClick={() => startCapture("NORMAL")}>
              <Camera className="size-4" />
              Capture evidence
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
                ) : item.type === "AUTO_CAPTURE" || item.type === "AUTO" ? (
                  <Badge variant="outline" className="absolute top-2 left-2 backdrop-blur-sm bg-red-500/20 text-red-300 border-red-500/40 gap-1 text-[10px]">
                    <Timer className="size-3" />
                    AUTO 10s
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

      <CameraCapture
        open={cameraOpen}
        onOpenChange={setCameraOpen}
        onCapture={onCapture}
        initialAutoMode={initialAutoMode}
      />

      <Dialog open={Boolean(preview)} onOpenChange={(v) => !v && setPreview(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              Evidence
              {preview?.type === "SOS" ? (
                <Badge variant="risk">SOS</Badge>
              ) : preview?.type === "AUTO_CAPTURE" || preview?.type === "AUTO" ? (
                <Badge variant="outline" className="bg-red-500/20 text-red-300 border-red-500/40">
                  Auto-Captured (10s)
                </Badge>
              ) : null}
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
