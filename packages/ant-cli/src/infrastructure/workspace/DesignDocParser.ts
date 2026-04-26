/**
 * Design Document Parser (UI + GameArt surfaces — D24/D25)
 *
 * Parses `*-spec.json`, `*-tokens.json`, `*-assets.json` into a structured
 * format optimized for split injection into Code Job prompts:
 *   - Token budget optimization (inject only required sections)
 *   - Task-specific context (e.g. UI Header task only gets GNB section,
 *     GameArt Effect task only gets `effects-matchClear` section)
 *   - Reduced LLM noise from irrelevant sections
 *
 * Surface taxonomy:
 *   - 'ui'      → ui-tokens / ui-assets / ui-spec
 *                 spec sub-section semantic = chapter (page region)
 *   - 'gameArt' → game-art-tokens / game-art-assets / game-art-spec
 *                 spec sub-section semantic = category (effects, characters,
 *                 projectiles, npcs, objectives, environments — LLM-decided
 *                 dictionary keys; schema does not enforce a fixed enum)
 *
 * The two surfaces share an identical JSON-dictionary structure, so the
 * parser itself is surface-agnostic. The caller stamps the `surface` field
 * on the result so downstream prompts know which interpretation to apply.
 */

import {
  DesignDocSection,
  DesignDocTocEntry,
  DesignDocSurface,
  ParsedDesignDocs,
} from '../../core/types/designDoc';

/** Conservative estimate: ~4 chars per token. */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Detect whether a JSON value is a "container" (a non-array object whose
 * children are themselves non-array objects) — i.e. a dictionary namespace
 * for named items. Containers split into `{key}-{childKey}` sections.
 */
function isContainerValue(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const children = Object.values(value as Record<string, unknown>);
  if (children.length === 0) return false;
  return children.every(v => v && typeof v === 'object' && !Array.isArray(v));
}

/**
 * Register a section into the result map with duplicate-key protection.
 * On collision: warn and merge.
 */
function addSection(
  result: Map<string, DesignDocSection>,
  id: string,
  title: string,
  content: string,
  lineNum: number,
): number {
  const tokenEstimate = estimateTokens(content);
  const lineCount = content.split('\n').length;

  if (result.has(id)) {
    console.warn(`[DesignDocParser] Duplicate section id "${id}" — merging content`);
    const existing = result.get(id)!;
    existing.content += '\n' + content;
    existing.tokenEstimate += tokenEstimate;
    existing.lineRange[1] = lineNum + lineCount;
  } else {
    result.set(id, {
      id,
      title,
      level: 2,
      content,
      tokenEstimate,
      lineRange: [lineNum, lineNum + lineCount],
    });
  }

  return lineNum + lineCount;
}

/**
 * Parse JSON sections from a `*-spec.json` document.
 *
 * Section IDs are discovered dynamically from the top-level keys:
 * - Container values (all children are objects): split into "{key}-{childKey}"
 *     UI:      pages → pages-events / modals → modals-connectModal
 *     GameArt: effects → effects-matchClear / characters → characters-hero
 * - Leaf values (primitives or arrays): used as-is (e.g. meta, layout)
 * - `_meta` is excluded (Design Job internal tracking).
 */
function parseJsonSections(content: string, label: string): Map<string, DesignDocSection> {
  const result = new Map<string, DesignDocSection>();

  try {
    const parsed = JSON.parse(content) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object') {
      return result;
    }

    let lineNum = 1;

    for (const [key, value] of Object.entries(parsed)) {
      if (key === '_meta') continue;
      if (!value || typeof value !== 'object') continue;

      if (isContainerValue(value)) {
        for (const [childKey, childData] of Object.entries(value as Record<string, unknown>)) {
          const sectionContent = JSON.stringify({ [childKey]: childData }, null, 2);
          const id = `${key}-${childKey}`;
          lineNum = addSection(result, id, `${key}/${childKey}`, sectionContent, lineNum);
        }
      } else {
        const sectionContent = JSON.stringify({ [key]: value }, null, 2);
        lineNum = addSection(result, key, key, sectionContent, lineNum);
      }
    }
  } catch (error) {
    console.warn(`[DesignDocParser] Failed to parse ${label}:`, error);
  }

  return result;
}

/** Generate document-ordered TOC from sections. */
function generateToc(sections: Map<string, DesignDocSection>): DesignDocTocEntry[] {
  const toc: DesignDocTocEntry[] = [];

  for (const [id, section] of sections) {
    toc.push({
      id,
      title: section.title,
      level: section.level,
      tokenEstimate: section.tokenEstimate,
    });
  }

  toc.sort((a, b) => {
    const sectionA = sections.get(a.id);
    const sectionB = sections.get(b.id);
    if (!sectionA || !sectionB) return 0;
    return sectionA.lineRange[0] - sectionB.lineRange[0];
  });

  return toc;
}

/**
 * Strip `_meta` from a JSON document — it is used for Design Job chapter /
 * category tracking and adds no value to Code Job consumers.
 */
function stripMetaFromJson(jsonContent: string): string {
  try {
    const parsed = JSON.parse(jsonContent);
    if (parsed && typeof parsed === 'object' && '_meta' in parsed) {
      const { _meta, ...rest } = parsed;
      return JSON.stringify(rest, null, 2);
    }
    return jsonContent;
  } catch {
    return jsonContent;
  }
}

/**
 * Parse a design doc triple (spec / tokens / assets) for one surface.
 *
 * @param surface 'ui' or 'gameArt' — informs the discriminator only; the
 *                parser itself is surface-agnostic (D25's category dictionary
 *                and UI's chapter dictionary share the same JSON shape).
 */
export function parseDesignDocs(
  surface: DesignDocSurface,
  spec?: string,
  tokens?: string,
  assets?: string,
): ParsedDesignDocs {
  const result: ParsedDesignDocs = {
    surface,
    specSections: new Map(),
    specToc: [],
    specTotalTokens: 0,
  };

  if (tokens) {
    result.tokens = stripMetaFromJson(tokens);
    result.tokensTokenEstimate = estimateTokens(result.tokens);
  }

  if (assets) {
    result.assets = stripMetaFromJson(assets);
    result.assetsTokenEstimate = estimateTokens(result.assets);
  }

  if (spec) {
    const label = surface === 'ui' ? 'ui-spec.json' : 'game-art-spec.json';
    result.specSections = parseJsonSections(spec, label);
    result.specToc = generateToc(result.specSections);
    result.specTotalTokens = Array.from(result.specSections.values())
      .reduce((sum, s) => sum + s.tokenEstimate, 0);
  }

  return result;
}

/**
 * UI-specific convenience wrapper — preserves the legacy `parseUiDocs` call
 * shape used by `ArtifactService.loadParsedUiContext`.
 *
 * @deprecated prefer `parseDesignDocs('ui', ...)`. Kept until all call sites
 *             migrate (Phase 3+).
 */
export function parseUiDocs(
  uiSpec?: string,
  uiTokens?: string,
  uiAssets?: string,
): ParsedDesignDocs {
  return parseDesignDocs('ui', uiSpec, uiTokens, uiAssets);
}

/**
 * GameArt convenience wrapper — symmetric to `parseUiDocs`.
 *
 * Phase 2 entry point for game-art doc parsing. The `surface = 'gameArt'`
 * stamp tells downstream prompts to interpret spec sub-section keys as
 * categories (effects / characters / projectiles / npcs / objectives /
 * environments — LLM-decided dictionary keys, not enforced enum).
 */
export function parseGameArtDocs(
  gameArtSpec?: string,
  gameArtTokens?: string,
  gameArtAssets?: string,
): ParsedDesignDocs {
  return parseDesignDocs('gameArt', gameArtSpec, gameArtTokens, gameArtAssets);
}

/**
 * Generate a sections summary for decompose prompts.
 *
 * The summary surfaces section names and token estimates without dumping
 * full content — decompose decides which sections each task should pull in
 * via the `uiSections` / `gameArtSections` task field.
 *
 * @param parsedDocs   parsed design docs from `parseDesignDocs(...)`.
 * @param sectionField the task-field name used to advertise section ids
 *                     (default 'uiSections' for backward compat; use
 *                     'gameArtSections' for game-art surface).
 */
export function generateDesignDocSectionsSummary(
  parsedDocs: ParsedDesignDocs,
  sectionField: 'uiSections' | 'gameArtSections' = 'uiSections',
): string {
  const lines: string[] = [];
  const surfaceLabel = parsedDocs.surface === 'gameArt' ? 'GameArt' : 'UI';

  lines.push(`## Available ${surfaceLabel} Sections (for ${sectionField} field)`);
  lines.push('');
  lines.push(`When creating ${surfaceLabel} tasks, specify which sections to include in the \`${sectionField}\` array.`);
  lines.push('This optimizes token usage by injecting only relevant documentation.');
  lines.push('');

  // Tokens & assets — always recommended.
  lines.push(`### Core Documents (always recommended for ${surfaceLabel} tasks)`);
  lines.push('');
  if (parsedDocs.tokensTokenEstimate) {
    const desc = parsedDocs.surface === 'gameArt'
      ? 'GameArt tokens JSON (palette, silhouette, lighting, motion tone)'
      : 'Design tokens JSON (colors, typography, spacing)';
    lines.push(`- \`"tokens"\`: ${desc} - ~${parsedDocs.tokensTokenEstimate} tokens`);
  }
  if (parsedDocs.assetsTokenEstimate) {
    const desc = parsedDocs.surface === 'gameArt'
      ? 'GameArt asset catalog (category dictionary with inline + external kinds)'
      : 'Asset mappings JSON (images, icons, logos)';
    lines.push(`- \`"assets"\`: ${desc} - ~${parsedDocs.assetsTokenEstimate} tokens`);
  }
  lines.push('');

  // Group sections by container prefix.
  const groups = new Map<string, DesignDocTocEntry[]>();
  for (const entry of parsedDocs.specToc) {
    const dashIdx = entry.id.indexOf('-');
    const groupKey = dashIdx > 0 ? entry.id.substring(0, dashIdx) : '_common';
    if (!groups.has(groupKey)) groups.set(groupKey, []);
    groups.get(groupKey)!.push(entry);
  }

  // Surface-specific group labels.
  const UI_GROUP_LABELS: Record<string, string> = {
    pages: 'Page Sections',
    modals: 'Modal Sections',
    sections: 'Shared Component Sections',
    overlays: 'Overlay Sections',
    _common: 'Common Sections (recommended when implementing any UI)',
  };
  const GAME_ART_GROUP_LABELS: Record<string, string> = {
    effects: 'Effect Categories',
    characters: 'Character Categories',
    projectiles: 'Projectile Categories',
    npcs: 'NPC Categories',
    objectives: 'Objective Categories',
    environments: 'Environment Categories',
    _common: 'Common Sections (recommended when implementing any GameArt)',
  };
  const groupLabels = parsedDocs.surface === 'gameArt' ? GAME_ART_GROUP_LABELS : UI_GROUP_LABELS;

  for (const [groupKey, entries] of groups) {
    const label = groupLabels[groupKey] ?? `${groupKey.charAt(0).toUpperCase()}${groupKey.slice(1)} Sections`;
    lines.push(`### ${label}`);
    lines.push('');
    for (const entry of entries) {
      lines.push(`- \`"${entry.id}"\`: ${entry.title} - ~${entry.tokenEstimate} tokens`);
    }
    lines.push('');
  }

  const totalTokens = (parsedDocs.tokensTokenEstimate || 0)
    + (parsedDocs.assetsTokenEstimate || 0)
    + parsedDocs.specTotalTokens;

  const exampleSections = parsedDocs.surface === 'gameArt'
    ? '["tokens", "assets", "effects-matchClear", "characters-hero"]'
    : '["tokens", "assets", "pages-events", "layout"]';

  lines.push('### Usage');
  lines.push('');
  lines.push('```json');
  lines.push('{');
  lines.push(`  "${sectionField}": ${exampleSections}`);
  lines.push('}');
  lines.push('```');
  lines.push('');
  lines.push(`**Note**: Total ${surfaceLabel} docs = ~${totalTokens} tokens. Split injection saves significant tokens.`);

  return lines.join('\n');
}

/**
 * @deprecated use `generateDesignDocSectionsSummary(parsedDocs, 'uiSections')`.
 */
export function generateUiSectionsSummary(parsedDocs: ParsedDesignDocs): string {
  return generateDesignDocSectionsSummary(parsedDocs, 'uiSections');
}
