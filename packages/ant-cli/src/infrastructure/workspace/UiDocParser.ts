/**
 * UI Document Parser
 * 
 * Parses ui-spec.md, ui-tokens.md, ui-assets.md into structured format
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
  // Remove markdown formatting, numbers, parentheses content
  const cleaned = title
    .replace(/^#+\s*/, '')                    // Remove leading #
    .replace(/^\d+\.?\d*\s*/, '')             // Remove leading numbers (1. or 5.1)
    .replace(/\s*\([^)]*\)\s*/g, ' ')         // Remove parenthetical content
    .toLowerCase()
    .trim();
  
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
 * Parse a single markdown file into sections
 */
function parseMarkdownSections(content: string): UiSpecSection[] {
  const lines = content.split('\n');
  const sections: UiSpecSection[] = [];
  
  let currentSection: {
    title: string;
    level: number;
    startLine: number;
    lines: string[];
  } | null = null;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;
    
    // Check for ## or ### headers
    const headerMatch = line.match(/^(#{2,3})\s+(.+)$/);
    
    if (headerMatch) {
      const level = headerMatch[1].length;
      const title = headerMatch[2].trim();
      
      // Save previous section
      if (currentSection) {
        const content = currentSection.lines.join('\n').trim();
        const id = normalizeSectionId(currentSection.title);
        
        sections.push({
          id,
          title: currentSection.title,
          level: currentSection.level,
          content,
          tokenEstimate: estimateTokens(content),
          lineRange: [currentSection.startLine, lineNum - 1],
        });
      }
      
      // Start new section
      currentSection = {
        title,
        level,
        startLine: lineNum,
        lines: [line],
      };
    } else if (currentSection) {
      currentSection.lines.push(line);
    }
  }
  
  // Don't forget the last section
  if (currentSection) {
    const content = currentSection.lines.join('\n').trim();
    const id = normalizeSectionId(currentSection.title);
    
    sections.push({
      id,
      title: currentSection.title,
      level: currentSection.level,
      content,
      tokenEstimate: estimateTokens(content),
      lineRange: [currentSection.startLine, lines.length],
    });
  }
  
  return sections;
}

/**
 * Merge nested sections into parent sections
 * 
 * Example:
 * - "## Component Specifications" contains "### 1. GNB", "### 2. Hero", etc.
 * - We want "gnb", "hero" as individual sections
 * - But also "responsive" containing "### 5.1 Breakpoint", "### 5.2 GNB Responsive", etc.
 */
function organizeSections(rawSections: UiSpecSection[]): Map<string, UiSpecSection> {
  const result = new Map<string, UiSpecSection>();
  
  // First pass: identify component sections (level 3, numbered like "### 1. GNB")
  // and common sections (level 2, like "## 5. Responsive Behavior")
  
  for (let i = 0; i < rawSections.length; i++) {
    const section = rawSections[i];
    const id = section.id;
    
    // Skip "Component Specifications" parent - its children are more useful
    if (id === 'components' || id === 'component-specifications') {
      continue;
    }
    
    // For level 3 sections under Component Specifications, use as-is
    // For level 2 common sections, gather their children
    if (section.level === 3) {
      // Individual component sections
      result.set(id, section);
    } else if (section.level === 2) {
      // Level 2 sections - gather children if they exist
      const children: UiSpecSection[] = [];
      let j = i + 1;
      
      while (j < rawSections.length && rawSections[j].level === 3) {
        children.push(rawSections[j]);
        j++;
      }
      
      if (children.length > 0) {
        // Combine parent with children
        const combinedContent = [
          section.content,
          ...children.map(c => c.content)
        ].join('\n\n');
        
        result.set(id, {
          ...section,
          content: combinedContent,
          tokenEstimate: estimateTokens(combinedContent),
          lineRange: [section.lineRange[0], children[children.length - 1].lineRange[1]],
        });
        
        // Skip children in main loop
        i = j - 1;
      } else {
        // No children, use as-is
        result.set(id, section);
      }
    }
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
 * Parse UI documents into structured format
 * 
 * @param uiSpec - Content of ui-spec.md
 * @param uiTokens - Content of ui-tokens.md  
 * @param uiAssets - Content of ui-assets.md
 * @returns Parsed UI documents structure
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
  
  // Parse ui-tokens.md (kept as-is, usually small)
  if (uiTokens) {
    result.tokens = uiTokens;
    result.tokensTokenEstimate = estimateTokens(uiTokens);
  }
  
  // Parse ui-assets.md (kept as-is, usually small)
  if (uiAssets) {
    result.assets = uiAssets;
    result.assetsTokenEstimate = estimateTokens(uiAssets);
  }
  
  // Parse ui-spec.md into sections
  if (uiSpec) {
    const rawSections = parseMarkdownSections(uiSpec);
    result.specSections = organizeSections(rawSections);
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
      parts.push(`## 🎯 DESIGN TOKENS
> Reference these tokens in your styles for consistency.

${parsedDocs.tokens}`);
    }
  }
  
  // Add assets if requested
  if (normalizedRequests.has('assets') && parsedDocs.assets) {
    parts.push(`## 📦 ASSET MAPPING (MANDATORY COPY)
> You MUST copy assets from \`inputs/assets/\` to \`public/\` before referencing them in code.

${parsedDocs.assets}`);
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
      parts.push(`## 🎨 UI SPEC: ${section.title}

${section.content}`);
    } else {
      // Try partial match
      for (const [id, sec] of parsedDocs.specSections) {
        if (id.includes(normalized) || normalized.includes(id)) {
          parts.push(`## 🎨 UI SPEC: ${sec.title}

${sec.content}`);
          break;
        }
      }
    }
  }
  
  return parts.join('\n\n---\n\n');
}

/**
 * Get all UI content (backward compatible)
 * Used when task.uiSections is undefined but task.ui is true
 */
export function getAllUiContent(parsedDocs: ParsedUiDocs): string {
  const parts: string[] = [];
  
  if (parsedDocs.tokens) {
    parts.push(`## 🎯 DESIGN TOKENS
> Reference these tokens in your styles for consistency.

${parsedDocs.tokens}`);
  }
  
  if (parsedDocs.assets) {
    parts.push(`## 📦 ASSET MAPPING (MANDATORY COPY)
> You MUST copy assets from \`inputs/assets/\` to \`public/\` before referencing them in code.

${parsedDocs.assets}`);
  }
  
  // Add all spec sections in document order
  for (const entry of parsedDocs.specToc) {
    const section = parsedDocs.specSections.get(entry.id);
    if (section) {
      parts.push(`## 🎨 UI SPEC: ${section.title}

${section.content}`);
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
    lines.push(`- \`"tokens"\`: Design tokens (colors, typography, spacing) - ~${parsedDocs.tokensTokenEstimate} tokens`);
  }
  if (parsedDocs.assetsTokenEstimate) {
    lines.push(`- \`"assets"\`: Asset mappings (images, icons, logos) - ~${parsedDocs.assetsTokenEstimate} tokens`);
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
    ['overview', 'layout', 'responsive', 'accessibility', 'grid', 'performance'].includes(e.id)
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
