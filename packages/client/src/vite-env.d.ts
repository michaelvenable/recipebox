/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** The API's address, e.g. https://api.recipes.mikevenable.net. */
  readonly VITE_API_URL?: string;
  /** Development sign-in stub, e.g. `google:1234`; sent as the server's `x-dev-identity` header in development only. */
  readonly VITE_DEV_IDENTITY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
