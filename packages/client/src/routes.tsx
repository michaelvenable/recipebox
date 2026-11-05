import type { RouteObject } from "react-router";
import { EditorOnly } from "./auth/EditorOnly.js";
import { Layout } from "./layout/Layout.js";
import { AccountPage } from "./pages/AccountPage.js";
import { NotFoundPage } from "./pages/NotFoundPage.js";
import { Placeholder } from "./pages/Placeholder.js";

/**
 * Every page. Public pages: the recipe list and a recipe (X-1). Editor-only pages are wrapped in EditorOnly, so visitors get a
 * sign-in message instead of the page and its API calls.
 */
export const routes: RouteObject[] = [
  {
    element: <Layout />,
    children: [
      { path: "/", element: <Placeholder title="RecipeBox" /> },
      { path: "/recipes/new", element: <EditorOnly><Placeholder title="New recipe" /></EditorOnly> },
      { path: "/recipes/:id", element: <Placeholder title="Recipe" /> },
      { path: "/recipes/:id/edit", element: <EditorOnly><Placeholder title="Edit recipe" /></EditorOnly> },
      { path: "/plan", element: <EditorOnly><Placeholder title="Want to make" /></EditorOnly> },
      { path: "/recommendations", element: <EditorOnly><Placeholder title="Rediscover" /></EditorOnly> },
      { path: "/trash", element: <EditorOnly><Placeholder title="Trash" /></EditorOnly> },
      { path: "/account", element: <AccountPage /> },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
];
