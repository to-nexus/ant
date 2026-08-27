/**
 * Attached-context (`@ctx:`) prompt band for the universal agent.
 *
 * Universal has no RAC/artifact pool, so attachments are never eager-loaded.
 * What the prompt must still do is keep the shared `read_file` contract
 * honest: full reads above `READ_FILE_FULL_READ_LIMIT` are refused with a
 * range instruction that assumes an outline exists in the prompt — so a
 * large attachment gets that outline here (the Compact half of the
 * canonical Compact ↔ Decompact cycle), and a directory attachment gets a
 * `list_files`-first instruction instead of a dead "read each" promise.
 */

import * as fs from 'fs';
import { parseUniversalAgentRef } from '@ant/shared';
import type { CustomAgentScopeRoot } from '../../../../core/customAgents/CustomAgentLoader';
import { resolveUniversalAgentPlanePath } from '../../../../core/customAgents/universalAgentPlane';
import { compactContent } from '../../../../core/utils/contentCompactor';
import {
  READ_FILE_FULL_READ_LIMIT,
  READ_FILE_RANGE_MAX_BYTES,
} from '../../../common/tool/handlers/readFile';
import { formatByteSize } from '../../../../core/utils/binaryExtensions';

export type AttachedEntryKind =
  /** Attached, then deleted before the turn ran — degrade, never throw. */
  | 'missing'
  | 'directory'
  /** One-shot readable (≤ READ_FILE_FULL_READ_LIMIT). */
  | 'file'
  /** Full read refused — needs an inline outline + range reads. */
  | 'large-file'
  /** Beyond even the range-read ceiling — size note only. */
  | 'oversize-file';

/** Pure classifier — the prompt branch is decided here, table-testable. */
export function classifyAttachedEntry(stat: {
  exists: boolean;
  isDirectory: boolean;
  sizeBytes: number;
}): AttachedEntryKind {
  if (!stat.exists) return 'missing';
  if (stat.isDirectory) return 'directory';
  if (stat.sizeBytes > READ_FILE_RANGE_MAX_BYTES) return 'oversize-file';
  if (stat.sizeBytes > READ_FILE_FULL_READ_LIMIT) return 'large-file';
  return 'file';
}

function renderEntry(rel: string, ctx: { containerPath: string; scopeRoots: CustomAgentScopeRoot[] }): string {
  let full: string | null = null;
  let stat: fs.Stats | null = null;
  try {
    full = resolveUniversalAgentPlanePath(rel, ctx).absPath;
    stat = fs.statSync(full);
  } catch {
    stat = null;
  }
  // A peer definition is named by WHOSE it is — `job.yaml` alone tells the
  // model nothing about which agent it is looking at.
  const peer = parseUniversalAgentRef(rel);
  const label = peer ? `\`${rel}\` — definition of agent \`${peer.agentId}\`` : `\`${rel}\``;
  const kind = classifyAttachedEntry({
    exists: stat !== null,
    isDirectory: stat?.isDirectory() ?? false,
    sizeBytes: stat?.size ?? 0,
  });

  switch (kind) {
    case 'missing':
      return `- ${label} — no longer exists (removed after it was attached)`;
    case 'directory':
      return `- ${label} — directory: explore with \`list_files\`, then \`read_file\` only what you need`;
    case 'file':
      return `- ${label} — read with \`read_file\` before acting`;
    case 'oversize-file':
      return (
        `- ${label} — very large file (${formatByteSize(stat!.size)}), beyond the read tool's ceiling; ` +
        `reason from its name/size or ask the user for the relevant part`
      );
    case 'large-file': {
      // Outline the exact set read_file refuses to one-shot, so the refusal
      // message's "outline in the prompt" is a real pointer, not a dead end.
      let outline: string | null = null;
      try {
        const content = fs.readFileSync(full!, 'utf-8');
        outline = compactContent(content, { threshold: 0, label: rel, filePath: rel }).content;
      } catch {
        outline = null;
      }
      const head =
        `- ${label} — large file (${formatByteSize(stat!.size)}): full read is refused; ` +
        `use the outline below with \`read_file("${rel}", startLine, endLine)\``;
      return outline ? `${head}\n\n${outline}\n` : head;
    }
  }
}

/** The `## Attached Context` section, or null when nothing is attached. */
export function buildAttachedContextSection(
  containerPath: string,
  attachedContext: readonly string[],
  scopeRoots: CustomAgentScopeRoot[] = [],
): string | null {
  if (attachedContext.length === 0) return null;
  return (
    `## Attached Context (user-specified)\n` +
    `The user attached these workspace paths to this request:\n` +
    attachedContext.map((p) => renderEntry(p, { containerPath, scopeRoots })).join('\n')
  );
}
