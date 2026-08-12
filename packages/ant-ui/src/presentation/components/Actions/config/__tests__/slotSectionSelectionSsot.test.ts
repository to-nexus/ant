/**
 * Selection-as-SSOT — the action-tab config panel's display contract.
 *
 * `actionMetadata.refs` / `.context` is the selection SSOT: the chat badge row,
 * `useActionFooterPolicy`'s build gate, and the BE's RAC (`refs ∪ context`) all
 * read it directly. The config panel used to render from the slot CATALOG
 * instead (`slots.context` → `resolveSlotEntries`), demoting the selection to a
 * highlight-only `Set`. Consequences, all reproduced as rows below:
 *
 *   - an intent declaring `context: []` (every `explain-*` / `ask-*`,
 *     `gen-ui-desc`, `gen-visual-*`, `gen-learn`) rendered "None" no matter how
 *     many files were attached — the bug as reported, on 설명-기반 UI 설계
 *   - a path outside every declared slot dir (free-add picker) had no card
 *   - a bare DIRECTORY selection never matched, because catalog entries are
 *     always files
 *
 * `resolveSlotSection` is the one derivation that owns this. The catalog
 * supplies candidates; anything selected it does not cover comes back as
 * `added`, and `isEmpty` is the only legal gate for the "None" prose.
 */

import { describe, it, expect } from 'vitest';
import { getConfigSlots } from '@ant/shared';
import type { SlotDef } from '@ant/shared';
import type { FileNode } from '@/infrastructure/http/api';
import { resolveSlotSection } from '../resolveSlots';
import { shouldSeedSlotDefaults } from '../seedDefaults';

const file = (name: string, path: string): FileNode => ({ name, path, type: 'file' });
const dir = (name: string, path: string, children: FileNode[]): FileNode => ({
  name, path, type: 'directory', children,
});

/** plan/prd.md + plan/notes.md, docs/a.md + docs/b.md, README.md at root. */
const TREE: FileNode[] = [
  dir('plan', 'plan', [file('prd.md', 'plan/prd.md'), file('notes.md', 'plan/notes.md')]),
  dir('docs', 'docs', [file('a.md', 'docs/a.md'), file('b.md', 'docs/b.md')]),
  file('README.md', 'README.md'),
];

const planDir: SlotDef = {
  path: 'plan', label: { en: 'Sources', ko: '소스' }, type: 'dir', required: true,
};
const emptyRefLike: SlotDef = {
  path: '', label: { en: 'Chat', ko: '채팅' }, type: 'file', required: false,
  emptyHint: { en: 'Describe it in chat', ko: '채팅으로 설명하세요' },
};

describe('resolveSlotSection — selection is the SSOT, the catalog is candidates', () => {
  it('no declared slots + nothing selected → isEmpty (the "None" prose is legal here)', () => {
    const view = resolveSlotSection([], TREE, new Set());
    expect(view.isEmpty).toBe(true);
    expect(view.added).toEqual([]);
    expect(view.entries).toEqual([]);
  });

  it('no declared slots + a selection → NOT empty, selection surfaces as added', () => {
    const view = resolveSlotSection([], TREE, new Set(['README.md', 'docs/a.md']));
    expect(view.isEmpty).toBe(false);
    expect(view.added.map(e => e.rawPath).sort()).toEqual(['README.md', 'docs/a.md']);
  });

  it('emptyHint-only refs slot + a selection → NOT empty (ask-* / gen-visual-* shape)', () => {
    const view = resolveSlotSection([emptyRefLike], TREE, new Set(['README.md']));
    expect(view.isEmpty).toBe(false);
    expect(view.added.map(e => e.rawPath)).toEqual(['README.md']);
  });

  it('emptyHint-only refs slot + nothing selected → isEmpty (hint prose still shows)', () => {
    expect(resolveSlotSection([emptyRefLike], TREE, new Set()).isEmpty).toBe(true);
  });

  it('a path the catalog already covers is an entry, never a duplicate added card', () => {
    const view = resolveSlotSection([planDir], TREE, new Set(['plan/prd.md']));
    expect(view.entries[0].files.map(f => f.path)).toContain('plan/prd.md');
    expect(view.added).toEqual([]);
    expect(view.isEmpty).toBe(false);
  });

  it('a path outside every slot dir is added even when the catalog is non-empty', () => {
    const view = resolveSlotSection([planDir], TREE, new Set(['plan/prd.md', 'README.md']));
    expect(view.added.map(e => e.rawPath)).toEqual(['README.md']);
  });

  it('a bare directory selection surfaces as a folder entry (catalog entries are files only)', () => {
    const view = resolveSlotSection([planDir], TREE, new Set(['docs']));
    expect(view.added).toHaveLength(1);
    expect(view.added[0]).toMatchObject({ rawPath: 'docs', isFolder: true, display: 'docs/' });
  });

  it('a fully-selected directory collapses to ONE folder entry with a file count', () => {
    const view = resolveSlotSection([], TREE, new Set(['docs/a.md', 'docs/b.md']));
    expect(view.added).toHaveLength(1);
    expect(view.added[0]).toMatchObject({ rawPath: 'docs', isFolder: true, fileCount: 2 });
  });

  it('a partially-selected directory stays as individual file entries', () => {
    const view = resolveSlotSection([], TREE, new Set(['docs/a.md']));
    expect(view.added).toHaveLength(1);
    expect(view.added[0]).toMatchObject({ rawPath: 'docs/a.md', isFolder: false, display: 'a.md' });
  });

  it('with no tree to collapse against, paths pass through instead of vanishing', () => {
    const view = resolveSlotSection([], [], new Set(['docs/a.md']));
    expect(view.added.map(e => e.rawPath)).toEqual(['docs/a.md']);
  });

  /**
   * The cross-slot hide: `refs` passes `selectedCtx` as `excludePaths` and vice
   * versa, so a path attached as context but living under a REFS slot dir gets
   * filtered out of the refs listing. Before this derivation it then appeared
   * nowhere at all — hidden from refs by the exclusion, and absent from context
   * because no context slot covered it.
   */
  it('a path selected as context but living under a refs slot dir appears in context', () => {
    const selectedCtx = new Set(['plan/notes.md']);
    const refs = resolveSlotSection([planDir], TREE, new Set(), { excludePaths: selectedCtx });
    const ctx = resolveSlotSection([], TREE, selectedCtx, { excludePaths: new Set() });

    expect(refs.entries[0].files.map(f => f.path)).not.toContain('plan/notes.md');
    expect(ctx.added.map(e => e.rawPath)).toEqual(['plan/notes.md']);
  });

  /** The reported defect, against the real matrix rather than a fixture. */
  it.each([
    'gen-ui-desc',
    'explain-sys',
    'explain-plan',
    'explain-code',
    'ask-general',
    'gen-learn',
  ] as const)('%s (declares context: []) still shows an attached context file', (intent) => {
    const slots = getConfigSlots(intent, { hasCodebase: false });
    expect(slots).not.toBeNull();
    expect(slots!.context).toEqual([]);

    const view = resolveSlotSection(slots!.context, TREE, new Set(['README.md']));
    expect(view.isEmpty).toBe(false);
    expect(view.added.map(e => e.rawPath)).toEqual(['README.md']);
  });
});

/**
 * The seeding effect used to run on every MOUNT, so simply arriving at the
 * panel re-derived default refs and cleared context. `ActionsPanel` unmounts
 * the view for the `basis-edit` step, so basis wizard → back wiped the
 * selection; so did attaching context in the chat composer first.
 */
describe('shouldSeedSlotDefaults — defaults may not clobber a live selection', () => {
  it.each([
    // metaIntent, viewIntent, hasSelection, expected
    ['gen-plan', 'gen-ui-desc', false, true],   // genuine intent switch
    ['gen-plan', 'gen-ui-desc', true, true],    // switch wins over a stale selection
    [undefined, 'gen-ui-desc', false, true],    // nothing seeded yet
    ['gen-ui-desc', 'gen-ui-desc', false, true],  // same intent, untouched → seed
    ['gen-ui-desc', 'gen-ui-desc', true, false],  // same intent, user has chosen → hands off
  ] as const)('meta=%s view=%s hasSelection=%s → %s', (metaIntent, viewIntent, hasSelection, expected) => {
    expect(shouldSeedSlotDefaults({ metaIntent, viewIntent, hasSelection })).toBe(expected);
  });
});
