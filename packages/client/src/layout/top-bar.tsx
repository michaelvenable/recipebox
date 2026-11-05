import { type ReactNode, createContext, useContext, useLayoutEffect } from "react";
import { createPortal } from "react-dom";

export interface TopBarSlot {
  /** Where a page's own top row goes, above the page; null until the layout has rendered. */
  element: HTMLElement | null;
  /** Hides the navigation row until the returned function is called. */
  claim: () => () => void;
}

export const TopBarContext = createContext<TopBarSlot | null>(null);

/**
 * A page's own top row in place of the navigation row, such as Cancel and Save on the create and edit form, so a stray tap
 * can't lose unsaved changes (docs/mockups/README.md, "Edit form"). The navigation row returns when this is gone.
 */
export function TopBar({ children }: { children: ReactNode }) {
  const slot = useContext(TopBarContext);
  const claim = slot?.claim;
  // Before paint, so the navigation row doesn't flash.
  useLayoutEffect(() => claim?.(), [claim]);
  return slot?.element ? createPortal(children, slot.element) : null;
}
