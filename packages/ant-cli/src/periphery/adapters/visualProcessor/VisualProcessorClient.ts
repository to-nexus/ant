/**
 * Visual Processor Client
 *
 * HTTP adapter for the visual-processor sidecar (rembg + BiRefNet).
 * Implements BackgroundRemovalPort; future processing capabilities
 * (upscale, optimize) will be added as new port implementations
 * backed by additional endpoints on the same sidecar.
 */

import type {
  BackgroundRemovalPort,
  BackgroundRemovalResult,
  BackgroundRemovalOptions,
} from '../../../core/ports/backgroundRemoval.js';

export class VisualProcessorClient implements BackgroundRemovalPort {
  private baseUrl: string;
  private timeoutMs: number;

  constructor(baseUrl: string = 'http://localhost:4103', timeoutMs: number = 60_000) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.timeoutMs = timeoutMs;
  }

  async removeBackground(
    imageData: Buffer,
    mimeType: string,
    options?: BackgroundRemovalOptions,
  ): Promise<BackgroundRemovalResult> {
    const start = Date.now();
    const requestId = crypto.randomUUID();

    const formData = new FormData();
    formData.append(
      'file',
      new Blob([new Uint8Array(imageData)], { type: mimeType }),
      'image.jpg',
    );

    const url = options?.model
      ? `${this.baseUrl}/remove-bg?model=${encodeURIComponent(options.model)}`
      : `${this.baseUrl}/remove-bg`;

    const response = await fetch(url, {
      method: 'POST',
      body: formData,
      headers: { 'X-Request-Id': requestId },
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!response.ok) {
      let detail = '';
      try {
        const body = await response.json();
        detail = body.detail || JSON.stringify(body);
      } catch {
        detail = await response.text().catch(() => '');
      }
      throw new Error(
        `visual-processor error ${response.status} [${requestId}]: ${detail || response.statusText}`,
      );
    }

    const arrayBuffer = await response.arrayBuffer();
    const elapsed = Date.now() - start;
    console.log(
      `🔲 [VisualProcessorClient] [${requestId}] remove-bg: model=${options?.model || 'server-default'} ` +
      `input=${imageData.length}B output=${arrayBuffer.byteLength}B elapsed=${elapsed}ms`,
    );

    return {
      data: Buffer.from(arrayBuffer),
      mimeType: 'image/png',
    };
  }

  async isAvailable(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/health`, {
        signal: AbortSignal.timeout(2_000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }
}
