/**
 * useImagePreview — Fetch a feature-relative image file as an object URL.
 *
 * Shared by any chat card that needs to show an inline image preview
 * (figma_called screenshot, downloaded asset, etc.).
 *
 * Lifecycle: fetch → createObjectURL → auto-revoke on unmount / path change.
 */

import { useState, useEffect } from 'react';
import { useStore } from '@/domain/store';
import { fetchFileBlob } from '@/infrastructure/http/api';

/**
 * SVGs without explicit width/height fall back to the HTML replaced-element
 * default of 300x150, causing square icons to render as wide rectangles.
 * Extract dimensions from viewBox and set them explicitly.
 */
async function patchSvgDimensions(blob: Blob): Promise<Blob> {
  const text = await blob.text();
  try {
    const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
    const svgEl = doc.querySelector('svg');
    if (!svgEl) return blob;

    const w = svgEl.getAttribute('width');
    const h = svgEl.getAttribute('height');
    if ((!w || w === '100%') || (!h || h === '100%')) {
      const viewBox = svgEl.getAttribute('viewBox');
      if (viewBox) {
        const parts = viewBox.trim().split(/[\s,]+/);
        if (parts.length === 4) {
          svgEl.setAttribute('width', parts[2]);
          svgEl.setAttribute('height', parts[3]);
          return new Blob([new XMLSerializer().serializeToString(doc)], { type: 'image/svg+xml' });
        }
      }
    }
  } catch { /* parse failed — use original blob */ }
  return blob;
}

export function useImagePreview(imagePath: string | undefined) {
  const selectedProject = useStore(state => state.selectedProject);
  const selectedFeature = useStore(state => state.selectedFeature);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!imagePath || !selectedProject || !selectedFeature) {
      setObjectUrl(null);
      return;
    }

    let revoked = false;
    let url: string | null = null;
    const isSvg = /\.svg$/i.test(imagePath);

    fetchFileBlob(selectedProject, selectedFeature, imagePath)
      .then(async blob => {
        if (revoked) return;
        const finalBlob = isSvg ? await patchSvgDimensions(blob) : blob;
        if (revoked) return;
        url = URL.createObjectURL(finalBlob);
        setObjectUrl(url);
      })
      .catch(() => {
        if (!revoked) setObjectUrl(null);
      });

    return () => {
      revoked = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [imagePath, selectedProject, selectedFeature]);

  return objectUrl;
}
