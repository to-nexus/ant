/**
 * System Design Prompt Builder
 * 
 * Handles message building for system-design work type:
 * - buildMessages: Main message builder with PromptEngine
 * - buildRuntimeContext: Task and directive context
 */

import { DesignGraphState } from '../../state';
import { CacheableContent } from '../../../../../../core/ports/llm';
import { TokenBudgetManager } from '../../../../../../core/utils/tokenBudget';
import { compactAndPruneHistory } from '../../../../../../core/utils/historyManager';
import { logPrompt } from '../../../../../../core/utils/promptLogger';
import { buildSourceDocsForTask } from './sourceSelector';
import { DesignTask } from '../../../../types/task';

/**
 * Build messages for LLM using PromptEngine with Prompt Caching
 * 
 * Handles system-design work type (fe-system, be-system, api-contract, etc.)
 */
export async function buildMessages(state: DesignGraphState): Promise<Array<{
  role: 'user' | 'assistant';
  content: CacheableContent[];
}>> {
  const messages: Array<{ role: 'user' | 'assistant'; content: CacheableContent[] }> = [];
  
  // NOTE: UI Design mode is handled separately in docGen() entry point
  // This function handles system-design messages only
  
  // ✅ System prompt is ALWAYS rebuilt (prevents context loss from history pruning)
  {
    console.log(`📄 [DocGen] Building system prompt`);
    const promptEngine = state.deps?.promptEngine;
    
    if (!promptEngine) {
      throw new Error('[DocGen] PromptEngine is required but not available in state.deps');
    }
    
    if (!state.currentTask) {
      throw new Error('[DocGen] currentTask is required but not available in state');
    }
    // ✅ Load existing design document's last section number and pattern
    let lastSectionNumber = 0;
    let sectionPattern = '';  // 'top-level' or 'nested'
    
    const targetFile = state.currentTask.targetFile || 'be-system-main.md';
    console.log(`📄 [DocGen] Target file: ${targetFile}`);
    
    // ✅ Use pre-computed isLastTaskForDocument from decompose phase
    // (Avoids dependency on taskQueue which may be empty in parallel worker contexts)
    const isLastTaskForDocument = (state.currentTask as any)?.isLastTaskForDocument ?? false;
    if (isLastTaskForDocument) {
      console.log(`📄 [DocGen] This is the LAST task for ${targetFile} - will NOT output metadata`);
    }
    
    // ✅ Build section scope from assignedSections (exclusive scope enforcement)
    const sectionScope = await buildSectionScope(state, targetFile);
    const filteredCatalog = await buildFilteredCatalog(state, targetFile);
    
    try {
      // ✅ FIX: Convert absolute path to workspace-relative path for FileSystemPort
      // FileSystemPort expects relative paths - absolute paths cause path resolution issues
      const pathModule = await import('path');
      let designDocPath = `${state.context.featurePath}/outputs/design/${targetFile}`;
      
      if (state.deps?.fileSystem) {
        const rootPath = state.deps.fileSystem.getRootPath?.();
        if (rootPath && pathModule.isAbsolute(designDocPath)) {
          designDocPath = pathModule.relative(rootPath, designDocPath);
        }
        
        const fileExists = await state.deps.fileSystem.fileExists(designDocPath);
        if (fileExists) {
          const fullContent = await state.deps.fileSystem.readFile(designDocPath) || '';
          if (fullContent) {
            // Parse all metadata from file
            const metadataLines = fullContent.trim().split('\n').slice(-5); // Check last 5 lines
            
            for (const line of metadataLines) {
              // Parse LAST_SECTION
              const lastSectionMatch = line.match(/<!-- LAST_SECTION: (\d+) -->/);
              if (lastSectionMatch) {
                lastSectionNumber = parseInt(lastSectionMatch[1]);
                console.log(`📄 [DocGen] Found last section: ${lastSectionNumber} (from metadata)`);
              }
              
              // Parse SECTION_PATTERN
              const patternMatch = line.match(/<!-- SECTION_PATTERN: (\w+) -->/);
              if (patternMatch) {
                sectionPattern = patternMatch[1];
                console.log(`📄 [DocGen] Found section pattern: ${sectionPattern}`);
              }
            }
            
            // Fallback for LAST_SECTION: scan for section headers
            if (!lastSectionNumber) {
              const sectionMatches = fullContent.match(/^## (\d+)\./gm);
              if (sectionMatches) {
                const numbers = sectionMatches.map((m: string) => parseInt(m.match(/\d+/)?.[0] || '0'));
                lastSectionNumber = Math.max(...numbers);
                console.log(`📄 [DocGen] Found last section: ${lastSectionNumber} (from scanning)`);
              }
            }
          }
        } else {
          console.log(`📄 [DocGen] ${targetFile} does not exist yet (first task)`);
        }
      }
    } catch (error) {
      console.error(`[DocGen] Error reading design document:`, error);
    }
    
    const sourceDocsForTask = buildSourceDocsForTask(
      (state.currentTask as DesignTask)?.sourceFiles,
      state.sourceDocuments
    );
    
    const taskSourceFiles = (state.currentTask as DesignTask)?.sourceFiles;
    if (taskSourceFiles?.length && !sourceDocsForTask) {
      console.warn(`⚠️ [DocGen] sourceFiles assigned [${taskSourceFiles.join(', ')}] but matched 0 documents in sourceDocuments`);
    }

    const promptResult = await promptEngine.buildExecutePrompt(
      'design',
      state.context,
      {
        directive: state.directive || '',
        lastSectionNumber,
        sectionPattern,
        prdSpec: sourceDocsForTask,
        designDomain: state.detectionReport?.domain,
        currentTask: {
          name: state.currentTask.name,
          type: state.currentTask.type,
          priority: state.currentTask.priority,
          description: state.currentTask.description,
          ...(state.currentTask.targetFile && { targetFile: state.currentTask.targetFile }),
        } as any,
        isLastTaskForDocument,
        sectionScope,
        filteredCatalog,
      },
      undefined,
      undefined
    );
    
    // ✅ Extract composed sections for granular caching
    const composed = promptResult.composed;
    
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // Block 1: System Prompt + Rules (CACHED - static)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    const systemPromptParts = [
      composed.system,
      composed.profiles,
      composed.rules,
      composed.examples
    ].filter(Boolean);
    
    const systemPromptBlock: CacheableContent = {
      type: 'text',
      text: systemPromptParts.join('\n\n'),
      cache_control: { type: 'ephemeral' }
    };
    
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // Block 2: Context (CACHED - changes per task)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    const contextParts = [
      composed.injections,
      sourceDocsForTask ? `# Requirements\n\n${sourceDocsForTask}` : null,
    ].filter(Boolean);
    
    const contextBlock: CacheableContent = {
      type: 'text',
      text: contextParts.join('\n\n'),
      cache_control: { type: 'ephemeral' }
    };
    
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // Block 3: Runtime Context (NOT CACHED - changes frequently)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    const runtimeContext = buildRuntimeContext(state);
    
    const runtimeBlock: CacheableContent = {
      type: 'text',
      text: runtimeContext
      // No cache_control - changes every turn
    };
    
    // ✅ Validate: Ensure XML output format instructions are present
    const allContent = [systemPromptParts.join(''), contextParts.join(''), runtimeContext].join('');
    const hasMarkdownFormat = allContent.includes('<file path=') || allContent.includes('Markdown File Output Format');
    
    if (!hasMarkdownFormat) {
      console.warn(`⚠️  WARNING: Markdown output format NOT found in prompt! (length: ${allContent.length} chars)`);
    }
    
    // ✅ Log prompt structure (not content)
    const jobId = state.jobId || state._httpJobId || 'unknown';
    if (state.context.featurePath) {
      try {
        const usedTemplates = detectUsedTemplates(state, targetFile);
        
        await logPrompt(
          state.context.featurePath,
          jobId,
          'design',
          'docGen-systemDesign',
          allContent.length,
          {
            taskId: state.currentTask?.id,
            taskName: state.currentTask?.name,
            templatePath: 'design/phases/execute/base-system-design',
            usedTemplates,
            injectedVariables: {
              targetFile,
              directive: state.directive ? `[${state.directive.length} chars]` : undefined,
              lastSectionNumber,
              sectionPattern,
              prdSpec: state.prd ? `[${state.prd.length} chars]` : undefined,
              planText: state.planText ? `[${state.planText.length} chars]` : undefined,
              designDomain: state.detectionReport?.domain,
              currentTask: state.currentTask?.id,
              isLastTaskForDocument,
              isMSAServiceDoc: targetFile.startsWith('be-system-') && !targetFile.includes('be-system-main'),
              sectionScope: sectionScope ? `[${sectionScope.length} chars]` : undefined,
              filteredCatalog: filteredCatalog ? `[${filteredCatalog.length} chars]` : undefined,
            },
          }
        );
      } catch (logError) {
        console.warn(`⚠️  [DocGen] Failed to log prompt:`, logError);
      }
    }
    
    messages.push({
      role: 'user',
      content: [systemPromptBlock, contextBlock, runtimeBlock]
    });
  }
  
  // ✅ Add conversation history (if exists)
  if (state.conversationHistory && state.conversationHistory.length > 0) {
    console.log(`📄 [DocGen] Using existing conversation history (${state.conversationHistory.length} messages)`);
    
    // Skip initial user messages (old system prompt — replaced by fresh rebuild above)
    let skipInitialUserMessages = true;
    const filteredHistory: typeof state.conversationHistory = [];
    for (const msg of state.conversationHistory) {
      if (msg.role === 'assistant') {
        skipInitialUserMessages = false;
      }
      if (skipInitialUserMessages && msg.role === 'user') {
        continue;
      }
      filteredHistory.push(msg);
    }
    
    const tokenManager = new TokenBudgetManager();
    
    // Universal 3-step compaction on tool conversation only (system prompt excluded)
    const { result: prunedHistory, wasCompacted } = compactAndPruneHistory(filteredHistory, tokenManager);
    
    // Convert history to CacheableContent format
    let isFirstMsg = true;
    for (const msg of prunedHistory) {
      if (typeof msg.content === 'string') {
        const shouldCache = wasCompacted && isFirstMsg && msg.role === 'assistant'
          && msg.content.startsWith('[Auto-compacted:');
        messages.push({
          role: msg.role as 'user' | 'assistant',
          content: [{
            type: 'text',
            text: msg.content,
            ...(shouldCache ? { cache_control: { type: 'ephemeral' as const } } : {}),
          }]
        });
      } else {
        messages.push({
          role: msg.role as 'user' | 'assistant',
          content: msg.content
        });
      }
      isFirstMsg = false;
    }
    
    // Anthropic API requires conversation to end with a user message.
    // If history ends with assistant (e.g., retry after no <done>), append continuation.
    if (messages.length > 0 && messages[messages.length - 1].role === 'assistant') {
      messages.push({
        role: 'user',
        content: [{ type: 'text', text: 'Continue.' }]
      });
    }

    const estimation = tokenManager.checkBudget(messages as any);
    
    if (estimation.isOverBudget) {
      throw new Error(
        `[DocGen] Token budget exceeded after compaction! ` +
        `${estimation.totalTokens.toLocaleString()} tokens > ` +
        `${tokenManager['config'].maxTokens.toLocaleString()} limit.`
      );
    }
  } else {
    const tokenManager = new TokenBudgetManager();
    tokenManager.checkBudget(messages as any);
  }
  
  // ✅ Log prompt structure (not content) - full message
  const jobIdFinal = state.jobId || state._httpJobId || 'unknown';
  if (state.context.featurePath) {
    try {
      // Calculate total text length from all messages
      const totalLength = messages.reduce((sum, m) => {
        const content = m.content as CacheableContent[];
        return sum + content.reduce((s: number, c) => {
          if (c.type === 'text' && typeof c.text === 'string') {
            return s + c.text.length;
          }
          return s;
        }, 0);
      }, 0);
      
      const targetFileForLog = state.currentTask?.targetFile || 'be-system-main.md';
      const usedTemplatesForLog = detectUsedTemplates(state, targetFileForLog);
      
      await logPrompt(
        state.context.featurePath,
        jobIdFinal,
        'design',
        'docGen-systemDesign-fullMessage',
        totalLength,
        {
          taskId: state.currentTask?.id,
          taskName: state.currentTask?.name,
          templatePath: 'design/phases/execute/base-system-design',
          usedTemplates: usedTemplatesForLog,
          injectedVariables: {
            targetFile: targetFileForLog,  // ✅ NEW: Critical for MSA debugging
            messageCount: messages.length,
            hasConversationHistory: !!(state.conversationHistory?.length),
            conversationHistoryLength: state.conversationHistory?.length || 0,
            prd: state.prd ? `[${state.prd.length} chars]` : undefined,
            design: state.design ? `[${state.design.length} chars]` : undefined,
            directive: state.directive ? `[${state.directive.length} chars]` : undefined,
            jobMode: state.detectionReport?.jobMode,
            designDomain: state.detectionReport?.domain,
            isMSAServiceDoc: targetFileForLog.startsWith('be-system-') && !targetFileForLog.includes('be-system-main'),
          },
        }
      );
    } catch (logError) {
      console.warn(`⚠️  [DocGen] Failed to log full message:`, logError);
    }
  }
  
  return messages;
}

/**
 * Build runtime context (task, directive, existing design)
 * 
 * This supplements PromptEngine's base prompt with execution-specific context:
 * - Current task and directive
 * - Existing design (for continuation)
 * 
 * Note: Output format instructions are in PromptEngine templates
 */
export function buildRuntimeContext(state: DesignGraphState): string {
  const task = state.currentTask;
  const lines: string[] = [];
  
  // ✅ 1. Target File
  if (task?.targetFile) {
    lines.push(`# Target Document`);
    lines.push(`Write to: \`outputs/design/${task.targetFile}\``);
    lines.push('');
    lines.push(`⚠️ CRITICAL: You MUST write to this file in your XML output!`);
    lines.push(`Use: <file path="outputs/design/${task.targetFile}">...</file>`);
    lines.push('');
  }
  
  // ✅ 2. Current Task
  if (task) {
    lines.push(`# Current Task`);
    lines.push(`**${task.name}**`);
    lines.push(task.description);
    lines.push('');
  }
  
  // ✅ 3. Directive (user requirements)
  if (state.directive) {
    lines.push(`# Directive`);
    lines.push(state.directive || '');
    lines.push('');
  }
  
  // ✅ 4. Existing Design Document (ONLY for refactor mode)
  // - generate: NO document needed (lastSectionNumber is sufficient for sequential chapter generation)
  // - refactor: FULL document needed (LLM must understand structure to modify specific sections)
  //   Use content matching targetFile from existingDesignDocs (not state.design which may be a different file)
  if (state.detectionReport?.jobMode === 'refactor') {
    const targetFileName = task?.targetFile || 'be-system-main.md';
    const existingContent = state.existingDesignDocs?.[targetFileName] || state.design;
    if (existingContent) {
      lines.push(`# Existing Design Document`);
      lines.push(existingContent);
      lines.push('');
    }
  }
  // ❌ For generate mode: DO NOT include state.design
  // Reason: Including old document content causes LLM confusion with outdated metadata
  // The lastSectionNumber in the base prompt is sufficient for sequential chapter numbering
  
  return lines.join('\n');
}

/**
 * Detect all templates that would be used, including framework augmentations.
 * Mirrors ModeController.detectFrameworkAugmentation logic for accurate logging.
 */
function detectUsedTemplates(state: DesignGraphState, targetFile: string): string[] {
  const templates: string[] = ['design/phases/execute/rules-system-design'];
  
  if (targetFile.includes('api-contract')) {
    templates.push('design/base/injections/api-contract-guide');
  } else if (targetFile.includes('be-system-')) {
    templates.push('design/base/injections/backend-guide');
  } else if (targetFile.includes('fe-system-')) {
    templates.push('design/base/injections/frontend-guide');
  }
  
  // Domain-specific guides
  if (state.detectionReport?.domain === 'game') {
    templates.push('design/phases/execute/injections/game-domain-guide');
  } else if (state.detectionReport?.domain === 'service') {
    templates.push('design/phases/execute/injections/service-domain-guide');
  }
  
  // Framework augmentation detection (mirrors ModeController.detectFrameworkAugmentation)
  // Filter by targetFile: nextjs → frontend docs only, go-api → backend docs only
  const isFrontendDoc = targetFile.includes('fe-system-') || targetFile.includes('frontend');
  const isBackendDoc = targetFile.includes('be-system-') || targetFile.includes('backend');
  const framework = (state.context as any)?.codebaseProfile?.framework?.toLowerCase();
  const language = (state.context as any)?.codebaseProfile?.language?.toLowerCase();
  
  if ((framework?.includes('next') || framework?.includes('nextjs')) && isFrontendDoc) {
    templates.push('design/phases/execute/injections/nextjs-augmentation');
  } else if ((language?.includes('go') || language?.includes('golang')) && isBackendDoc) {
    const env = state.detectionReport?.environment;
    if (!env || env === 'backend' || env === 'fullstack') {
      templates.push('design/phases/execute/injections/go-api-augmentation');
    }
  } else {
    const allSourceDocs = state.sourceDocuments
      ? Object.values(state.sourceDocuments).join(' ')
      : state.prd || '';
    const textSources = [allSourceDocs, state.directive].filter(Boolean);
    const combined = textSources.join(' ').toLowerCase();
    if ((combined.includes('next.js') || combined.includes('nextjs') || combined.includes('next app router')) && isFrontendDoc) {
      templates.push('design/phases/execute/injections/nextjs-augmentation');
    } else if ((combined.includes('go ') || combined.includes('golang')) &&
               (combined.includes('api') || combined.includes('server') || combined.includes('backend')) && isBackendDoc) {
      templates.push('design/phases/execute/injections/go-api-augmentation');
    }
  }
  
  return templates;
}

/**
 * Catalog file mapping by targetFile prefix.
 * - names: section name list (for computing ASSIGNED/FORBIDDEN scope)
 * - full: detailed per-section writing guides (for filteredCatalog)
 */
const CATALOG_MAP: Record<string, { names: string; full: string }> = {
  'fe-system-': {
    names: 'design/base/catalogs/frontend-catalog-names.md',
    full: 'design/base/catalogs/frontend-catalog.md',
  },
  'be-system-': {
    names: 'design/base/catalogs/backend-catalog-names.md',
    full: 'design/base/catalogs/backend-catalog.md',
  },
  'api-contract-': {
    names: 'design/base/catalogs/api-contract-catalog-names.md',
    full: 'design/base/catalogs/api-contract-catalog.md',
  },
};

/**
 * Parse catalog-names.md content into an array of section names.
 * Format: "- § Section Name" or "- § Section Name (conditional: ...)"
 */
function parseCatalogSections(content: string): string[] {
  return content
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.startsWith('- §'))
    .map(line => {
      const match = line.match(/^- (§ [^(]+)/);
      return match ? match[1].trim() : '';
    })
    .filter(Boolean);
}

/**
 * Resolve the templates directory, compatible with both ESM dev (tsx) and bundled (esbuild) environments.
 * - Dev:  import.meta.url → src/agents/architect/.../docGen/systemDesignPrompt.ts → ../../../../../../core/prompt/templates
 * - Prod: import.meta.url → dist/composition/job-runner.js → ../core/prompt/templates (via /dist/ marker)
 */
async function resolveTemplateDir(): Promise<string> {
  const { fileURLToPath } = await import('url');
  const pathModule = await import('path');

  const currentDir = pathModule.dirname(fileURLToPath(import.meta.url));

  const distMarker = `${pathModule.sep}dist${pathModule.sep}`;
  const distIdx = currentDir.lastIndexOf(distMarker);
  if (distIdx !== -1) {
    const distRoot = currentDir.substring(0, distIdx + distMarker.length - 1);
    return pathModule.join(distRoot, 'core', 'prompt', 'templates');
  }

  return pathModule.resolve(currentDir, '../../../../../../core/prompt/templates');
}

/**
 * Build the ASSIGNED/FORBIDDEN section scope block for the execute prompt.
 * Returns undefined if assignedSections is not available on the current task.
 */
async function buildSectionScope(
  state: DesignGraphState,
  targetFile: string
): Promise<string | undefined> {
  const assignedSections = (state.currentTask as any)?.assignedSections as string[] | undefined;
  if (!assignedSections || assignedSections.length === 0) {
    return undefined;
  }
  
  // Resolve the catalog-names file for this document type
  let catalogTemplatePath: string | undefined;
  for (const [prefix, entry] of Object.entries(CATALOG_MAP)) {
    if (targetFile.startsWith(prefix)) {
      catalogTemplatePath = entry.names;
      break;
    }
  }
  
  if (!catalogTemplatePath) {
    console.warn(`⚠️  [DocGen] No catalog mapping for targetFile: ${targetFile}`);
    return `**ASSIGNED sections (write ONLY these):** ${assignedSections.join(', ')}`;
  }
  
  // Load the catalog-names file from the templates directory
  let allSections: string[] = [];
  try {
    const pathModule = await import('path');
    const fsModule = await import('fs/promises');
    const templateDir = await resolveTemplateDir();
    const catalogPath = pathModule.join(templateDir, catalogTemplatePath);
    const content = await fsModule.readFile(catalogPath, 'utf-8');
    allSections = parseCatalogSections(content);
  } catch (error) {
    console.warn(`⚠️  [DocGen] Failed to load catalog-names: ${catalogTemplatePath}`, error);
    return `**ASSIGNED sections (write ONLY these):** ${assignedSections.join(', ')}`;
  }
  
  // Detect non-canonical names in assignedSections (decompose bug indicator)
  const allSectionSet = new Set(allSections);
  const unknownSections = assignedSections.filter(s => !allSectionSet.has(s));
  if (unknownSections.length > 0) {
    console.warn(`⚠️ [DocGen] assignedSections contain names not in catalog: [${unknownSections.join(', ')}]`);
  }

  // Compute FORBIDDEN = all catalog sections not in ASSIGNED
  const assignedSet = new Set(assignedSections);
  const forbiddenSections = allSections.filter(s => !assignedSet.has(s));
  
  const lines = [
    `**ASSIGNED sections (write ONLY these):** ${assignedSections.join(', ')}`,
  ];
  if (forbiddenSections.length > 0) {
    lines.push(`**FORBIDDEN sections (do NOT write):** ${forbiddenSections.join(', ')}`);
  }
  
  console.log(`📄 [DocGen] Section scope: ${assignedSections.length} assigned, ${forbiddenSections.length} forbidden`);
  return lines.join('\n');
}

/**
 * Split a full catalog file into individual sections.
 * Each section starts with "### §" and continues until the next "### §" or EOF.
 */
function splitCatalogIntoSections(content: string): Array<{ name: string; block: string }> {
  const sections: Array<{ name: string; block: string }> = [];
  const lines = content.split('\n');
  let currentName = '';
  let currentLines: string[] = [];

  for (const line of lines) {
    if (line.trimStart().startsWith('### §')) {
      if (currentName) {
        sections.push({ name: currentName, block: currentLines.join('\n') });
      }
      const nameMatch = line.match(/### (§ [^(]+)/);
      currentName = nameMatch ? nameMatch[1].trim() : line.trim();
      currentLines = [line];
    } else if (currentName) {
      currentLines.push(line);
    }
  }
  if (currentName) {
    sections.push({ name: currentName, block: currentLines.join('\n') });
  }

  return sections;
}

/**
 * Build a filtered catalog containing only the assigned sections' writing guides.
 * When assignedSections is set, the LLM should only see HOW-to-write guidance for
 * its assigned sections — preventing it from writing sections outside its scope.
 * Returns undefined when no filtering is needed (full catalog will be shown via partial).
 */
async function buildFilteredCatalog(
  state: DesignGraphState,
  targetFile: string
): Promise<string | undefined> {
  const assignedSections = (state.currentTask as any)?.assignedSections as string[] | undefined;
  if (!assignedSections || assignedSections.length === 0) {
    return undefined;
  }

  let catalogRelPath: string | undefined;
  for (const [prefix, entry] of Object.entries(CATALOG_MAP)) {
    if (targetFile.startsWith(prefix)) { catalogRelPath = entry.full; break; }
  }
  if (!catalogRelPath) {
    console.warn(`⚠️  [DocGen] No catalog mapping for targetFile: ${targetFile}`);
    return undefined;
  }

  try {
    const pathModule = await import('path');
    const fsModule = await import('fs/promises');
    const templateDir = await resolveTemplateDir();
    const catalogPath = pathModule.join(templateDir, catalogRelPath);
    const content = await fsModule.readFile(catalogPath, 'utf-8');

    const allSections = splitCatalogIntoSections(content);
    const filtered = allSections.filter(s =>
      assignedSections.some(assigned => s.name.includes(assigned.replace('§ ', '')))
    );

    if (filtered.length === 0) {
      console.warn(`⚠️  [DocGen] No catalog sections matched assignedSections: ${assignedSections.join(', ')}`);
      return undefined;
    }

    console.log(`📄 [DocGen] Filtered catalog: ${filtered.length}/${allSections.length} sections for [${assignedSections.join(', ')}]`);
    return filtered.map(s => s.block).join('\n\n');
  } catch (error) {
    console.warn(`⚠️  [DocGen] Failed to load full catalog: ${catalogRelPath}`, error);
    return undefined;
  }
}

