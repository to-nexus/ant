/**
 * sessionDigest — compact summary of recent session turns for triage context.
 *
 * Injected into the triage prompt so it can detect conversational intent
 * (follow-up questions, continuation of previous work, etc.).
 * Returns undefined when no session entries exist; triage skips the section.
 */

import type { ConversationMessage } from '../conversations';

export function buildSessionDigest(entries: ConversationMessage[]): string | undefined {
  if (!entries || entries.length === 0) return undefined;

  const recentEntries = entries.slice(-3);

  const lines: string[] = [];
  for (const entry of recentEntries) {
    const role = entry.role === 'user' ? 'User' : entry.role === 'assistant' ? 'Assistant' : 'System';
    const contentStr = typeof entry.content === 'string' ? entry.content : JSON.stringify(entry.content);

    const maxLen = entry.role === 'user' ? 300 : 200;
    const truncated = contentStr.length > maxLen
      ? contentStr.substring(0, maxLen) + '...'
      : contentStr;

    const meta = entry.metadata;
    let metaHint = '';
    if (meta?.hasArtifact && meta.artifactPath) {
      metaHint = ` (generated ${meta.artifactPath}, ${contentStr.length} chars)`;
    }

    lines.push(`[${role}]${metaHint}: ${truncated}`);
  }

  return lines.join('\n');
}
