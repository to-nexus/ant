/**
 * Image Generation Port
 * Interface for AI image generation services (Gemini, etc.)
 */

export interface GeneratedImage {
  data: Buffer;
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
  prompt: string;
  modelResponseMetadata?: Record<string, any>;
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
   * Generate images from a text prompt
   * @returns Array of generated images (1 or more depending on numberOfImages)
   */
  generate(prompt: string, options?: ImageGenerationOptions): Promise<GeneratedImage[]>;
}
