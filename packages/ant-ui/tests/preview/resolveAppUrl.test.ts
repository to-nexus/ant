/**
 * resolveAppUrl — preview/deploy app-link resolver.
 *
 * Regression guard for the subdomain double-prefix bug: the backend returns an
 * ABSOLUTE URL for an app in subdomain mode (`https://{label}.<baseDomain>`) and
 * a ROOT-RELATIVE path in path mode (`/urlKey`). App-link consumers must NOT
 * prefix the preview origin onto an already-absolute URL — otherwise the link
 * becomes `https://origin` + `https://label.base` (the reported broken link).
 */

import { describe, expect, it } from 'vitest';
import { resolveAppUrl, PREVIEW_BASE } from '@/infrastructure/http/api/client';

describe('resolveAppUrl', () => {
  it('returns an absolute https URL verbatim (subdomain mode — no origin prefix)', () => {
    const abs = 'https://individual--probe-to-nexus--jhedu--base.ant-preview.example.com';
    expect(resolveAppUrl(abs)).toBe(abs);
  });

  it('returns an absolute http URL verbatim', () => {
    const abs = 'http://label.example';
    expect(resolveAppUrl(abs)).toBe(abs);
  });

  it('prefixes the preview origin onto a root-relative path (path mode)', () => {
    expect(resolveAppUrl('/individual--probe--proj--main')).toBe(
      `${PREVIEW_BASE()}/individual--probe--proj--main`,
    );
  });

  it('prefixes the preview origin onto a /deploy/ path (path mode)', () => {
    expect(resolveAppUrl('/deploy/individual--probe--proj--feat')).toBe(
      `${PREVIEW_BASE()}/deploy/individual--probe--proj--feat`,
    );
  });
});
