import { Link } from "react-router";

export function NotFoundPage() {
  return (
    <>
      <h1>Page not found</h1>
      <p className="muted">
        There's nothing at this address. <Link to="/">Go to the recipes</Link>.
      </p>
    </>
  );
}
