import * as React from "react";
import { Camera, RefreshCw, Check, Upload, VideoOff, Play, Square, Timer, Zap, ZapOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * Camera sheet with manual capture, 5-second interval auto-capture & auto-torch/flashlight support.
 */
export function CameraCapture({ open, onOpenChange, onCapture, initialAutoMode = false, autoTorch = false }) {
  const videoRef = React.useRef(null);
  const canvasRef = React.useRef(null);
  const streamRef = React.useRef(null);
  const fileRef = React.useRef(null);

  const [shot, setShot] = React.useState(null);
  const [error, setError] = React.useState(null);

  // 5-second auto capture states
  const [isAutoActive, setIsAutoActive] = React.useState(initialAutoMode);
  const [countdown, setCountdown] = React.useState(5);
  const [autoCount, setAutoCount] = React.useState(0);

  // Torch / Flashlight state
  const [torchSupported, setTorchSupported] = React.useState(false);
  const [isTorchOn, setIsTorchOn] = React.useState(false);

  const onCaptureRef = React.useRef(onCapture);
  React.useEffect(() => {
    onCaptureRef.current = onCapture;
  }, [onCapture]);

  const stop = React.useCallback(() => {
    if (streamRef.current) {
      const track = streamRef.current.getVideoTracks()[0];
      if (track && typeof track.applyConstraints === "function") {
        track.applyConstraints({ advanced: [{ torch: false }] }).catch(() => {});
      }
      streamRef.current.getTracks().forEach((t) => t.stop());
    }
    streamRef.current = null;
    setIsTorchOn(false);
    setTorchSupported(false);
  }, []);

  React.useEffect(() => {
    if (open && initialAutoMode) {
      setIsAutoActive(true);
    }
  }, [open, initialAutoMode]);

  const toggleTorch = async (desiredState) => {
    if (!streamRef.current) return;
    const track = streamRef.current.getVideoTracks()[0];
    if (!track) return;
    const targetState = desiredState !== undefined ? desiredState : !isTorchOn;
    try {
      if (typeof track.applyConstraints === "function") {
        await track.applyConstraints({ advanced: [{ torch: targetState }] });
        setIsTorchOn(targetState);
      }
    } catch (err) {
      console.warn("Torch toggle failed:", err);
    }
  };

  React.useEffect(() => {
    if (!open) {
      stop();
      setShot(null);
      setError(null);
      setIsAutoActive(false);
      setCountdown(5);
      setAutoCount(0);
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

        // Check torch capability & auto-enable torch when autoTorch or initialAutoMode is requested
        const track = stream.getVideoTracks()[0];
        if (track) {
          const capabilities = typeof track.getCapabilities === "function" ? track.getCapabilities() : {};
          const supportsTorch = Boolean(capabilities.torch);
          setTorchSupported(supportsTorch);

          if (autoTorch || initialAutoMode || supportsTorch) {
            try {
              if (typeof track.applyConstraints === "function") {
                await track.applyConstraints({ advanced: [{ torch: true }] });
                setIsTorchOn(true);
              }
            } catch (torchErr) {
              console.warn("Auto torch activation notice:", torchErr);
            }
          }
        }
      } catch {
        if (!cancelled) {
          setError(
            "Camera unavailable. Browsers require https or localhost — you can upload a photo instead.",
          );
        }
      }
    })();

    return () => {
      cancelled = true;
      stop();
    };
  }, [open, stop, autoTorch, initialAutoMode]);

  // Helper to extract JPEG data URL from video stream
  const getCanvasShot = React.useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !video.videoWidth) return null;
    const maxEdge = 1280;
    const scale = Math.min(1, maxEdge / Math.max(video.videoWidth, video.videoHeight));
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.82);
  }, []);

  // 5-Second Auto-Capture Loop
  React.useEffect(() => {
    if (!open || !isAutoActive || error) return;

    setCountdown(5);
    const interval = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          // Trigger capture
          const dataUrl = getCanvasShot();
          if (dataUrl && onCaptureRef.current) {
            onCaptureRef.current(dataUrl, "AUTO");
            setAutoCount((c) => c + 1);
          }
          return 5;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [open, isAutoActive, error, getCanvasShot]);

  function takeShot() {
    const dataUrl = getCanvasShot();
    if (dataUrl) setShot(dataUrl);
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
    onCapture(shot, "NORMAL");
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between gap-2 flex-wrap">
            <span className="flex items-center gap-2">
              Capture evidence
              {isTorchOn && (
                <Badge variant="outline" className="bg-amber-500/10 border-amber-500/40 text-amber-400 gap-1 text-[11px]">
                  <Zap className="size-3 fill-amber-400" /> Torch Active
                </Badge>
              )}
            </span>
            {isAutoActive && (
              <Badge variant="outline" className="bg-red-500/10 border-red-500/40 text-red-400 gap-1.5 animate-pulse">
                <Timer className="size-3.5" />
                5s Auto-Capture ({countdown}s) • Saved: {autoCount}
              </Badge>
            )}
          </DialogTitle>
          <DialogDescription>
            Photos are stamped with exact time and coordinates when saved to your vault. Flashlight activates automatically during night SOS.
          </DialogDescription>
        </DialogHeader>

        <div className="relative overflow-hidden rounded-xl border border-border bg-black">
          {shot ? (
            <img src={shot} alt="Captured evidence preview" className="aspect-video w-full object-contain" />
          ) : error ? (
            <div className="flex aspect-video flex-col items-center justify-center gap-3 px-6 text-center">
              <VideoOff className="size-7 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">{error}</p>
            </div>
          ) : (
            <>
              <video
                ref={videoRef}
                playsInline
                muted
                className="aspect-video w-full bg-black object-cover"
              />
              <div className="absolute top-3 right-3 flex items-center gap-2">
                {isAutoActive && (
                  <div className="flex items-center gap-2 rounded-full bg-black/70 px-3 py-1.5 backdrop-blur-md text-xs font-semibold text-white border border-white/20">
                    <div className="size-2 rounded-full bg-red-500 animate-ping" />
                    Auto-capturing in {countdown}s
                  </div>
                )}
                {torchSupported && (
                  <Button
                    type="button"
                    size="icon"
                    variant={isTorchOn ? "warning" : "secondary"}
                    onClick={() => toggleTorch()}
                    title="Toggle Flashlight / Torch"
                    className="size-8 rounded-full bg-black/70 backdrop-blur-md border border-white/20 text-amber-400 hover:bg-black/90"
                  >
                    {isTorchOn ? <Zap className="size-4 fill-amber-400" /> : <ZapOff className="size-4" />}
                  </Button>
                )}
              </div>
            </>
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

        <DialogFooter className="flex flex-col sm:flex-row gap-2 sm:justify-between">
          <Button variant="outline" onClick={() => fileRef.current?.click()}>
            <Upload className="size-4" />
            Upload file
          </Button>

          <div className="flex items-center gap-2">
            {!error && !shot && (
              <>
                {torchSupported && (
                  <Button
                    variant={isTorchOn ? "outline" : "secondary"}
                    onClick={() => toggleTorch()}
                    className="gap-1.5 border-amber-500/40 text-amber-400"
                  >
                    {isTorchOn ? <ZapOff className="size-4" /> : <Zap className="size-4 fill-amber-400" />}
                    {isTorchOn ? "Torch Off" : "Torch On"}
                  </Button>
                )}
                <Button
                  variant={isAutoActive ? "destructive" : "secondary"}
                  onClick={() => setIsAutoActive(!isAutoActive)}
                  className="gap-1.5"
                >
                  {isAutoActive ? (
                    <>
                      <Square className="size-4" />
                      Stop 5s Auto
                    </>
                  ) : (
                    <>
                      <Play className="size-4" />
                      Start 5s Auto
                    </>
                  )}
                </Button>
              </>
            )}

            {shot ? (
              <>
                <Button variant="outline" onClick={() => setShot(null)}>
                  <RefreshCw className="size-4" />
                  Retake
                </Button>
                <Button onClick={confirm}>
                  <Check className="size-4" />
                  Save Photo
                </Button>
              </>
            ) : (
              <Button onClick={takeShot} disabled={Boolean(error)}>
                <Camera className="size-4" />
                Capture Single
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
