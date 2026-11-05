import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { pwaOptions } from "./pwa.config.js";

export default defineConfig({
  // X-4: the web app manifest and the service worker (pwa.config.ts).
  plugins: [react(), VitePWA(pwaOptions)],
  // The API's CORS policy allows exactly this origin in development (DEV_CLIENT_ORIGIN in packages/server/src/config.ts), so
  // never fall back to another port.
  server: { port: 5173, strictPort: true },
});
