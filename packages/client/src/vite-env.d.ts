/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** The API's address, e.g. https://api.recipes.mikevenable.net. */
  readonly VITE_API_URL?: string;
  /** Development sign-in stub, e.g. `google:1234`; sent as the server's `x-dev-identity` header in development only. */
  readonly VITE_DEV_IDENTITY?: string;
  /** `true` to offer "Sign in with Google" as well as Microsoft (X-7). Unset or anything else: Microsoft only. */
  readonly VITE_GOOGLE_SIGN_IN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
