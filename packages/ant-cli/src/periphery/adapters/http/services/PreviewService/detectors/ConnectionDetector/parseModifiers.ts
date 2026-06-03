import { ConnectionResolution } from '../../../../../../../core/ports/portRegistry';

/**
 * Parse a single annotation token into a `ConnectionResolution`, or `null`
 * when the token belongs to a different concern.
 *
 * Token grammar (resolution layer):
 *   - `'self'`                              → ant-project, both fields = `'self'`
 *   - `'ant-project:{p}:{f}'`               → ant-project with explicit target
 *   - `'ant-project:{p}:{f}:{serviceName}'` → ant-project + service segment
 *
 * Returning `null` (rather than a default `url` resolution) is intentional
 * — the caller iterates over all tokens and falls back to `url` only when
 * no token claims the resolution slot.
 *
 * Note: there is no `mock:*` token — every `business` `@connection` is
 * virtualizable by definition (§0 grammar policy). The category alone
 * decides whether `virtualization` is auto-attached at the call site.
 */
export function parseResolutionModifier(token: string, defaultValue: string): ConnectionResolution | null {
  if (token === 'self') {
    return { type: 'ant-project', projectId: 'self', feature: 'self' };
  }

  const antProjectMatch = token.match(/^ant-project:([^:]+):([^:]+)(?::(.+))?$/);
  if (antProjectMatch) {
    return {
      type: 'ant-project',
      projectId: antProjectMatch[1],
      feature: antProjectMatch[2],
      ...(antProjectMatch[3] ? { serviceName: antProjectMatch[3] } : {}),
    };
  }

  void defaultValue;
  return null;
}
