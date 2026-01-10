import { DesignGraphState } from "../state";
import { LLMClient } from "../../../../../core/ports";
import { PromptEngine } from "../../../../../core/prompt/engine";
import * as path from 'path';
import * as fs from 'fs/promises';

interface DetectEnvironmentDesignResponse {
  // ✅ Work type (first-level classification)
  workType: "ui-design" | "system-design" | "error";
  workTypeReasoning: string;
  
  // ✅ Only for system-design
  domain?: "game" | "service";
  domainReasoning?: string;
  environment?: "frontend" | "backend" | "fullstack";
  environmentReasoning?: string;
  
  // ✅ NEW: Error handling for modification requests without documents
  errorMessage?: string;
  errorType?: string;
  suggestedAction?: string;
}

function parseDetectEnvironmentDesignResponse(raw: string): DetectEnvironmentDesignResponse {
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
    
    // ✅ Parse workType (required)
    const workType: "ui-design" | "system-design" | "error" =
      parsed.workType === "ui-design" ? "ui-design" : 
      parsed.workType === "error" ? "error" :
      "system-design";
    
    // ✅ NEW: Handle error case (modification request without documents)
    if (workType === "error") {
      return {
        workType: "error",
        workTypeReasoning: parsed.workTypeReasoning || "Error occurred during work type detection",
        errorMessage: parsed.errorMessage || "문서가 존재하지 않습니다",
        errorType: parsed.errorType || "missing_documents",
        suggestedAction: parsed.suggestedAction || "먼저 문서를 생성해주세요",
      };
    }
    
    // ✅ For system-design, parse domain and environment
    if (workType === "system-design") {
      const domain: "game" | "service" =
        parsed.domain === "game" || parsed.domain === "service"
          ? parsed.domain
          : "service";
      
      const environment: "frontend" | "backend" | "fullstack" =
        parsed.environment === "frontend" || parsed.environment === "backend" || parsed.environment === "fullstack"
          ? parsed.environment
          : "fullstack";

      return {
        workType,
        workTypeReasoning:
          typeof parsed.workTypeReasoning === "string" && parsed.workTypeReasoning.length > 0
            ? parsed.workTypeReasoning
            : "System design work detected.",
        domain,
        domainReasoning:
          typeof parsed.domainReasoning === "string" && parsed.domainReasoning.length > 0
            ? parsed.domainReasoning
            : "Defaulted to 'service' because domain was ambiguous or missing.",
        environment,
        environmentReasoning:
          typeof parsed.environmentReasoning === "string" && parsed.environmentReasoning.length > 0
            ? parsed.environmentReasoning
            : "Defaulted to 'fullstack' because environment was ambiguous or missing.",
      };
    }
    
    // ✅ For ui-design, no domain/environment needed
    return {
      workType: "ui-design",
      workTypeReasoning:
        typeof parsed.workTypeReasoning === "string" && parsed.workTypeReasoning.length > 0
          ? parsed.workTypeReasoning
          : "UI design work detected.",
    };
  } catch (error) {
    console.error("❌ [DesignDetectEnvironment] Failed to parse LLM response:", error);
    console.error("Raw response (truncated):", raw.substring(0, 500));

    // 안전 기본값: system-design + service + fullstack
    return {
      workType: "system-design",
      workTypeReasoning: "Failed to parse LLM response; defaulting to system design.",
      domain: "service",
      domainReasoning: "Failed to parse LLM response; defaulting domain to 'service'.",
      environment: "fullstack",
      environmentReasoning: "Failed to parse LLM response; defaulting environment to 'fullstack'.",
    };
  }
}

/**
 * Scan directory for files (non-recursive)
 */
async function listFilesInDir(dirPath: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    return entries
      .filter(e => e.isFile() && !e.name.startsWith('.'))
      .map(e => e.name);
  } catch {
    return [];
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
 * Design graph 전용 detectEnvironment 노드
 *
 * Responsibility:
 * - PRD + directive + filesystem context를 기반으로:
 *   1. Work Type 분류: ui-design | system-design
 *   2. Domain 분류 (system-design only): game | service
 *   3. Environment 분류 (system-design only): frontend | backend | fullstack
 * - 결과는 이후 프롬프트 인젝션 및 파일명 결정에 사용
 */
export async function detectEnvironment(
  state: DesignGraphState
): Promise<Partial<DesignGraphState>> {
  const llm = state.deps?.llm as LLMClient | undefined;
  const engine = state.deps?.promptEngine as PromptEngine | undefined;

  if (!llm || !engine) {
    console.warn(
      "[DesignDetectEnvironment] Missing llm or promptEngine dependency. Skipping detection."
    );
    // 기본값: system-design + service + fullstack
    return {
      designWorkType: "system-design",
      designWorkTypeReasoning:
        "promptEngine or llm not available; defaulting to system design.",
      designDomain: "service",
      designDomainReasoning:
        "promptEngine or llm not available; defaulting design domain to 'service'.",
      designEnvironment: "fullstack",
      designEnvironmentReasoning:
        "promptEngine or llm not available; defaulting design environment to 'fullstack'.",
    };
  }

  // Workflow UI: focus this node in the design workflow view
  if (state.deps?.workflowUpdate && state._httpJobId) {
    await state.deps.workflowUpdate.enterNode(state._httpJobId, "detectEnvironment");
  }

  try {
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🔍 DESIGN WORK TYPE + ENVIRONMENT DETECTION');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    
    // Directive 우선순위: overrideDirective (chat) > directive (task)
    const directive = state.overrideDirective || state.directive || "";
    const prdSpec = state.prd || "";

    // ✅ NEW: Scan inputs/references and inputs/assets for UI doc detection
    const featurePath = state.context.featurePath || '';
    const referencesDir = path.join(featurePath, 'inputs/references');
    const assetsDir = path.join(featurePath, 'inputs/assets');
    
    // Check for references (screens, components)
    const screensDir = path.join(referencesDir, 'screens');
    const componentsDir = path.join(referencesDir, 'components');
    
    const hasScreens = await dirHasFiles(screensDir);
    const hasComponents = await dirHasFiles(componentsDir);
    const hasReferences = hasScreens || hasComponents;
    
    // Check for assets
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
      
      // Categorize assets
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
      if (logos.length > 0) {
        parts.push(`**logos/** (${logos.length} files):`);
        logos.slice(0, 5).forEach(f => parts.push(`  - ${f}`));
      }
      if (backgrounds.length > 0) {
        parts.push(`**backgrounds/** (${backgrounds.length} files):`);
        backgrounds.slice(0, 5).forEach(f => parts.push(`  - ${f}`));
      }
      if (icons.length > 0) {
        parts.push(`**icons/** (${icons.length} files):`);
        icons.slice(0, 5).forEach(f => parts.push(`  - ${f}`));
      }
      if (other.length > 0) {
        parts.push(`**other/** (${other.length} files):`);
        other.slice(0, 5).forEach(f => parts.push(`  - ${f}`));
      }
      assetsList = parts.join('\n');
      
      console.log(`📦 Found assets: ${allAssets.length} files`);
      console.log(`   - logos: ${logos.length}`);
      console.log(`   - backgrounds: ${backgrounds.length}`);
      console.log(`   - icons: ${icons.length}`);
      console.log(`   - other: ${other.length}`);
    }
    
    // ✅ Check for existing design documents (CRITICAL for decision making)
    const outputsDir = path.join(featurePath, 'outputs/design');
    
    // UI Design documents
    const hasUiTokens = await dirHasFiles(outputsDir) && await fs.access(path.join(outputsDir, 'ui-tokens.json')).then(() => true).catch(() => false);
    const hasUiAssets = await dirHasFiles(outputsDir) && await fs.access(path.join(outputsDir, 'ui-assets.json')).then(() => true).catch(() => false);
    const hasUiSpec = await dirHasFiles(outputsDir) && await fs.access(path.join(outputsDir, 'ui-spec.json')).then(() => true).catch(() => false);
    const hasUiDocs = hasUiTokens && hasUiAssets && hasUiSpec;
    
    // System Design documents
    const hasSystemDesign = await dirHasFiles(outputsDir) && await fs.access(path.join(outputsDir, 'system-design.md')).then(() => true).catch(() => false);
    const hasApiContract = await dirHasFiles(outputsDir) && await fs.access(path.join(outputsDir, 'api-contract.md')).then(() => true).catch(() => false);
    const hasFeSystemDesign = await dirHasFiles(outputsDir) && await fs.access(path.join(outputsDir, 'fe-system-design.md')).then(() => true).catch(() => false);
    const hasBeSystemDesign = await dirHasFiles(outputsDir) && await fs.access(path.join(outputsDir, 'be-system-design.md')).then(() => true).catch(() => false);
    const hasSystemDocs = hasSystemDesign || hasApiContract || hasFeSystemDesign || hasBeSystemDesign;
    
    if (hasUiDocs) {
      console.log(`✅ UI design documents already completed:`);
      if (hasUiTokens) console.log(`   - ui-tokens.json`);
      if (hasUiAssets) console.log(`   - ui-assets.json`);
      if (hasUiSpec) console.log(`   - ui-spec.json`);
    }
    
    if (hasSystemDocs) {
      console.log(`✅ System design documents already exist:`);
      if (hasSystemDesign) console.log(`   - system-design.md`);
      if (hasApiContract) console.log(`   - api-contract.md`);
      if (hasFeSystemDesign) console.log(`   - fe-system-design.md`);
      if (hasBeSystemDesign) console.log(`   - be-system-design.md`);
    }
    
    if (hasUiDocs && !hasSystemDocs) {
      console.log(`🎯 UI design complete → System design should be next`);
    }
    
    // Build UI references list for state
    let uiReferences: DesignGraphState['uiReferences'] = undefined;
    if (hasReferences) {
      const screenFiles = hasScreens ? (await listFilesRecursive(screensDir)).map(f => `inputs/references/screens/${f}`) : undefined;
      const componentFiles = hasComponents ? (await listFilesRecursive(componentsDir)).map(f => `inputs/references/components/${f}`) : undefined;
      
      uiReferences = {
        screens: screenFiles,
        components: componentFiles,
      };
    }

    // PromptEngine을 사용해 detect 프롬프트 구성
    const prompt = await engine.buildDesignDomainPrompt({
      directive,
      prdSpec,
      hasReferences,
      hasAssets,
      referencesList,
      assetsList,
      // ✅ NEW: Pass document completion status
      hasUiDocs,
      hasUiTokens,
      hasUiAssets,
      hasUiSpec,
      hasSystemDocs,
      hasSystemDesign,
      hasApiContract,
      hasFeSystemDesign,
      hasBeSystemDesign,
    });

    // ✅ Chat UI 준비
    const { getChatAPIClient } = await import("../../../../../core/adapters/ChatAPIClient");
    const chatAPI = getChatAPIClient();
    
    await chatAPI.showChatStatus('placeholder');

    // LLM call (single turn, no extra streaming orchestrator)
    let response = "";
    let capturedUsage: any = undefined;
    
    for await (const event of llm.stream(
      [{ role: "user", content: prompt }],
      {
        temperature: 0.2,
        maxTokens: 16000,
      }
    )) {
      if (event.text) {
        response += event.text;
      }
      
      // ✅ Extract token usage from done event
      const { extractTokenUsageFromStreamEvent } = await import("../../common/llmHelpers");
      const usage = extractTokenUsageFromStreamEvent(event);
      if (usage) {
        capturedUsage = usage;
      }
    }
    
    // ✅ Accumulate token usage to job-level (not task-level, as detectEnvironment runs before tasks)
    if (capturedUsage) {
      const { accumulateTokenUsage } = await import("../../common/llmHelpers");
      accumulateTokenUsage(state as any, capturedUsage, { taskLevel: false, jobLevel: true });
      console.log(`   Tokens: ${capturedUsage.totalTokens} total (${capturedUsage.inputTokens} in, ${capturedUsage.outputTokens} out)`);
    }

    // ✅ Transform and display response using SpecialTagTransformer (now supports Design job)
    const { SpecialTagTransformer } = await import('../../../../../core/streaming/transformers/SpecialTagTransformer');
    const transformer = new SpecialTagTransformer('ko');
    const transformed = transformer.transform(response);
    
    if (transformed.text) {
      await chatAPI.sendLLMEvent({
        type: 'text',
        text: transformed.text
      });
    }
    
    await chatAPI.finalizeMessage();

    const parsed = parseDetectEnvironmentDesignResponse(response);

    // ✅ NEW: Handle error case (modification request without documents)
    if (parsed.workType === 'error') {
      console.log(`\n❌ Error: ${parsed.errorType}`);
      console.log(`   Message: ${parsed.errorMessage}`);
      console.log(`   Suggested Action: ${parsed.suggestedAction}`);
      console.log();
      
      // Send error message to chat
      const errorText = `❌ **${parsed.errorMessage}**\n\n${parsed.suggestedAction}`;
      await chatAPI.sendLLMEvent({
        type: 'text',
        text: errorText
      });
      
      // Return error state to terminate the design graph
      return {
        designWorkType: undefined,
        designWorkTypeReasoning: parsed.workTypeReasoning,
        designError: {
          type: parsed.errorType || 'unknown_error',
          message: parsed.errorMessage || 'An error occurred',
          suggestedAction: parsed.suggestedAction,
        },
      };
    }

    // Log result to console (for debugging)
    console.log(`\n✅ Work Type: ${parsed.workType}`);
    console.log(`   Reasoning: ${parsed.workTypeReasoning}`);
    
    if (parsed.workType === 'system-design') {
      console.log(`✅ Domain: ${parsed.domain}`);
      console.log(`   Reasoning: ${parsed.domainReasoning}`);
      console.log(`✅ Environment: ${parsed.environment}`);
      console.log(`   Reasoning: ${parsed.environmentReasoning}`);
      
      if (parsed.domain === "game") {
        console.log("   Domain-specific injections: Game Domain Design Guide");
      } else if (parsed.domain === "service") {
        console.log("   Domain-specific injections: Service Domain Design Guide");
      }
      
      if (parsed.environment === "frontend") {
        console.log("   Environment-specific injections: Frontend Guide");
        console.log("   Strategy: Single-tier → unified document (system-design.md)");
      } else if (parsed.environment === "backend") {
        console.log("   Environment-specific injections: Backend Guide");
        console.log("   Strategy: Single-tier → unified document (system-design.md)");
      } else {
        console.log("   Environment-specific injections: Frontend + Backend Guides");
        console.log("   Strategy: Fullstack → contract-first (api-contract.md, fe-system-design.md, be-system-design.md)");
      }
    } else {
      console.log(`   UI Design Mode`);
      console.log(`   Target files: ui-tokens.json, ui-assets.json, ui-spec.json`);
      if (hasReferences) {
        console.log(`   📸 Will analyze reference images from inputs/references/`);
      }
      if (hasAssets) {
        console.log(`   📦 Will create asset mapping from inputs/assets/`);
      }
    }
    console.log();

    return {
      designWorkType: parsed.workType,
      designWorkTypeReasoning: parsed.workTypeReasoning,
      designDomain: parsed.domain,
      designDomainReasoning: parsed.domainReasoning,
      designEnvironment: parsed.environment,
      designEnvironmentReasoning: parsed.environmentReasoning,
      // ✅ NEW: UI context for ui-design work type
      uiReferences: parsed.workType === 'ui-design' ? uiReferences : undefined,
      uiAssetsList: parsed.workType === 'ui-design' ? uiAssetsList : undefined,
      tokenUsage: (state as any).tokenUsage,  // ✅ CRITICAL: Return accumulated job-level token usage
    };
  } finally {
    // Ensure workflow node is marked as completed in UI
    if (state.deps?.workflowUpdate && state._httpJobId) {
      state.deps.workflowUpdate.exitNode(state._httpJobId, "detectEnvironment");
    }
  }
}
