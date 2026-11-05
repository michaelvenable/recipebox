import type { ReactNode } from "react";
import { Link, useLocation } from "react-router";
import { appUrl, useViewer } from "./sign-in.js";
import { SignInButtons } from "./SignInButtons.js";

/**
 * Wraps an editor-only page (the to-make list, rediscovery, the trash, new and edit). Visitors and non-editors get a message
 * instead, and the page itself, with its API calls, is never rendered for them. The server refuses them anyway (X-1, X-6).
 */
export function EditorOnly({ children }: { children: ReactNode }) {
  const { viewer } = useViewer();
  const location = useLocation();

  if (viewer === "loading") return <p role="status">Loading…</p>;
  if (viewer === "visitor") {
    return (
      <>
        <h1>Sign in to see this</h1>
        <p className="muted">This page is for the household's editors.</p>
        <SignInButtons returnTo={appUrl(`${location.pathname}${location.search}${location.hash}`)} />
      </>
    );
  }
  if (viewer === "nonEditor") {
    return (
      <>
        <h1>Only editors can see this</h1>
        <p className="muted">
          Your account isn't on the editor list. <Link to="/account">Your Account page</Link> shows the ID to send to the
          app's owner.
        </p>
      </>
    );
  }
  return <>{children}</>;
}
