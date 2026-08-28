import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "@/App";
import "@/index.css";

// Apply the stored theme before React mounts so there is no light-mode flash.
document.documentElement.classList.toggle(
  "dark",
  (localStorage.getItem("protego.theme") ?? "dark") !== "light",
);

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

/*
 * Register the service worker so the app, the tiles already seen and the safety
 * pack survive losing the network.
 *
 * Only in a production build: in dev the worker would serve a cached shell over
 * Vite's HMR and changes would appear not to apply. Service workers also need a
 * secure context, so this is a no-op on http://<lan-ip> — see README.
 */
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    // The worker cannot read import.meta.env, and in production the API is on
    // a different host to the static site — so the API origin is handed over on
    // the script URL. It decides what counts as an API request from this.
    const apiBase = import.meta.env.VITE_API_BASE || "";
    const swUrl = apiBase ? `/sw.js?api=${encodeURIComponent(apiBase)}` : "/sw.js";
    navigator.serviceWorker
      .register(swUrl)
      .catch((err) => console.warn("[ProTego] service worker registration failed:", err));
  });
}
