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
    navigator.serviceWorker
      .register("/sw.js")
      .catch((err) => console.warn("[ProTego] service worker registration failed:", err));
  });
}
