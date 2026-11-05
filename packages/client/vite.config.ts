import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // The API's CORS policy allows exactly this origin in development (DEV_CLIENT_ORIGIN in packages/server/src/config.ts), so
  // never fall back to another port.
  server: { port: 5173, strictPort: true },
});
