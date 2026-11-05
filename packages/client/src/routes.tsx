import type { RouteObject } from "react-router";
import { EditorOnly } from "./auth/EditorOnly.js";
import { Layout } from "./layout/Layout.js";
import { AccountPage } from "./pages/AccountPage.js";
import { NotFoundPage } from "./pages/NotFoundPage.js";
import { Placeholder } from "./pages/Placeholder.js";
import { EditRecipePage, NewRecipePage } from "./pages/RecipeFormPage.js";
import { RecipeListPage } from "./pages/RecipeListPage.js";
import { RecipePage } from "./pages/RecipePage.js";

/**
 * Every page. Public pages: the recipe list and a recipe (X-1). Editor-only pages are wrapped in EditorOnly, so visitors get a
 * sign-in message instead of the page and its API calls.
 */
export const routes: RouteObject[] = [
  {
    element: <Layout />,
    children: [
      { path: "/", element: <RecipeListPage /> },
      { path: "/recipes/new", element: <EditorOnly><NewRecipePage /></EditorOnly> },
      { path: "/recipes/:id", element: <RecipePage /> },
      { path: "/recipes/:id/edit", element: <EditorOnly><EditRecipePage /></EditorOnly> },
      { path: "/plan", element: <EditorOnly><Placeholder title="Want to make" /></EditorOnly> },
      { path: "/recommendations", element: <EditorOnly><Placeholder title="Rediscover" /></EditorOnly> },
      { path: "/trash", element: <EditorOnly><Placeholder title="Trash" /></EditorOnly> },
      { path: "/account", element: <AccountPage /> },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
];
