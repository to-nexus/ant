/**
 * UI Design Prompt Builder
 * 
 * Handles message building for ui-design work type:
 * - buildUiDesignMessages: Main message builder
 * - buildUiDesignFreshPrompt: Fresh prompt for tool loop continuation
 * - buildUiDesignSystemPrompt: System prompt loader (from template)
 * 
 * NOTE: Task instructions and tool guides are in templates:
 * - base-ui-design.md (with Handlebars conditionals for task-specific content)
 * - rules-ui-design.md (tool usage rules)
 */

import { DesignGraphState } from '../../state';
import { CacheableContent } from '../../../../../../core/ports/llm';

/**
 * Build multimodal messages for UI Design generation
 * 
 * TOOLING-BASED APPROACH:
 * - Images are NOT preloaded (avoids token explosion)
 * - LLM uses tools to selectively load images when needed:
 *   - list_reference_images: Discover available screenshots
 *   - read_reference_image: Load specific image for analysis
 *   - list_assets: List asset files for mapping
 */
export async function buildUiDesignMessages(state: DesignGraphState): Promise<Array<{
  role: 'user' | 'assistant';
  content: CacheableContent[];
}>> {
  const task = state.currentTask;
  
  // ✅ Check if this is a continuation after tool calling
  const conversationHistory = state.conversationHistory || [];
  const isAfterToolCall = conversationHistory.length > 0;
  
  if (isAfterToolCall) {
    console.log(`🎨 [DocGen] UI Design continuing with existing conversation (${conversationHistory.length} messages)`);
    
    // ✅ Code job pattern: Build fresh prompt + append history (skip initial user messages)
    const messages: Array<{ role: 'user' | 'assistant'; content: CacheableContent[] }> = [];
    
    // 1. Build fresh user prompt (always needed as first message)
    const freshPrompt = await buildUiDesignFreshPrompt(state);
    messages.push({
      role: 'user',
      content: freshPrompt
    });
    
    // 2. Append history (skip initial user messages - replaced by fresh prompt)
    let skipInitialUserMessages = true;
    for (const msg of conversationHistory) {
      if (msg.role === 'assistant') {
        skipInitialUserMessages = false;
      }
      
      if (skipInitialUserMessages && msg.role === 'user') {
        continue;
      }
      
      // ✅ Convert to CacheableContent format
      if (typeof msg.content === 'string') {
        messages.push({
          role: msg.role as 'user' | 'assistant',
          content: [{ type: 'text', text: msg.content }]
        });
      } else {
        messages.push({
          role: msg.role as 'user' | 'assistant',
          content: msg.content as CacheableContent[]
        });
      }
    }
    
    return messages;
  }
  
  console.log(`🎨 [DocGen] Building UI Design prompt for task: ${task?.id} (tool-based multimodal)`);
  
  const content: CacheableContent[] = [];
  
  // ✅ 1. System Prompt (includes rules and task-specific instructions via templates)
  const systemPrompt = await buildUiDesignSystemPrompt(state);
  content.push({
    type: 'text',
    text: systemPrompt,
    cache_control: { type: 'ephemeral' }
  });
  
  // ✅ 2. Available Resources Summary (dynamic data - must be in code)
  const resourcesSummary = buildResourcesSummary(state);
  content.push({
    type: 'text',
    text: resourcesSummary
  });
  
  // ✅ 3. PRD Context (if available)
  if (state.prd) {
    content.push({
      type: 'text',
      text: `\n\n# PRD (Requirements)\n\n${state.prd}`
    });
  }
  
  // ✅ 4. Inject previously generated UI docs (each task has fresh conversationHistory)
  // NOTE: conversationHistory resets between tasks, so prior docs must be loaded from disk
  const previousDocs = await loadPreviousUiDocs(state, task?.id || '');
  if (previousDocs) {
    content.push({
      type: 'text',
      text: previousDocs
    });
  }
  
  return [{
    role: 'user',
    content
  }];
}

/**
 * Build fresh user prompt for tool loop continuation
 * This is needed when continuing after tool calls to maintain proper message structure
 */
export async function buildUiDesignFreshPrompt(state: DesignGraphState): Promise<CacheableContent[]> {
  const content: CacheableContent[] = [];
  const task = state.currentTask;
  
  // ✅ 1. System Prompt (includes rules and task-specific instructions)
  const systemPrompt = await buildUiDesignSystemPrompt(state);
  content.push({
    type: 'text',
    text: systemPrompt,
    cache_control: { type: 'ephemeral' }
  });
  
  // ✅ 2. Available Resources Summary (dynamic data)
  const resourcesSummary = buildResourcesSummary(state);
  content.push({
    type: 'text',
    text: resourcesSummary
  });
  
  // ✅ 3. PRD Context (if available)
  if (state.prd) {
    content.push({
      type: 'text',
      text: `\n\n# PRD (Requirements)\n\n${state.prd}`
    });
  }
  
  // ✅ 4. Inject previously generated UI docs
  const previousDocs = await loadPreviousUiDocs(state, task?.id || '');
  if (previousDocs) {
    content.push({
      type: 'text',
      text: previousDocs
    });
  }
  
  // ✅ 5. Add next step instruction after tool call (CRITICAL FIX)
  // This ensures LLM continues with analysis phase instead of stopping after discovery
  if (task?.id === 'ui-spec') {
    const hasDiscoveredImages = state.uiReferences?.screens?.length || state.uiReferences?.components?.length;
    
    if (hasDiscoveredImages) {
      content.push({
        type: 'text',
        text: `\n\n# Next Steps

You have discovered reference images. Now proceed to the Analysis phase:

1. Use \`read_reference_image\` tool to load the main screen screenshot
2. Analyze the layout structure, components, and visual patterns
3. Generate ui-spec.md based on your analysis

⚠️ Do NOT stop after discovering images. You must analyze them before generating the document.`
      });
    }
  }
  
  return content;
}

/**
 * Build resources summary for UI Design tasks
 * 
 * NOTE: This is dynamic data that must be generated at runtime
 * - Counts of available screenshots and assets
 * - Examples of file names
 */
function buildResourcesSummary(state: DesignGraphState): string {
  let resourcesSummary = '\n\n# Available Resources\n\n';
  resourcesSummary += '## Reference Screenshots\n';
  resourcesSummary += 'Use `list_reference_images` tool to discover available screenshots, then use `read_reference_image` to load and analyze specific images.\n\n';
  
  if (state.uiReferences?.screens?.length) {
    resourcesSummary += `- **Screens**: ${state.uiReferences.screens.length} screenshots available\n`;
    resourcesSummary += `  (Examples: ${state.uiReferences.screens.slice(0, 3).join(', ')}${state.uiReferences.screens.length > 3 ? '...' : ''})\n`;
  }
  if (state.uiReferences?.components?.length) {
    resourcesSummary += `- **Components**: ${state.uiReferences.components.length} component snapshots available\n`;
    resourcesSummary += `  (Examples: ${state.uiReferences.components.slice(0, 3).join(', ')}${state.uiReferences.components.length > 3 ? '...' : ''})\n`;
  }
  
  resourcesSummary += '\n## Asset Files\n';
  resourcesSummary += 'Use `list_assets` tool to discover available asset files for mapping.\n\n';
  
  if (state.uiAssetsList) {
    const assetCounts = [
      state.uiAssetsList.logos?.length ? `logos: ${state.uiAssetsList.logos.length}` : null,
      state.uiAssetsList.icons?.length ? `icons: ${state.uiAssetsList.icons.length}` : null,
      state.uiAssetsList.backgrounds?.length ? `backgrounds: ${state.uiAssetsList.backgrounds.length}` : null,
      state.uiAssetsList.other?.length ? `other: ${state.uiAssetsList.other.length}` : null,
    ].filter(Boolean);
    
    if (assetCounts.length > 0) {
      resourcesSummary += `Available: ${assetCounts.join(', ')}\n`;
    }
  }
  
  return resourcesSummary;
}

/**
 * Load previously generated UI documents for dependent tasks
 * 
 * Why needed: conversationHistory resets between tasks (each task = fresh session)
 * So prior task outputs must be loaded from disk.
 * 
 * Dependency:
 * - ui-assets: needs ui-tokens.md
 * - ui-spec: needs ui-tokens.md + ui-assets.md
 */
async function loadPreviousUiDocs(
  state: DesignGraphState,
  taskId: string
): Promise<string> {
  // Only ui-assets and ui-spec need previous docs
  if (taskId !== 'ui-assets' && taskId !== 'ui-spec') {
    return '';
  }
  
  const fileSystem = state.deps?.fileSystem;
  if (!fileSystem || !state.context.featurePath) {
    return '';
  }
  
  const path = await import('path');
  const workspaceRoot = fileSystem.getWorkspaceRoot?.() || '';
  const featureDirRel = workspaceRoot
    ? path.relative(workspaceRoot, state.context.featurePath)
    : state.context.featurePath.replace(/^\//, '');
  
  const designOutputDir = path.join(featureDirRel, 'outputs/design');
  let injectedDocs = '';
  
  // Load ui-tokens.md for both ui-assets and ui-spec
  try {
    const tokensPath = path.join(designOutputDir, 'ui-tokens.md');
    const tokensContent = await fileSystem.readFile(tokensPath);
    if (tokensContent && !tokensContent.includes('ant:template')) {
      injectedDocs += `\n\n════════════════════════════════════════════════════════════════════════════════\n`;
      injectedDocs += `# REFERENCE: ui-tokens.md (generated in previous task)\n`;
      injectedDocs += `> Use these token names. Do NOT use raw values that are defined here.\n`;
      injectedDocs += `════════════════════════════════════════════════════════════════════════════════\n\n`;
      injectedDocs += tokensContent;
      console.log(`📄 [DocGen] Injected ui-tokens.md (${tokensContent.length} chars) for ${taskId}`);
    }
  } catch {
    // File doesn't exist yet, skip
  }
  
  // Load ui-assets.md only for ui-spec
  if (taskId === 'ui-spec') {
    try {
      const assetsPath = path.join(designOutputDir, 'ui-assets.md');
      const assetsContent = await fileSystem.readFile(assetsPath);
      if (assetsContent && !assetsContent.includes('ant:template')) {
        injectedDocs += `\n\n════════════════════════════════════════════════════════════════════════════════\n`;
        injectedDocs += `# REFERENCE: ui-assets.md (generated in previous task)\n`;
        injectedDocs += `> Reference these asset identifiers when documenting components.\n`;
        injectedDocs += `════════════════════════════════════════════════════════════════════════════════\n\n`;
        injectedDocs += assetsContent;
        console.log(`📄 [DocGen] Injected ui-assets.md (${assetsContent.length} chars) for ${taskId}`);
      }
    } catch {
      // File doesn't exist yet, skip
    }
  }
  
  return injectedDocs;
}

/**
 * Build system prompt for UI Design generation
 * 
 * Loads: design/phases/execute/base-ui-design.md
 * - Includes rules-ui-design.md via partial
 * - Has task-specific instructions via Handlebars conditionals
 */
export async function buildUiDesignSystemPrompt(state: DesignGraphState): Promise<string> {
  const promptPort = state.deps?.promptEngine;
  
  if (!promptPort) {
    throw new Error('[DocGen] PromptEngine is required but not available in state.deps');
  }
  
  // Load from template with task context for Handlebars conditionals
  const template = await (promptPort as any).deps?.promptPort?.render('design/phases/execute/base-ui-design', {
    taskId: state.currentTask?.id,
    taskName: state.currentTask?.name,
  });
  
  if (!template) {
    throw new Error('[DocGen] Failed to load base-ui-design.md template');
  }
  
  return template;
}
