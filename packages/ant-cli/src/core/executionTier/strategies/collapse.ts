/**
 * Collapse operation strategies.
 *
 * Collapse marks pre-boundary `user_turn` / `user_turn_meta` lines as
 * `collapsed=true` so they stop contributing to prompt context. The
 * primary trigger is the boundary append itself — {@link AtBoundaryCollapse}
 * defers to `SessionPort.appendBoundary`, which handles the pre-boundary
 * marking atomically alongside the boundary write.
 *
 * Tiers that never emit a boundary (0 / 1 / 2 / 4) use {@link NoopCollapse}.
 */

import type { FeatureBoundaryLine } from '@ant/shared';
import type { SessionPort } from '../../ports/session';

export interface CollapseStrategy {
  /**
   * Perform the collapse side-effect tied to a boundary. For the
   * at-boundary variant the call is a no-op because `session.appendBoundary`
   * performs the collapse atomically; the method exists on the interface
   * so future variants (e.g. delayed / selective collapse) can hook in.
   */
  apply(session: SessionPort, boundary: FeatureBoundaryLine): Promise<void>;
}

export class NoopCollapse implements CollapseStrategy {
  async apply(): Promise<void> {
    /* noop — tiers without boundary do not collapse */
  }
}

/**
 * At-boundary collapse — {@link SessionPort.appendBoundary} performs the
 * pre-boundary `collapsed=true` marking atomically inside the same JSONL
 * file lock that writes the boundary line. The atomicity lives at the
 * adapter layer so a process crash between "write boundary" and "mark
 * pre-boundary lines collapsed" cannot leave the file half-collapsed.
 *
 * Given that design, this strategy is deliberately a no-op: Tier 3's
 * boundary strategy already triggered the collapse transitively when it
 * called `appendBoundary`. The class exists as the semantic marker that
 * Tier 3 opts into collapse (Tier 0/1/2/4 bind to {@link NoopCollapse})
 * and as a hook for future variants (e.g. selective / delayed collapse)
 * that need to act AFTER the boundary has been persisted.
 */
export class AtBoundaryCollapse implements CollapseStrategy {
  async apply(_session: SessionPort, _boundary: FeatureBoundaryLine): Promise<void> {
    /* intentional no-op — handled inside SessionPort.appendBoundary */
  }
}

export const noopCollapse = new NoopCollapse();
export const atBoundaryCollapse = new AtBoundaryCollapse();
