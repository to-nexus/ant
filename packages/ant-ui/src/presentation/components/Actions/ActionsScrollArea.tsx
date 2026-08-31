/**
 * Scroll body for every actions-panel grid step (canonical and universal).
 *
 * The scroller and the content box MUST stay separate elements: `items-center`
 * on an overflowing scroll container splits the overflow above and below the
 * box, and everything above `scrollTop: 0` is unreachable — that is what cut
 * off the first rows of a long intent list. Content is top-aligned; the grid
 * centers itself horizontally via its own `maxWidth` + auto margins.
 */

import { PageTransition } from './PageTransition';

const SCROLLER = 'flex-1 min-h-0 overflow-y-auto overflow-x-hidden';
const CONTENT = 'w-full px-5 py-5';

interface ActionsScrollAreaProps {
  children: React.ReactNode;
  /** When set, the scroller is a PageTransition keyed on this value. */
  pageKey?: string;
  direction?: 1 | -1;
}

export function ActionsScrollArea({ children, pageKey, direction = 1 }: ActionsScrollAreaProps) {
  if (pageKey === undefined) {
    return (
      <div className={SCROLLER}>
        <div className={CONTENT}>{children}</div>
      </div>
    );
  }

  return (
    <PageTransition pageKey={pageKey} direction={direction} className={SCROLLER}>
      <div className={CONTENT}>{children}</div>
    </PageTransition>
  );
}
