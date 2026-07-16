/**
 * Compaction of an over-budget child report into its parent-facing inline
 * form: lead (the answer — the child prompt mandates lead-with-answer) + a
 * deterministic structural outline of the WHOLE document (markdown headings
 * with char offsets) + a drill-down notice pointing at the `subagent_report`
 * tool. The decompaction counterpart is reportStore.ts. No LLM call involved.
 *
 * Invariant: nothing emitted here may contain the literal `[SUBAGENT REPORT`
 * or `Subagent launched (id:` — detectOrphanedLaunches (drain.ts) regex-scans
 * all history text and either literal would corrupt ack↔marker pairing.
 * Lowercase `subagent_report` (the tool name) is safe.
 */

const HEADING_RE = /^#{1,4}\s.+$/gm;

/** Chars reserved for the drill-down notice when sizing the lead. */
const NOTICE_RESERVE = 360;

/** Outline block ceiling — a pathological heading-only report must not eat the lead. */
const MAX_OUTLINE_CHARS = 2_400;

export interface OutlineEntry {
  offset: number;
  heading: string;
}

export function extractOutline(full: string): OutlineEntry[] {
  const out: OutlineEntry[] = [];
  for (const m of full.matchAll(HEADING_RE)) {
    out.push({ offset: m.index ?? 0, heading: m[0].trim() });
  }
  return out;
}

function buildOutlineBlock(outline: OutlineEntry[]): string {
  const header = '\n\n---\nDocument outline (char offsets for the subagent_report tool):\n';
  const lines: string[] = [];
  let size = header.length;
  for (const e of outline) {
    const line = `- [offset ${e.offset}] ${e.heading}`;
    if (size + line.length + 1 > MAX_OUTLINE_CHARS) {
      lines.push(`- (… ${outline.length - lines.length} more sections — page sequentially)`);
      break;
    }
    lines.push(line);
    size += line.length + 1;
  }
  return header + lines.join('\n');
}

function buildNotice(omitted: number, total: number, id: string, withOutline: boolean): string {
  const how = withOutline
    ? 'an offset from the outline above (or page sequentially)'
    : 'an offset (page sequentially)';
  return (
    `\n\n[... ${omitted} of ${total} chars not inlined. The full report is retained — ` +
    `call the subagent_report tool with id "${id}" and ${how} to read the omitted ` +
    `content in full. The user can open the complete report from the report card. ...]`
  );
}

/** Cut at a line boundary near `budget` so the lead never ends mid-line. */
function lineBoundedSlice(full: string, budget: number): string {
  if (budget >= full.length) return full;
  const nl = full.lastIndexOf('\n', budget);
  return full.slice(0, nl > budget * 0.5 ? nl : budget);
}

/**
 * Compact an over-budget report to ≈`cap` chars. Reports with structure (2+
 * headings) get lead + full-document outline + notice; unstructured reports
 * fall back to head + notice + tail.
 */
export function compactReport(full: string, cap: number, id: string): string {
  if (full.length <= cap) return full;
  const outline = extractOutline(full);

  if (outline.length >= 2) {
    const outlineBlock = buildOutlineBlock(outline);
    const leadBudget = Math.max(200, cap - outlineBlock.length - NOTICE_RESERVE);
    const lead = lineBoundedSlice(full, leadBudget);
    const notice = buildNotice(full.length - lead.length, full.length, id, true);
    return lead + outlineBlock + notice;
  }

  const bodyBudget = Math.max(200, cap - NOTICE_RESERVE);
  const headBudget = Math.max(1, Math.floor(bodyBudget * 0.75));
  const head = lineBoundedSlice(full, headBudget);
  // Tail never overlaps the head (pathologically small caps in tests/tuning).
  const tailStart = Math.max(head.length, full.length - Math.max(0, bodyBudget - head.length));
  const tail = full.slice(tailStart);
  const notice = buildNotice(full.length - head.length - tail.length, full.length, id, false);
  return head + notice + tail;
}
