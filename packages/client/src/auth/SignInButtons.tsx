import { PROVIDER_NAMES, type Provider, signInUrl } from "./sign-in.js";

const PROVIDERS: readonly Provider[] = ["aad", "google"];

/** "Sign in with Microsoft" and "Sign in with Google", each returning to `returnTo` afterwards (X-8). */
export function SignInButtons({ returnTo }: { returnTo: string }) {
  return (
    <div className="stack">
      {PROVIDERS.map((provider) => (
        // Full-page links, not fetches: the provider's sign-in pages take over the window.
        <a key={provider} href={signInUrl(provider, returnTo)} className="button button-primary">
          Sign in with {PROVIDER_NAMES[provider]}
        </a>
      ))}
    </div>
  );
}
