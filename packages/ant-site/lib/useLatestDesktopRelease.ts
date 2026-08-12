'use client';

import { useCallback, useEffect, useState } from 'react';
import { ANT_DESKTOP_LATEST_API_URL } from './links';

/**
 * Latest Ant Desktop release lookup.
 *
 * The site carries no desktop version constant. `releases/latest/download/<file>`
 * only redirects on an exact filename and the assets embed the version, so the
 * newest release is resolved at runtime and its own asset URLs are used — the
 * download rows link straight to the file, never via the releases page.
 *
 * `unavailable` is the convergent fallback for every no-URL path (404 while the
 * repo is private, 403 rate limit, network/CORS failure, asset name drift). The
 * UI falls back to the releases page plus a retry, never a dead end.
 */
export type DesktopAssetId = 'mac-arm' | 'mac-intel';

export type DesktopReleaseState =
  | { status: 'loading' }
  | { status: 'ready'; version: string; assetUrls: Record<DesktopAssetId, string> }
  | { status: 'unavailable'; retry: () => void };

/** Suffixes come from release.yml's `ant-desktop_${VERSION}_${ARCH}.dmg` — matched by suffix so the version segment is never parsed. */
const ASSET_SUFFIX: Record<DesktopAssetId, string> = {
  'mac-arm': '_aarch64.dmg',
  'mac-intel': '_x86_64.dmg',
};

interface ReleaseAsset {
  name?: string;
  browser_download_url?: string;
}

export function useLatestDesktopRelease(): DesktopReleaseState {
  const [state, setState] = useState<DesktopReleaseState>({ status: 'loading' });

  const load = useCallback(() => {
    let cancelled = false;
    setState({ status: 'loading' });

    (async () => {
      try {
        const res = await fetch(ANT_DESKTOP_LATEST_API_URL, {
          headers: {
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
          },
        });
        if (cancelled) return;
        if (!res.ok) throw new Error(`release ${res.status}`);

        const release = (await res.json()) as { tag_name?: string; assets?: ReleaseAsset[] };
        const assets = release.assets ?? [];
        const assetUrls = {} as Record<DesktopAssetId, string>;
        for (const [id, suffix] of Object.entries(ASSET_SUFFIX) as [DesktopAssetId, string][]) {
          const url = assets.find((a) => a.name?.endsWith(suffix))?.browser_download_url;
          // A release missing either arch is not a partial success — fall back wholesale.
          if (!url) throw new Error(`missing asset ${suffix}`);
          assetUrls[id] = url;
        }

        if (!cancelled) setState({ status: 'ready', version: release.tag_name ?? '', assetUrls });
      } catch {
        if (!cancelled) setState({ status: 'unavailable', retry: () => load() });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => load(), [load]);

  return state;
}
