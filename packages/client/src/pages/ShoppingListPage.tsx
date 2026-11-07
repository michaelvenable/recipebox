import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { shoppingListKeys } from "../api/query-keys.js";
import { fetchShoppingList } from "../api/recipes.js";
import { sendShoppingList, sharedListUrl } from "../api/shopping-lists.js";
import { formatWeekdayDate } from "../recipes/dates.js";
import { changeErrorMessage } from "../recipes/recipe-changes.js";
import { ShoppingItems, summary, useTicks } from "../recipes/ShoppingItems.js";

/**
 * The shopping list at /plan/shopping (PLAN-8, docs/mockups/ShoppingList.dc.html): every ingredient of every recipe on the
 * to-make list, in the server's order (the domain sorts it, X-13), each with its recipe's name. Editor-only (X-1), behind
 * EditorOnly in routes.tsx. "Send" makes a link anyone can open for 7 days (PLAN-9).
 */
export function ShoppingListPage() {
  const list = useQuery({ queryKey: shoppingListKeys.all, queryFn: ({ signal }) => fetchShoppingList(signal) });
  const items = list.data;
  const { ticks, toggle } = useTicks();
  const hasItems = items !== undefined && items.length > 0;

  return (
    <div className="shopping-page">
      <header className="list-page-header">
        <Link to="/plan" className="back-link">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M15 5l-7 7 7 7" />
          </svg>
          Plan
        </Link>
        {/* PLAN-9: with nothing on the list there is nothing to send. */}
        {hasItems ? (
          <SendableHeading summary={summary(items)} />
        ) : (
          <h1>Shopping list</h1>
        )}
      </header>
      {items === undefined ? (
        list.isError ? (
          <div className="card stack" role="alert">
            <p>Couldn't load the shopping list. Check the connection and try again.</p>
            <button type="button" className="button" onClick={() => void list.refetch()}>
              Try again
            </button>
          </div>
        ) : (
          <p role="status">Loading the shopping list…</p>
        )
      ) : items.length === 0 ? (
        <NothingToShopFor />
      ) : (
        <ShoppingItems items={items} ticks={ticks} toggle={toggle} />
      )}
    </div>
  );
}

/** PLAN-8: with nothing on the to-make list there is no shopping list. */
function NothingToShopFor() {
  return (
    <div className="empty-state">
      <h2>Nothing to shop for</h2>
      <p className="muted">The plan is empty, so there's no shopping list.</p>
      <Link to="/" className="button button-primary">
        Browse recipes
      </Link>
    </div>
  );
}

/**
 * How the link reached the editor besides being shown: the share sheet, or copied (or not). "notSharedOrCopied": the device
 * refused both after Send, as Safari can once the wait for the server has used up the tap; the Share button then offers the
 * share sheet again on a fresh tap. "notShared": that button's share failed.
 */
type Delivery = "shared" | "copied" | "notCopied" | "notSharedOrCopied" | "notShared";

const DELIVERY_MESSAGES: Partial<Record<Delivery, string>> = {
  copied: "Link copied.",
  notCopied: "Couldn't copy. Select the link and copy it instead.",
  notSharedOrCopied: "Couldn't share or copy the link yet. Tap Share to send it.",
  notShared: "Couldn't share. Copy the link instead.",
};

function canShare(): boolean {
  return typeof navigator.share === "function";
}

interface SentLink {
  url: string;
  expiresAt: string;
  delivery?: Delivery;
}

/** Whether `error` is the share sheet being closed without sharing, which is the editor's choice, not a failure. */
function isCancelled(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

async function copyText(text: string): Promise<Delivery> {
  try {
    // Unavailable outside secure contexts or when the browser refuses; the link stays on screen to select by hand.
    await navigator.clipboard.writeText(text);
    return "copied";
  } catch {
    return "notCopied";
  }
}

/**
 * The heading, the count and "Send" (PLAN-9). Send asks the server for a new link to the list as it is now, then offers it
 * through the device's share function, or copies it where there is none. Either way the link and the date it stops working
 * stay on screen, with "Copy link". Each Send makes a new link; earlier ones keep working.
 */
function SendableHeading({ summary: count }: { summary: string }) {
  const send = useMutation({ mutationFn: sendShoppingList });
  const [sent, setSent] = useState<SentLink>();

  async function onSend() {
    if (send.isPending) return;
    setSent(undefined);
    let link;
    try {
      link = await send.mutateAsync();
    } catch {
      return; // Shown below from send.error.
    }
    const url = sharedListUrl(link.token);
    const shown: SentLink = { url, expiresAt: link.expiresAt };
    setSent(shown);
    if (canShare()) {
      try {
        await navigator.share({ title: "Shopping list", url });
        setSent({ ...shown, delivery: "shared" });
        return;
      } catch (error) {
        if (isCancelled(error)) return;
        // Refused, such as when the wait for the server used up the tap that allows sharing: copy it instead.
        const copied = await copyText(url);
        setSent({ ...shown, delivery: copied === "copied" ? copied : "notSharedOrCopied" });
        return;
      }
    }
    setSent({ ...shown, delivery: await copyText(url) });
  }

  return (
    <>
      <div className="heading-with-action">
        <div className="list-page-heading">
          <h1>Shopping list</h1>
          <p className="muted">{count}</p>
        </div>
        <button type="button" className="pill-button" disabled={send.isPending} onClick={() => void onSend()}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 15V3" />
            <path d="M7 8l5-5 5 5" />
            <path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" />
          </svg>
          Send
        </button>
      </div>
      {send.isError && (
        <p className="form-error" role="alert">
          Couldn't make a link. {changeErrorMessage(send.error)}
        </p>
      )}
      {send.isPending && <p role="status">Making a link…</p>}
      {sent !== undefined && <SentLinkPanel key={sent.url} link={sent} />}
    </>
  );
}

/**
 * "Link created." with the date it stops working, in the device's time zone (X-12), the link and "Copy link", and "Share" where
 * the device has a share function: tapped, it opens the share sheet on that fresh tap (PLAN-9).
 */
function SentLinkPanel({ link }: { link: SentLink }) {
  const [latest, setLatest] = useState<Delivery>();
  const delivery = latest ?? link.delivery;
  const message = delivery === undefined ? undefined : DELIVERY_MESSAGES[delivery];

  async function share() {
    try {
      await navigator.share({ title: "Shopping list", url: link.url });
      setLatest("shared");
    } catch (error) {
      // Closing the share sheet is the editor's choice, not a failure; whatever was said before stays.
      if (!isCancelled(error)) setLatest("notShared");
    }
  }

  return (
    <div role="status" className="sent-link">
      <p>
        <strong>Link created.</strong> Anyone with it can see this list, without signing in, until{" "}
        {formatWeekdayDate(link.expiresAt)}. Then it stops working.
      </p>
      <div className="sent-link-address">
        <code>{link.url}</code>
        <button type="button" className="link-button" onClick={() => void copyText(link.url).then(setLatest)}>
          Copy link
        </button>
        {canShare() && (
          <button type="button" className="link-button" onClick={() => void share()}>
            Share
          </button>
        )}
      </div>
      {message !== undefined && <p className="sent-link-copied">{message}</p>}
    </div>
  );
}
