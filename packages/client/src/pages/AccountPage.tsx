import { useState } from "react";
import { useLocation } from "react-router";
import type { Me } from "@recipebox/shared";
import { PROVIDER_NAMES, appUrl, isAppPath, signOutUrl, useViewer } from "../auth/sign-in.js";
import { SignInButtons } from "../auth/SignInButtons.js";

/** The ID as it goes in the EDITORS setting, e.g. `google:1098…` (docs/architecture.md, "Editors"). */
function editorId(me: Me): string {
  if (me.provider === undefined) return me.accountId ?? "";
  return `${me.provider}:${me.accountId ?? ""}`;
}

function CopyButton({ text }: { text: string }) {
  const [result, setResult] = useState<"copied" | "failed" | undefined>(undefined);

  async function copy() {
    try {
      // Unavailable outside secure contexts or when the browser refuses; the ID stays on screen to select by hand.
      await navigator.clipboard.writeText(text);
      setResult("copied");
    } catch {
      setResult("failed");
    }
  }

  return (
    <>
      <button type="button" className="button button-small" onClick={() => void copy()}>
        Copy
      </button>
      <span role="status" className="copy-status">
        {result === "copied" ? "Copied" : result === "failed" ? "Couldn't copy. Select the ID and copy it instead." : ""}
      </span>
    </>
  );
}

/** X-11: provider, account ID with a copy button, editor or not, and sign out; or sign-in buttons when signed out. */
export function AccountPage() {
  const { viewer, me } = useViewer();
  const location = useLocation();

  if (viewer === "loading") {
    return (
      <>
        <h1>Account</h1>
        <p role="status">Loading…</p>
      </>
    );
  }

  if (me === undefined || !me.signedIn) {
    // X-8: return to the page the visitor came from (set by the nav's Sign in link), or else to this page.
    const from: unknown = (location.state as { from?: unknown } | null)?.from;
    const returnTo = appUrl(isAppPath(from) ? from : `${location.pathname}${location.search}`);
    return (
      <>
        <h1>Account</h1>
        <p className="muted">Sign in to add and edit recipes. Anyone can view recipes without signing in.</p>
        <SignInButtons returnTo={returnTo} />
      </>
    );
  }

  const id = editorId(me);
  return (
    <>
      <h1>Account</h1>
      <div className="stack">
        <dl className="card account-details">
          <div>
            <dt>Signed in with</dt>
            <dd>{me.provider === undefined ? "Unknown" : PROVIDER_NAMES[me.provider]}</dd>
          </div>
          <div>
            <dt>Account ID</dt>
            <dd className="account-id">
              <code>{id}</code>
              <CopyButton text={id} />
            </dd>
          </div>
          <div>
            <dt>Access</dt>
            <dd>
              {me.isEditor ? <span className="badge badge-editor">Editor</span> : <span className="badge">Not an editor</span>}
            </dd>
          </div>
        </dl>
        {!me.isEditor && (
          <p className="muted">
            You can view recipes but not change them. To become an editor, send this ID to the app's owner to be added to the
            editor list.
          </p>
        )}
        <a href={signOutUrl(appUrl("/"))} className="button">
          Sign out
        </a>
      </div>
    </>
  );
}
