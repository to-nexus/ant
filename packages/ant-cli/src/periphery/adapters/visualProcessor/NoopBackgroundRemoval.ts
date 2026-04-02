/**
 * No-op Background Removal
 *
 * Pass-through adapter used when the visual-processor sidecar
 * is not configured. Returns the original image unchanged.
 */

import type {
  BackgroundRemovalPort,
  BackgroundRemovalResult,
} from '../../../core/ports/backgroundRemoval.js';

export class NoopBackgroundRemoval implements BackgroundRemovalPort {
  async removeBackground(
    imageData: Buffer,
    _mimeType: string,
  ): Promise<BackgroundRemovalResult> {
    return { data: imageData, mimeType: 'image/png' };
  }

  async isAvailable(): Promise<boolean> {
    return false;
  }
}
