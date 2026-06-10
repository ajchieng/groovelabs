// Centralized Audiotool OAuth configuration. The redirect URL must match an origin
// registered for the Audiotool application. It defaults to the local Vite dev origin
// so local development needs no extra setup, but any deployed environment should set
// VITE_AUDIOTOOL_REDIRECT_URL to its own origin.
const DEFAULT_REDIRECT_URL = "http://127.0.0.1:5173/";

const clientId = import.meta.env.VITE_AUDIOTOOL_CLIENT_ID?.trim() ?? "";
const redirectUrl = import.meta.env.VITE_AUDIOTOOL_REDIRECT_URL?.trim() || DEFAULT_REDIRECT_URL;

export const audiotoolConfig = {
  clientId,
  redirectUrl,
  oauthStoragePrefix: `oidc_${clientId}_oidc_`,
} as const;
