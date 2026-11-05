import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
// Self-hosted, so the font is part of the installed app and no request goes to a font service. Regular and bold only, as before.
import "@fontsource/atkinson-hyperlegible/400.css";
import "@fontsource/atkinson-hyperlegible/700.css";
import { App } from "./App.js";
import { registerServiceWorker } from "./pwa/service-worker.js";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");

const updates = registerServiceWorker();

createRoot(root).render(
  <StrictMode>
    <App updates={updates} />
  </StrictMode>,
);
