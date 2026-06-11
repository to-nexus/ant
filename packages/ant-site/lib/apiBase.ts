/**
 * API base + server-mode SSOT for the marketing site.
 *
 * `NEXT_PUBLIC_API_BASE` is the split-host backend origin (e.g.
 * ant.crosstoken.io → ant-server.crosstoken.io). Empty string means a
 * single-origin / local-mode build with no backend round-trip available —
 * mirrors ant-ui's `VITE_CLOUD_BACKEND_BASE` empty ⇒ local-mode discipline.
 *
 * Consumed by both the auth session provider and the pricing catalog fetch,
 * so it lives in one module rather than being redefined per-consumer.
 */

export type ServerMode = 'local' | 'cloud';

/** Raw backend origin (no `/api` suffix). Empty ⇒ local-mode build. */
export const RAW_API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? '';

/** Backend `/api` base for fetch calls. Relative (`/api`) when same-origin. */
export const API_BASE = `${RAW_API_BASE}/api`;

/** Local builds short-circuit any backend round-trip; cloud builds fetch. */
export const SERVER_MODE: ServerMode = RAW_API_BASE === '' ? 'local' : 'cloud';

/**
 * Canonical managed-cloud API origin for the pricing catalog. Configured via
 * `NEXT_PUBLIC_CLOUD_API_BASE` (no hardcoded origin) so the marketing site
 * always shows real cloud prices — even in a local/self-host build — without
 * baking an origin into the source. Falls back to `RAW_API_BASE` when unset.
 */
const RAW_CATALOG_API_BASE = process.env.NEXT_PUBLIC_CLOUD_API_BASE || RAW_API_BASE;

/**
 * Pricing-catalog fetch base. Prices stay server-sourced at runtime — never
 * baked into the bundle.
 */
export const CATALOG_API_BASE = `${RAW_CATALOG_API_BASE}/api`;
