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
  formatDetectionReportForChat,
  JobMode,
  JobEnvironment,
  DesignDomain,
} from "../../../../../core/types/detection";

interface ParsedDesignResponse {
  workType: "ui-design" | "system-design" | "error";
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
    const workType: "ui-design" | "system-design" | "error" =
      parsed.workType === "ui-design" ? "ui-design" : 
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

    // Safe defaults
    return {
      workType: "system-design",
      workTypeReasoning: "Failed to parse LLM response; defaulting to system design.",
      jobMode: "generate",
      jobModeReasoning: "Failed to parse LLM response; defaulting to generate.",
      domain: "service",
      domainReasoning: "Failed to parse; defaulting to 'service'.",
      environment: "fullstack",
      environmentReasoning: "Failed to parse; defaulting to 'fullstack'.",
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
 * Design Job detectEnvironment node
 */
export async function detectEnvironment(
  state: DesignGraphState
): Promise<Partial<DesignGraphState>> {
  const phaseStart = Date.now();
  
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

  // Workflow UI
  if (state.deps?.workflowUpdate && state._httpJobId) {
    await state.deps.workflowUpdate.enterNode(state._httpJobId, "detectEnvironment", 0);
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
    
    const screensDir = path.join(referencesDir, 'screens');
    const componentsDir = path.join(referencesDir, 'components');
    
    const hasScreens = await dirHasFiles(screensDir);
    const hasComponents = await dirHasFiles(componentsDir);
    const hasReferences = hasScreens || hasComponents;
    const hasAssets = await dirHasFiles(assetsDir);
    
    // Build references list
    let referencesList = '';
    if (hasReferences) {
      const screenFiles = hasScreens ? await listFilesRecursive(screensDir) : [];
      const componentFiles = hasComponents ? await listFilesRecursive(componentsDir) : [];
      
      const parts: string[] = [];
      if (screenFiles.length > 0) {
        parts.push(`**screens/** (${screenFiles.length} files):`);
        screenFiles.slice(0, 10).forEach(f => parts.push(`  - ${f}`));
        if (screenFiles.length > 10) parts.push(`  ... and ${screenFiles.length - 10} more`);
      }
      if (componentFiles.length > 0) {
        parts.push(`**components/** (${componentFiles.length} files):`);
        componentFiles.slice(0, 10).forEach(f => parts.push(`  - ${f}`));
        if (componentFiles.length > 10) parts.push(`  ... and ${componentFiles.length - 10} more`);
      }
      referencesList = parts.join('\n');
      
      console.log(`📸 Found reference images:`);
      console.log(`   - screens: ${screenFiles.length} files`);
      console.log(`   - components: ${componentFiles.length} files`);
    }
    
    // Build assets list
    let assetsList = '';
    let uiAssetsList: DesignGraphState['uiAssetsList'] = undefined;
    if (hasAssets) {
      const allAssets = await listFilesRecursive(assetsDir);
      
      const logos = allAssets.filter(f => f.includes('logo') || f.startsWith('logos/'));
      const backgrounds = allAssets.filter(f => f.includes('bg') || f.startsWith('bg/') || f.includes('background'));
      const icons = allAssets.filter(f => f.includes('icon') || f.startsWith('icons/'));
      const other = allAssets.filter(f => !logos.includes(f) && !backgrounds.includes(f) && !icons.includes(f));
      
      uiAssetsList = {
        logos: logos.length > 0 ? logos : undefined,
        backgrounds: backgrounds.length > 0 ? backgrounds : undefined,
        icons: icons.length > 0 ? icons : undefined,
        other: other.length > 0 ? other : undefined,
      };
      
      const parts: string[] = [];
      if (logos.length > 0) parts.push(`**logos/** (${logos.length} files)`);
      if (backgrounds.length > 0) parts.push(`**backgrounds/** (${backgrounds.length} files)`);
      if (icons.length > 0) parts.push(`**icons/** (${icons.length} files)`);
      if (other.length > 0) parts.push(`**other/** (${other.length} files)`);
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
      const screenFiles = hasScreens ? (await listFilesRecursive(screensDir)).map(f => `inputs/references/screens/${f}`) : undefined;
      const componentFiles = hasComponents ? (await listFilesRecursive(componentsDir)).map(f => `inputs/references/components/${f}`) : undefined;
      uiReferences = { screens: screenFiles, components: componentFiles };
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
      { temperature: LLM_TEMPERATURE.DETECT, maxTokens: LLM_MAX_TOKENS.DETECT }
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

    // Create DetectionReport
    let detectionReport: DetectionReport;
    
    if (parsed.workType === 'ui-design') {
      detectionReport = createUiDesignDetectionReport({
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
