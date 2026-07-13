/**
 * `prime-nesting-grate` regression — composite userEmail codec.
 *
 * The JOB_STATUS_UPDATES payload carries `userEmail =
 * `${userId}@${organizationId}``. Cloud userIds are full lowercased
 * emails (org-model SSOT), so the composite contains multiple '@'
 * (`probe@to.nexus@individual`). RouteConfigurator's old naive
 * `split('@')` sheared it into {userId:'probe', organizationId:'to.nexus'},
 * silently misrouting every workspace-path read downstream — the
 * cancelled/resume card was dropped on "no turn anchor" and the pause
 * was later re-labeled server_crash by StaleJobRecovery Phase 1b.
 *
 * `parseCompositeUserEmail` is the shared codec: parse at the LAST '@'.
 */

import { describe, it, expect } from 'vitest';
import { parseCompositeUserEmail } from '../../src/core/utils/compositeUserEmail';

describe('parseCompositeUserEmail', () => {
  it('cloud composite (userId is itself an email) splits at the LAST @', () => {
    expect(parseCompositeUserEmail('probe@to.nexus@individual')).toEqual({
      userId: 'probe@to.nexus',
      organizationId: 'individual',
    });
  });

  it('local composite round-trips', () => {
    expect(parseCompositeUserEmail('local@local')).toEqual({
      userId: 'local',
      organizationId: 'local',
    });
  });

  it('round-trips the compose format for both tenancy shapes', () => {
    for (const ctx of [
      { userId: 'probe@to.nexus', organizationId: 'individual' },
      { userId: 'local', organizationId: 'local' },
    ]) {
      const composite = `${ctx.userId}@${ctx.organizationId}`;
      expect(parseCompositeUserEmail(composite)).toEqual(ctx);
    }
  });

  it('rejects strings that cannot carry both parts', () => {
    expect(parseCompositeUserEmail('no-at-sign')).toBeUndefined();
    expect(parseCompositeUserEmail('@org')).toBeUndefined();
    expect(parseCompositeUserEmail('user@')).toBeUndefined();
    expect(parseCompositeUserEmail('')).toBeUndefined();
  });
});
