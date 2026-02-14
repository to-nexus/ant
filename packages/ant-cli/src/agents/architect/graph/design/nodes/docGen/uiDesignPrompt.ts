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
import { logPrompt } from '../../../../../../core/utils/promptLogger';
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
  
  // ✅ Log prompt structure (not content)
  const jobId = state.jobId || state._httpJobId || 'unknown';
  if (state.context.featurePath) {
    try {
      // Calculate total text length
      const totalLength = content
        .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
        .reduce((sum, c) => sum + c.text.length, 0);
      
      await logPrompt(
        state.context.featurePath,
        jobId,
        'design',
        'docGen-uiDesign-fullMessage',
        totalLength,
        {
          taskId: task?.id,
          taskName: task?.name,
          templatePath: 'design/phases/execute/base-ui-design',
          usedTemplates: [
            'design/phases/execute/rules-ui-design',
            'design/phases/execute/injections/ui-tokens-guide',
            'design/phases/execute/injections/ui-assets-guide',
            'design/phases/execute/injections/ui-spec-guide',
          ],
          injectedVariables: {
            systemPrompt: systemPrompt ? `[${systemPrompt.length} chars]` : undefined,
            resourcesSummary: resourcesSummary ? `[${resourcesSummary.length} chars]` : undefined,
            prd: state.prd ? `[${state.prd.length} chars]` : undefined,
            previousDocs: previousDocs ? `[${previousDocs.length} chars]` : undefined,
            uiReferences: state.uiReferences ? {
              count: state.uiReferences.length,
            } : undefined,
            uiAssetsList: state.uiAssetsList ? 'SET' : undefined,
          },
        }
      );
    } catch (logError) {
      console.warn(`⚠️  [DocGen] Failed to log full message:`, logError);
    }
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
  //
  // IMPORTANT: buildUiDesignFreshPrompt is ONLY called when isAfterToolCall=true (Turn 2+)
  // At this point, LLM has already called list_reference_images and has the results.
  // We MUST always remind the LLM to continue - DO NOT rely on state.uiReferences
  // because it may be undefined even when tool results exist!
  const isUiTokensTask = task?.id?.startsWith('ui-tokens');
  const isUiSpecTask = task?.id?.startsWith('ui-spec');
  
  // ALWAYS add instruction for ui-tokens and ui-spec tasks in Turn 2+
  // Don't check hasDiscoveredImages - this function is only called after tool calls!
  if (isUiTokensTask || isUiSpecTask) {
    const targetDoc = isUiTokensTask ? 'ui-tokens.json' : 'ui-spec.json';
    console.log(`🔔 [FreshPrompt] Adding "Next Steps" instruction for ${task?.id} → ${targetDoc}`);
    content.push({
      type: 'text',
      text: `\n\n# ⚠️ CRITICAL: You MUST Continue!

**This is Turn 2+ of your workflow. DO NOT STOP HERE.**

## Your Current Progress:
- ✅ Turn 1: You called \`list_reference_images\` or \`list_assets\` - DONE
- 🔄 Turn 2: NOW you must load the image OR generate the document

## What You MUST Do Now:

### Option A: If you haven't loaded the screenshot yet
Call \`read_reference_image\` tool:
\`\`\`
read_reference_image("inputs/references/homepage-desktop.png")
\`\`\`

### Option B: If you already have the screenshot loaded
Generate the document using \`<file>\` XML tag:
\`\`\`xml
<file path="outputs/design/${targetDoc}">
<!-- START_SECTION: 1 -->
# Document Title
...content...
<!-- END_SECTION -->
</file>
\`\`\`

## ⚠️ FAILURE CONDITIONS:
- ❌ Responding with only text explanation → TASK FAILS
- ❌ Saying "I will do X" without doing it → TASK FAILS
- ❌ Stopping without generating \`<file>\` → TASK FAILS

**You MUST output either a tool_use block OR a <file> XML tag!**`
    });
  }
  
  // ✅ Log prompt structure (not content) - tool loop continuation
  const jobIdFresh = state.jobId || state._httpJobId || 'unknown';
  if (state.context.featurePath) {
    try {
      const totalLength = content
        .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
        .reduce((sum, c) => sum + c.text.length, 0);
      
      await logPrompt(
        state.context.featurePath,
        jobIdFresh,
        'design',
        'docGen-uiDesign-freshPrompt',
        totalLength,
        {
          taskId: task?.id,
          taskName: task?.name,
          templatePath: 'design/phases/execute/base-ui-design',
          usedTemplates: [
            'design/phases/execute/rules-ui-design',
            'design/phases/execute/injections/ui-tokens-guide',
            'design/phases/execute/injections/ui-assets-guide',
            'design/phases/execute/injections/ui-spec-guide',
          ],
          injectedVariables: {
            systemPrompt: systemPrompt ? `[${systemPrompt.length} chars]` : undefined,
            resourcesSummary: resourcesSummary ? `[${resourcesSummary.length} chars]` : undefined,
            prd: state.prd ? `[${state.prd.length} chars]` : undefined,
            previousDocs: previousDocs ? `[${previousDocs.length} chars]` : undefined,
            isUiTokensTask,
            isUiSpecTask,
            isFreshPrompt: true,
          },
        }
      );
    } catch (logError) {
      console.warn(`⚠️  [DocGen] Failed to log fresh prompt:`, logError);
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
  resourcesSummary += '## Reference Images\n';
  resourcesSummary += 'Use `list_reference_images` tool to discover available images, then use `read_reference_image` to load and analyze specific images.\n\n';
  
  if (state.uiReferences?.length) {
    resourcesSummary += `- **References**: ${state.uiReferences.length} images available\n`;
    resourcesSummary += `  (Examples: ${state.uiReferences.slice(0, 5).join(', ')}${state.uiReferences.length > 5 ? '...' : ''})\n`;
  }
  
  resourcesSummary += '\n## Asset Files\n';
  resourcesSummary += 'Use `list_assets` tool to discover available asset files for mapping.\n\n';
  
  if (state.uiAssetsList) {
    const assetCounts = Object.entries(state.uiAssetsList)
      .filter(([, files]) => files.length > 0)
      .map(([group, files]) => `${group}: ${files.length}`);
    
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
 * - ui-assets: needs ui-tokens.json
 * - ui-spec: needs ui-tokens.json + ui-assets.json
 */
async function loadPreviousUiDocs(
  state: DesignGraphState,
  taskId: string
): Promise<string> {
  // ✅ Chapter-based approach: Load complete documents from previous categories
  // - ui-tokens-ch*: No dependencies
  // - ui-assets-ch*: Need complete ui-tokens.json
  // - ui-spec-ch*: Need complete ui-tokens.json + ui-assets.json
  
  const isUiTokensTask = taskId.startsWith('ui-tokens');
  const isUiAssetsTask = taskId.startsWith('ui-assets');
  const isUiSpecTask = taskId.startsWith('ui-spec');
  
  // ui-tokens tasks don't need previous docs (foundation)
  if (isUiTokensTask) {
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
  
  // ✅ Load COMPLETE ui-tokens.json for ui-assets-* and ui-spec-*
  if (isUiAssetsTask || isUiSpecTask) {
    try {
      const tokensPath = path.join(designOutputDir, 'ui-tokens.json');
      const tokensContent = await fileSystem.readFile(tokensPath);
      if (tokensContent && !tokensContent.includes('ant:template')) {
        injectedDocs += `\n\n════════════════════════════════════════════════════════════════════════════════\n`;
        injectedDocs += `# REFERENCE: ui-tokens.json (ALL chapters completed)\n`;
        injectedDocs += `> Use these token keys. Do NOT use raw values that are defined here.\n`;
        injectedDocs += `════════════════════════════════════════════════════════════════════════════════\n\n`;
        injectedDocs += '```json\n' + tokensContent + '\n```';
        console.log(`📄 [DocGen] Injected ui-tokens.json (${tokensContent.length} chars) for ${taskId}`);
      }
    } catch {
      // File doesn't exist yet, skip
    }
  }
  
  // ✅ Load COMPLETE ui-assets.json for ui-spec-*
  if (isUiSpecTask) {
    try {
      const assetsPath = path.join(designOutputDir, 'ui-assets.json');
      const assetsContent = await fileSystem.readFile(assetsPath);
      if (assetsContent && !assetsContent.includes('ant:template')) {
        injectedDocs += `\n\n════════════════════════════════════════════════════════════════════════════════\n`;
        injectedDocs += `# REFERENCE: ui-assets.json (ALL chapters completed)\n`;
        injectedDocs += `> Reference these asset identifiers when documenting components.\n`;
        injectedDocs += `════════════════════════════════════════════════════════════════════════════════\n\n`;
        injectedDocs += '```json\n' + assetsContent + '\n```';
        console.log(`📄 [DocGen] Injected ui-assets.json (${assetsContent.length} chars) for ${taskId}`);
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
 * 
 * ✅ NEW: Tracks lastSectionNumber for chapter-based append (same as System Design)
 * ✅ NEW: Injects previousChaptersSummary to prevent duplicate content
 */
export async function buildUiDesignSystemPrompt(state: DesignGraphState): Promise<string> {
  const promptPort = state.deps?.promptEngine;
  
  if (!promptPort) {
    throw new Error('[DocGen] PromptEngine is required but not available in state.deps');
  }
  
  // ✅ NEW: Load lastSectionNumber for chapter-based append (same as System Design)
  let lastSectionNumber = 0;
  let sectionPattern = '';  // 'top-level' or 'nested'
  let previousChaptersSummary = '';
  let existingFileContent = '';
  
  const taskId = state.currentTask?.id || '';
  const taskDescription = state.currentTask?.description || '';
  const targetFile = state.currentTask?.targetFile;
  
  // Determine target file from task ID if not explicitly set
  const actualTargetFile = targetFile || 
    (taskId.startsWith('ui-tokens') ? 'ui-tokens.json' :
     taskId.startsWith('ui-assets') ? 'ui-assets.json' :
     taskId.startsWith('ui-spec') ? 'ui-spec.json' : 'ui-spec.json');
  
  // ✅ Check if this is the last task for this document
  // If no more tasks in queue target the same file, don't output metadata
  // CRITICAL: Exclude current task from the count (it may still be in queue)
  const currentTaskId = state.currentTask?.id;
  const allQueuedTasks = state.taskQueue?.getAll?.() || [];
  const remainingTasksForFile = allQueuedTasks.filter(
    (task: any) => {
      // Exclude current task from remaining count
      if (task.id === currentTaskId) return false;
      const taskTargetFile = task.targetFile || 
        (task.id?.startsWith('ui-tokens') ? 'ui-tokens.json' :
         task.id?.startsWith('ui-assets') ? 'ui-assets.json' :
         task.id?.startsWith('ui-spec') ? 'ui-spec.json' : null);
      return taskTargetFile === actualTargetFile;
    }
  );
  const isLastTaskForDocument = remainingTasksForFile.length === 0;
  if (isLastTaskForDocument) {
    console.log(`📄 [DocGen UI] This is the LAST task for ${actualTargetFile} - will NOT output metadata`);
  }
  
  // ✅ Check if file exists and extract last section number + existing sections
  if (state.deps?.fileSystem && state.context.featurePath) {
    try {
      const path = await import('path');
      const workspaceRoot = state.deps.fileSystem.getWorkspaceRoot?.() || '';
      const featureDirRel = workspaceRoot
        ? path.relative(workspaceRoot, state.context.featurePath)
        : state.context.featurePath.replace(/^\//, '');
      
      const filePath = path.join(featureDirRel, 'outputs/design', actualTargetFile);
      const fileExists = await state.deps.fileSystem.fileExists(filePath);
      
      if (fileExists) {
        existingFileContent = await state.deps.fileSystem.readFile(filePath) || '';
        if (existingFileContent) {
          const isJsonFile = actualTargetFile.endsWith('.json');
          
          // ✅ JSON files: Parse and read _meta field (all UI docs are now JSON)
          if (isJsonFile) {
            try {
              const parsed = JSON.parse(existingFileContent);
              if (parsed._meta) {
                if (typeof parsed._meta.lastSection === 'number') {
                  lastSectionNumber = parsed._meta.lastSection;
                  console.log(`📄 [DocGen UI] Found lastSection in ${actualTargetFile}: ${lastSectionNumber} (from _meta)`);
                }
                if (parsed._meta.sectionPattern) {
                  sectionPattern = parsed._meta.sectionPattern;
                  console.log(`📄 [DocGen UI] Found sectionPattern in ${actualTargetFile}: ${sectionPattern}`);
                }
              }
              // For JSON, count top-level keys (excluding _meta) as "sections"
              const dataKeys = Object.keys(parsed).filter(k => k !== '_meta');
              if (!lastSectionNumber && dataKeys.length > 0) {
                lastSectionNumber = dataKeys.length;
                console.log(`📄 [DocGen UI] Estimated lastSection from ${dataKeys.length} top-level keys in ${actualTargetFile}`);
              }
              // Generate previousChaptersSummary from top-level keys
              if (dataKeys.length > 0) {
                previousChaptersSummary = dataKeys.map((k, i) => `- Category ${i + 1}: ${k}`).join('\n');
              }
              // For ui-spec.json with sections object
              if (parsed.sections && typeof parsed.sections === 'object' && !Array.isArray(parsed.sections)) {
                const sectionKeys = Object.keys(parsed.sections);
                if (sectionKeys.length > 0) {
                  previousChaptersSummary = sectionKeys.map((k, i) => `- Section ${i + 1}: ${k}`).join('\n');
                }
              }
            } catch (parseError) {
              console.warn(`📄 [DocGen UI] Failed to parse ${actualTargetFile} as JSON:`, parseError);
            }
          }
          // Non-JSON files (should not happen for UI docs)
          else {
            const metadataLines = existingFileContent.trim().split('\n').slice(-5);
            
            for (const line of metadataLines) {
              const lastSectionMatch = line.match(/<!-- LAST_SECTION: (\d+) -->/);
              if (lastSectionMatch) {
                lastSectionNumber = parseInt(lastSectionMatch[1]);
                console.log(`📄 [DocGen UI] Found last section in ${actualTargetFile}: ${lastSectionNumber} (from metadata)`);
              }
              
              const patternMatch = line.match(/<!-- SECTION_PATTERN: (\w+) -->/);
              if (patternMatch) {
                sectionPattern = patternMatch[1];
                console.log(`📄 [DocGen UI] Found section pattern in ${actualTargetFile}: ${sectionPattern}`);
              }
            }
            
            // Fallback: scan for section headers (## N.)
            if (!lastSectionNumber) {
              const sectionMatches = existingFileContent.match(/^## (\d+)\./gm);
              if (sectionMatches) {
                const numbers = sectionMatches.map((m: string) => parseInt(m.match(/\d+/)?.[0] || '0'));
                lastSectionNumber = Math.max(...numbers);
                console.log(`📄 [DocGen UI] Found last section in ${actualTargetFile}: ${lastSectionNumber} (from scanning)`);
              }
            }
            
            // Extract section titles for previousChaptersSummary
            previousChaptersSummary = extractPreviousSectionsSummary(existingFileContent);
          }
          
          if (previousChaptersSummary) {
            console.log(`📄 [DocGen UI] Extracted summary from existing ${actualTargetFile}`);
          }
        }
      } else {
        console.log(`📄 [DocGen UI] ${actualTargetFile} does not exist yet (first chapter)`);
      }
    } catch (error) {
      console.error(`[DocGen UI] Error reading ${actualTargetFile}:`, error);
    }
  }
  
  // ✅ NEW: Extract PATH_PATTERN for ui-assets continuation chapters
  let pathPattern = '';
  if (taskId.startsWith('ui-assets') && existingFileContent) {
    pathPattern = extractPathPattern(existingFileContent);
    if (pathPattern) {
      console.log(`📄 [DocGen UI] Extracted PATH_PATTERN from existing ui-assets.json: ${pathPattern}`);
    }
  }
  
  // Load from template with task context + lastSectionNumber for Handlebars conditionals
  const injectedVariables = {
    taskId: state.currentTask?.id,
    taskName: state.currentTask?.name,
    taskDescription,
    lastSectionNumber,
    sectionPattern,
    targetFile: actualTargetFile,
    previousChaptersSummary,
    isLastTaskForDocument,  // ✅ If true, don't output metadata comments
    pathPattern,  // ✅ NEW: For ui-assets ch2+ to follow ch1's destination paths
    existingDocContent: existingFileContent,  // ✅ NEW: Full file content for LLM to see and extend
    jobMode: state.detectionReport?.jobMode,  // ✅ NEW: For refactor mode handling (generate/refactor/explain)
  };
  
  const template = await (promptPort as any).deps?.promptPort?.render('design/phases/execute/base-ui-design', injectedVariables);
  
  if (!template) {
    throw new Error('[DocGen] Failed to load base-ui-design.md template');
  }
  
  // ✅ Log prompt structure (not content)
  const jobId = state.jobId || state._httpJobId || 'unknown';
  if (state.context.featurePath) {
    try {
      await logPrompt(
        state.context.featurePath,
        jobId,
        'design',
        'docGen-uiDesign-systemPrompt',
        template.length,
        {
          taskId: state.currentTask?.id,
          taskName: state.currentTask?.name,
          templatePath: 'design/phases/execute/base-ui-design',
          usedTemplates: [
            'design/phases/execute/rules-ui-design',
            'design/phases/execute/injections/ui-tokens-guide',
            'design/phases/execute/injections/ui-assets-guide',
            'design/phases/execute/injections/ui-spec-guide',
          ],
          injectedVariables: {
            // Summarize large content
            taskDescription: injectedVariables.taskDescription ? `[${injectedVariables.taskDescription.length} chars]` : undefined,
            isLastTaskForDocument: injectedVariables.isLastTaskForDocument,
            pathPattern: injectedVariables.pathPattern,
            previousChaptersSummary: injectedVariables.previousChaptersSummary ? `[${injectedVariables.previousChaptersSummary.length} chars]` : undefined,
            existingDocContent: injectedVariables.existingDocContent ? `[${injectedVariables.existingDocContent.length} chars]` : undefined,
          },
        }
      );
    } catch (logError) {
      console.warn(`⚠️  [DocGen] Failed to log prompt:`, logError);
    }
  }
  
  return template;
}

/**
 * Extract section titles from existing file content to create a summary
 * of what has already been documented (to prevent duplication)
 */
function extractPreviousSectionsSummary(content: string): string {
  if (!content) return '';
  
  const lines = content.split('\n');
  const sections: string[] = [];
  
  for (const line of lines) {
    // Match ## N. Title or ### N.N. Subsection Title
    const sectionMatch = line.match(/^(#{2,3})\s+(\d+(?:\.\d+)?\.?)\s+(.+)$/);
    if (sectionMatch) {
      const level = sectionMatch[1].length;
      const number = sectionMatch[2];
      const title = sectionMatch[3].trim();
      
      // Format: "- Section N: Title" or "  - Subsection N.N: Title"
      const indent = level === 2 ? '' : '  ';
      const prefix = level === 2 ? 'Section' : 'Subsection';
      sections.push(`${indent}- ${prefix} ${number} ${title}`);
    }
  }
  
  if (sections.length === 0) return '';
  
  return sections.join('\n');
}

/**
 * Extract PATH_PATTERN metadata from existing ui-assets.json content
 * 
 * For JSON files: reads from _meta.pathPattern object
 * For MD files (legacy): parses HTML comment
 * 
 * This ensures ch2+ follows the same destination path patterns as ch1.
 */
function extractPathPattern(content: string): string {
  if (!content) return '';
  
  // Try to parse as JSON first (new format)
  try {
    const parsed = JSON.parse(content);
    if (parsed._meta?.pathPattern) {
      // Convert object to string format: "logos=public/logos/, icons=public/icons/"
      const patterns: string[] = [];
      for (const [key, value] of Object.entries(parsed._meta.pathPattern)) {
        patterns.push(`${key}=${value}`);
      }
      return patterns.join(', ');
    }
    
    // Fallback: infer from actual asset destinations in JSON
    const destinationPaths = new Set<string>();
    for (const category of Object.values(parsed)) {
      if (typeof category === 'object' && category !== null && !('lastSection' in category)) {
        for (const asset of Object.values(category as Record<string, any>)) {
          if (asset?.dest) {
            const dirMatch = (asset.dest as string).match(/(public\/[\w-]+\/)/);
            if (dirMatch) {
              destinationPaths.add(dirMatch[1]);
            }
          }
        }
      }
    }
    
    if (destinationPaths.size > 0) {
      const patterns: string[] = [];
      for (const p of destinationPaths) {
        const dirName = p.replace(/^public\//, '').replace(/\/$/, '');
        patterns.push(`${dirName}=${p}`);
      }
      return patterns.join(', ');
    }
  } catch {
    // Not JSON, try legacy MD format
  }
  
  // Legacy: Look for PATH_PATTERN metadata comment in MD
  const pathPatternMatch = content.match(/<!-- PATH_PATTERN: (.+?) -->/);
  if (pathPatternMatch) {
    return pathPatternMatch[1];
  }
  
  // Legacy fallback: Extract patterns from tables
  const destinationPaths = new Set<string>();
  const tableRowMatch = content.matchAll(/\|\s*[\w-]+\s*\|\s*[^|]+\s*\|\s*(public\/[\w/]+)/g);
  
  for (const match of tableRowMatch) {
    const destPath = match[1];
    const dirMatch = destPath.match(/(public\/[\w-]+\/)/);
    if (dirMatch) {
      destinationPaths.add(dirMatch[1]);
    }
  }
  
  if (destinationPaths.size > 0) {
    const patterns: string[] = [];
    for (const p of destinationPaths) {
      const dirName = p.replace(/^public\//, '').replace(/\/$/, '');
      patterns.push(`${dirName}=${p}`);
    }
    return patterns.join(', ');
  }
  
  return '';
}
