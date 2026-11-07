import type { TagCount } from "@recipebox/shared";

interface TagChipsProps {
  tags: TagCount[] | undefined;
  failed: boolean;
  retry: () => void;
  picked: readonly string[];
  toggle: (tag: string) => void;
}

/**
 * A tag filter: every tag in use with its count, in the server's alphabetical order (REC-13). Used by the recipe list (REC-13)
 * and by "haven't made in a while" (COOK-9), each with its own picked tags.
 */
export function TagChips({ tags, failed, retry, picked, toggle }: TagChipsProps) {
  if (failed && tags === undefined) {
    return (
      <p className="muted inline-retry">
        Couldn't load the tags.{" "}
        <button type="button" className="link-button" onClick={retry}>
          Try again
        </button>
      </p>
    );
  }
  if (tags === undefined || tags.length === 0) return null;
  return (
    <div className="tag-chips" role="group" aria-label="Filter by tag">
      {tags.map(({ tag, count }) => (
        <button key={tag} type="button" className="chip" aria-pressed={picked.includes(tag)} onClick={() => toggle(tag)}>
          {tag} · {count}
        </button>
      ))}
    </div>
  );
}
