/**
 * DetectEnvironment Node for Design Job (Refactored with DetectionReport)
 * 
 * Responsibilities:
 * 1. Detect job mode (generate/refactor/explain)
 * 2. Detect work type (ui-design/system-design)
 * 3. Detect environment (frontend/backend/fullstack) - for system-design only
 * 4. Detect domain (game/service) - for system-design only
 * 
 * ✅ Uses unified DetectionReport for all detection results
 */

import { DesignGraphState } from "../state";
import { LLMClient } from "../../../../../core/ports";
import { PromptEngine } from "../../../../../core/prompt/engine";
import { logPrompt } from "../../../../../core/utils/promptLogger";
import { LLM_TEMPERATURE, LLM_MAX_TOKENS } from "../../../../common/graph/llmConfig";
import * as path from 'path';
import * as fs from 'fs/promises';
import { getEstimatingLabel } from "../../../../common/graph/timing/estimatingLabels";
import {
  DetectionReport,
  createUiDesignDetectionReport,
  createSystemDesignDetectionReport,
  createSpecDetectionReport,
  formatDetectionReportForChat,
  resolveDesignTargetFiles,
  JobMode,
  JobEnvironment,
  DesignDomain,
} from "../../../../../core/types/detection";

interface ParsedDesignResponse {
  workType: "ui-design" | "system-design" | "spec" | "clarify" | "error";
  workTypeReasoning: string;
  jobMode: JobMode;
  jobModeReasoning: string;
  domain?: DesignDomain;
  domainReasoning?: string;
  environment?: JobEnvironment;
  environmentReasoning?: string;
  errorMessage?: string;
  errorType?: string;
  suggestedAction?: string;
}

function parseDetectResponse(raw: string): ParsedDesignResponse {
  try {
    const detectMatch = raw.match(/<detect>\s*([\s\S]*?)\s*<\/detect>/);
    let jsonStr: string;

    if (detectMatch) {
      jsonStr = detectMatch[1];
    } else {
      const jsonMatch =
        raw.match(/```json\n([\s\S]*?)\n```/) ||
        raw.match(/{[\s\S]*}/);
      if (!jsonMatch) {
        throw new Error("No JSON found in response");
      }
      jsonStr = (jsonMatch[1] || jsonMatch[0]).trim();
    }

    const parsed = JSON.parse(jsonStr);
    
    // Parse workType
    const workType: "ui-design" | "system-design" | "spec" | "clarify" | "error" =
      parsed.workType === "ui-design" ? "ui-design" : 
      parsed.workType === "spec" ? "spec" :
      parsed.workType === "clarify" ? "clarify" :
      parsed.workType === "error" ? "error" :
      "system-design";
    
    // Handle error case
    if (workType === "error") {
      return {
        workType: "error",
        workTypeReasoning: parsed.workTypeReasoning || "Error occurred during work type detection",
        jobMode: "generate",
        jobModeReasoning: "",
        errorMessage: parsed.errorMessage || "문서가 존재하지 않습니다",
        errorType: parsed.errorType || "missing_documents",
        suggestedAction: parsed.suggestedAction || "먼저 문서를 생성해주세요",
      };
    }
    
    // Parse jobMode (unified name)
    const jobMode: JobMode =
      (parsed.jobMode || parsed.designMode) === "refactor" ? "refactor" :
      (parsed.jobMode || parsed.designMode) === "explain" ? "explain" : "generate";
    
    const jobModeReasoning: string =
      parsed.jobModeReasoning || parsed.designModeReasoning ||
      (jobMode === "refactor" 
        ? "Modification of existing documents requested."
        : jobMode === "explain"
          ? "Analysis or explanation of existing documents requested."
          : "New document creation or full regeneration requested.");
    
    // Clarify: LLM could not confidently determine spec vs system-design
    if (workType === "clarify") {
      return {
        workType: "clarify",
        workTypeReasoning: parsed.workTypeReasoning || "Ambiguous between spec and system-design.",
        jobMode: "generate",
        jobModeReasoning: "",
      };
    }
    
    // For system-design, parse domain and environment
    if (workType === "system-design") {
      const domain: DesignDomain =
        parsed.domain === "game" ? "game" : "service";
      
      const environment: JobEnvironment =
        parsed.environment === "frontend" ? "frontend" :
        parsed.environment === "backend" ? "backend" : "fullstack";

      return {
        workType,
        workTypeReasoning: parsed.workTypeReasoning || "System design work detected.",
        jobMode,
        jobModeReasoning,
        domain,
        domainReasoning: parsed.domainReasoning || "Defaulted to 'service'.",
        environment,
        environmentReasoning: parsed.environmentReasoning || "Defaulted to 'fullstack'.",
      };
    }
    
    // For spec
    if (workType === "spec") {
      return {
        workType: "spec",
        workTypeReasoning: parsed.workTypeReasoning || "Spec document work detected.",
        jobMode,
        jobModeReasoning,
      };
    }
    
    // For ui-design
    return {
      workType: "ui-design",
      workTypeReasoning: parsed.workTypeReasoning || "UI design work detected.",
      jobMode,
      jobModeReasoning,
    };
  } catch (error) {
    console.error("❌ [DesignDetectEnvironment] Failed to parse LLM response:", error);
    console.error("Raw response (truncated):", raw.substring(0, 500));

    // Parse failure → clarify instead of silent fallback
    return {
      workType: "clarify",
      workTypeReasoning: "Failed to parse LLM response. Asking user to clarify.",
      jobMode: "generate",
      jobModeReasoning: "",
    };
  }
}

/**
 * Scan directory for files (recursive)
 */
async function listFilesRecursive(dirPath: string, relativeTo: string = ''): Promise<string[]> {
  const results: string[] = [];
  
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      
      const fullPath = path.join(dirPath, entry.name);
      const relPath = relativeTo ? `${relativeTo}/${entry.name}` : entry.name;
      
      if (entry.isFile()) {
        results.push(relPath);
      } else if (entry.isDirectory()) {
        const subResults = await listFilesRecursive(fullPath, relPath);
        results.push(...subResults);
      }
    }
  } catch {
    // Directory doesn't exist or not accessible
  }
  
  return results;
}

/**
 * Check if directory exists and has files
 */
async function dirHasFiles(dirPath: string): Promise<boolean> {
  try {
    const files = await listFilesRecursive(dirPath);
    return files.length > 0;
  } catch {
    return false;
  }
}

/**
 * Parse user's choice from the clarify card directive.
 * ClarifyingVariant formats answers as: "- question: answer"
 */
function parseDetectClarifyChoice(
  directive: string,
  hasSystemDocs: boolean
): { workType: 'spec' | 'system-design'; jobMode: JobMode } {
  const lower = directive.toLowerCase();
  if (lower.includes('spec') || lower.includes('스펙 문서')) {
    return { workType: 'spec', jobMode: 'generate' };
  }
  if (lower.includes('시스템 기획서 수정') || lower.includes('system-design')) {
    return { workType: 'system-design', jobMode: hasSystemDocs ? 'refactor' : 'generate' };
  }
  // Best-effort: if contains "수정" / "modify" lean toward system-design refactor
  if (lower.includes('수정') || lower.includes('modify') || lower.includes('refactor')) {
    return { workType: 'system-design', jobMode: hasSystemDocs ? 'refactor' : 'generate' };
  }
  // Default to spec (safer — avoids destructive modification of existing docs)
  return { workType: 'spec', jobMode: 'generate' };
}

/**
 * Send a clarify card asking the user to choose between spec and system-design.
 */
async function sendDetectClarifyCard(state: DesignGraphState): Promise<void> {
  const { getChatAPIClient } = await import("../../../../../core/adapters/ChatAPIClient");
  const chatAPI = getChatAPIClient();
  await chatAPI.sendClarifyCards([{
    question: '어떤 작업을 수행할까요?',
    options: [
      '새로운 스펙 문서 생성 (spec-*.md)',
      '기존 시스템 기획서 수정',
    ],
  }]);
  await chatAPI.finalizeMessage();
}

/**
 * Save awaitingDetectClarify state to session for resume.
 */
async function saveDetectClarifyToSession(state: DesignGraphState): Promise<void> {
  if (!state.deps?.session || !state.context.featureFolder) return;
  try {
    await state.deps.session.updateArtifacts(
      state.context.project,
      state.context.featureFolder,
      'design',
      {
        state: {
          awaitingDetectClarify: true,
          directive: state.directive,
          overrideDirective: state.overrideDirective,
          chatSource: state.chatSource,
          prd: state.prd,
        }
      }
    );
    console.log(`💾 [detectEnvironment] Saved awaitingDetectClarify=true to session`);
  } catch (err) {
    console.warn(`⚠️  [detectEnvironment] Failed to save clarify state:`, err);
  }
}

/**
 * Design Job detectEnvironment node
 */
export async function detectEnvironment(
  state: DesignGraphState
): Promise<Partial<DesignGraphState>> {
  const phaseStart = Date.now();
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Detect clarify resume: user chose spec vs system-design
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  if (state.awaitingDetectClarify && state.overrideDirective) {
    console.log(`🔄 [detectEnvironment] Detect clarify resume — parsing user choice`);
    
    const featurePath = state.context.featurePath || '';
    const outputsDir = path.join(featurePath, 'outputs/design');
    const hasSystemDocs = await fs.access(path.join(outputsDir, 'system-design.md')).then(() => true).catch(() => false)
      || await fs.access(path.join(outputsDir, 'api-contract.md')).then(() => true).catch(() => false)
      || await fs.access(path.join(outputsDir, 'be-system-design.md')).then(() => true).catch(() => false);
    
    const choice = parseDetectClarifyChoice(state.overrideDirective, hasSystemDocs);
    console.log(`✅ [detectEnvironment] User chose: workType=${choice.workType}, jobMode=${choice.jobMode}`);
    
    let detectionReport: DetectionReport;
    if (choice.workType === 'spec') {
      detectionReport = createSpecDetectionReport({
        jobMode: choice.jobMode,
        jobModeReasoning: 'User explicitly chose spec document creation.',
      });
    } else {
      detectionReport = createSystemDesignDetectionReport({
        jobMode: choice.jobMode,
        jobModeReasoning: 'User explicitly chose system design modification.',
        environment: 'fullstack',
        environmentReasoning: 'Defaulting to fullstack (will be refined by decompose).',
        domain: 'service',
        domainReasoning: 'Defaulting to service.',
      });
    }
    
    const { getChatAPIClient } = await import("../../../../../core/adapters/ChatAPIClient");
    const chatAPI = getChatAPIClient();
    const formattedReport = formatDetectionReportForChat(detectionReport, 'ko');
    await chatAPI.sendLLMEvent({ type: 'text', text: formattedReport });
    await chatAPI.finalizeMessage();
    
    return {
      detectionReport,
      awaitingDetectClarify: false,
      _phaseTimings: { ...(state._phaseTimings || {}), detect: Date.now() - phaseStart },
    };
  }
  
  // ✅ Node activity banner
  if (state.deps?.kanbanUpdate?.setEstimatingActivity) {
    state.deps.kanbanUpdate.setEstimatingActivity(getEstimatingLabel('detect', state._uiLocale), 'detect');
  }
  
  const llm = state.deps?.llm as LLMClient | undefined;
  const engine = state.deps?.promptEngine as PromptEngine | undefined;

  if (!llm || !engine) {
    console.warn("[DesignDetectEnvironment] Missing llm or promptEngine dependency.");
    
    // Default DetectionReport for system-design
    const defaultReport = createSystemDesignDetectionReport({
      jobMode: "generate",
      jobModeReasoning: "promptEngine or llm not available; defaulting.",
      environment: "fullstack",
      environmentReasoning: "Defaulting to fullstack.",
      domain: "service",
      domainReasoning: "Defaulting to service.",
    });
    
    return { detectionReport: defaultReport, _phaseTimings: { ...(state._phaseTimings || {}), detect: Date.now() - phaseStart } };
  }

  // ✅ Increment recursion count (track node execution for UI gauge)
  state.recursionCount = (state.recursionCount || 0) + 1;
  
  // Workflow UI
  if (state.deps?.workflowUpdate && state._httpJobId) {
    await state.deps.workflowUpdate.enterNode(
      state._httpJobId, "detectEnvironment", 0,
      undefined, undefined,
      state.recursionCount, state.recursionLimit
    );
  }

  try {
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🔍 DESIGN WORK TYPE + ENVIRONMENT DETECTION');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    
    const directive = state.overrideDirective || state.directive || "";
    const prdSpec = state.prd || "";

    // Scan inputs/references and inputs/assets
    const featurePath = state.context.featurePath || '';
    const referencesDir = path.join(featurePath, 'inputs/references');
    const assetsDir = path.join(featurePath, 'inputs/assets');
    
    const hasReferences = await dirHasFiles(referencesDir);
    const hasAssets = await dirHasFiles(assetsDir);
    
    // Build references list (dynamic grouping by subdirectory)
    let referencesList = '';
    if (hasReferences) {
      const allRefFiles = await listFilesRecursive(referencesDir);
      
      // Group by first-level subdirectory dynamically
      const grouped: Record<string, string[]> = {};
      for (const f of allRefFiles) {
        const sep = f.indexOf('/');
        const group = sep > 0 ? f.substring(0, sep) : '(root)';
        (grouped[group] ||= []).push(f);
      }
      
      const parts: string[] = [];
      for (const [group, files] of Object.entries(grouped)) {
        parts.push(`**${group}/** (${files.length} files):`);
        files.slice(0, 10).forEach(f => parts.push(`  - ${f}`));
        if (files.length > 10) parts.push(`  ... and ${files.length - 10} more`);
      }
      referencesList = parts.join('\n');
      
      console.log(`📸 Found reference images: ${allRefFiles.length} files`);
    }
    
    // Build assets list (dynamic grouping by subdirectory)
    let assetsList = '';
    let uiAssetsList: DesignGraphState['uiAssetsList'] = undefined;
    if (hasAssets) {
      const allAssets = await listFilesRecursive(assetsDir);
      
      // Group by first-level subdirectory dynamically
      const grouped: Record<string, string[]> = {};
      for (const f of allAssets) {
        const sep = f.indexOf('/');
        const group = sep > 0 ? f.substring(0, sep) : '(root)';
        (grouped[group] ||= []).push(f);
      }
      
      uiAssetsList = grouped;
      
      const parts: string[] = [];
      for (const [group, files] of Object.entries(grouped)) {
        parts.push(`**${group}/** (${files.length} files)`);
      }
      assetsList = parts.join('\n');
      
      console.log(`📦 Found assets: ${allAssets.length} files`);
    }
    
    // Check existing design documents
    const outputsDir = path.join(featurePath, 'outputs/design');
    
    const hasUiTokens = await fs.access(path.join(outputsDir, 'ui-tokens.json')).then(() => true).catch(() => false);
    const hasUiAssets = await fs.access(path.join(outputsDir, 'ui-assets.json')).then(() => true).catch(() => false);
    const hasUiSpec = await fs.access(path.join(outputsDir, 'ui-spec.json')).then(() => true).catch(() => false);
    const hasUiDocs = hasUiTokens && hasUiAssets && hasUiSpec;
    
    const hasSystemDesign = await fs.access(path.join(outputsDir, 'system-design.md')).then(() => true).catch(() => false);
    const hasApiContract = await fs.access(path.join(outputsDir, 'api-contract.md')).then(() => true).catch(() => false);
    const hasFeSystemDesign = await fs.access(path.join(outputsDir, 'fe-system-design.md')).then(() => true).catch(() => false);
    const hasBeSystemDesign = await fs.access(path.join(outputsDir, 'be-system-design.md')).then(() => true).catch(() => false);
    const hasSystemDocs = hasSystemDesign || hasApiContract || hasFeSystemDesign || hasBeSystemDesign;
    
    if (hasUiDocs) {
      console.log(`✅ UI design documents completed`);
    }
    if (hasSystemDocs) {
      console.log(`✅ System design documents exist`);
    }
    
    // Build UI references for state
    let uiReferences: DesignGraphState['uiReferences'] = undefined;
    if (hasReferences) {
      const allRefFiles = await listFilesRecursive(referencesDir);
      uiReferences = allRefFiles.map(f => `inputs/references/${f}`);
    }

    // Build prompt
    const detectVars = {
      directive,
      prdSpec,
      hasReferences,
      hasAssets,
      referencesList,
      assetsList,
      hasUiDocs,
      hasUiTokens,
      hasUiAssets,
      hasUiSpec,
      hasSystemDocs,
      hasSystemDesign,
      hasApiContract,
      hasFeSystemDesign,
      hasBeSystemDesign,
    };
    
    const prompt = await engine.buildDesignDomainPrompt(detectVars);
    
    // Log prompt
    const jobId = state.jobId || state._httpJobId || 'unknown';
    if (featurePath) {
      try {
        await logPrompt(featurePath, jobId, 'design', 'detectEnvironment', prompt.length, {
          templatePath: 'design/phases/detect/base',
          injectedVariables: { hasReferences, hasAssets, hasUiDocs, hasSystemDocs },
        });
      } catch (logError) {
        console.warn(`⚠️  [Design-DetectEnv] Failed to log prompt:`, logError);
      }
    }

    // Chat UI
    const { getChatAPIClient } = await import("../../../../../core/adapters/ChatAPIClient");
    const chatAPI = getChatAPIClient();
    await chatAPI.showChatStatus('placeholder');

    // LLM call
    let response = "";
    let capturedUsage: any = undefined;
    
    for await (const event of llm.stream(
      [{ role: "user", content: prompt }],
      { temperature: LLM_TEMPERATURE.DETECT, maxTokens: LLM_MAX_TOKENS.DEFAULT, enableThinking: false }
    )) {
      if (event.text) {
        response += event.text;
      }
      
      const { extractTokenUsageFromStreamEvent } = await import("../../../../common/graph/llmHelpers");
      const usage = extractTokenUsageFromStreamEvent(event);
      if (usage) {
        capturedUsage = usage;
      }
    }
    
    if (capturedUsage) {
      const { accumulateTokenUsage } = await import("../../../../common/graph/llmHelpers");
      accumulateTokenUsage(state as any, capturedUsage, { taskLevel: false, jobLevel: true });
      console.log(`   Tokens: ${capturedUsage.totalTokens} total`);
      // ✅ Push live token update to Kanban UI during estimating phase
      if (state.deps?.kanbanUpdate?.updateTokenUsage && (state as any).tokenUsage) {
        state.deps.kanbanUpdate.updateTokenUsage((state as any).tokenUsage);
      }
    }

    // Parse response
    const parsed = parseDetectResponse(response);

    // Handle error case
    if (parsed.workType === 'error') {
      console.log(`\n❌ Error: ${parsed.errorType}`);
      console.log(`   Message: ${parsed.errorMessage}`);
      
      const errorText = `❌ **${parsed.errorMessage}**\n\n${parsed.suggestedAction}`;
      await chatAPI.sendLLMEvent({ type: 'text', text: errorText });
      await chatAPI.finalizeMessage();
      
      return {
        detectionReport: undefined,
        designError: {
          type: parsed.errorType || 'unknown_error',
          message: parsed.errorMessage || 'An error occurred',
          suggestedAction: parsed.suggestedAction,
        },
        _phaseTimings: { ...(state._phaseTimings || {}), detect: Date.now() - phaseStart },
      };
    }

    // Handle clarify case (ambiguous between spec and system-design, or parse failure)
    if (parsed.workType === 'clarify') {
      console.log(`\n💬 Clarify needed: ${parsed.workTypeReasoning}`);
      
      await sendDetectClarifyCard(state);
      await saveDetectClarifyToSession(state);
      
      if (state.deps?.kanbanUpdate?.clearEstimatingActivity) {
        state.deps.kanbanUpdate.clearEstimatingActivity();
      }
      
      return {
        awaitingDetectClarify: true,
        tokenUsage: (state as any).tokenUsage,
        _phaseTimings: { ...(state._phaseTimings || {}), detect: Date.now() - phaseStart },
      };
    }

    // Create DetectionReport
    let detectionReport: DetectionReport;
    
    if (parsed.workType === 'ui-design') {
      detectionReport = createUiDesignDetectionReport({
        jobMode: parsed.jobMode,
        jobModeReasoning: parsed.jobModeReasoning,
      });
    } else if (parsed.workType === 'spec') {
      detectionReport = createSpecDetectionReport({
        jobMode: parsed.jobMode,
        jobModeReasoning: parsed.jobModeReasoning,
      });
    } else {
      detectionReport = createSystemDesignDetectionReport({
        jobMode: parsed.jobMode,
        jobModeReasoning: parsed.jobModeReasoning,
        environment: parsed.environment!,
        environmentReasoning: parsed.environmentReasoning!,
        domain: parsed.domain!,
        domainReasoning: parsed.domainReasoning!,
      });
    }

    // Resolve targetFiles (single source of truth for chat + decompose)
    if (detectionReport.workType === 'system-design') {
      const existingFiles = [
        hasSystemDesign && 'system-design.md',
        hasApiContract && 'api-contract.md',
        hasFeSystemDesign && 'fe-system-design.md',
        hasBeSystemDesign && 'be-system-design.md',
      ].filter(Boolean) as string[];

      const { targetFiles, effectiveJobMode } = resolveDesignTargetFiles(
        detectionReport.environment,
        detectionReport.jobMode,
        existingFiles
      );

      detectionReport.targetFiles = targetFiles;
      if (effectiveJobMode !== detectionReport.jobMode) {
        console.log(`ℹ️  [Detect] jobMode corrected: ${detectionReport.jobMode} → ${effectiveJobMode} (no same-tier docs for ${detectionReport.environment})`);
        detectionReport.jobMode = effectiveJobMode;
        detectionReport.jobModeReasoning += ` (corrected: no same-tier docs for ${detectionReport.environment})`;
      }
    }

    // Display in Chat UI
    const formattedReport = formatDetectionReportForChat(detectionReport, 'ko');
    await chatAPI.sendLLMEvent({ type: 'text', text: formattedReport });
    await chatAPI.finalizeMessage();

    // Log result
    console.log(`\n✅ Job Mode: ${detectionReport.jobMode}`);
    console.log(`   Reasoning: ${detectionReport.jobModeReasoning}`);
    console.log(`✅ Work Type: ${detectionReport.workType}`);
    
    if (detectionReport.workType === 'system-design') {
      console.log(`✅ Domain: ${detectionReport.domain}`);
      console.log(`✅ Environment: ${detectionReport.environment}`);
      if (detectionReport.targetFiles) {
        console.log(`✅ Target Files: [${detectionReport.targetFiles.join(', ')}]`);
      }
    }
    console.log();

    // Save detectionReport to session (enables decompose-direct routing on resume)
    if (state.deps?.session && state.context.featureFolder) {
      try {
        const session = await state.deps.session.load(
          state.context.project,
          state.context.featureFolder,
          'design'
        );
        await state.deps.session.updateArtifacts(
          state.context.project,
          state.context.featureFolder,
          'design',
          {
            state: {
              ...session.state,
              detectionReport,
            }
          }
        );
      } catch (err) {
        // Non-critical
      }
    }

    return {
      detectionReport,
      uiReferences: detectionReport.workType === 'ui-design' ? uiReferences : undefined,
      uiAssetsList: detectionReport.workType === 'ui-design' ? uiAssetsList : undefined,
      tokenUsage: (state as any).tokenUsage,
      _phaseTimings: { ...(state._phaseTimings || {}), detect: Date.now() - phaseStart },
    };
  } finally {
    if (state.deps?.workflowUpdate && state._httpJobId) {
      state.deps.workflowUpdate.exitNode(state._httpJobId, "detectEnvironment", 0);
    }
  }
}
