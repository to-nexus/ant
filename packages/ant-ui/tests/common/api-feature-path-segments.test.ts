/**
 * Feature names may contain `/` (git-style branch), so any api module that puts
 * one in a URL **path** position must project it to a `/`-free slug via
 * `featureSeg()`. A raw name splits into extra path segments and matches no
 * route — the BE routes declare a fixed param count (e.g. figma's
 * `/config/:projectId/:featureName`), so the request 404s.
 *
 * Query VALUES are exempt: `/` is legal there, and `?feature=` params keep
 * plain `encodeURIComponent`.
 *
 * Axis: one structural row per api module (catches modules added later) plus
 * behavioural checks on the call sites that regressed.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { featureNameToSlug } from '@ant/shared';

const API_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../src/infrastructure/http/api',
);

/** Block comments and line comments — so a commented-out example can't fail the build. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/**
 * A bare identifier interpolated directly after `/` inside a template literal.
 * `${featureSeg(x)}` / `${encodeURIComponent(x)}` are calls, not bare
 * identifiers, so they never match.
 */
const RAW_PATH_INTERPOLATION = /\/\$\{\s*([A-Za-z_$][\w$]*)\s*\}/g;

const apiModules = fs
  .readdirSync(API_DIR)
  .filter((f) => f.endsWith('.ts') && f !== 'client.ts');

describe('api modules keep a feature name inside one path segment', () => {
  it('discovers the api modules (guards against a bad path)', () => {
    expect(apiModules.length).toBeGreaterThan(5);
    expect(apiModules).toContain('figma.ts');
  });

  it.each(apiModules)('%s interpolates no bare feature variable into a path', (file) => {
    const src = stripComments(fs.readFileSync(path.join(API_DIR, file), 'utf8'));

    const offenders = [...src.matchAll(RAW_PATH_INTERPOLATION)]
      .map((m) => m[1])
      .filter((ident) => /feature/i.test(ident));

    expect(offenders).toEqual([]);
  });
});

describe('feature names containing "/" stay a single path segment', () => {
  const FEATURE = 'feature/base';
  const SLUG = featureNameToSlug(FEATURE);
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ success: true, config: {} }),
      text: async () => '{}',
    }));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const requestedPath = (): string => {
    expect(fetchMock).toHaveBeenCalled();
    return String(fetchMock.mock.calls[0][0]);
  };

  it('slug is slash-free (otherwise the rest of this suite is vacuous)', () => {
    expect(FEATURE).toContain('/');
    expect(SLUG).not.toContain('/');
  });

  it('getFigmaConfig', async () => {
    const { getFigmaConfig } = await import('../../src/infrastructure/http/api/figma');
    await getFigmaConfig('proj', FEATURE);
    expect(requestedPath()).toBe(`/api/figma/config/proj/${SLUG}`);
  });

  it('saveFigmaConfig', async () => {
    const { saveFigmaConfig } = await import('../../src/infrastructure/http/api/figma');
    await saveFigmaConfig('proj', FEATURE, {} as any);
    expect(requestedPath()).toBe(`/api/figma/config/proj/${SLUG}`);
  });

  it('clearChatHistory', async () => {
    const { clearChatHistory } = await import('../../src/infrastructure/http/api/chat');
    await clearChatHistory('proj', FEATURE);
    expect(requestedPath()).toBe(`/api/projects/proj/features/${SLUG}/chat/messages`);
  });

  it('clearChatHistory keeps the cancelActive query intact', async () => {
    const { clearChatHistory } = await import('../../src/infrastructure/http/api/chat');
    await clearChatHistory('proj', FEATURE, { cancelActive: true });
    expect(requestedPath()).toBe(
      `/api/projects/proj/features/${SLUG}/chat/messages?cancelActive=true`,
    );
  });
});
