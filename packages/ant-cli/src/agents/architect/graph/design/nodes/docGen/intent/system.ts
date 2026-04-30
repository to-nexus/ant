/**
 * System Design Prompt Builder
 * 
 * Handles message building for system-design work type:
 * - buildMessages: Main message builder with PromptEngine
 * - buildRuntimeContext: Task and directive context
 */

import { DesignGraphState } from '../../../state';
import { CONV_KEYS, getConv } from '../../../../../../common/graph/conversations';
import { CacheableContent, MessageContentBlock } from '../../../../../../../core/ports/llm';
import { logPrompt } from '../../../../../../../core/utils/promptLogger';
import { buildSourceFileIndex, EXECUTE_SOURCE_THRESHOLD } from '../sourceSelector';
import { DesignTask } from '../../../../../types/task';
import { designDirOf, effectiveTechTier, getTechTier, getRACDocuments, ARTIFACT_PREFIX } from '@ant/shared';
import type { ResolvedArtifact, TechTier } from '@ant/shared';
import { PromptBuilder } from '../../../../../../../core/prompt/builder/PromptBuilder';
import { AutoInjectionResolver } from '../../../../../../../core/prompt/builder/AutoInjectionResolver';
import { deriveArtifactPolicies } from '../../../../../../../core/prompt/builder/ArtifactRoleResolver';
import type { PromptBuildConfig } from '../../../../../../../core/prompt/builder/PromptBuildConfig';
import { buildCacheableBlocks } from '../../../../../../../core/prompt/builder/CacheBlockMapper';
import { composeMessages } from '../../../../../../../core/utils/messageComposer';
import { selectArtifacts, ArtifactPoolView } from '../../../../../../../core/prompt/builder/ArtifactPipeline';
import {
  CATALOG_MAP,
  parseCatalogSections,
  resolveTemplateDir,
} from '../../decompose/catalogLookup';

export interface BuildMessagesResult {
  messages: Array<{ role: 'user' | 'assistant'; content: MessageContentBlock[] }>;
  useSourceFileTool: boolean;
}

/**
 * Build messages for LLM using PromptEngine with Prompt Caching
 * 
 * Handles system-design work type (fe-system, be-system, api-contract, etc.)
 */
export async function buildMessages(state: DesignGraphState): Promise<BuildMessagesResult> {
  let useSourceFileTool = false;
  let prdSpecForLog = '';
  let blocks: CacheableContent[] = [];
  
  // NOTE: UI Design mode is handled separately in docGen() entry point
  // This function handles system-design messages only
  
  // ✅ System prompt is ALWAYS rebuilt (prevents context loss from history pruning)
  {
    console.log(`📄 [DocGen] Building system prompt`);

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
      let designDocPath = `${state.context.featurePath}/${designDirOf(targetFile)}/${targetFile}`;
      
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
    
    // Select source artifacts from pool (include policy set by decompose)
    const currentTask = state.currentTask as DesignTask | undefined;
    const taskSourceFiles = currentTask?.sourceFiles;
    let sourceArtifacts = selectArtifacts(state.artifacts || [], { include: currentTask?.include || [ARTIFACT_PREFIX.SOURCES] });
    if (taskSourceFiles?.length) {
      const planPrefix = `${ARTIFACT_PREFIX.SOURCES}/`;
      sourceArtifacts = sourceArtifacts.filter(a =>
        taskSourceFiles.some(f => a.path.endsWith('/' + f) || a.path === planPrefix + f),
      );
    }
    const combinedSourceContent = sourceArtifacts.map(a => a.content).join('\n\n');

    let prdSpec = combinedSourceContent;
    if (combinedSourceContent.length > EXECUTE_SOURCE_THRESHOLD) {
      const filteredDocs: Record<string, string> = {};
      const planPrefixRe = new RegExp(`^${ARTIFACT_PREFIX.SOURCES}/`);
      for (const a of sourceArtifacts) {
        const name = a.path.replace(planPrefixRe, '');
        filteredDocs[name] = a.content;
      }
      prdSpec = buildSourceFileIndex(filteredDocs, 8, { includeLineNumbers: true })
        + `\n\n> Source documents are large. Use \`read_source_doc\` with \`startLine\`/\`endLine\` to read broad ranges (300-500+ lines per call).`
        + ` The outline above shows line numbers (e.g., L120) for each heading.`
        + ` Prioritize breadth: read large sections in few calls, then START WRITING by call 5-7.`
        + ` Do NOT read every section — gather enough context and begin output immediately.`;
      useSourceFileTool = true;
      console.log(`📄 [DocGen] Source docs (${combinedSourceContent.length.toLocaleString()} chars) > threshold (${EXECUTE_SOURCE_THRESHOLD.toLocaleString()}) → tool-use mode`);
    }
    prdSpecForLog = prdSpec;

    const hasExplicitDocs = state.resolvedAction?.source === 'explicit'
      && ((state.resolvedAction?.artifacts?.length ?? state.resolvedAction?.documents?.length ?? 0) > 0);
    if (hasExplicitDocs) {
      useSourceFileTool = false;
    }

    // Build resolvedAction with pool-derived documents when no explicit docs present
    let resolvedActionWithDocs = state.resolvedAction;
    if (!hasExplicitDocs && prdSpec) {
      const docs: ResolvedArtifact[] = sourceArtifacts.length > 0
        ? sourceArtifacts.map(a => ({ ...a, content: prdSpec.length !== combinedSourceContent.length ? prdSpec : a.content }))
        : [{ path: ARTIFACT_PREFIX.SOURCES, content: prdSpec, role: 'context' as const, label: 'PRD Specification' }];
      resolvedActionWithDocs = {
        ...(state.resolvedAction || { source: 'infer' as const, mode: 'generate' as const, tech: {}, hasExplicitFields: false }),
        artifacts: docs,
        documents: docs,
      };
    }

    const taskTechTiers = (state.currentTask as DesignTask).techTiers ?? (getTechTier(state) ? [getTechTier(state)!] : []);
    const contextWithTechTier = {
      ...state.context,
      techTier: effectiveTechTier(taskTechTiers),
      techTiers: taskTechTiers,
    };

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // Build prompt via PromptBuilder (4-tier injection resolution)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    const intent = state.resolvedAction?.intent;
    const effectiveTier = effectiveTechTier(taskTechTiers);

    const promptBuilder = state.deps?.promptBuilder;
    if (!promptBuilder) throw new Error('[DocGen] PromptBuilder is required but not available in state.deps');

    // Build runtime context → vars.runtimeContext
    const runtimeContext = buildRuntimeContext(state);

    const designConfig: PromptBuildConfig = {
      templates: {
        base: 'jobs/design/nodes/execute/variants/system-design/base',
        rules: 'jobs/design/nodes/execute/variants/system-design/rules',
        system: 'jobs/design/base/system',
      },
      intent,
      artifactPolicies: intent
        ? deriveArtifactPolicies(intent, getRACDocuments(resolvedActionWithDocs))
        : [],
      techContext: {
        techTier: effectiveTier,
        techTiers: taskTechTiers,
        mode: state.resolvedAction?.mode,
        resolvedAction: resolvedActionWithDocs,
      },
      basis: state.resolvedAction?.basis,
      pipeline: {
        sanitizeInput: true,
        includeBasis: true,
        includeExamples: false,
        applyPolicyGuardrails: true,
        formatForLLM: true,
      },
      artifacts: getRACDocuments(resolvedActionWithDocs),
      vars: {
        currentTask: state.currentTask ? {
          name: state.currentTask.name,
          type: state.currentTask.type,
          priority: state.currentTask.priority,
          description: state.currentTask.description,
          ...(state.currentTask.targetFile && { targetFile: state.currentTask.targetFile }),
        } : null,
        directive: state.directive || '',
        lastSectionNumber: lastSectionNumber ?? undefined,
        sectionPattern: sectionPattern ?? undefined,
        isLastTaskForDocument,
        sectionScope: sectionScope || undefined,
        filteredCatalog: filteredCatalog || undefined,
        isSpecDriven: false,
        referenceRequests: [],
        resolvedAction: resolvedActionWithDocs || null,
        userLanguage: state.context?.userLanguage || 'en',
        designDomain: state.resolvedAction?.domain,
        runtimeContext,
        // Codebase Channel SSOT — flow workspace state to the
        // codebase-channel partial / AutoInjectionResolver gate.
        workspaceState: state.workspaceState,
      },
    };

    const promptResult = await promptBuilder.build(designConfig);

    // Assemble blocks via CacheBlockMapper
    blocks = buildCacheableBlocks(promptResult);

    // ✅ Validate: Ensure XML output format instructions are present
    const allContent = blocks
      .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
      .map(b => b.text)
      .join('');
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
            templatePath: 'jobs/design/nodes/execute/variants/system-design/base',
            usedTemplates,
            injectedVariables: {
              targetFile,
              directive: state.directive ? `[${state.directive.length} chars]` : undefined,
              lastSectionNumber,
              sectionPattern,
              prdSpec: prdSpec ? `[${prdSpec.length} chars]` : undefined,
              planText: state.planText ? `[${state.planText.length} chars]` : undefined,
              designDomain: state.resolvedAction?.domain,
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
  }

  // Compose messages via MessageComposer
  const { messages } = composeMessages({
    initialBlocks: blocks,
    priorTurns: getConv(state.conversations, CONV_KEYS.NODE_DOCGEN) as any,
  });
  
  // ✅ Log prompt structure (not content) - full message
  const jobIdFinal = state.jobId || state._httpJobId || 'unknown';
  if (state.context.featurePath) {
    try {
      // Calculate total text length from all messages
      const totalLength = messages.reduce((sum, m) => {
        const content = m.content as MessageContentBlock[];
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
          templatePath: 'jobs/design/nodes/execute/variants/system-design/base',
          usedTemplates: usedTemplatesForLog,
          injectedVariables: {
            targetFile: targetFileForLog,  // ✅ NEW: Critical for MSA debugging
            messageCount: messages.length,
            hasConversationHistory: getConv(state.conversations, CONV_KEYS.NODE_DOCGEN).length > 0,
            nodeHistoryLength: getConv(state.conversations, CONV_KEYS.NODE_DOCGEN).length,
            prdSpec: prdSpecForLog ? `[${prdSpecForLog.length} chars]` : undefined,
            design: (() => { const d = new ArtifactPoolView(state.artifacts || []).firstDesignContent(); return d ? `[${d.length} chars]` : undefined; })(),
            directive: state.directive ? `[${state.directive.length} chars]` : undefined,
            detectedMode: state.resolvedAction?.mode,
            designDomain: state.resolvedAction?.domain,
            isMSAServiceDoc: targetFileForLog.startsWith('be-system-') && !targetFileForLog.includes('be-system-main'),
          },
        }
      );
    } catch (logError) {
      console.warn(`⚠️  [DocGen] Failed to log full message:`, logError);
    }
  }
  
  return { messages, useSourceFileTool };
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
    const outputDir = designDirOf(task.targetFile);
    lines.push(`Write to: \`${outputDir}/${task.targetFile}\``);
    lines.push('');
    lines.push(`⚠️ CRITICAL: You MUST write to this file in your XML output!`);
    lines.push(`Use: <file path="${outputDir}/${task.targetFile}">...</file>`);
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
  //   Use content matching targetFile from existingDesignDocs (pool fallback for missing docs)
  if (state.resolvedAction?.mode === 'refactor') {
    const targetFileName = task?.targetFile || 'be-system-main.md';
    const existingContent = state.existingDesignDocs?.[targetFileName] || new ArtifactPoolView(state.artifacts || []).firstDesignContent();
    if (existingContent) {
      lines.push(`# Existing Design Document`);
      lines.push(existingContent);
      lines.push('');
    }
  }
  // ❌ For generate mode: DO NOT include previous design content
  // Reason: Including old document content causes LLM confusion with outdated metadata
  // The lastSectionNumber in the base prompt is sufficient for sequential chapter numbering
  
  return lines.join('\n');
}

/**
 * Detect all templates that would be used, including framework augmentations.
 *
 * Framework/language path decisions now delegate to
 * `AutoInjectionResolver.resolveTechTierInjections` (SSOT). See
 * `docs/architecture/13-prompt-system.md` "Hints 계층". The 3-branch
 * priority (task → graph → text-search) is preserved here only as an
 * input-gathering step: each branch shapes the `tiers` array, and the
 * resolver decides which `basis/techTier/framework/*` files to emit.
 */
function detectUsedTemplates(state: DesignGraphState, targetFile: string): string[] {
  const templates: string[] = ['jobs/design/nodes/execute/variants/system-design/rules'];

  if (targetFile.includes('api-contract')) {
    templates.push('jobs/design/base/injections/api-contract-guide');
  } else if (targetFile.includes('be-system-')) {
    templates.push('jobs/design/base/injections/backend-guide');
  } else if (targetFile.includes('fe-system-')) {
    templates.push('jobs/design/base/injections/frontend-guide');
  }

  // Domain-specific guides — D27 (v6) lifts these out of `basis/domain/`
  // because `domain` is a workspace selector, not a TierKey (D23).
  if (state.resolvedAction?.domain === 'game') {
    templates.push('jobs/design/domain/game');
  } else if (state.resolvedAction?.domain === 'service') {
    templates.push('jobs/design/domain/service');
  }

  const tiers = resolveDesignTechTierCandidates(state, targetFile);
  if (tiers.length > 0) {
    const resolver = new AutoInjectionResolver();
    const paths = resolver.resolveTechTierInjections('design', tiers, state.currentTask?.type);
    for (const p of paths) templates.push(p);
  }

  return templates;
}

/**
 * Produce the list of TechTier candidates to feed into
 * `AutoInjectionResolver.resolveTechTierInjections('design', ...)`.
 *
 * Priority order (first non-empty branch wins):
 *   0. Task-level `techTiers` (from decompose).
 *   1. Graph-level `getTechTier(state)`.
 *   2. Text-search fallback over source docs + directive — materialized as
 *      a synthetic (pseudo) TechTier so the resolver signature remains
 *      unchanged and the injection rules live in one place.
 *
 * Filter by `targetFile`: frontend docs accept frontend-shaped tiers,
 * backend docs accept backend-shaped tiers. This preserves the prior
 * filtering semantics (`nextjs → fe-system-*`, `go → be-system-*`).
 */
function resolveDesignTechTierCandidates(
  state: DesignGraphState,
  targetFile: string,
): TechTier[] {
  const isFrontendDoc = targetFile.includes('fe-system-') || targetFile.includes('frontend');
  const isBackendDoc = targetFile.includes('be-system-') || targetFile.includes('backend');

  const fits = (tier: TechTier): boolean => {
    const fw = tier.framework?.toLowerCase();
    const lang = tier.language;
    if (isFrontendDoc && (fw?.includes('next') || fw?.includes('nextjs'))) return true;
    if (isBackendDoc && lang === 'go') return true;
    return false;
  };

  // Priority 0 — task-level techTiers
  const taskTiers = ((state.currentTask as DesignTask)?.techTiers ?? []).filter(fits);
  if (taskTiers.length > 0) return taskTiers;

  // Priority 1 — graph-level techTier
  const graphTier = getTechTier(state);
  if (graphTier && fits(graphTier)) return [graphTier];

  // Priority 2 — text-search fallback synthesized as pseudo-techTier
  const pool = new ArtifactPoolView(state.artifacts || []);
  const allSourceDocs = pool.hasSources()
    ? pool.sources.map(a => a.content).join(' ')
    : '';
  const combined = [allSourceDocs, state.directive].filter(Boolean).join(' ').toLowerCase();
  if (isFrontendDoc && (combined.includes('next.js') || combined.includes('nextjs') || combined.includes('next app router'))) {
    return [{ framework: 'nextjs', stack: 'frontend' }];
  }
  if (isBackendDoc
      && (combined.includes('go ') || combined.includes('golang'))
      && (combined.includes('api') || combined.includes('server') || combined.includes('backend'))) {
    return [{ language: 'go', stack: 'backend' }];
  }
  return [];
}

// CATALOG_MAP / parseCatalogSections / resolveTemplateDir live in
// ../../decompose/catalogLookup so decompose-side validation and execute-side
// rendering share the same SSOT. Diverging copies historically allowed bugs
// like assigning frontend-catalog sections to api-contract tasks to slip
// through validation while still rendering an (inconsistent) prompt.

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

