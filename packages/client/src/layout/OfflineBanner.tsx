import { useOnline } from "../pwa/online.js";

/**
 * "You're offline" while the browser has no connection. The app needs one (docs/specs/README.md, out of scope: offline use); the
 * service worker only keeps the app itself, so it opens, and pages wait for the connection to load. The live region is always
 * there, empty while online, so screen readers announce the message when it appears.
 */
export function OfflineBanner() {
  const online = useOnline();
  return (
    <div role="status" className="offline-region">
      {!online && <p className="offline-banner">You're offline. RecipeBox needs a connection to load and save recipes.</p>}
    </div>
  );
}
