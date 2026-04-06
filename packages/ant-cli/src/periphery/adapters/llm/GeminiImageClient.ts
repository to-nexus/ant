/**
 * GeminiImageClient
 *
 * Implements ImageGenerationPort using Gemini's native image generation (Nano Banana).
 * Uses generateContent with image-capable models (gemini-*-image-preview).
 *
 * Sketch model: gemini-3.1-flash-image-preview (fast, draft quality)
 * Render model: gemini-3-pro-image-preview (high quality, production)
 *
 * **Format limitation**: The Gemini API (non-Vertex) does NOT support the
 * `outputMimeType` parameter in `imageConfig`. The model autonomously decides
 * the output MIME type (typically JPEG or PNG). Any `outputFormat` passed via
 * `ImageGenerationOptions` is recorded in metadata for logging/diagnostics
 * only and has no effect on the actual output format. For assets requiring
 * transparency (e.g. logos), use the SVG path (engrave node) instead.
 */

import { GoogleGenAI } from '@google/genai';
import {
  ImageGenerationPort,
  GeneratedImage,
  ImageGenerationOptions,
} from '../../../core/ports/imageGeneration';
import { withRetry } from '../../../core/utils/retry';
import type { TaskTokenUsage } from '@ant/shared';

export class GeminiImageClient implements ImageGenerationPort {
  private client: GoogleGenAI;
  public readonly modelName: string;

  constructor(config: {
    apiKey?: string;
    modelName: string;
  }) {
    const apiKey = config.apiKey || process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GeminiImageClient: GEMINI_API_KEY is required');
    }

    this.client = new GoogleGenAI({ apiKey });
    this.modelName = config.modelName;
  }

  async generate(
    prompt: string,
    options?: ImageGenerationOptions
  ): Promise<GeneratedImage[]> {
    const numberOfImages = options?.numberOfImages ?? 1;
    const outputFormat = options?.outputFormat ?? 'png';
    const aspectRatio = options?.aspectRatio ?? '1:1';
    const temperature = options?.temperature ?? 1.0;

    console.log(
      `🎨 [IMAGE GEN] model=${this.modelName} count=${numberOfImages} format=${outputFormat} ratio=${aspectRatio} temp=${temperature}${options?.referenceImage ? ' +refImage' : ''}`
    );

    const contents: any = options?.referenceImage
      ? [
          { text: prompt },
          {
            inlineData: {
              mimeType: options.referenceImage.mimeType,
              data: options.referenceImage.data.toString('base64'),
            },
          },
        ]
      : prompt;

    const results: GeneratedImage[] = [];

    const generateOne = async (index: number): Promise<GeneratedImage | null> => {
      return withRetry(
        async () => {
          const response = await this.client.models.generateContent({
            model: this.modelName,
            contents,
            config: {
              responseModalities: ['Text', 'Image'],
              temperature,
              imageConfig: {
                aspectRatio,
              },
            },
          });

          if (!response.candidates?.[0]?.content?.parts) {
            const finishReason = response.candidates?.[0]?.finishReason;
            if (finishReason === 'SAFETY') {
              throw new SafetyBlockError('Image generation blocked by safety filter');
            }
            console.warn(`🎨 [IMAGE GEN] Empty response for candidate ${index + 1}`);
            return null;
          }

          const usageMeta = (response as any).usageMetadata;
          const tokenUsage: TaskTokenUsage | undefined = usageMeta ? {
            inputTokens: usageMeta.promptTokenCount ?? 0,
            outputTokens: usageMeta.candidatesTokenCount ?? 0,
            totalTokens: (usageMeta.promptTokenCount ?? 0) + (usageMeta.candidatesTokenCount ?? 0),
          } : undefined;

          for (const part of response.candidates[0].content.parts) {
            if (part.inlineData?.data) {
              const responseMime = (part.inlineData.mimeType as string) || 'image/png';
              const normalizedMime = (
                ['image/png', 'image/jpeg', 'image/webp'].includes(responseMime)
                  ? responseMime
                  : 'image/png'
              ) as GeneratedImage['mimeType'];

              const requestedMime = `image/${outputFormat}`;
              if (normalizedMime !== requestedMime) {
                console.warn(`🎨 [IMAGE GEN] Format mismatch: requested=${requestedMime}, received=${normalizedMime}`);
              }

              if (tokenUsage) {
                console.log(`🎨 [IMAGE GEN] Token usage: ${tokenUsage.inputTokens} in / ${tokenUsage.outputTokens} out`);
              }

              return {
                data: Buffer.from(part.inlineData.data, 'base64'),
                mimeType: normalizedMime,
                prompt,
                tokenUsage,
                modelResponseMetadata: {
                  model: this.modelName,
                  aspectRatio,
                  outputFormat,
                  responseMimeType: responseMime,
                  formatMismatch: normalizedMime !== requestedMime,
                  candidateIndex: index,
                  finishReason: response.candidates?.[0]?.finishReason,
                },
              };
            }
          }

          console.warn(`🎨 [IMAGE GEN] No image data in response for candidate ${index + 1}`);
          return null;
        },
        {
          maxAttempts: 3,
          initialDelayMs: 2000,
          maxDelayMs: 15000,
          backoffMultiplier: 2,
          retryableErrors: ['RESOURCE_EXHAUSTED', 'UNAVAILABLE', 'INTERNAL', '429', '500', '503'],
        }
      );
    };

    const promises = Array.from({ length: numberOfImages }, (_, i) => generateOne(i));
    const settled = await Promise.allSettled(promises);

    let safetyError: SafetyBlockError | undefined;
    for (const result of settled) {
      if (result.status === 'fulfilled' && result.value) {
        results.push(result.value);
      } else if (result.status === 'rejected') {
        if (result.reason instanceof SafetyBlockError) {
          safetyError = result.reason;
        }
        console.warn(`🎨 [IMAGE GEN] Candidate failed: ${result.reason?.message || result.reason}`);
      }
    }

    if (results.length === 0) {
      if (safetyError) throw safetyError;
      throw new Error('All image generation attempts failed or returned empty results');
    }

    if (safetyError) {
      console.warn(`🎨 [IMAGE GEN] ${results.length}/${numberOfImages} succeeded despite partial safety blocks`);
    }

    console.log(`🎨 [IMAGE GEN] Generated ${results.length}/${numberOfImages} images`);
    return results;
  }
}

/**
 * Thrown when Gemini's safety filter blocks image generation.
 * Visual graph can catch this to route back to direct node for prompt modification.
 */
export class SafetyBlockError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SafetyBlockError';
  }
}
