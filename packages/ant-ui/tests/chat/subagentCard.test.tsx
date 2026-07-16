/**
 * SubagentCard — running spinner state, terminal per-state rendering,
 * click-to-open (into a main-panel report tab) only when a report body exists.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import type { ChatStatusLine } from '@ant/shared';

const openReportEditorTab = vi.fn();

vi.mock('@/domain/store', () => ({
  useStore: (selector: (s: any) => any) => selector({ openReportEditorTab }),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string, o?: any) => (o ? `${k}:${JSON.stringify(o)}` : k) }),
}));
vi.mock('@/presentation/components/common/async', () => ({
  Spinner: () => null,
}));

import { SubagentCard } from '../../src/presentation/components/chat/SubagentCard';

function line(statusType: 'subagent_running' | 'subagent_report', metadata: Record<string, any>): ChatStatusLine {
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

beforeEach(() => openReportEditorTab.mockClear());

describe('SubagentCard', () => {
  it('running: shows the running label, no round chip, no button role', () => {
    const tree = render(<SubagentCard line={line('subagent_running', { goal: 'map auth', rounds: 2 })} />);
    const dump = JSON.stringify(tree.toJSON());
    expect(dump).toContain('subagent.running');
    // Round counter is intentionally not surfaced anymore.
    expect(dump).not.toContain('subagent.rounds');
    expect(dump).not.toContain('"role":"button"');
  });

  it('identity badge renders on running AND terminal cards', () => {
    const running = render(<SubagentCard line={line('subagent_running', { goal: 'g' })} />);
    expect(JSON.stringify(running.toJSON())).toContain('subagent.badge');
    const terminal = render(
      <SubagentCard line={line('subagent_report', { goal: 'g', state: 'done', report: 'r' })} />,
    );
    expect(JSON.stringify(terminal.toJSON())).toContain('subagent.badge');
  });

  it('terminal with report: clickable, opens a report editor tab', () => {
    const tree = render(
      <SubagentCard line={line('subagent_report', { goal: 'g', state: 'done', report: '# findings' })} />,
    );
    const root = tree.root.findByProps({ role: 'button' });
    act(() => { root.props.onClick(); });
    expect(openReportEditorTab).toHaveBeenCalledWith({
      cardId: 'card-1',
      goal: 'g',
      report: '# findings',
    });
    expect(JSON.stringify(tree.toJSON())).toContain('subagent.viewReport');
  });

  it('terminal without report: not clickable, shows noReport', () => {
    const tree = render(
      <SubagentCard line={line('subagent_report', { goal: 'g', state: 'error', error: 'boom' })} />,
    );
    expect(tree.root.findAllByProps({ role: 'button' })).toHaveLength(0);
    const dump = JSON.stringify(tree.toJSON());
    expect(dump).toContain('subagent.noReport');
    expect(dump).toContain('subagent.error');
  });

  it('per-state labels: partial and aborted', () => {
    for (const [state, key] of [['partial', 'subagent.partial'], ['aborted', 'subagent.aborted']] as const) {
      const tree = render(
        <SubagentCard line={line('subagent_report', { goal: 'g', state, report: 'r' })} />,
      );
      expect(JSON.stringify(tree.toJSON())).toContain(key);
    }
  });
});
