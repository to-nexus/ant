import { DesignGraphState } from "../state";
import { LLMClient } from "../../../../../core/ports";
import { PromptEngine } from "../../../../../core/prompt/engine";

interface DetectEnvironmentDesignResponse {
  domain: "game" | "service";
  domainReasoning: string;
  environment: "frontend" | "backend" | "fullstack";
  environmentReasoning: string;
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
    
    const domain: "game" | "service" =
      parsed.domain === "game" || parsed.domain === "service"
        ? parsed.domain
        : "service";
    
    const environment: "frontend" | "backend" | "fullstack" =
      parsed.environment === "frontend" || parsed.environment === "backend" || parsed.environment === "fullstack"
        ? parsed.environment
        : "fullstack";

    return {
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
  } catch (error) {
    console.error("❌ [DesignDetectEnvironment] Failed to parse LLM response:", error);
    console.error("Raw response (truncated):", raw.substring(0, 500));

    // 안전 기본값: service + fullstack
    return {
      domain: "service",
      domainReasoning: "Failed to parse LLM response; defaulting domain to 'service'.",
      environment: "fullstack",
      environmentReasoning: "Failed to parse LLM response; defaulting environment to 'fullstack'.",
    };
  }
}

/**
 * Design graph 전용 detectEnvironment 노드
 *
 * Responsibility:
 * - PRD + directive를 기반으로:
 *   1. Domain 분류: game | service
 *   2. Environment 분류: frontend | backend | fullstack
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
    // 기본값: service + fullstack
    return {
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
    console.log('🔍 DESIGN ENVIRONMENT DETECTION: Analyzing project');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    
    // Directive 우선순위: overrideDirective (chat) > directive (task)
    const directive = state.overrideDirective || state.directive || "";
    const prdSpec = state.prd || "";

    // PromptEngine을 사용해 detect 프롬프트 구성
    const prompt = await engine.buildDesignDomainPrompt({
      directive,
      prdSpec,
    });

    // ✅ Chat UI 준비
    const { getChatAPIClient } = await import("../../../../../core/adapters/ChatAPIClient");
    const chatAPI = getChatAPIClient();
    
    await chatAPI.showChatStatus('placeholder');

    // LLM call (single turn, no extra streaming orchestrator)
    let response = "";
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

    // Log result to console (for debugging)
    console.log(`✅ Domain: ${parsed.domain}`);
    console.log(`   Reasoning: ${parsed.domainReasoning}`);
    console.log(`✅ Environment: ${parsed.environment}`);
    console.log(`   Reasoning: ${parsed.environmentReasoning}`);
    
    if (parsed.domain === "game") {
      console.log(
        "   Domain-specific injections: Game Domain Design Guide"
      );
    } else if (parsed.domain === "service") {
      console.log(
        "   Domain-specific injections: Service Domain Design Guide"
      );
    }
    
    if (parsed.environment === "frontend") {
      console.log("   Environment-specific injections: Frontend Guide");
      console.log("   Output file: fe-system-design.md");
    } else if (parsed.environment === "backend") {
      console.log("   Environment-specific injections: Backend Guide");
      console.log("   Output file: be-system-design.md");
    } else {
      console.log("   Environment-specific injections: Frontend + Backend Guides");
      console.log("   Output file: system-design.md (unified)");
    }
    console.log();

    return {
      designDomain: parsed.domain,
      designDomainReasoning: parsed.domainReasoning,
      designEnvironment: parsed.environment,
      designEnvironmentReasoning: parsed.environmentReasoning,
    };
  } finally {
    // Ensure workflow node is marked as completed in UI
    if (state.deps?.workflowUpdate && state._httpJobId) {
      state.deps.workflowUpdate.exitNode(state._httpJobId, "detectEnvironment");
    }
  }
}

