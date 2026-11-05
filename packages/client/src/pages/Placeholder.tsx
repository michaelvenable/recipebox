/** Stands in for a screen that a later task builds. */
export function Placeholder({ title }: { title: string }) {
  return (
    <>
      <h1>{title}</h1>
      <p className="muted">Coming soon.</p>
    </>
  );
}
