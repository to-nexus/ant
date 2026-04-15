/**
 * VisualTier Resolver — shared by code and design decompose.
 *
 * 1. Parses <visualTier> XML tag from LLM response
 * 2. Merges user preset (wins) with auto-detected values
 * 3. Derives lower 3 layers from upper 3
 */

import type {
  VisualTier,
  VisualLanguageVariant,
  SurfaceSystemVariant,
  SpatialSystemVariant,
} from '@ant/shared';

import {
  VISUAL_LANGUAGE_VARIANTS,
  SURFACE_SYSTEM_VARIANTS,
  SPATIAL_SYSTEM_VARIANTS,
  deriveInteractionGrammar,
  deriveVisualHierarchyRules,
  deriveComponentSemantics,
} from '@ant/shared';

/**
 * Resolve visualTier layers from decompose LLM response + user preset.
 * Returns only the 6 layer fields (no designSystem) to spread onto VisualTier.
 */
export function resolveVisualTierFromDecompose(
  rawResponse: string,
  userPreset?: Partial<VisualTier>,
): Partial<VisualTier> | undefined {
  const detected = parseVisualTierTag(rawResponse);

  const visualLanguage = userPreset?.visualLanguage ?? detected?.visualLanguage;
  const surfaceSystem = userPreset?.surfaceSystem ?? detected?.surfaceSystem;
  const spatialSystem = userPreset?.spatialSystem ?? detected?.spatialSystem;

  if (!visualLanguage && !surfaceSystem && !spatialSystem) return undefined;

  const interactionGrammar = visualLanguage
    ? deriveInteractionGrammar(visualLanguage) : undefined;
  const visualHierarchyRules = (visualLanguage && spatialSystem)
    ? deriveVisualHierarchyRules(visualLanguage, spatialSystem) : undefined;
  const componentSemantics = detected?.screenContext
    ? deriveComponentSemantics(detected.screenContext) : undefined;

  return {
    visualLanguage,
    surfaceSystem,
    spatialSystem,
    interactionGrammar,
    visualHierarchyRules,
    componentSemantics,
  };
}

function parseVisualTierTag(raw: string): {
  visualLanguage?: VisualLanguageVariant;
  surfaceSystem?: SurfaceSystemVariant;
  spatialSystem?: SpatialSystemVariant;
  screenContext?: string;
} | undefined {
  const match = raw.match(/<visualTier>\s*([\s\S]*?)\s*<\/visualTier>/);
  if (!match) return undefined;

  try {
    const parsed = JSON.parse(match[1].replace(/[\x00-\x1f]/g, ''));
    return {
      visualLanguage: validate(parsed.visualLanguage, VISUAL_LANGUAGE_VARIANTS),
      surfaceSystem: validate(parsed.surfaceSystem, SURFACE_SYSTEM_VARIANTS),
      spatialSystem: validate(parsed.spatialSystem, SPATIAL_SYSTEM_VARIANTS),
      screenContext: typeof parsed.screenContext === 'string' ? parsed.screenContext : undefined,
    };
  } catch {
    console.warn('⚠️  [Decompose] Failed to parse <visualTier> tag');
    return undefined;
  }
}

function validate<T extends string>(raw: unknown, allowed: readonly T[]): T | undefined {
  return typeof raw === 'string' && allowed.includes(raw as T) ? (raw as T) : undefined;
}
