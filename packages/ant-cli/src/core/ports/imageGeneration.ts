/**
 * Image Generation Port
 * Interface for AI image generation services (Gemini, etc.)
 */

import type { TaskTokenUsage } from '@ant/shared';

export interface GeneratedImage {
  data: Buffer;
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
  prompt: string;
  modelResponseMetadata?: Record<string, any>;
  /**
   * Token usage for this image generation call (prompt processing tokens).
   * May be undefined if the provider does not report token counts for image generation.
   */
  tokenUsage?: TaskTokenUsage;
}

export interface ImageGenerationOptions {
  aspectRatio?: string;
  /**
   * Desired output format. Gemini API (non-Vertex) does NOT support controlling
   * output format — the model decides the MIME type autonomously. This field is
   * retained for the port contract (future Vertex AI support) and is used only
   * as metadata/logging in the current GeminiImageClient implementation.
   */
  outputFormat?: 'png' | 'jpeg' | 'webp';
  numberOfImages?: number;
  temperature?: number;
  referenceImage?: {
    data: Buffer;
    mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
  };
}

export interface ImageGenerationPort {
  /**
   * The resolved model id this client generates with. Declared on the port so
   * callers that record which model produced an image read it directly instead of
   * casting and carrying their own fallback literal.
   */
  readonly modelName: string;

  /**
   * Generate images from a text prompt
   * @returns Array of generated images (1 or more depending on numberOfImages)
   */
  generate(prompt: string, options?: ImageGenerationOptions): Promise<GeneratedImage[]>;
}
