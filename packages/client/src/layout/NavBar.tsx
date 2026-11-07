import { Link, useLocation } from "react-router";
import { useViewer } from "../auth/sign-in.js";

interface NavItem {
  label: string;
  to: string;
  /** Whether this item is the current section, given the current path. */
  isCurrent: (pathname: string) => boolean;
}

const under = (path: string) => (pathname: string) => pathname === path || pathname.startsWith(`${path}/`);

/** The recipe list and everything about single recipes (view, new, edit) are the "Catalog" section. */
const RECIPES: NavItem = { label: "Catalog", to: "/", isCurrent: (p) => p === "/" || under("/recipes")(p) };

const EDITOR_ITEMS: readonly NavItem[] = [
  RECIPES,
  { label: "Plan", to: "/plan", isCurrent: under("/plan") },
  { label: "Recommendations", to: "/recommendations", isCurrent: under("/recommendations") },
  { label: "Trash", to: "/trash", isCurrent: under("/trash") },
];

const VISITOR_ITEMS: readonly NavItem[] = [RECIPES];

function current(isCurrent: boolean): "page" | undefined {
  return isCurrent ? "page" : undefined;
}

/**
 * The top row on every page (X-8, docs/mockups/README.md "Navigation"). Visitors see Recipes and Sign in; editors see their
 * four sections and an Account button. Signed-in non-editors see Recipes and the Account button, since signing in again
 * wouldn't change anything for them and the Account page is where they find their ID and sign out.
 */
export function NavBar() {
  const { viewer } = useViewer();
  const location = useLocation();
  const pathname = location.pathname;
  const items = viewer === "editor" ? EDITOR_ITEMS : VISITOR_ITEMS;
  const onAccount = under("/account")(pathname);

  return (
    <nav aria-label="Main" className="nav">
      <div className="nav-items">
        {items.map((item) => (
          <Link key={item.to} to={item.to} className="nav-item" aria-current={current(item.isCurrent(pathname))}>
            {item.label}
          </Link>
        ))}
      </div>
      {viewer === "visitor" && (
        <Link
          to="/account"
          // X-8: the Account page sends the visitor back here after signing in.
          state={onAccount ? undefined : { from: `${pathname}${location.search}${location.hash}` }}
          className="nav-item nav-sign-in"
          aria-current={current(onAccount)}
        >
          Sign in
        </Link>
      )}
      {(viewer === "editor" || viewer === "nonEditor") && (
        <Link to="/account" aria-label="Account" className="nav-account" aria-current={current(onAccount)}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <circle cx="12" cy="8" r="4" />
            <path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" />
          </svg>
        </Link>
      )}
    </nav>
  );
}
