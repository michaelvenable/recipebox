import { PROVIDER_NAMES, signInProviders, signInUrl } from "./sign-in.js";

/** "Sign in with Microsoft", and "Sign in with Google" when offered (X-7), each returning to `returnTo` afterwards (X-8). */
export function SignInButtons({ returnTo }: { returnTo: string }) {
  return (
    <div className="stack">
      {signInProviders().map((provider) => (
        // Full-page links, not fetches: the provider's sign-in pages take over the window.
        <a key={provider} href={signInUrl(provider, returnTo)} className="button button-primary">
          Sign in with {PROVIDER_NAMES[provider]}
        </a>
      ))}
    </div>
  );
}
