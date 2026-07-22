/**
 * ANT commit co-author attribution.
 *
 * When ANT authors a commit on the user's behalf (`authorMode: 'ant'`), the
 * human stays the primary git author; ANT is credited via a `Co-authored-by:`
 * trailer — the same convention Cursor / GitHub Copilot / Claude Code use. Only
 * the "ANT" identity is exposed (the underlying work spans several models, so
 * no per-commit model is surfaced).
 *
 * `ANT_COAUTHOR.email` is the single swap point: for GitHub to render the ANT
 * avatar / count it as a contributor, this email must belong to a GitHub
 * account (a dedicated `ant-agent` user or a GitHub App). Until that account
 * exists the trailer still shows the name "ANT" as plain text.
 */

export const ANT_COAUTHOR = {
  name: 'ANT',
  email: 'ant-agent@to.nexus',
} as const;

export const ANT_COAUTHOR_TRAILER = `Co-authored-by: ${ANT_COAUTHOR.name} <${ANT_COAUTHOR.email}>`;

/**
 * Append the ANT `Co-authored-by:` trailer to a commit message, separated from
 * the body by a blank line (git trailer convention). Idempotent — if the
 * trailer is already present the message is returned unchanged, so a retried
 * commit never accumulates duplicate trailers.
 */
export function withAntCoAuthor(message: string): string {
  const body = message.trimEnd();
  if (body.includes(ANT_COAUTHOR_TRAILER)) return body;
  return `${body}\n\n${ANT_COAUTHOR_TRAILER}`;
}
