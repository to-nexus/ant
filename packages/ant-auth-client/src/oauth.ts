/**
 * Build the Google OIDC sign-in URL. `oauthBase` should be a fully qualified
 * origin (e.g. `https://ant-server.crosstoken.io`) or empty string for
 * same-origin. The `/api/auth/google` path is appended verbatim — backend
 * route-mounting is the SSOT, this helper just composes the URL.
 */
export function getSignInUrl(opts: {
  oauthBase: string;
  returnTo: string;
}): string {
  return `${opts.oauthBase}/api/auth/google?returnTo=${encodeURIComponent(opts.returnTo)}`;
}

/**
 * Entry URL for "Get Started" / hero CTAs that should always land the user
 * inside the app. When already signed in, bypasses OAuth and links straight
 * to `appPath` (e.g. `/app/`).
 */
export function getAppEntryUrl(opts: {
  isSignedIn: boolean;
  oauthBase: string;
  appPath: string;
}): string {
  if (opts.isSignedIn) return opts.appPath;
  return getSignInUrl({ oauthBase: opts.oauthBase, returnTo: opts.appPath });
}
