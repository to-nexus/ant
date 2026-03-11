/**
 * Normalize a GitHub repository URL for comparison.
 * Strips protocol, credentials, trailing .git, trailing slashes, and lowercases.
 */
export function normalizeRepoUrl(url: string): string {
  return url.trim()
    .replace(/^https?:\/\//, '')
    .replace(/\/\/[^@]+@/, '//')
    .replace(/\.git$/, '')
    .replace(/\/+$/, '')
    .toLowerCase();
}
