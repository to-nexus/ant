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
  UI_SECTION_ID_MAP,
} from '../../core/types/uiDoc';

/**
 * Estimate token count from text
 * Conservative estimate: ~4 characters per token
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Normalize section title to canonical section ID
 */
function normalizeSectionId(title: string): string {
  const cleaned = title.toLowerCase().trim();
  
  // Try exact match first
  if (UI_SECTION_ID_MAP[cleaned]) {
    return UI_SECTION_ID_MAP[cleaned];
  }
  
  // Try partial match
  for (const [pattern, id] of Object.entries(UI_SECTION_ID_MAP)) {
    if (cleaned.includes(pattern) || pattern.includes(cleaned)) {
      return id;
    }
  }
  
  // Generate ID from cleaned title
  return cleaned
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, '-')
    .substring(0, 30);
}

/**
 * Parse JSON sections from ui-spec.json
 * Excludes _meta field (used for chapter tracking, not needed in Code Job)
 */
function parseJsonSections(content: string): Map<string, UiSpecSection> {
  const result = new Map<string, UiSpecSection>();
  
  try {
    const parsed = JSON.parse(content) as any;
    if (!parsed || typeof parsed !== 'object') {
      return result;
    }
    
    // Extract sections from the 'sections' key
    const sections = parsed.sections || {};
    let lineNum = 1;
    
    for (const [sectionId, sectionData] of Object.entries(sections)) {
      const sectionContent = JSON.stringify({ [sectionId]: sectionData }, null, 2);
      const id = normalizeSectionId(sectionId);
      
      result.set(id, {
        id,
        title: sectionId,
        level: 2,
        content: sectionContent,
        tokenEstimate: estimateTokens(sectionContent),
        lineRange: [lineNum, lineNum + sectionContent.split('\n').length],
      });
      
      lineNum += sectionContent.split('\n').length;
    }
    
    // Also extract meta, layout, components, accessibility as separate sections
    // NOTE: _meta is excluded (internal tracking field, not needed for Code Job)
    const topLevelSections = ['meta', 'layout', 'components', 'accessibility'];
    for (const key of topLevelSections) {
      if (parsed[key]) {
        const sectionContent = JSON.stringify({ [key]: parsed[key] }, null, 2);
        result.set(key, {
          id: key,
          title: key,
          level: 2,
          content: sectionContent,
          tokenEstimate: estimateTokens(sectionContent),
          lineRange: [1, sectionContent.split('\n').length],
        });
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
  
  // Add assets if requested
  if (normalizedRequests.has('assets') && parsedDocs.assets) {
    parts.push(`## 📦 ASSET MAPPING (JSON)
> You MUST copy assets from \`inputs/assets/\` to \`public/\` before referencing them in code.

\`\`\`json
${parsedDocs.assets}
\`\`\``);
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
 * Used when task.uiSections is undefined but task.ui is true
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
    parts.push(`## 📦 ASSET MAPPING (JSON)
> You MUST copy assets from \`inputs/assets/\` to \`public/\` before referencing them in code.

\`\`\`json
${parsedDocs.assets}
\`\`\``);
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
  
  // Component sections
  const componentSections = parsedDocs.specToc.filter(e => 
    ['gnb', 'hero', 'about', 'ecosystem', 'token', 'technology', 'social', 'footer'].includes(e.id)
  );
  
  if (componentSections.length > 0) {
    lines.push('### Component Sections');
    lines.push('');
    for (const entry of componentSections) {
      lines.push(`- \`"${entry.id}"\`: ${entry.title} - ~${entry.tokenEstimate} tokens`);
    }
    lines.push('');
  }
  
  // Common sections
  const commonSections = parsedDocs.specToc.filter(e => 
    ['meta', 'layout', 'components', 'accessibility'].includes(e.id)
  );
  
  if (commonSections.length > 0) {
    lines.push('### Common Sections (recommended when implementing any UI)');
    lines.push('');
    for (const entry of commonSections) {
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
  lines.push('  "uiSections": ["tokens", "assets", "hero", "layout"]');
  lines.push('}');
  lines.push('```');
  lines.push('');
  lines.push(`**Note**: Total UI docs = ~${totalTokens} tokens. Split injection saves significant tokens.`);
  
  return lines.join('\n');
}
