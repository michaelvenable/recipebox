/**
 * A recipe's tags, in the server's alphabetical order (REC-11). Read-only for everyone: tags are changed only in the create and
 * edit form (REC-10, TagsField). Nothing at all when the recipe has none.
 */
export function RecipeTags({ tags }: { tags: readonly string[] }) {
  if (tags.length === 0) return null;
  return (
    <div className="recipe-tags">
      <ul className="tag-list" aria-label="Tags">
        {tags.map((tag) => (
          <li key={tag} className="tag">
            {tag}
          </li>
        ))}
      </ul>
    </div>
  );
}
