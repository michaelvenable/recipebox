import { Outlet } from "react-router";
import { NavBar } from "./NavBar.js";

/** Every page: the navigation row, then the page itself. */
export function Layout() {
  return (
    <div className="app">
      <NavBar />
      <main className="page">
        <Outlet />
      </main>
    </div>
  );
}
