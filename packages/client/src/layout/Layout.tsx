import { useCallback, useMemo, useState } from "react";
import { Outlet } from "react-router";
import { NavBar } from "./NavBar.js";
import { NoticeProvider, NoticeRegion } from "./notices.js";
import { TopBarContext, type TopBarSlot } from "./top-bar.js";

/**
 * Every page: the navigation row, or the page's own top row in its place (TopBar), then the page itself. Messages such as Undo
 * after deleting (REC-6) live here too, so they stay when the app goes to another page.
 */
export function Layout() {
  const [element, setElement] = useState<HTMLElement | null>(null);
  const [claims, setClaims] = useState(0);
  const claim = useCallback(() => {
    setClaims((n) => n + 1);
    return () => setClaims((n) => n - 1);
  }, []);
  const slot = useMemo<TopBarSlot>(() => ({ element, claim }), [element, claim]);

  return (
    <div className="app">
      <TopBarContext value={slot}>
        <NoticeProvider>
          {claims === 0 && <NavBar />}
          <div ref={setElement} className="top-bar-slot" />
          <NoticeRegion />
          <main className="page">
            <Outlet />
          </main>
        </NoticeProvider>
      </TopBarContext>
    </div>
  );
}
