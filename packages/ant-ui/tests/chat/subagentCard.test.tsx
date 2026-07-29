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
  Spinner: () => 'SPINNER_SENTINEL',
  SunburstSpinner: (p: { tone?: string; className?: string }) =>
    `SUNBURST_SENTINEL:${p.tone}:${p.className}`,
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
  it('running: goal is the only visible text; the state label moves to aria-label', () => {
    const tree = render(<SubagentCard line={line('subagent_running', { goal: 'map auth', rounds: 2 })} />);
    const row = tree.root.findByProps({ role: 'status' });

    // The spinner is the sole VISUAL carrier of "in progress" — the running
    // label must not be rendered as text next to it.
    const visibleText = (function collect(node: any): string[] {
      if (typeof node === 'string') return [node];
      if (!node || typeof node !== 'object') return [];
      return (node.children ?? []).flatMap(collect);
    })(tree.toJSON());
    expect(visibleText).toContain('map auth');
    expect(visibleText.some((s) => s.includes('subagent.running'))).toBe(false);

    // ...but it survives for assistive tech.
    expect(row.props['aria-label']).toContain('subagent.running');

    // Round counter is intentionally not surfaced anymore.
    const dump = JSON.stringify(tree.toJSON());
    expect(dump).not.toContain('subagent.rounds');
    expect(dump).not.toContain('"role":"button"');
  });

  it('running row uses the sunburst glyph in the badge violet, never the thin ring', () => {
    const tree = render(<SubagentCard line={line('subagent_running', { goal: 'g' })} />);
    const dump = JSON.stringify(tree.toJSON());

    // `tone` must stay explicit: the default `muted` (--text-3) rendered as a
    // speck on this borderless line, which is why the glyph exists at all.
    expect(dump).toContain('SUNBURST_SENTINEL:accent');
    // The goal span is the only shrinkable item on the row.
    expect(dump).toContain('flex-shrink-0');
    expect(dump).not.toContain('SPINNER_SENTINEL');
  });

  it('running row is borderless — no background / border / shell', () => {
    const tree = render(<SubagentCard line={line('subagent_running', { goal: 'g' })} />);
    const row = tree.root.findByProps({ role: 'status' });
    const style = (row.props.style ?? {}) as Record<string, unknown>;
    expect(style.background).toBeUndefined();
    expect(style.border).toBeUndefined();
    // The shimmer clips a gradient to the TEXT, not to a row background.
    expect(JSON.stringify(tree.toJSON())).not.toContain('var(--bg-surface)');
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
