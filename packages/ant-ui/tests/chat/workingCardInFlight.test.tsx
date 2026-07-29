/**
 * WorkingCard in-flight presentation — two rules with DIFFERENT scopes.
 *
 * Rule 1 (chat-wide): the icon slot is the sole carrier of progress state.
 *   Every in-flight variant renders <Spinner>; none signals "in flight" by
 *   pulsing a static icon. TerminalCard / FileCard already obeyed this; the
 *   four WorkingCard variants that used `animate-status-pulse` (grepping /
 *   reading / reading_source / reading_state) were the last exceptions.
 *
 * Rule 2 (borderless one-liners ONLY): in-flight rows drop the tinted box.
 *   This is deliberately NOT chat-wide — TerminalCard and FileCard keep their
 *   TurnCardShell while running because they stream stdout / diffs into it.
 *   The box marks "card with a body", not "work in progress". The last test
 *   pins that boundary so the borderless rule cannot creep into body-bearing
 *   cards.
 *
 * Plus a dispatch guard: `searching_reference` / `searched_reference` are
 * emitted by the BE but were missing from TurnItem's WorkingCard case group,
 * so they fell through to `default: return null` and never rendered.
 */

import { describe, it, expect, vi } from 'vitest';
import { readFile } from 'fs/promises';
import * as path from 'path';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import type { ChatStatusLine } from '@ant/shared';

vi.mock('@/domain/store', () => ({
  useStore: (selector: (s: any) => any) =>
    selector({ selectedFile: undefined, selectFile: vi.fn(), setFileViewMode: vi.fn() }),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string, o?: any) => (o ? `${k}:${JSON.stringify(o)}` : k) }),
}));
vi.mock('@/presentation/components/common/async', () => ({
  Spinner: () => 'SPINNER_SENTINEL',
}));

import { WorkingCard } from '../../src/presentation/components/chat/WorkingCard';

/** Every in-flight variant `isProgressState` recognises. */
const IN_FLIGHT = [
  'exploring', 'retrieving', 'grepping', 'listing_files', 'searching_code',
  'searching_reference', 'reading', 'reading_state', 'reading_source',
  'indexing', 'analyzing', 'loading', 'storing', 'learning', 'processing',
  'downloading', 'figma_calling',
] as const;

const TERMINAL = [
  'explored', 'retrieved', 'grepped', 'listed_files', 'searched_code',
  'searched_reference', 'read', 'read_state', 'read_source', 'indexed',
  'analyzed', 'loaded', 'stored', 'learned', 'processed', 'downloaded',
  'figma_called',
] as const;

function line(statusType: string, metadata: Record<string, any> = {}): ChatStatusLine {
  return {
    type: 'chat_status', ts: 't0', jobId: 'j', turnId: 'turn-1', jobType: 'code',
    cardId: 'card-1', statusType, metadata,
  } as any;
}

function render(el: React.ReactElement): ReactTestRenderer {
  let tree: ReactTestRenderer | undefined;
  act(() => { tree = create(el); });
  return tree!;
}

/** Walks the rendered tree collecting every inline `style` object. */
function styles(node: any, out: Record<string, unknown>[] = []): Record<string, unknown>[] {
  if (!node || typeof node !== 'object') return out;
  if (node.props?.style && typeof node.props.style === 'object') out.push(node.props.style);
  (node.children ?? []).forEach((c: any) => styles(c, out));
  return out;
}

describe('WorkingCard — icon slot is the sole progress signal (chat-wide rule)', () => {
  it.each(IN_FLIGHT)('%s renders a Spinner and never pulses a static icon', (variant) => {
    const dump = JSON.stringify(render(
      <WorkingCard line={line(variant)} variant={variant as any} />,
    ).toJSON());
    expect(dump).toContain('SPINNER_SENTINEL');
    expect(dump).not.toContain('animate-status-pulse');
  });

  it.each(TERMINAL)('%s renders a settled icon, not a Spinner', (variant) => {
    const dump = JSON.stringify(render(
      <WorkingCard line={line(variant)} variant={variant as any} />,
    ).toJSON());
    expect(dump).not.toContain('SPINNER_SENTINEL');
    expect(dump).not.toContain('animate-status-pulse');
  });
});

describe('WorkingCard — in-flight rows are borderless', () => {
  it('no background / border on a plain in-flight row', () => {
    const tree = render(<WorkingCard line={line('reading', { filePath: 'src/a.ts' })} variant="reading" />);
    for (const s of styles(tree.toJSON())) {
      expect(s.background).toBeUndefined();
      expect(s.border).toBeUndefined();
    }
  });

  it('no background / border on an AGGREGATED in-flight row (filesList present)', () => {
    // Aggregated buckets carry completed files while a later slot is still in
    // flight — this path used to fall through to the tinted TurnCardShell,
    // which would have made "single read = no box / aggregated read = box".
    const tree = render(
      <WorkingCard
        line={line('reading', { aggregated: true, filesCount: 2, filesList: [{ path: 'a.ts' }, { path: 'b.ts' }] })}
        variant="reading"
      />,
    );
    const collapsed = styles(tree.toJSON());
    expect(collapsed.every((s) => s.background === undefined && s.border === undefined)).toBe(true);
    // The chevron affordance still exists (the drawer is reachable).
    expect(tree.root.findAllByProps({ role: 'button' }).length).toBeGreaterThan(0);
  });

  it('expanded in-flight drawer frames itself (no enclosing shell to lean on)', () => {
    const tree = render(
      <WorkingCard
        line={line('reading', { aggregated: true, filesCount: 2, filesList: [{ path: 'a.ts' }, { path: 'b.ts' }] })}
        variant="reading"
      />,
    );
    act(() => { tree.root.findByProps({ role: 'button' }).props.onClick(); });
    const framed = styles(tree.toJSON()).filter(
      (s) => s.border === '1px solid var(--border-1)' && s.background === 'var(--bg-surface-2)',
    );
    expect(framed.length).toBe(1);
    expect(JSON.stringify(tree.toJSON())).toContain('a.ts');
  });

  it('terminal cards KEEP their tint — borderless is in-flight-only', () => {
    const tree = render(<WorkingCard line={line('read', { filePath: 'src/a.ts' })} variant="read" />);
    const tinted = styles(tree.toJSON()).filter(
      (s) => typeof s.background === 'string' && (s.background as string).startsWith('oklch(from var(--bg-surface-2)'),
    );
    expect(tinted.length).toBeGreaterThan(0);
  });
});

describe('status card dispatch — source-level guards', () => {
  const CHAT = path.resolve(__dirname, '..', '..', 'src', 'presentation', 'components', 'chat');

  it('reference-search cards route to WorkingCard instead of the null default', async () => {
    const src = await readFile(path.join(CHAT, 'TurnItem.tsx'), 'utf8');
    // The WorkingCard group is the run of `case` labels ending in the
    // WorkingCard return; both reference-search types must sit inside it.
    const group = src.slice(
      src.indexOf("case 'exploring':"),
      src.indexOf('<WorkingCard line={line} pending={pending} variant={line.statusType}'),
    );
    expect(group).toContain("case 'searching_reference':");
    expect(group).toContain("case 'searched_reference':");
    // The cast that hid the reading_state / read_state union gap is gone.
    expect(src).not.toContain('statusType as any');
  });

  it('body-bearing in-flight cards still use TurnCardShell (boundary of the borderless rule)', async () => {
    for (const file of ['TerminalCard.tsx', 'FileCard.tsx']) {
      const src = await readFile(path.join(CHAT, file), 'utf8');
      expect(src).toContain('<TurnCardShell');
    }
  });
});
