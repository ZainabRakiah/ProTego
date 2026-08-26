import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

const BACKEND = process.env.VITE_BACKEND_URL || "http://127.0.0.1:5001";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": path.resolve(process.cwd(), "src") },
  },
  server: {
    port: 5173,
    open: true,
    // Everything the Flask app owns is proxied, so the browser only ever talks
    // to one origin and there are no CORS or mixed-port surprises.
    proxy: {
      "/api": { target: BACKEND, changeOrigin: true },
      "/safecam": { target: BACKEND, changeOrigin: true },
      "/data": { target: BACKEND, changeOrigin: true },
      "/friendsnavigator": { target: BACKEND, changeOrigin: true },
    },
  },
  build: { outDir: "dist", sourcemap: false, chunkSizeWarningLimit: 1000 },
});
