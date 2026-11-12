/**
 * X-15: what the app stores and who can see it, for anyone, signed in or not (docs/mockups/Privacy.dc.html). Every statement
 * must stay true of the code and infrastructure; the source of each is noted beside it. No personal contact details.
 */
export function PrivacyPage() {
  return (
    <div className="prose">
      <header>
        <h1>Privacy</h1>
        <p className="muted">Recipe Box is a recipe app for one household. This page says what it stores and who can see it.</p>
      </header>

      {/* X-1. Photo metadata: server/src/photos/photo-conversion.ts. */}
      <section aria-labelledby="privacy-recipes">
        <h2 id="privacy-recipes">Recipes and photos</h2>
        <p>
          Recipes and their photos are public: anyone with the app's address can see them without signing in. When a photo is
          uploaded, the location and other details the camera saved in it are removed.
        </p>
      </section>

      {/* X-1, PLAN-9, REC-25. */}
      <section aria-labelledby="privacy-lists">
        <h2 id="privacy-lists">The household's lists</h2>
        <p>
          The "to make" list, cooking history, notes on recipes and trash can be seen only by the household's editors, and so
          can photos of recipes in the trash. The one exception is a shopping list an editor sends: for 7 days, anyone with its link can see
          the current shopping list, and nothing else.
        </p>
      </section>

      {/*
        X-7. The API reads only the provider and account ID headers (server/src/http/caller.ts); nothing about a person is
        stored except the EDITORS setting (provider:accountId).
      */}
      <section aria-labelledby="privacy-sign-in">
        <h2 id="privacy-sign-in">Signing in</h2>
        <p>
          You sign in with a Microsoft or Google account, on Microsoft's or Google's own page; the app never sees your password.
          From signing in, the app uses only which of the two you used and your permanent account ID. It doesn't keep your
          name or email address. The list of editors holds each editor's provider and account ID, and apart from that list the
          app keeps no record of who signs in.
        </p>
      </section>

      {/*
        IMP-1, IMP-12. The model is a deployment in the app's own Azure AI Foundry resource (docs/architecture.md, "Recipe
        import"; server/src/imports/recipe-reader.ts); the page photo is deleted when the import ends
        (server/src/imports/process-import.ts), and a leftover one by the storage lifecycle rule within two days
        (infra/main.bicep).
      */}
      <section aria-labelledby="privacy-import">
        <h2 id="privacy-import">Importing a recipe from a photo</h2>
        <p>
          When an editor uploads a photo of a recipe to import it, the photo is sent to an AI service in the app's own Microsoft
          Azure account, which reads the recipe from it. The photo is used for nothing else, and it is deleted once the import
          ends.
        </p>
      </section>

      {/*
        X-9, X-16. The app sets no cookies. Its only storage is the provider an editor last signed in with ("aad" or "google",
        in localStorage) and a once-per-visit flag in sessionStorage (auth/auto-sign-in.ts); the service worker caches only the
        app's own files (pwa.config.ts). No third-party scripts or fonts.
      */}
      <section aria-labelledby="privacy-cookies">
        <h2 id="privacy-cookies">Cookies</h2>
        <p>
          The only cookies are the ones signing in sets, to keep you signed in. There are no advertising, tracking or analytics
          cookies. Your device also remembers which of Microsoft or Google an editor last signed in with, and nothing else about
          them, so that the app can sign them in again when it is next opened. So that it can be installed and start quickly,
          the app keeps a copy of its own files on your device.
        </p>
      </section>

      {/* server/src/http/request-log.ts logs no headers or identity; Log Analytics retentionInDays: 30 (infra/main.bicep). */}
      <section aria-labelledby="privacy-logs">
        <h2 id="privacy-logs">Server logs</h2>
        <p>
          The server logs each request: what was asked for, when, and the network address it came from. The logs don't
          include names, email addresses or who was signed in. They are used only to keep the app running, and are kept for
          30 days.
        </p>
      </section>

      {/* REC-7, REC-16, REC-25; backups: docs/architecture.md, "Backups", and infra/main.bicep (7 days each). */}
      <section aria-labelledby="privacy-deleting">
        <h2 id="privacy-deleting">Deleting</h2>
        <p>
          A deleted recipe stays in the trash for 30 days. Within a day after that, it is removed for good, with its photo,
          cooking history and notes. Replacing or removing a photo deletes the old one. Backup copies are kept for 7 days, then they expire.
        </p>
      </section>

      <section aria-labelledby="privacy-sharing">
        <h2 id="privacy-sharing">Sharing</h2>
        <p>Nothing is sold or shared with anyone else. The app runs on Microsoft Azure, which stores its data.</p>
      </section>

      <section aria-labelledby="privacy-questions">
        <h2 id="privacy-questions">Questions</h2>
        <p>Ask the household member who shared the app with you.</p>
      </section>
    </div>
  );
}
