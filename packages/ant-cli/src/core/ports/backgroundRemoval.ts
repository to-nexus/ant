/**
 * Background Removal Port
 * Interface for image background removal services (visual-processor sidecar).
 */

export interface BackgroundRemovalResult {
  data: Buffer;
  mimeType: 'image/png';
}

export interface BackgroundRemovalOptions {
  /** rembg model name, e.g. 'birefnet-general', 'birefnet-portrait' */
  model?: string;
}

export interface BackgroundRemovalPort {
  /**
   * Remove background from an image, returning a transparent PNG.
   */
  removeBackground(
    imageData: Buffer,
    mimeType: string,
    options?: BackgroundRemovalOptions,
  ): Promise<BackgroundRemovalResult>;

  /**
   * Check if the background removal service is reachable.
   * Used for graceful fallback when sidecar is not running.
   */
  isAvailable(): Promise<boolean>;
}
