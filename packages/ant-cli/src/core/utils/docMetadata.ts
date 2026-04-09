/**
 * Document Metadata Utilities
 *
 * Reads/writes consumption metadata embedded in design documents.
 *
 * MD files use YAML frontmatter:
 *   ---
 *   ant:
 *     status: draft | active | consumed
 *     consumedBy: job-abc123
 *     consumedAt: 2026-04-09T10:30
 *   ---
 *
 * JSON files use a top-level `_ant` field:
 *   { "_ant": { "status": "consumed", ... }, ...data }
 */

export type DocStatus = 'draft' | 'active' | 'consumed';

export interface DocMeta {
  status: DocStatus;
  consumedBy?: string;
  consumedAt?: string;
}

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n?/;

/**
 * Extract metadata from a document's content string.
 * Returns null if no metadata is present.
 */
export function readDocMeta(content: string, isJson: boolean): DocMeta | null {
  if (isJson) {
    try {
      const parsed = JSON.parse(content);
      if (parsed?._ant && typeof parsed._ant === 'object') {
        return {
          status: parsed._ant.status || 'draft',
          consumedBy: parsed._ant.consumedBy || undefined,
          consumedAt: parsed._ant.consumedAt || undefined,
        };
      }
    } catch { /* not valid JSON or no _ant field */ }
    return null;
  }

  const match = content.match(FRONTMATTER_RE);
  if (!match) return null;

  const yaml = match[1];
  const statusMatch = yaml.match(/status:\s*(draft|active|consumed)/);
  if (!statusMatch) return null;

  const consumedByMatch = yaml.match(/consumedBy:\s*(.+)/);
  const consumedAtMatch = yaml.match(/consumedAt:\s*(.+)/);

  return {
    status: statusMatch[1] as DocStatus,
    consumedBy: consumedByMatch?.[1]?.trim() || undefined,
    consumedAt: consumedAtMatch?.[1]?.trim() || undefined,
  };
}

/**
 * Update or insert metadata into a document's content string.
 * Preserves the document body.
 */
export function writeDocMeta(content: string, meta: DocMeta, isJson: boolean): string {
  if (isJson) {
    try {
      const parsed = JSON.parse(content);
      parsed._ant = {
        status: meta.status,
        ...(meta.consumedBy && { consumedBy: meta.consumedBy }),
        ...(meta.consumedAt && { consumedAt: meta.consumedAt }),
      };
      return JSON.stringify(parsed, null, 2);
    } catch {
      return content;
    }
  }

  const frontmatter = [
    '---',
    'ant:',
    `  status: ${meta.status}`,
    ...(meta.consumedBy ? [`  consumedBy: ${meta.consumedBy}`] : []),
    ...(meta.consumedAt ? [`  consumedAt: ${meta.consumedAt}`] : []),
    '---',
  ].join('\n');

  const existing = content.match(FRONTMATTER_RE);
  if (existing) {
    return content.replace(FRONTMATTER_RE, frontmatter + '\n');
  }
  return frontmatter + '\n' + content;
}

/**
 * Mark a document as consumed by a specific job.
 */
export function buildConsumedMeta(jobId: string): DocMeta {
  return {
    status: 'consumed',
    consumedBy: jobId,
    consumedAt: new Date().toISOString(),
  };
}
