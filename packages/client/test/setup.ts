import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

// Vitest globals are off, so Testing Library can't register its own cleanup.
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  // X-16 remembers the sign-in provider in localStorage and a once-per-visit flag in sessionStorage.
  localStorage.clear();
  sessionStorage.clear();
});
