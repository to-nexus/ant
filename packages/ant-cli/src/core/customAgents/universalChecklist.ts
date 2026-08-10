/**
 * Universal checklist — parse/serialize for the `<checklist>` canonical tag.
 *
 * The universal job has no task plane (no TaskQueue, no decompose); its
 * lightweight to-do list is authored by the agent LLM as a `<checklist>`
 * tag in its streamed text and rendered on the FE's dedicated Checklist
 * surface (never as kanban task cards). Contract:
 *
 *   - Full-replace semantics: every emit carries the WHOLE list; the last
 *     occurrence in a round wins. No diff protocol.
 *   - FIFO: items run in declared order, at most one 'active' at a time
 *     (the parser normalizes extras — the loop is a single sequential LLM).
 *   - Creation threshold: a checklist exists only when the work decomposes
 *     into 2+ deliverables. A NEW checklist (none carried on the turn) with
 *     fewer than 2 items is dropped; an UPDATE of an existing one may shrink
 *     to any size (finishing a list legitimately passes through 1 item).
 *   - `<checklist plan="relative/path.md">` records the plan document the
 *     list was derived from — display/restore metadata only.
 */

import type { UniversalChecklist, UniversalChecklistItem, UniversalChecklistItemState } from '@ant/shared';

/** Hard cap on items per checklist — beyond this the tail is dropped. */
export const CHECKLIST_MAX_ITEMS = 30;

const CHECKLIST_TAG_PATTERN = /<checklist(\s[^>]*)?>\s*([\s\S]*?)\s*<\/checklist>/gi;
const PLAN_ATTR_PATTERN = /\bplan\s*=\s*"([^"]*)"/i;
const ITEM_LINE_PATTERN = /^\s*[-*]\s*\[([ ~xX])\]\s*(.+?)\s*$/;

function stateForMark(mark: string): UniversalChecklistItemState {
  if (mark === '~') return 'active';
  if (mark.toLowerCase() === 'x') return 'done';
  return 'pending';
}

/**
 * Parse the LAST `<checklist>` occurrence in `text` (full-replace: later
 * emits supersede earlier ones within the same round).
 *
 * Returns `undefined` when no well-formed checklist is present, or when a
 * NEW checklist (`hasExisting: false`) carries fewer than 2 items — the
 * creation threshold; single-deliverable work never materializes a list.
 */
export function parseChecklistTag(
  text: string,
  opts: { hasExisting: boolean },
): UniversalChecklist | undefined {
  let last: RegExpExecArray | null = null;
  CHECKLIST_TAG_PATTERN.lastIndex = 0;
  for (let m = CHECKLIST_TAG_PATTERN.exec(text); m; m = CHECKLIST_TAG_PATTERN.exec(text)) {
    last = m;
  }
  if (!last) return undefined;

  const attrs = last[1] ?? '';
  const body = last[2] ?? '';
  const sourcePlanPath = PLAN_ATTR_PATTERN.exec(attrs)?.[1]?.trim() || undefined;

  const items: UniversalChecklistItem[] = [];
  let activeSeen = false;
  for (const line of body.split('\n')) {
    if (items.length >= CHECKLIST_MAX_ITEMS) break;
    const m = ITEM_LINE_PATTERN.exec(line);
    if (!m) continue; // malformed lines are skipped, not fatal
    let state = stateForMark(m[1]);
    // FIFO: at most one active item — extras demote to pending.
    if (state === 'active') {
      if (activeSeen) state = 'pending';
      else activeSeen = true;
    }
    items.push({ id: `item-${items.length + 1}`, text: m[2], state });
  }

  if (items.length === 0) return undefined;
  if (!opts.hasExisting && items.length < 2) {
    console.log(`📋 [UniversalChecklist] New checklist below creation threshold (${items.length} item) — skipped`);
    return undefined;
  }

  return { items, sourcePlanPath, updatedAt: new Date().toISOString() };
}

/** Render a checklist back to the tag's line format (prompt "Working Checklist" block). */
export function serializeChecklist(checklist: UniversalChecklist): string {
  const mark = (state: UniversalChecklistItemState): string =>
    state === 'done' ? 'x' : state === 'active' ? '~' : ' ';
  return checklist.items.map((i) => `- [${mark(i.state)}] ${i.text}`).join('\n');
}
