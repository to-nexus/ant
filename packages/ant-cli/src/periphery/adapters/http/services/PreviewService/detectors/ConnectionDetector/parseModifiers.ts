import { ConnectionResolution, VirtualizationStrategy } from '../../../../../../../core/ports/portRegistry';
import { logger } from '../../../../../../../utils/logger';

/**
 * Parse a single annotation token into a `ConnectionResolution`, or `null`
 * when the token belongs to a different concern (e.g. a `mock:*` token).
 *
 * Token grammar (resolution layer):
 *   - `'self'`                              → ant-project, both fields = `'self'`
 *   - `'ant-project:{p}:{f}'`               → ant-project with explicit target
 *   - `'ant-project:{p}:{f}:{serviceName}'` → ant-project + service segment
 *
 * Returning `null` (rather than a default `url` resolution) is intentional
 * — the caller iterates over all tokens and falls back to `url` only when
 * no token claims the resolution slot.
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

  // Suppress `defaultValue` lint when the token isn't ours — kept in the
  // signature so the call site remains symmetric with `parseMockModifier`.
  void defaultValue;
  return null;
}

/**
 * Parse a single annotation token into a `VirtualizationStrategy`, or
 * `null` when the token does not declare a virtualization story.
 *
 * Token grammar (virtualization layer):
 *   - `'mock:available'` → `{ mockKind: 'available', toggleEnvVar, active: false }`
 *     (the `active` field is overwritten by `overrideWithEnvFile`)
 *   - `'mock:inline'`    → `{ mockKind: 'inline', active: true }` — inline
 *     fakes are always live; there is no external toggle.
 *
 * Unknown `mock:*` tokens are logged as a warning and treated as no-op so
 * a typo doesn't silently change connection semantics.
 */
export function parseMockModifier(token: string, connectionName: string): VirtualizationStrategy | null {
  if (token === 'mock:available') {
    return {
      mockKind: 'available',
      toggleEnvVar: deriveToggleVar(connectionName),
      active: false,
    };
  }
  if (token === 'mock:inline') {
    return { mockKind: 'inline', active: true };
  }
  if (token.startsWith('mock:')) {
    logger.warn(
      `[ConnectionDetector] Unknown mock modifier token "${token}" on connection "${connectionName}" — ignored.`,
      { component: 'ConnectionDetector' },
    );
  }
  return null;
}

/**
 * Convert a `@connection` name into its per-connection toggle env var.
 *   `stripe-api`       → `USE_MOCK_STRIPE_API`
 *   `payment_service`  → `USE_MOCK_PAYMENT_SERVICE`
 */
export function deriveToggleVar(name: string): string {
  return `USE_MOCK_${name.replace(/-/g, '_').toUpperCase()}`;
}
