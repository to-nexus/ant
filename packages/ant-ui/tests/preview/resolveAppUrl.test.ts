/**
 * resolveAppUrl — preview/deploy app-link resolver.
 *
 * Regression guard for the subdomain double-prefix bug: the backend returns an
 * ABSOLUTE URL for an app in subdomain mode (`https://{label}.<baseDomain>`) and
 * a ROOT-RELATIVE path in path mode (`/urlKey`). App-link consumers must NOT
 * prefix the preview origin onto an already-absolute URL — otherwise the link
 * becomes `https://origin` + `https://label.base` (the reported broken link).
 *
 * The origin it prefixes is the CONTENT origin, not the management one: the user's
 * app is served from a host that carries no control-plane API, so a document served
 * there has no same-origin API to drive with the viewer's session (H-NEW-001).
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  hasDistinctContentOrigin,
  resolveAppUrl,
  PREVIEW_BASE,
  PREVIEW_CONTENT_BASE,
} from '@/infrastructure/http/api/client';

describe('resolveAppUrl', () => {
  it('returns an absolute https URL verbatim (subdomain mode — no origin prefix)', () => {
    const abs = 'https://individual--probe-to-nexus--jhedu--base.ant-preview.example.com';
    expect(resolveAppUrl(abs)).toBe(abs);
  });

  it('returns an absolute http URL verbatim', () => {
    const abs = 'http://label.example';
    expect(resolveAppUrl(abs)).toBe(abs);
  });

  it('prefixes the CONTENT origin onto a root-relative path (path mode)', () => {
    expect(resolveAppUrl('/individual--probe--proj--main')).toBe(
      `${PREVIEW_CONTENT_BASE()}/individual--probe--proj--main`,
    );
  });

  it('prefixes the CONTENT origin onto a /deploy/ path (path mode)', () => {
    expect(resolveAppUrl('/deploy/individual--probe--proj--feat')).toBe(
      `${PREVIEW_CONTENT_BASE()}/deploy/individual--probe--proj--feat`,
    );
  });

  it('falls back to the management origin when no content host is configured', () => {
    // Keeps a not-yet-migrated single-host deployment working unchanged.
    expect(PREVIEW_CONTENT_BASE()).toBe(PREVIEW_BASE());
  });
});

/**
 * The one predicate that decides whether the workspace preview lane is reachable.
 * The lane is mounted only on the content listener, so "is a second origin
 * published?" is a host-environment capability, not a mode.
 */
describe('hasDistinctContentOrigin', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('is false when no content host is declared — the single-host topology', () => {
    expect(hasDistinctContentOrigin()).toBe(false);
  });

  it('is false when the content host is declared but equal to the management host', () => {
    vi.stubEnv('VITE_PREVIEW_HOST', 'https://ant-preview.example.com');
    vi.stubEnv('VITE_PREVIEW_CONTENT_HOST', 'https://ant-preview.example.com');
    expect(hasDistinctContentOrigin()).toBe(false);
  });

  it('is true only when the two origins actually differ', () => {
    vi.stubEnv('VITE_PREVIEW_HOST', 'https://ant-preview.example.com');
    vi.stubEnv('VITE_PREVIEW_CONTENT_HOST', 'https://ant-app.example.com');
    expect(hasDistinctContentOrigin()).toBe(true);
  });
});
