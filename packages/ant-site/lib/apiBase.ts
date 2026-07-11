/**
 * API base + server-mode SSOT for the marketing site.
 *
 * `NEXT_PUBLIC_API_BASE` is the split-host backend origin (e.g.
 * ant.cross.nexus → ant-server.cross.nexus). Empty string means a
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

/**
 * Managed ANT Cloud app origin (ant-ui host, e.g. `ant.cross.nexus`). A distinct
 * host from `CLOUD_API_BASE` (API-only, `ant-server.cross.nexus`) — split-host
 * deployment, never interchangeable. Origin-only, mirroring the `CLOUD_API_BASE`
 * convention: the `/app/` path is appended by consumers, not baked into the var.
 * Env-var only via `NEXT_PUBLIC_CLOUD_APP_BASE`; unset ⇒ '' (no source fallback).
 */
const RAW_CLOUD_APP_BASE = process.env.NEXT_PUBLIC_CLOUD_APP_BASE ?? '';
export const CLOUD_APP_BASE = RAW_CLOUD_APP_BASE.replace(/\/+$/, '');

/**
 * Origin of the ant-ui app THIS site's same-tier "Go to App" CTAs link to.
 * Origin-only (the `/app/` path is appended in code), mirroring `CLOUD_APP_BASE`.
 *
 * - Production (single-origin CloudFront: ant-site at `/*`, ant-ui at `/app/*`):
 *   leave unset ⇒ '' ⇒ CTAs stay relative (`/app/`), same-origin — correct.
 * - Local dev: ant-site (`next dev`, 4300) and ant-ui (Vite, 4200) are SEPARATE
 *   origins, so a relative `/app/` from 4300 dead-ends. Set this to ant-ui's
 *   origin (`http://localhost:4200`) so the CTA is absolute and works whether
 *   the user browses the site directly or through the ant-ui proxy. If you run
 *   ant-ui on a different port, set this + `ANT_UI_PORT` to match.
 */
const RAW_APP_BASE = process.env.NEXT_PUBLIC_APP_BASE ?? '';
export const APP_BASE = RAW_APP_BASE.replace(/\/+$/, '');
