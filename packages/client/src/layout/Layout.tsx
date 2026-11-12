import { useCallback, useMemo, useState } from "react";
import { Outlet } from "react-router";
import { useAutoSignIn } from "../auth/auto-sign-in.js";
import { ImportsProvider } from "../imports/imports.js";
import { NavBar } from "./NavBar.js";
import { NoticeProvider, NoticeRegion } from "./notices.js";
import { OfflineBanner } from "./OfflineBanner.js";
import { TopBarContext, type TopBarSlot } from "./top-bar.js";

/**
 * Every page: the navigation row, or the page's own top row in its place (TopBar), then the page itself. Messages such as Undo
 * after deleting (REC-6) live here too, so they stay when the app goes to another page, as does "You're offline". So does the
 * checking of imports in progress, so "‹name› imported" shows on any page (IMP-10).
 */
export function Layout() {
  const [element, setElement] = useState<HTMLElement | null>(null);
  const [claims, setClaims] = useState(0);
  const claim = useCallback(() => {
    setClaims((n) => n + 1);
    return () => setClaims((n) => n - 1);
  }, []);
  const slot = useMemo<TopBarSlot>(() => ({ element, claim }), [element, claim]);
  // X-16: while leaving to sign in again automatically, keep showing that the app is loading, not the visitor's page.
  const signingIn = useAutoSignIn();

  return (
    <div className="app">
      <TopBarContext value={slot}>
        <NoticeProvider>
          <ImportsProvider>
            {claims === 0 && !signingIn && <NavBar />}
            <div ref={setElement} className="top-bar-slot" />
            <OfflineBanner />
            <NoticeRegion />
            <main className="page">
              {signingIn ? <p role="status">Loading…</p> : <Outlet />}
            </main>
          </ImportsProvider>
        </NoticeProvider>
      </TopBarContext>
    </div>
  );
}
