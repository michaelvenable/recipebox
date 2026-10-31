// The one place that implements X-13, so every value object counts, sorts and matches text the same way.
// The locale is fixed to English rather than taken from the machine, so server and tests always agree.

const graphemes = new Intl.Segmenter("en", { granularity: "grapheme" });
const collator = new Intl.Collator("en", { sensitivity: "base" });

/** Characters as a person sees them (X-13): every emoji, including flags and family emoji, counts as one. */
export function characterCount(text: string): number {
  return [...graphemes.segment(text)].length;
}

/**
 * Order ignoring case and accents, using English rules (X-13). Texts the collator considers equal fall back to code-unit
 * order, so the result is the same on every run and only identical texts compare as 0.
 */
export function compareText(a: string, b: string): number {
  return collator.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0);
}

/** Whether `needle` occurs anywhere in `haystack`, ignoring case and accents (X-13). */
export function containsText(haystack: string, needle: string): boolean {
  return fold(haystack).includes(fold(needle));
}

// Letters that NFKD doesn't split into a base letter plus accent, spelled out the way sorting treats them (X-13).
const UNDECOMPOSED: Readonly<Record<string, string>> = {
  ø: "o",
  Ø: "O",
  ł: "l",
  Ł: "L",
  đ: "d",
  Đ: "D",
  æ: "ae",
  Æ: "AE",
  œ: "oe",
  Œ: "OE",
  ß: "ss",
  ẞ: "SS",
};
const UNDECOMPOSED_LETTER = new RegExp(`[${Object.keys(UNDECOMPOSED).join("")}]`, "gu");

/**
 * Folds text for search the same way sorting treats it (X-13, REC-9): NFKD (so "ﬁ" becomes "fi"), accents dropped, letters
 * without a decomposition spelled out ("ø" becomes "o", "ß" becomes "ss"), then lowercased. "Smørrebrød" becomes "smorrebrod".
 */
function fold(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(UNDECOMPOSED_LETTER, (letter) => UNDECOMPOSED[letter] ?? letter)
    .toLowerCase();
}
