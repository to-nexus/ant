/**
 * useImagePreview — Fetch a feature-relative image file as an object URL.
 *
 * Shared by any chat card that needs to show an inline image preview
 * (figma_called screenshot, downloaded asset, read_reference_image, etc.).
 *
 * Lifecycle: fetch → createObjectURL → auto-revoke on unmount / path change.
 */

import { useState, useEffect } from 'react';
import { useStore } from '@/domain/store';
import { fetchFileBlob } from '@/infrastructure/http/api';

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

    fetchFileBlob(selectedProject, selectedFeature, imagePath)
      .then(blob => {
        if (revoked) return;
        url = URL.createObjectURL(blob);
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
