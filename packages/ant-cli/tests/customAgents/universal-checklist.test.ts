/**
 * Universal checklist axis — `<checklist>` parse/serialize tables:
 * full-replace (last occurrence wins), the ≥2-item creation threshold vs
 * update acceptance, FIFO single-active normalization, the `plan`
 * source attribute, the 30-item cap, and malformed-line tolerance.
 */

import { describe, it, expect } from 'vitest';
import {
  parseChecklistTag,
  serializeChecklist,
  CHECKLIST_MAX_ITEMS,
} from '../../src/core/customAgents/universalChecklist';

const NEW = { hasExisting: false };
const UPDATE = { hasExisting: true };

const list = (lines: string[], attrs = '') => `<checklist${attrs}>\n${lines.join('\n')}\n</checklist>`;

describe('parseChecklistTag — item table', () => {
  it('parses pending/active/done marks in declared order', () => {
    const cl = parseChecklistTag(list(['- [x] first', '- [~] second', '- [ ] third']), NEW)!;
    expect(cl.items).toEqual([
      { id: 'item-1', text: 'first', state: 'done' },
      { id: 'item-2', text: 'second', state: 'active' },
      { id: 'item-3', text: 'third', state: 'pending' },
    ]);
  });

  it.each([
    ['uppercase X counts as done', '- [X] done item', 'done'],
    ['asterisk bullets accepted', '* [ ] star item', 'pending'],
  ] as const)('%s', (_label, line, state) => {
    const cl = parseChecklistTag(list([line, '- [ ] filler']), NEW)!;
    expect(cl.items[0].state).toBe(state);
  });

  it('malformed lines are skipped, not fatal', () => {
    const cl = parseChecklistTag(list(['prose line', '- [ ] real one', '- broken []', '- [ ] real two']), NEW)!;
    expect(cl.items.map((i) => i.text)).toEqual(['real one', 'real two']);
  });

  it('FIFO: extra active items demote to pending (at most one [~])', () => {
    const cl = parseChecklistTag(list(['- [~] a', '- [~] b', '- [ ] c']), NEW)!;
    expect(cl.items.map((i) => i.state)).toEqual(['active', 'pending', 'pending']);
  });

  it(`caps at ${CHECKLIST_MAX_ITEMS} items`, () => {
    const lines = Array.from({ length: CHECKLIST_MAX_ITEMS + 10 }, (_, i) => `- [ ] item ${i}`);
    const cl = parseChecklistTag(list(lines), NEW)!;
    expect(cl.items).toHaveLength(CHECKLIST_MAX_ITEMS);
  });
});

describe('parseChecklistTag — creation threshold vs update', () => {
  it('NEW checklist with <2 items → dropped (single-deliverable work has no list)', () => {
    expect(parseChecklistTag(list(['- [ ] only one']), NEW)).toBeUndefined();
  });

  it('UPDATE may shrink to 1 item (finishing a list passes through 1)', () => {
    const cl = parseChecklistTag(list(['- [~] last one']), UPDATE)!;
    expect(cl.items).toHaveLength(1);
  });

  it('no tag / empty body → undefined', () => {
    expect(parseChecklistTag('no tag here', NEW)).toBeUndefined();
    expect(parseChecklistTag('<checklist></checklist>', UPDATE)).toBeUndefined();
  });
});

describe('parseChecklistTag — full-replace + plan attribute', () => {
  it('last occurrence wins (full-replace within a round)', () => {
    const text =
      list(['- [ ] a', '- [ ] b']) + '\nprose between\n' + list(['- [x] a', '- [~] b']);
    const cl = parseChecklistTag(text, NEW)!;
    expect(cl.items.map((i) => i.state)).toEqual(['done', 'active']);
  });

  it('plan attribute lands in sourcePlanPath', () => {
    const cl = parseChecklistTag(list(['- [ ] a', '- [ ] b'], ' plan="plan/ops/weekly/report.md"'), NEW)!;
    expect(cl.sourcePlanPath).toBe('plan/ops/weekly/report.md');
  });

  it('absent plan attribute → sourcePlanPath undefined', () => {
    const cl = parseChecklistTag(list(['- [ ] a', '- [ ] b']), NEW)!;
    expect(cl.sourcePlanPath).toBeUndefined();
  });
});

describe('serializeChecklist — round trip', () => {
  it('serializes back to the tag line format', () => {
    const cl = parseChecklistTag(list(['- [x] first', '- [~] second', '- [ ] third']), NEW)!;
    expect(serializeChecklist(cl)).toBe('- [x] first\n- [~] second\n- [ ] third');
  });

  it('parse(serialize(x)) is stable', () => {
    const original = parseChecklistTag(list(['- [x] a', '- [~] b', '- [ ] c']), NEW)!;
    const reparsed = parseChecklistTag(`<checklist>\n${serializeChecklist(original)}\n</checklist>`, UPDATE)!;
    expect(reparsed.items).toEqual(original.items);
  });
});
