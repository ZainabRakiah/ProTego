/**
 * Continuous evidence camera.
 *
 * Evidence capture is not photography: a blurred, half-dark frame of someone's
 * face is still evidence, so nothing here rejects a frame. The camera opens
 * once, fires on a fixed interval, and every single frame goes to the upload
 * queue. Motion blur, underexposure and shaky framing are expected — a user
 * running from someone is not going to hold the phone steady.
 *
 * Kept as a plain class rather than a hook because the same stream is shared by
 * the evidence page and the shake-triggered panic flow, and it has to keep
 * running while the user navigates between them.
 */

/** How dark a frame has to be (mean luma, 0-255) before night mode kicks in. */
const NIGHT_LUMA = 62;
/** Long edge of a saved frame. These are stored base64, so size matters. */
const MAX_EDGE = 1280;

export class BurstCamera {
  constructor() {
    this.stream = null;
    this.track = null;
    this.video = null;
    this.canvas = null;
    this.timer = null;
    this.torchOn = false;
    this.running = false;
    this.frames = 0;
  }

  get torchSupported() {
    if (!this.track) return false;
    const caps = this.track.getCapabilities?.();
    return Boolean(caps && "torch" in caps);
  }

  /**
   * Opens the rear camera. Low-light hints are advisory: browsers silently drop
   * constraints they do not implement, which is why they sit in `advanced`.
   */
  async open() {
    if (this.stream) return this.stream;

    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 30 },
        advanced: [{ exposureMode: "continuous" }, { focusMode: "continuous" }],
      },
      audio: false,
    });

    this.stream = stream;
    this.track = stream.getVideoTracks()[0] ?? null;

    const video = document.createElement("video");
    video.playsInline = true;
    video.muted = true;
    video.srcObject = stream;
    await video.play().catch(() => {});
    this.video = video;

    this.canvas = document.createElement("canvas");
    return stream;
  }

  /** Mirrors the live stream into a <video> the UI owns, without stealing it. */
  attach(el) {
    if (el && this.stream && el.srcObject !== this.stream) {
      el.srcObject = this.stream;
      el.play?.().catch(() => {});
    }
  }

  async setTorch(on) {
    if (!this.torchSupported) return false;
    try {
      await this.track.applyConstraints({ advanced: [{ torch: Boolean(on) }] });
      this.torchOn = Boolean(on);
      return true;
    } catch {
      return false;
    }
  }

  /** Mean luma of a 32px thumbnail — cheap enough to run on every frame. */
  #meanLuma(video) {
    const c = document.createElement("canvas");
    c.width = 32;
    c.height = 32;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(video, 0, 0, 32, 32);
    const { data } = ctx.getImageData(0, 0, 32, 32);
    let sum = 0;
    for (let i = 0; i < data.length; i += 4) {
      sum += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
    }
    return sum / (data.length / 4);
  }

  /**
   * Grabs one frame. Returns `{ dataUrl, night, luma }`, or null if the video
   * has no pixels yet — never throws, so one bad frame cannot stop the burst.
   */
  capture() {
    const video = this.video;
    const canvas = this.canvas;
    if (!video || !canvas || !video.videoWidth) return null;

    let luma = 255;
    try {
      luma = this.#meanLuma(video);
    } catch {
      /* getImageData can fail on a tainted or not-yet-ready frame. */
    }
    const night = luma < NIGHT_LUMA;

    const scale = Math.min(1, MAX_EDGE / Math.max(video.videoWidth, video.videoHeight));
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    const ctx = canvas.getContext("2d");

    if (night) {
      // Lift the shadows so a face in an unlit street is at least visible.
      // Scaled by how dark it actually is, so dusk is not blown out.
      const lift = 1 + Math.min(1.4, (NIGHT_LUMA - luma) / 40);
      ctx.filter = `brightness(${lift.toFixed(2)}) contrast(1.12) saturate(0.92)`;
    } else {
      ctx.filter = "none";
    }
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    ctx.filter = "none";

    this.frames += 1;
    // Quality stays modest: more frames beats sharper frames here.
    return { dataUrl: canvas.toDataURL("image/jpeg", 0.72), night, luma };
  }

  /**
   * Fires `onFrame` every `intervalMs`, starting immediately. `autoTorch` turns
   * the light on by itself once the scene reads as dark.
   */
  async start({ intervalMs = 5000, onFrame, onError, autoTorch = true } = {}) {
    if (this.running) return;
    try {
      await this.open();
    } catch (err) {
      onError?.(
        err?.name === "NotAllowedError"
          ? "Camera permission was refused. Allow it and try again."
          : "Camera unavailable. Browsers only allow it on https or localhost.",
      );
      return;
    }

    this.running = true;
    const tick = () => {
      if (!this.running) return;
      const shot = this.capture();
      if (!shot) return;
      if (autoTorch && shot.night && !this.torchOn) this.setTorch(true);
      onFrame?.(shot);
    };

    tick();
    this.timer = setInterval(tick, intervalMs);
  }

  stop({ keepStream = false } = {}) {
    this.running = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (keepStream) return;
    if (this.torchOn) this.setTorch(false);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.track = null;
    this.video = null;
    this.canvas = null;
    this.torchOn = false;
  }
}
