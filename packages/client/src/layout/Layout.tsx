import { useCallback, useMemo, useState } from "react";
import { Outlet } from "react-router";
import { NavBar } from "./NavBar.js";
import { TopBarContext, type TopBarSlot } from "./top-bar.js";

/** Every page: the navigation row, or the page's own top row in its place (TopBar), then the page itself. */
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
        {claims === 0 && <NavBar />}
        <div ref={setElement} className="top-bar-slot" />
        <main className="page">
          <Outlet />
        </main>
      </TopBarContext>
    </div>
  );
}
