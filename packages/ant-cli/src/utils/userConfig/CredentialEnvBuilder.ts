/**
 * CredentialEnvBuilder
 * 
 * Builds environment variables for private module authentication.
 * Uses Git env-scoped config (GIT_CONFIG_COUNT/KEY/VALUE) to inject
 * credentials into child processes without modifying global git config.
 * 
 * Requires Git 2.31+.
 */

/**
 * Build env vars that grant git/go/npm access to private GitHub modules.
 * Returns empty object when token is missing (safe no-op).
 * 
 * GOPRIVATE is set to github.com/* (all GitHub repos bypass module proxy)
 * because the project's dependencies may span multiple GitHub orgs that
 * are unknowable at job start time (go.mod may not exist yet).
 * The Git URL rewriting ensures all github.com fetches use the PAT.
 * 
 * SECURITY: The returned object contains the raw PAT in GIT_CONFIG_KEY_0.
 * It must only be passed to spawn() env — never logged, serialized, or
 * sent to the frontend.
 */
export function buildCredentialEnv(
  githubToken: string | null,
  githubRepo: string | null,
  _codebasePath?: string
): Record<string, string> {
  if (!githubToken) return {};
  if (!githubRepo) return {};

  return {
    GOPRIVATE: 'github.com/*',
    GONOSUMCHECK: 'github.com/*',
    GONOSUMDB: 'github.com/*',
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: `url.https://${githubToken}@github.com/.insteadOf`,
    GIT_CONFIG_VALUE_0: 'https://github.com/',
  };
}

/**
 * Extract GitHub organization/owner from a repo identifier.
 * Accepts "owner/repo" or full GitHub URL formats.
 */
export function extractOrg(githubRepo: string): string | null {
  const match = githubRepo.match(/(?:github\.com[:/])?([^/]+)\/[^/]+/);
  return match?.[1] || null;
}
