/**
 * Attached-context (`@ctx:`) prompt band for the universal agent.
 *
 * Universal has no RAC/artifact pool, so text attachments are never
 * eager-loaded. What the prompt must still do is keep the shared `read_file`
 * contract honest: full reads above `READ_FILE_FULL_READ_LIMIT` are refused
 * with a range instruction that assumes an outline exists in the prompt — so
 * a large attachment gets that outline here (the Compact half of the
 * canonical Compact ↔ Decompact cycle), and a directory attachment gets a
 * `list_files`-first instruction instead of a dead "read each" promise.
 *
 * Images are the one eager-loaded kind: a pin whose BYTES are a supported
 * image (magic-byte sniff — the same `detectImageMimeFromBuffer` SSOT the
 * canonical vision builder uses; extensions are never trusted) becomes a
 * base64 vision block on the current user message, and its prompt line says
 * so. The line and the block are computed together here so they cannot
 * disagree — a line claiming the model can see an image that was never
 * attached is the near-loading-brace failure shape.
 */

import * as fs from 'fs';
import { parseUniversalAgentRef } from '@ant/shared';
import type { CustomAgentScopeRoot } from '../../../../core/customAgents/CustomAgentLoader';
import type { ImageContentBlock } from '../../../../core/ports/llm';
import { resolveUniversalAgentPlanePath } from '../../../../core/customAgents/universalAgentPlane';
import { compactContent } from '../../../../core/utils/contentCompactor';
import {
  READ_FILE_FULL_READ_LIMIT,
  READ_FILE_RANGE_MAX_BYTES,
} from '../../../common/tool/handlers/readFile';
import { formatByteSize } from '../../../../core/utils/binaryExtensions';
import {
  detectImageMimeFromBuffer,
  resolveImageAttachBudgets,
  type AnthropicImageMime,
  type ImageAttachBudgets,
} from '../../../../core/utils/imageMime';

export type AttachedEntryKind =
  /** Attached, then deleted before the turn ran — degrade, never throw. */
  | 'missing'
  | 'directory'
  /** Bytes are a supported image — the vision channel, not read_file. */
  | 'image'
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
  /** Magic-byte verdict for file entries; absent/null = not an image. */
  imageMime?: AnthropicImageMime | null;
}): AttachedEntryKind {
  if (!stat.exists) return 'missing';
  if (stat.isDirectory) return 'directory';
  if (stat.imageMime) return 'image';
  if (stat.sizeBytes > READ_FILE_RANGE_MAX_BYTES) return 'oversize-file';
  if (stat.sizeBytes > READ_FILE_FULL_READ_LIMIT) return 'large-file';
  return 'file';
}

/** Magic-byte head window — the longest signature (WEBP) needs 12 bytes. */
const IMAGE_SNIFF_BYTES = 16;

function sniffImageMime(absPath: string): AnthropicImageMime | null {
  let fd: number;
  try {
    fd = fs.openSync(absPath, 'r');
  } catch {
    return null;
  }
  try {
    const buf = Buffer.alloc(IMAGE_SNIFF_BYTES);
    const read = fs.readSync(fd, buf, 0, IMAGE_SNIFF_BYTES, 0);
    return detectImageMimeFromBuffer(buf.subarray(0, read));
  } catch {
    return null;
  } finally {
    fs.closeSync(fd);
  }
}

export interface AttachedContextResult {
  /** The `## Attached Context` section, or null when nothing is attached. */
  section: string | null;
  /**
   * Vision blocks for the image pins the budgets admitted, in pin order.
   * Attach to the CURRENT user message only (never persisted — base64 must
   * not enter the session history).
   */
  imageBlocks: ImageContentBlock[];
}

interface VisionOptions {
  /** False when the provider cannot take image blocks — lines degrade honestly. */
  enabled: boolean;
  budgets?: ImageAttachBudgets;
}

/**
 * Build the attached-context band AND the vision blocks in one pass, so the
 * prose about each image (attached / too large / provider can't view) always
 * matches what is actually sent.
 */
export function buildAttachedContext(
  containerPath: string,
  attachedContext: readonly string[],
  scopeRoots: CustomAgentScopeRoot[] = [],
  vision: VisionOptions = { enabled: false },
): AttachedContextResult {
  if (attachedContext.length === 0) return { section: null, imageBlocks: [] };

  const budgets = vision.budgets ?? resolveImageAttachBudgets();
  const imageBlocks: ImageContentBlock[] = [];
  let totalImageBytes = 0;

  const lines = attachedContext.map((rel) => {
    const ctx = { containerPath, scopeRoots };
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
    const isFile = stat !== null && !stat.isDirectory();
    const kind = classifyAttachedEntry({
      exists: stat !== null,
      isDirectory: stat?.isDirectory() ?? false,
      sizeBytes: stat?.size ?? 0,
      imageMime: isFile ? sniffImageMime(full!) : null,
    });

    switch (kind) {
      case 'missing':
        return `- ${label} — no longer exists (removed after it was attached)`;
      case 'directory':
        return `- ${label} — directory: explore with \`list_files\`, then \`read_file\` only what you need`;
      case 'image': {
        const size = stat!.size;
        if (!vision.enabled) {
          return `- ${label} — image (${formatByteSize(size)}): the current model cannot view images; reason from its name and ask the user for what it shows if needed`;
        }
        if (size > budgets.maxBytesPerImage) {
          return `- ${label} — image (${formatByteSize(size)}): too large to attach (limit ${formatByteSize(budgets.maxBytesPerImage)}); ask the user for a smaller export if its content matters`;
        }
        if (imageBlocks.length >= budgets.maxImages || totalImageBytes + size > budgets.maxTotalBytes) {
          return `- ${label} — image (${formatByteSize(size)}): not attached (image budget for this turn is already spent)`;
        }
        try {
          const buf = fs.readFileSync(full!);
          // Re-sniff the full buffer — the block's media_type must match the
          // bytes Anthropic will verify (sage-orbiting-grain).
          const mime = detectImageMimeFromBuffer(buf);
          if (!mime) {
            return `- ${label} — unreadable image file; ask the user to re-export it`;
          }
          imageBlocks.push({ type: 'image', source: { type: 'base64', media_type: mime, data: buf.toString('base64') } });
          totalImageBytes += size;
          return `- ${label} — image (${mime}, ${formatByteSize(size)}): attached to this message — you can see it directly`;
        } catch {
          return `- ${label} — image could not be read from disk`;
        }
      }
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
  });

  const section =
    `## Attached Context (user-specified)\n` +
    `The user attached these workspace paths to this request:\n` +
    lines.join('\n');
  return { section, imageBlocks };
}

/** Text-only projection (vision off) — kept for callers that render prose only. */
export function buildAttachedContextSection(
  containerPath: string,
  attachedContext: readonly string[],
  scopeRoots: CustomAgentScopeRoot[] = [],
): string | null {
  return buildAttachedContext(containerPath, attachedContext, scopeRoots).section;
}
