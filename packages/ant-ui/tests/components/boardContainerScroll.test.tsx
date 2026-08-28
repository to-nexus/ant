/**
 * BoardContainer body scroll — the checklist board was hard-clipped at the
 * bottom because `overflow-y-auto` was gated on `isKanbanBoard && horizontal`,
 * and the element emitted `overflow-hidden` alongside it so the outcome hung
 * on Tailwind's class order. The verdict is now computed once.
 */
import { describe, expect, it } from 'vitest';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { BoardContainer } from '../../src/presentation/components/BoardContainer';

/** Class list of the body div (the container's last child). */
function bodyClasses(props: { className?: string; scrollBody?: boolean }): string {
  let tree: ReactTestRenderer | undefined;
  act(() => {
    tree = create(
      <BoardContainer className={props.className} scrollBody={props.scrollBody}>
        <span>item</span>
      </BoardContainer>,
    );
  });
  const root = tree!.toJSON() as any;
  const body = root.children[root.children.length - 1];
  return body.props.className as string;
}

describe('BoardContainer body scroll', () => {
  it('scrollBody opts the body into vertical scroll', () => {
    const cls = bodyClasses({ className: 'checklist-board', scrollBody: true });
    expect(cls).toContain('overflow-y-auto');
    expect(cls).toContain('min-h-0');
  });

  it('omitting scrollBody leaves a non-kanban board unscrolled', () => {
    expect(bodyClasses({ className: 'checklist-board' })).not.toContain('overflow-y-auto');
  });

  it('the legacy kanban-horizontal sniff still scrolls', () => {
    expect(bodyClasses({ className: 'kanban-board horizontal' })).toContain('overflow-y-auto');
  });

  it('a kanban vertical split still does not scroll at board level', () => {
    expect(bodyClasses({ className: 'kanban-board vertical' })).not.toContain('overflow-y-auto');
  });

  it('never emits both overflow verdicts on the same element', () => {
    for (const props of [
      { className: 'checklist-board', scrollBody: true },
      { className: 'checklist-board' },
      { className: 'kanban-board horizontal' },
      { className: 'kanban-board vertical' },
    ]) {
      const cls = bodyClasses(props);
      expect(cls.includes('overflow-y-auto') && cls.includes('overflow-hidden')).toBe(false);
    }
  });
});
