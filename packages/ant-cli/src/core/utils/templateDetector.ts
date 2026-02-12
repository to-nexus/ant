/**
 * Shared utility for detecting ant:template placeholder files.
 *
 * A file is considered a "template" (i.e. empty / no user content) when:
 *   1. It contains the `<!-- ant:template -->` marker, AND
 *   2. After stripping HTML comments + markdown scaffolding (headers, empty
 *      list items, label-only items, blockquotes) the remaining user-written
 *      content is negligible (< 50 chars).
 *
 * If the marker is present but substantial content exists, the file is treated
 * as a real document with a leftover marker — the marker is stripped and the
 * content is returned as-is.
 */

const TEMPLATE_MARKER = '<!-- ant:template -->';

/**
 * Check if file content is a template placeholder.
 */
export function isTemplateContent(content: string): boolean {
  if (!content.includes(TEMPLATE_MARKER)) return false;

  const stripped = content
    .replace(/<!--[\s\S]*?-->/g, '')          // HTML comments
    .replace(/^#+\s+.*$/gm, '')               // Markdown headers
    .replace(/^>\s.*$/gm, '')                  // Blockquotes
    .replace(/^-\s*(\*\*[^*]+\*\*:)?\s*$/gm, '') // "- " or "- **label**:"
    .replace(/^-\s*[^\s:]+:\s*$/gm, '')        // "- label:"
    .trim();

  return stripped.length < 50;
}

/**
 * Normalize a user document that may contain a template marker.
 *
 * - Returns `null` if the content is empty or a template placeholder.
 * - Returns the cleaned content (marker stripped) if real content exists.
 */
export function normalizeTemplateDoc(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // If only HTML comments remain, treat as empty
  const withoutComments = trimmed.replace(/<!--[\s\S]*?-->/g, '').trim();
  if (!withoutComments) return null;

  if (trimmed.includes(TEMPLATE_MARKER)) {
    if (isTemplateContent(trimmed)) return null;
    // Real content exists — strip only the template marker comments
    return trimmed
      .replace(/<!--\s*ant:template\s*-->/g, '')
      .replace(/<!--.*ant:template.*-->/g, '')
      .trim();
  }

  return trimmed;
}
