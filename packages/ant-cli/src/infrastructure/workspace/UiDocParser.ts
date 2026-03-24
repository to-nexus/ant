/**
 * UI Document Parser
 * 
 * Parses ui-spec.json, ui-tokens.json, ui-assets.json into structured format
 * for split injection into Code Job prompts.
 * 
 * This enables:
 * - Token budget optimization (inject only needed sections)
 * - Task-specific UI context (e.g., Header task only gets GNB section)
 * - Better LLM focus (less noise from irrelevant sections)
 */

import {
  ParsedUiDocs,
  UiSpecSection,
  UiSpecTocEntry,
} from '../../core/types/uiDoc';
import { condenseContent } from '../../core/utils/contentCondenser';

/**
 * Estimate token count from text
 * Conservative estimate: ~4 characters per token
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Detect whether a JSON value is a "container" that should be split into
 * per-child sections. A container is a non-array object whose every child
 * is also a non-array object (i.e., it acts as a namespace for named items).
 */
function isContainerValue(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const children = Object.values(value as Record<string, unknown>);
  if (children.length === 0) return false;
  return children.every(v => v && typeof v === 'object' && !Array.isArray(v));
}

/**
 * Register a section into the result map with duplicate-key protection.
 * On collision: warn and merge the new content into the existing section.
 */
function addSection(
  result: Map<string, UiSpecSection>,
  id: string,
  title: string,
  content: string,
  lineNum: number,
): number {
  const tokenEstimate = estimateTokens(content);
  const lineCount = content.split('\n').length;

  if (result.has(id)) {
    console.warn(`[UiDocParser] Duplicate section id "${id}" — merging content`);
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
 * Parse JSON sections from ui-spec.json
 *
 * Section IDs are discovered dynamically from the JSON structure:
 * - Container keys (all children are objects): split into "{key}-{childKey}"
 *   e.g., pages → pages-events, modals → modals-connectModal
 * - Leaf keys: used as-is, e.g., meta, layout
 *
 * _meta is excluded (Design Job internal tracking).
 */
function parseJsonSections(content: string): Map<string, UiSpecSection> {
  const result = new Map<string, UiSpecSection>();

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
    console.warn('[UiDocParser] Failed to parse JSON:', error);
  }

  return result;
}

/**
 * Generate table of contents from sections
 */
function generateToc(sections: Map<string, UiSpecSection>): UiSpecTocEntry[] {
  const toc: UiSpecTocEntry[] = [];
  
  for (const [id, section] of sections) {
    toc.push({
      id,
      title: section.title,
      level: section.level,
      tokenEstimate: section.tokenEstimate,
    });
  }
  
  // Sort by line range (preserve document order)
  toc.sort((a, b) => {
    const sectionA = sections.get(a.id);
    const sectionB = sections.get(b.id);
    if (!sectionA || !sectionB) return 0;
    return sectionA.lineRange[0] - sectionB.lineRange[0];
  });
  
  return toc;
}

/**
 * Remove _meta field from JSON content
 * _meta is used for chapter tracking in Design Job, not needed in Code Job
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
 * Parse UI documents into structured format
 * 
 * @param uiSpec - Content of ui-spec.json
 * @param uiTokens - Content of ui-tokens.json  
 * @param uiAssets - Content of ui-assets.json
 * @returns Parsed UI documents structure
 * 
 * NOTE: _meta fields are stripped from all documents (used for chapter tracking only)
 */
export function parseUiDocs(
  uiSpec?: string,
  uiTokens?: string,
  uiAssets?: string
): ParsedUiDocs {
  const result: ParsedUiDocs = {
    specSections: new Map(),
    specToc: [],
    specTotalTokens: 0,
  };
  
  // Parse ui-tokens.json (strip _meta, then keep as string)
  if (uiTokens) {
    result.tokens = stripMetaFromJson(uiTokens);
    result.tokensTokenEstimate = estimateTokens(result.tokens);
  }
  
  // Parse ui-assets.json (strip _meta, then keep as string)
  if (uiAssets) {
    result.assets = stripMetaFromJson(uiAssets);
    result.assetsTokenEstimate = estimateTokens(result.assets);
  }
  
  // Parse ui-spec.json into sections (parseJsonSections already excludes _meta)
  if (uiSpec) {
    result.specSections = parseJsonSections(uiSpec);
    result.specToc = generateToc(result.specSections);
    
    // Calculate total tokens
    result.specTotalTokens = Array.from(result.specSections.values())
      .reduce((sum, s) => sum + s.tokenEstimate, 0);
  }
  
  return result;
}

/**
 * Get UI sections for a specific task based on uiSections array
 * 
 * @param parsedDocs - Parsed UI documents
 * @param requestedSections - Section IDs requested by the task
 * @returns Combined content string for the requested sections
 */
export function getUiSectionsForTask(
  parsedDocs: ParsedUiDocs,
  requestedSections: string[]
): string {
  const parts: string[] = [];
  
  // Normalize requested sections
  const normalizedRequests = new Set(
    requestedSections.map(s => s.toLowerCase().trim())
  );
  
  // Add tokens if requested or if any UI section is requested
  if (normalizedRequests.has('tokens') || normalizedRequests.size > 0) {
    if (parsedDocs.tokens) {
      parts.push(`## 🎯 DESIGN TOKENS (JSON)
> Reference these tokens in your styles for consistency.

\`\`\`json
${parsedDocs.tokens}
\`\`\``);
    }
  }
  
  // Add assets if requested (condense if large)
  if (normalizedRequests.has('assets') && parsedDocs.assets) {
    const assetsResult = condenseContent(parsedDocs.assets, {
      threshold: 20_000,
      label: 'ui-assets.json',
      filePath: 'outputs/design/ui-assets.json',
      contentType: 'json',
    });
    if (assetsResult.wasCondensed) {
      parts.push(`## 📦 ASSET MAPPING (condensed — use read_file for details)
> SVG assets → copy to \`src/assets/\` and import as SVGR component (NOT to \`public/\`).
> Raster assets (png, jpg, webp) → copy to \`public/\` and reference via framework image component.

${assetsResult.content}`);
    } else {
      parts.push(`## 📦 ASSET MAPPING (JSON)
> SVG assets → copy to \`src/assets/\` and import as SVGR component (NOT to \`public/\`).
> Raster assets (png, jpg, webp) → copy to \`public/\` and reference via framework image component.

\`\`\`json
${parsedDocs.assets}
\`\`\``);
    }
  }

  // Add requested spec sections
  for (const sectionId of requestedSections) {
    const normalized = sectionId.toLowerCase().trim();
    
    // Skip special sections (handled above)
    if (normalized === 'tokens' || normalized === 'assets') {
      continue;
    }
    
    // Look up section
    const section = parsedDocs.specSections.get(normalized);
    if (section) {
      parts.push(`## 🎨 UI SPEC: ${section.title} (JSON)

\`\`\`json
${section.content}
\`\`\``);
    } else {
      // Try partial match
      for (const [id, sec] of parsedDocs.specSections) {
        if (id.includes(normalized) || normalized.includes(id)) {
          parts.push(`## 🎨 UI SPEC: ${sec.title} (JSON)

\`\`\`json
${sec.content}
\`\`\``);
          break;
        }
      }
    }
  }
  
  return parts.join('\n\n---\n\n');
}

/**
 * Get all UI content
 * Used when task.uiSections is undefined (type is 'ui' or 'design-system' but no sections specified)
 */
export function getAllUiContent(parsedDocs: ParsedUiDocs): string {
  const parts: string[] = [];
  
  if (parsedDocs.tokens) {
    parts.push(`## 🎯 DESIGN TOKENS (JSON)
> Reference these tokens in your styles for consistency.

\`\`\`json
${parsedDocs.tokens}
\`\`\``);
  }
  
  if (parsedDocs.assets) {
    const assetsResult = condenseContent(parsedDocs.assets, {
      threshold: 20_000,
      label: 'ui-assets.json',
      filePath: 'outputs/design/ui-assets.json',
      contentType: 'json',
    });
    if (assetsResult.wasCondensed) {
      parts.push(`## 📦 ASSET MAPPING (condensed — use read_file for details)
> SVG assets → copy to \`src/assets/\` and import as SVGR component (NOT to \`public/\`).
> Raster assets (png, jpg, webp) → copy to \`public/\` and reference via framework image component.

${assetsResult.content}`);
    } else {
      parts.push(`## 📦 ASSET MAPPING (JSON)
> SVG assets → copy to \`src/assets/\` and import as SVGR component (NOT to \`public/\`).
> Raster assets (png, jpg, webp) → copy to \`public/\` and reference via framework image component.

\`\`\`json
${parsedDocs.assets}
\`\`\``);
    }
  }
  
  // Add all spec sections in document order
  for (const entry of parsedDocs.specToc) {
    const section = parsedDocs.specSections.get(entry.id);
    if (section) {
      parts.push(`## 🎨 UI SPEC: ${section.title} (JSON)

\`\`\`json
${section.content}
\`\`\``);
    }
  }
  
  return parts.join('\n\n---\n\n');
}

/**
 * Generate UI sections summary for decompose prompt
 * Provides section names and token estimates without full content
 */
export function generateUiSectionsSummary(parsedDocs: ParsedUiDocs): string {
  const lines: string[] = [];
  
  lines.push('## Available UI Sections (for uiSections field)');
  lines.push('');
  lines.push('When creating UI tasks, specify which sections to include in the `uiSections` array.');
  lines.push('This optimizes token usage by injecting only relevant UI documentation.');
  lines.push('');
  
  // Tokens and Assets
  lines.push('### Core Documents (always recommended for UI tasks)');
  lines.push('');
  if (parsedDocs.tokensTokenEstimate) {
    lines.push(`- \`"tokens"\`: Design tokens JSON (colors, typography, spacing) - ~${parsedDocs.tokensTokenEstimate} tokens`);
  }
  if (parsedDocs.assetsTokenEstimate) {
    lines.push(`- \`"assets"\`: Asset mappings JSON (images, icons, logos) - ~${parsedDocs.assetsTokenEstimate} tokens`);
  }
  lines.push('');
  
  // Dynamically group sections by their container prefix.
  // Sections with a hyphen (e.g., "pages-events") are grouped by prefix ("pages").
  // Sections without a hyphen (e.g., "meta", "layout") go into "common".
  const groups = new Map<string, UiSpecTocEntry[]>();

  for (const entry of parsedDocs.specToc) {
    const dashIdx = entry.id.indexOf('-');
    const groupKey = dashIdx > 0 ? entry.id.substring(0, dashIdx) : '_common';
    if (!groups.has(groupKey)) groups.set(groupKey, []);
    groups.get(groupKey)!.push(entry);
  }

  const GROUP_LABELS: Record<string, string> = {
    pages: 'Page Sections',
    modals: 'Modal Sections',
    sections: 'Shared Component Sections',
    overlays: 'Overlay Sections',
    _common: 'Common Sections (recommended when implementing any UI)',
  };

  for (const [groupKey, entries] of groups) {
    const label = GROUP_LABELS[groupKey] ?? `${groupKey.charAt(0).toUpperCase()}${groupKey.slice(1)} Sections`;
    lines.push(`### ${label}`);
    lines.push('');
    for (const entry of entries) {
      lines.push(`- \`"${entry.id}"\`: ${entry.title} - ~${entry.tokenEstimate} tokens`);
    }
    lines.push('');
  }
  
  // Total
  const totalTokens = (parsedDocs.tokensTokenEstimate || 0) + 
                      (parsedDocs.assetsTokenEstimate || 0) + 
                      parsedDocs.specTotalTokens;
  
  lines.push('### Usage');
  lines.push('');
  lines.push('```json');
  lines.push('{');
  lines.push('  "uiSections": ["tokens", "assets", "pages-events", "layout"]');
  lines.push('}');
  lines.push('```');
  lines.push('');
  lines.push(`**Note**: Total UI docs = ~${totalTokens} tokens. Split injection saves significant tokens.`);
  
  return lines.join('\n');
}
