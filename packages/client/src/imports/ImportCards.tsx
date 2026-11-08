import { useReadingImports } from "./imports.js";

/**
 * One "Reading your photo…" card per import in progress, newest first, above the recipes (IMP-5,
 * docs/mockups/ImportReading.dc.html). For editors only: the Catalog doesn't render it for anyone else, so they never ask for
 * imports (X-1). The page drawn on the card is a picture of a page, not the uploaded photo, which is never shown (IMP-12).
 */
export function ImportCards() {
  const reading = useReadingImports();
  if (reading.length === 0) return null;
  return (
    <ul className="import-cards" aria-label="Imports in progress">
      {reading.map((item) => (
        <li key={item.importId} className="import-card">
          <span className="import-card-page" aria-hidden="true">
            <span />
            <span />
            <span />
            <span />
          </span>
          <span className="recipe-card-text">
            <span className="recipe-card-name">Reading your photo…</span>
            <span className="recipe-card-meta">Usually a minute or two. You can keep using the app.</span>
          </span>
          <svg className="import-card-spinner" width="24" height="24" viewBox="0 0 24 24" fill="none" strokeWidth="3" strokeLinecap="round" aria-hidden="true">
            <circle cx="12" cy="12" r="9" stroke="var(--chip-bg)" />
            <path d="M12 3a9 9 0 0 1 9 9" stroke="var(--accent)" />
          </svg>
        </li>
      ))}
    </ul>
  );
}
