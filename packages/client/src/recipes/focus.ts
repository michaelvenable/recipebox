/**
 * Whether focus may be moved for a change that has just been saved, after `pressed` (the control that started it) was used.
 * Only if focus is nowhere (the pressed control was replaced, or a tap didn't focus it) or still on that control: if the editor
 * has moved on, for instance into the tag field, a save landing later mustn't pull them away.
 */
export function focusIsUnclaimed(pressed: Element | null): boolean {
  const active = document.activeElement;
  return active === null || active === document.body || active === pressed;
}
