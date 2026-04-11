/**
 * DetectEnvironment Node for Design Job (Refactored with DetectionReport)
 * 
 * Responsibilities:
 * 1. Detect job mode (generate/refactor/explain)
 * 2. Detect intent group (design-ui/design-system/design-spec)
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
  IntentGroup,
} from "../../../../../core/types/detection";
import { isFigmaDataPopulated, DESIGN_DIR, DESIGN_SUBDIR, resolveFromInfer, synthesizeDesignIntent } from "@ant/shared";
import type { ResolvedActionContext, ActionMetadata } from "@ant/shared";
import { extractLLMInfo } from "../../../../../core/ports/workflow";

interface ParsedDesignResponse {
  intentGroup: "design-ui" | "design-system" | "design-spec" | "clarify" | "error";
  intentGroupReasoning: string;
  jobMode: JobMode;
  jobModeReasoning: string;
  domain?: DesignDomain;
  domainReasoning?: string;
  environment?: JobEnvironment;
  environmentReasoning?: string;
  errorMessage?: string;
  errorType?: string;
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
    
    // Parse intentGroup (backward compat: read workType if intentGroup absent)
    const rawIG = parsed.intentGroup ?? parsed.workType;
    const intentGroup: "design-ui" | "design-system" | "design-spec" | "clarify" | "error" =
      (rawIG === "ui-design" || rawIG === "design-ui") ? "design-ui" : 
      (rawIG === "spec" || rawIG === "design-spec") ? "design-spec" :
      rawIG === "clarify" ? "clarify" :
      rawIG === "error" ? "error" :
      "design-system";
    const rawIGReasoning = parsed.intentGroupReasoning ?? parsed.workTypeReasoning;
    
    // Handle error case
    if (intentGroup === "error") {
      return {
        intentGroup: "error",
        intentGroupReasoning: rawIGReasoning || "Error occurred during intent group detection",
        jobMode: "generate",
        jobModeReasoning: "",
        errorMessage: parsed.errorMessage || "문서가 존재하지 않습니다",
        errorType: parsed.errorType || "missing_documents",
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
    if (intentGroup === "clarify") {
      return {
        intentGroup: "clarify",
        intentGroupReasoning: rawIGReasoning || "Ambiguous between spec and system-design.",
        jobMode: "generate",
        jobModeReasoning: "",
      };
    }
    
    // For system-design, parse domain and environment
    if (intentGroup === "design-system") {
      const domain: DesignDomain =
        parsed.domain === "game" ? "game" : "service";
      
      const environment: JobEnvironment =
        parsed.environment === "frontend" ? "frontend" :
        parsed.environment === "backend" ? "backend" : "fullstack";

      return {
        intentGroup,
        intentGroupReasoning: rawIGReasoning || "System design work detected.",
        jobMode,
        jobModeReasoning,
        domain,
        domainReasoning: parsed.domainReasoning || "Defaulted to 'service'.",
        environment,
        environmentReasoning: parsed.environmentReasoning || "Defaulted to 'fullstack'.",
      };
    }
    
    // For spec
    if (intentGroup === "design-spec") {
      return {
        intentGroup: "design-spec",
        intentGroupReasoning: rawIGReasoning || "Spec document work detected.",
        jobMode,
        jobModeReasoning,
      };
    }
    
    // For ui-design
    return {
      intentGroup: "design-ui",
      intentGroupReasoning: rawIGReasoning || "UI design work detected.",
      jobMode,
      jobModeReasoning,
    };
  } catch (error) {
    console.error("❌ [DesignDetectEnvironment] Failed to parse LLM response:", error);
    console.error("Raw response (truncated):", raw.substring(0, 500));

    // Parse failure → clarify instead of silent fallback
    return {
      intentGroup: "clarify",
      intentGroupReasoning: "Failed to parse LLM response. Asking user to clarify.",
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
): { intentGroup: 'design-spec' | 'design-system'; jobMode: JobMode } {
  const lower = directive.toLowerCase();
  if (lower.includes('spec') || lower.includes('스펙 문서')) {
    return { intentGroup: 'design-spec', jobMode: 'generate' };
  }
  if (lower.includes('시스템 기획서 수정') || lower.includes('system-design')) {
    return { intentGroup: 'design-system', jobMode: hasSystemDocs ? 'refactor' : 'generate' };
  }
  // Best-effort: if contains "수정" / "modify" lean toward system-design refactor
  if (lower.includes('수정') || lower.includes('modify') || lower.includes('refactor')) {
    return { intentGroup: 'design-system', jobMode: hasSystemDocs ? 'refactor' : 'generate' };
  }
  // Default to design-spec (safer — avoids destructive modification of existing docs)
  return { intentGroup: 'design-spec', jobMode: 'generate' };
}

/**
 * Send a clarify card asking the user to choose between spec and system-design.
 */
async function sendDetectClarifyCard(): Promise<void> {
  const { sendClarify } = await import("../../../../common/clarifyTool");
  await sendClarify([{
    question: '어떤 작업을 수행할까요?',
    options: [
      '새로운 스펙 문서 생성 (spec-*.md)',
      '기존 시스템 기획서 수정',
    ],
  }]);
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

// checkLocalMCPAvailability is now a shared utility
import { checkLocalMCPAvailability } from '../../../../../periphery/adapters/figma/MCPTransport';

/**
 * Validate Figma MCP availability for pipelines requiring MCP access.
 * Returns undefined if MCP is reachable, or a designError if not.
 */
async function checkFigmaMCPReachable(
  state: DesignGraphState,
): Promise<DesignGraphState['designError'] | undefined> {
  const serverMode = process.env.ANT_SERVER_MODE || 'local';

  if (serverMode === 'local') {
    const mcpAvailable = await checkLocalMCPAvailability();
    if (!mcpAvailable) {
      return {
        type: 'figma_mcp_unavailable',
        message: 'Figma Desktop이 실행되지 않았습니다.',
      };
    }
  } else {
    const userId = state.context?.userId;
    const redis = state.deps?.redis;

    if (!userId || !redis) {
      return {
        type: 'figma_bridge_unavailable',
        message: !userId
          ? 'Ant Desktop 앱 연결 확인에 필요한 컨텍스트가 없습니다.'
          : 'Redis 연결이 없어 Ant Desktop 상태를 확인할 수 없습니다.',
      };
    }

    try {
      const { createMCPTransport } = await import('../../../../../periphery/adapters/figma/MCPTransport');
      const transport = createMCPTransport({ serverMode: 'cloud', userId, redis });
      const available = await transport.isAvailable();

      if (!available) {
        return {
          type: 'figma_bridge_unavailable',
          message: 'Ant Desktop 앱이 연결되지 않았거나 Figma Desktop이 응답하지 않습니다.',
        };
      }
    } catch (err: any) {
      return {
        type: 'figma_bridge_unavailable',
        message: 'Ant Desktop 앱 연결 상태 확인에 실패했습니다.',
      };
    }
  }

  return undefined;
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
    
    const clarifyDocNames = state.existingDesignDocs ? Object.keys(state.existingDesignDocs) : [];
    const hasSystemDocs = clarifyDocNames.length > 0;
    
    const choice = parseDetectClarifyChoice(state.overrideDirective, hasSystemDocs);
    console.log(`✅ [detectEnvironment] User chose: intentGroup=${choice.intentGroup}, mode=${choice.jobMode}`);
    
    let detectionReport: DetectionReport;
    if (choice.intentGroup === 'design-spec') {
      detectionReport = createSpecDetectionReport({
        detectedMode: choice.jobMode,
        detectedModeReasoning: 'User explicitly chose spec document creation.',
      });
    } else {
      detectionReport = createSystemDesignDetectionReport({
        detectedMode: choice.jobMode,
        detectedModeReasoning: 'User explicitly chose system design modification.',
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
    
    // RAC: create from detection (infer path, clarify resume)
    const clarifyActionMetadata = state.actionMetadata;
    const clarifySynthesized = synthesizeDesignIntent(detectionReport, {
      figmaPopulated: isFigmaDataPopulated(state.figmaConfig),
      hasReferences: state.uiReferences != null && state.uiReferences.length > 0,
    });
    let clarifyRAC = resolveFromInfer(detectionReport, clarifyActionMetadata, state.context.codebaseProfile, undefined, clarifySynthesized);
    console.log(`📋 [detectEnvironment] RAC created (clarify resume): intent=${clarifyRAC.intent}, tech=${JSON.stringify(clarifyRAC.tech)}`);

    if (state._pendingDocuments?.length) {
      clarifyRAC = {
        ...clarifyRAC,
        documents: [...(clarifyRAC.documents || []), ...state._pendingDocuments],
      };
    }

    return {
      detectionReport,
      resolvedAction: clarifyRAC,
      awaitingDetectClarify: false,
      _pendingDocuments: undefined,
      _phaseTimings: { ...(state._phaseTimings || {}), detect: Date.now() - phaseStart },
    };
  }
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // ActionMetadata bypass: intent already determines intentGroup/mode
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  if (state.actionMetadata?.intent) {
    const { deriveFromIntent } = await import('@ant/shared');
    const intent = state.actionMetadata.intent;
    const derived = deriveFromIntent(intent);
    console.log(`⚡ [detectEnvironment] ActionMetadata bypass: intent=${intent} → intentGroup=${derived.intentGroup}, mode=${derived.mode}, env=${derived.environment}`);

    let detectionReport: DetectionReport;
    if (derived.intentGroup === 'design-ui') {
      detectionReport = createUiDesignDetectionReport({
        detectedMode: derived.mode as any,
        detectedModeReasoning: `Determined by actionMetadata intent: ${intent}`,
      });
    } else if (derived.intentGroup === 'design-spec') {
      detectionReport = createSpecDetectionReport({
        detectedMode: derived.mode as any,
        detectedModeReasoning: `Determined by actionMetadata intent: ${intent}`,
      });
    } else {
      detectionReport = createSystemDesignDetectionReport({
        detectedMode: derived.mode as any,
        detectedModeReasoning: `Determined by actionMetadata intent: ${intent}`,
        environment: (derived.environment || 'fullstack') as any,
        environmentReasoning: `Determined by actionMetadata intent: ${intent}`,
        domain: 'service',
        domainReasoning: 'Default domain.',
      });
    }

    const { getChatAPIClient } = await import("../../../../../core/adapters/ChatAPIClient");
    const chatAPI = getChatAPIClient();
    const formattedReport = formatDetectionReportForChat(detectionReport, state._uiLocale || 'ko');
    await chatAPI.sendLLMEvent({ type: 'text', text: formattedReport });
    await chatAPI.finalizeMessage();

    return {
      detectionReport,
      resolvedAction: state.resolvedAction,
      _pendingDocuments: undefined,
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
      detectedMode: "generate",
      detectedModeReasoning: "promptEngine or llm not available; defaulting.",
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
      undefined, state.deps?.llm ? extractLLMInfo(state.deps.llm) : undefined,
      state.recursionCount, state.recursionLimit
    );
  }

  try {
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🔍 DESIGN WORK TYPE + ENVIRONMENT DETECTION');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    
    const directive = state.overrideDirective || state.directive || "";
    const { buildCondensedSourceDocs } = await import('./docGen/sourceSelector');
    const condensedSource = buildCondensedSourceDocs(state.sourceDocuments, 350_000) || state.prd || "";

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
    
    // Check existing design documents (subdirectory-first, then flat fallback)
    const outputsDir = path.join(featurePath, DESIGN_DIR);
    const uiDir = path.join(outputsDir, DESIGN_SUBDIR.UI);
    
    const existsIn = async (file: string, ...dirs: string[]) => {
      for (const d of dirs) {
        if (await fs.access(path.join(d, file)).then(() => true).catch(() => false)) return true;
      }
      return false;
    };
    const hasUiTokens = await existsIn('ui-tokens.json', uiDir, outputsDir);
    const hasUiAssets = await existsIn('ui-assets.json', uiDir, outputsDir);
    const hasUiSpec = await existsIn('ui-spec.json', uiDir, outputsDir);
    const hasUiDocs = hasUiTokens && hasUiAssets && hasUiSpec;
    
    // Derive from state.existingDesignDocs (populated by resolve node with pattern scan)
    // This correctly discovers MSA files (be-system-api.md, fe-system-web.md, etc.)
    const existingDocNames = state.existingDesignDocs ? Object.keys(state.existingDesignDocs) : [];
    const hasSystemDesign = existingDocNames.some(f => f.startsWith('be-system-') || f.startsWith('fe-system-'));
    const hasApiContract = existingDocNames.some(f => f.startsWith('api-contract-'));
    const hasFeSystemDesign = existingDocNames.some(f => f.startsWith('fe-system-'));
    const hasBeSystemDesign = existingDocNames.some(f => f.startsWith('be-system-'));
    const hasSystemDocs = existingDocNames.length > 0;
    
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

    // Build documents[] for detect prompt
    const detectDocs = condensedSource
      ? [{ path: 'source-docs', content: condensedSource, role: 'context' as const, label: 'Source Documents (condensed)' }]
      : [];

    // Build prompt
    const detectVars = {
      directive,
      documents: detectDocs,
      hasDocuments: detectDocs.length > 0,
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
      systemDesignFiles: existingDocNames,
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
      if (event.type === 'retry') {
        response = '';
        capturedUsage = undefined;
        continue;
      }
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
      const { accumulateTokenUsage, logTokenUsageToFile } = await import("../../../../common/graph/llmHelpers");
      accumulateTokenUsage(state, capturedUsage, { taskLevel: false, jobLevel: true });
      console.log(`   Tokens: ${capturedUsage.totalTokens} total`);
      // ✅ Push live token update to Kanban UI during estimating phase
      if (state.deps?.kanbanUpdate?.updateTokenUsage && state.tokenUsage) {
        state.deps.kanbanUpdate.updateTokenUsage(state.tokenUsage);
      }
      
      logTokenUsageToFile(
        state.context?.featurePath,
        state.jobId || state._httpJobId,
        capturedUsage,
        {
          taskId: 'estimating',
          taskName: 'detectEnvironment',
          node: 'detectEnvironment',
          callIndex: 0,
          estimatedPromptChars: prompt.length,
        }
      );
    }

    // Parse response
    const parsed = parseDetectResponse(response);

    // Structural override: skipTriage (redirect/proceedAnyway) implies active work intent.
    // explain mode is for passive document understanding — incompatible with redirect context.
    if (state.skipTriage && parsed.jobMode === 'explain' && parsed.intentGroup !== 'error' && parsed.intentGroup !== 'clarify') {
      console.log('⚠️  [detectEnvironment] Override: explain → generate (skipTriage implies active work intent)');
      parsed.jobMode = 'generate';
      parsed.jobModeReasoning = 'Overridden from explain: skipTriage flag indicates redirect/proceedAnyway — active work intent.';
    }

    // Handle error case
    if (parsed.intentGroup === 'error') {
      console.log(`\n❌ Error: ${parsed.errorType}`);
      console.log(`   Message: ${parsed.errorMessage}`);
      
      const errorText = `❌ **${parsed.errorMessage}**`;
      await chatAPI.sendLLMEvent({ type: 'text', text: errorText });
      await chatAPI.finalizeMessage();
      
      return {
        detectionReport: undefined,
        designError: {
          type: parsed.errorType || 'unknown_error',
          message: parsed.errorMessage || 'An error occurred',
        },
        _phaseTimings: { ...(state._phaseTimings || {}), detect: Date.now() - phaseStart },
      };
    }

    // Handle clarify case (ambiguous between spec and system-design, or parse failure)
    if (parsed.intentGroup === 'clarify') {
      console.log(`\n💬 Clarify needed: ${parsed.intentGroupReasoning}`);
      
      await sendDetectClarifyCard();
      await saveDetectClarifyToSession(state);
      
      if (state.deps?.kanbanUpdate?.clearEstimatingActivity) {
        state.deps.kanbanUpdate.clearEstimatingActivity();
      }
      
      return {
        awaitingDetectClarify: true,
        tokenUsage: state.tokenUsage,
        _phaseTimings: { ...(state._phaseTimings || {}), detect: Date.now() - phaseStart },
      };
    }

    // Create DetectionReport
    let detectionReport: DetectionReport;
    
    if (parsed.intentGroup === 'design-ui') {
      detectionReport = createUiDesignDetectionReport({
        detectedMode: parsed.jobMode,
        detectedModeReasoning: parsed.jobModeReasoning,
      });
    } else if (parsed.intentGroup === 'design-spec') {
      detectionReport = createSpecDetectionReport({
        detectedMode: parsed.jobMode,
        detectedModeReasoning: parsed.jobModeReasoning,
      });
    } else {
      detectionReport = createSystemDesignDetectionReport({
        detectedMode: parsed.jobMode,
        detectedModeReasoning: parsed.jobModeReasoning,
        environment: parsed.environment!,
        environmentReasoning: parsed.environmentReasoning!,
        domain: parsed.domain!,
        domainReasoning: parsed.domainReasoning!,
      });
    }

    // Resolve targetFiles (single source of truth for chat + decompose)
    if (detectionReport.detectedIntentGroup === 'design-system') {
      const existingFiles = existingDocNames;

      const { targetFiles, effectiveMode } = resolveDesignTargetFiles(
        detectionReport.environment,
        detectionReport.detectedMode,
        existingFiles
      );

      detectionReport.targetFiles = targetFiles;
      if (effectiveMode !== detectionReport.detectedMode) {
        console.log(`ℹ️  [Detect] mode corrected: ${detectionReport.detectedMode} → ${effectiveMode} (no same-tier docs for ${detectionReport.environment})`);
        detectionReport.detectedMode = effectiveMode;
        detectionReport.detectedModeReasoning += ` (corrected: no same-tier docs for ${detectionReport.environment})`;
      }
    }

    // Display in Chat UI
    const formattedReport = formatDetectionReportForChat(detectionReport, 'ko');
    await chatAPI.sendLLMEvent({ type: 'text', text: formattedReport });
    await chatAPI.finalizeMessage();

    // Log result
    console.log(`\n✅ Job Mode: ${detectionReport.detectedMode}`);
    console.log(`   Reasoning: ${detectionReport.detectedModeReasoning}`);
    console.log(`✅ Intent Group: ${detectionReport.detectedIntentGroup}`);
    
    if (detectionReport.detectedIntentGroup === 'design-system') {
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

    // Figma MCP reachability check for ui-design with Figma intent
    let figmaDesignError: DesignGraphState['designError'] | undefined;
    const figmaPopulated = isFigmaDataPopulated(state.figmaConfig);
    
    if (detectionReport.detectedIntentGroup === 'design-ui' && figmaPopulated) {
      figmaDesignError = await checkFigmaMCPReachable(state);
      
      if (figmaDesignError) {
        console.log(`\n❌ Figma MCP unavailable: ${figmaDesignError.message}`);
        
        const errorText = `❌ **${figmaDesignError.message}**`;
        await chatAPI.sendLLMEvent({ type: 'text', text: errorText });
        await chatAPI.finalizeMessage();
        
        // RAC: create even on error path (downstream may need it)
        const errorActionMetadata = state.actionMetadata;
        const errorSynthesized = synthesizeDesignIntent(detectionReport, {
          figmaPopulated,
          hasReferences,
        });
        let errorRAC = state.resolvedAction || resolveFromInfer(detectionReport, errorActionMetadata, state.context.codebaseProfile, undefined, errorSynthesized);

        if (state._pendingDocuments?.length) {
          errorRAC = {
            ...errorRAC,
            documents: [...(errorRAC.documents || []), ...state._pendingDocuments],
          };
        }

        return {
          detectionReport,
          resolvedAction: errorRAC,
          designError: figmaDesignError,
          tokenUsage: state.tokenUsage,
          _pendingDocuments: undefined,
          _phaseTimings: { ...(state._phaseTimings || {}), detect: Date.now() - phaseStart },
        };
      }
      
      console.log(`✅ Figma MCP reachable — pipeline=figma`);
      // Figma mode: suppress references pipeline
      uiReferences = undefined;
    }

    // Spec intentGroup: Figma MCP availability (tools enabled, no figmaExplore)
    // Graceful: MCP unavailable → no designError, just proceed without Figma tools
    let specFigmaAvailable: boolean | undefined;
    let specFigmaFileKey: string | undefined;
    let specFigmaStartNodeId: string | undefined;

    if (detectionReport.detectedIntentGroup === 'design-spec' && isFigmaDataPopulated(state.figmaConfig)) {
      const serverMode = process.env.ANT_SERVER_MODE || 'local';
      let mcpReachable = false;
      try {
        if (serverMode === 'local') {
          mcpReachable = await checkLocalMCPAvailability();
        } else {
          const userId = state.context?.userId;
          const redis = state.deps?.redis;
          if (userId && redis) {
            const { createMCPTransport } = await import('../../../../../periphery/adapters/figma/MCPTransport');
            const transport = createMCPTransport({ serverMode: 'cloud', userId, redis });
            mcpReachable = await transport.isAvailable();
          }
        }
      } catch {
        // Non-critical: spec proceeds without Figma
      }

      if (mcpReachable && state.figmaConfig!.file) {
        const { extractFigmaUrlParts } = await import('@ant/shared');
        const parts = extractFigmaUrlParts(state.figmaConfig!.file);
        if (parts.fileKey) {
          specFigmaAvailable = true;
          specFigmaFileKey = parts.fileKey;
          specFigmaStartNodeId = parts.nodeId;
          console.log(`✅ [detectEnvironment] Spec Figma MCP available (fileKey=${parts.fileKey})`);
        }
      }
      if (!mcpReachable) {
        console.log(`ℹ️  [detectEnvironment] Spec has figma.json but MCP unavailable — proceeding without Figma tools`);
      }
    }

    // RAC: create from detection (infer path, LLM detection complete)
    let inferRAC: ResolvedActionContext | undefined = state.resolvedAction;
    if (!inferRAC) {
      const inferActionMetadata = state.actionMetadata;
      const inferSynthesized = synthesizeDesignIntent(detectionReport, {
        figmaPopulated: isFigmaDataPopulated(state.figmaConfig),
        hasReferences,
      });
      inferRAC = resolveFromInfer(detectionReport, inferActionMetadata, state.context.codebaseProfile, undefined, inferSynthesized);
      console.log(`📋 [detectEnvironment] RAC created (infer): intent=${inferRAC.intent}, intentGroup=${inferRAC.intentGroup}, tech=${JSON.stringify(inferRAC.tech)}`);
    }

    if (state._pendingDocuments?.length) {
      inferRAC = {
        ...inferRAC!,
        documents: [...(inferRAC!.documents || []), ...state._pendingDocuments],
      };
    }

    return {
      detectionReport,
      resolvedAction: inferRAC,
      uiReferences: detectionReport.detectedIntentGroup === 'design-ui' ? uiReferences : undefined,
      uiAssetsList: detectionReport.detectedIntentGroup === 'design-ui' ? uiAssetsList : undefined,
      figmaAvailable: specFigmaAvailable,
      figmaFileKey: specFigmaFileKey,
      figmaStartNodeId: specFigmaStartNodeId,
      tokenUsage: state.tokenUsage,
      _pendingDocuments: undefined,
      _phaseTimings: { ...(state._phaseTimings || {}), detect: Date.now() - phaseStart },
    };
  } finally {
    if (state.deps?.workflowUpdate && state._httpJobId) {
      state.deps.workflowUpdate.exitNode(state._httpJobId, "detectEnvironment", 0);
    }
  }
}
