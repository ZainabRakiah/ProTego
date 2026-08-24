import * as React from "react";
import { Camera, RefreshCw, Check, Upload, VideoOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * Camera sheet that returns a JPEG data URL.
 *
 * getUserMedia needs a secure context, so on plain http://<lan-ip> it will
 * fail. The file picker fallback is always offered for exactly that case.
 */
export function CameraCapture({ open, onOpenChange, onCapture }) {
  const videoRef = React.useRef(null);
  const canvasRef = React.useRef(null);
  const streamRef = React.useRef(null);
  const fileRef = React.useRef(null);

  const [shot, setShot] = React.useState(null);
  const [error, setError] = React.useState(null);

  const stop = React.useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  React.useEffect(() => {
    if (!open) {
      stop();
      setShot(null);
      setError(null);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
      } catch {
        if (!cancelled) {
          setError(
            "Camera unavailable. Browsers only allow it on https or localhost — you can upload a photo instead.",
          );
        }
      }
    })();

    return () => {
      cancelled = true;
      stop();
    };
  }, [open, stop]);

  function takeShot() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !video.videoWidth) return;
    // Cap the long edge: these are stored base64 in SQLite, so size matters.
    const maxEdge = 1280;
    const scale = Math.min(1, maxEdge / Math.max(video.videoWidth, video.videoHeight));
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
    setShot(canvas.toDataURL("image/jpeg", 0.82));
  }

  function onFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setShot(String(reader.result));
    reader.readAsDataURL(file);
  }

  function confirm() {
    if (!shot) return;
    onCapture(shot);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Capture evidence</DialogTitle>
          <DialogDescription>
            The photo is stamped with the time and your coordinates when you save it.
          </DialogDescription>
        </DialogHeader>

        <div className="overflow-hidden rounded-xl border border-border bg-black">
          {shot ? (
            <img src={shot} alt="Captured evidence preview" className="aspect-video w-full object-contain" />
          ) : error ? (
            <div className="flex aspect-video flex-col items-center justify-center gap-3 px-6 text-center">
              <VideoOff className="size-7 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">{error}</p>
            </div>
          ) : (
            <video
              ref={videoRef}
              playsInline
              muted
              className="aspect-video w-full bg-black object-cover"
            />
          )}
        </div>
        <canvas ref={canvasRef} className="hidden" />

        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={onFile}
          className="hidden"
        />

        <DialogFooter>
          <Button variant="outline" onClick={() => fileRef.current?.click()}>
            <Upload className="size-4" />
            Upload instead
          </Button>

          {shot ? (
            <>
              <Button variant="outline" onClick={() => setShot(null)}>
                <RefreshCw className="size-4" />
                Retake
              </Button>
              <Button onClick={confirm}>
                <Check className="size-4" />
                Use this photo
              </Button>
            </>
          ) : (
            <Button onClick={takeShot} disabled={Boolean(error)}>
              <Camera className="size-4" />
              Capture
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
