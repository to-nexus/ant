/**
 * SubagentReportOverlay — renders the persisted report, closes via button,
 * auto-closes on stale cardId; plus selectSubagentReportLine +
 * aggregateChatStatuses pass-through pins.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import type { ChatStatusLine } from '@ant/shared';

const closeSubagentReport = vi.fn();
let storeState: Record<string, any> = {};

vi.mock('@/domain/store', () => ({
  useStore: (selector: (s: any) => any) => selector(storeState),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
vi.mock('@/presentation/components/markdown/createMarkdownComponents', () => ({
  createMarkdownComponents: () => ({}),
}));
vi.mock('react-markdown', () => ({
  default: ({ children }: { children: string }) => children,
}));
vi.mock('remark-gfm', () => ({ default: () => undefined }));

import { SubagentReportOverlay } from '../../src/presentation/components/chat/SubagentReportOverlay';
import { selectSubagentReportLine } from '../../src/domain/store/selectors/chat';
import { aggregateChatStatuses } from '../../src/presentation/components/chat/aggregateChatStatuses';

function reportLine(cardId: string, metadata: Record<string, any>): ChatStatusLine {
  return {
    type: 'chat_status', ts: 't0', jobId: 'j', turnId: 'turn-1', jobType: 'code',
    cardId, statusType: 'subagent_report', metadata,
  } as any;
}

function render(el: React.ReactElement): ReactTestRenderer {
  let tree: ReactTestRenderer | undefined;
  act(() => { tree = create(el); });
  return tree!;
}

beforeEach(() => {
  closeSubagentReport.mockClear();
  storeState = { closeSubagentReport, openSubagentReportCardId: null, chatEvents: [] };
});

describe('SubagentReportOverlay', () => {
  it('renders the persisted report and closes via the close button', () => {
    storeState.openSubagentReportCardId = 'c1';
    storeState.chatEvents = [reportLine('c1', { goal: 'g', state: 'done', report: '# The findings' })];

    const tree = render(<SubagentReportOverlay />);
    const dump = JSON.stringify(tree.toJSON());
    expect(dump).toContain('The findings');
    expect(dump).toContain('subagent.overlay.title');
    // Identity badge next to the title.
    expect(dump).toContain('subagent.badge');

    const closeBtn = tree.root.findByProps({ 'aria-label': 'subagent.overlay.close' });
    act(() => { closeBtn.props.onClick(); });
    expect(closeSubagentReport).toHaveBeenCalled();
  });

  it('auto-closes when the cardId is stale (chat cleared)', () => {
    storeState.openSubagentReportCardId = 'gone';
    storeState.chatEvents = [];
    const tree = render(<SubagentReportOverlay />);
    expect(tree.toJSON()).toBeNull();
    expect(closeSubagentReport).toHaveBeenCalled();
  });

  it('renders nothing when closed', () => {
    const tree = render(<SubagentReportOverlay />);
    expect(tree.toJSON()).toBeNull();
  });
});

describe('selectSubagentReportLine', () => {
  it('finds the latest matching line; null on miss', () => {
    const state = {
      chatEvents: [
        reportLine('a', { report: 'old' }),
        reportLine('a', { report: 'new' }),
      ],
      streamingBuffers: {},
    } as any;
    expect((selectSubagentReportLine(state, 'a')?.metadata as any).report).toBe('new');
    expect(selectSubagentReportLine(state, 'zzz')).toBeNull();
    expect(selectSubagentReportLine(state, null)).toBeNull();
  });
});

describe('aggregateChatStatuses pass-through', () => {
  it('adjacent subagent_report lines are NOT coalesced', () => {
    const items = [
      { kind: 'status', line: reportLine('a', { goal: 'g1', state: 'done', report: 'r1' }) },
      { kind: 'status', line: reportLine('b', { goal: 'g2', state: 'done', report: 'r2' }) },
    ] as any[];
    const out = aggregateChatStatuses(items);
    expect(out).toHaveLength(2);
  });
});
