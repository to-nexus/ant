import { DesignGraphState } from "../state";
import { LLMClient } from "../../../../../core/ports";
import { PromptEngine } from "../../../../../core/prompt/engine";

interface DetectEnvironmentDesignResponse {
  domain: "game" | "service";
  domainReasoning: string;
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

    return {
      domain,
      domainReasoning:
        typeof parsed.domainReasoning === "string" && parsed.domainReasoning.length > 0
          ? parsed.domainReasoning
          : "Defaulted to 'service' because domain was ambiguous or missing.",
    };
  } catch (error) {
    console.error("❌ [DesignDetectEnvironment] Failed to parse LLM response:", error);
    console.error("Raw response (truncated):", raw.substring(0, 500));

    // 안전 기본값: service
    return {
      domain: "service",
      domainReasoning: "Failed to parse LLM response; defaulting domain to 'service'.",
    };
  }
}

/**
 * Design graph 전용 detectEnvironment 노드
 *
 * Responsibility:
 * - PRD + directive + 기존 designDoc 을 기반으로 프로젝트 도메인을 game | service 로 분류
 * - 결과는 이후 프롬프트 인젝션에서만 사용 (설계 내용은 여전히 PRD/요구를 따름)
 */
export async function detectEnvironment(
  state: DesignGraphState
): Promise<Partial<DesignGraphState>> {
  const llm = state.deps?.llm as LLMClient | undefined;
  const engine = state.deps?.promptEngine as PromptEngine | undefined;

  if (!llm || !engine) {
    console.warn(
      "[DesignDetectEnvironment] Missing llm or promptEngine dependency. Skipping domain detection."
    );
    // 기본값: service
    return {
      designDomain: "service",
      designDomainReasoning:
        "promptEngine or llm not available; defaulting design domain to 'service'.",
    };
  }

  // Workflow UI: focus this node in the design workflow view
  if (state.deps?.workflowUpdate && state._httpJobId) {
    await state.deps.workflowUpdate.enterNode(state._httpJobId, "detectEnvironment");
  }

  try {
    // Directive 우선순위: overrideDirective (chat) > directive (task)
    const directive = state.overrideDirective || state.directive || "";
    const prdSpec = state.prd || "";

    // PromptEngine을 사용해 detect 프롬프트 구성
    const prompt = await engine.buildDesignDomainPrompt({
      directive,
      prdSpec,
    });

    // LLM call (single turn, no extra streaming orchestrator)
    let response = "";
    for await (const event of llm.stream(
      [{ role: "user", content: prompt }],
      {
        temperature: 0.2,
        // Use a high enough maxTokens to be safely above thinking.budget_tokens
        // (see code graph detectEnvironment/decompose callers for the same pattern)
        maxTokens: 16000,
      }
    )) {
      if (event.text) {
        response += event.text;
      }
    }

    const parsed = parseDetectEnvironmentDesignResponse(response);

    // Log result to console (for debugging)
    console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("🎯 [DesignDetectEnvironment] Detected design domain");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log(`  Domain: ${parsed.domain}`);
    console.log(`  Reason: ${parsed.domainReasoning}`);
    if (parsed.domain === "game") {
      console.log(
        "  Domain-specific injections: Game Domain Design Guide (design/phases/execute/injections/game-domain-guide.md)"
      );
    } else if (parsed.domain === "service") {
      console.log(
        "  Domain-specific injections: Service Domain Design Guide (design/phases/execute/injections/service-domain-guide.md)"
      );
    }
    console.log();

    // Render detection result into chat UI so the user can see
    try {
      const { getChatAPIClient } = await import("../../../../../core/adapters/ChatAPIClient");
      const chatAPI = getChatAPIClient();

      const hasDomainInjection = parsed.domain === "game" || parsed.domain === "service";
      let content =
        "🧭 **Design Domain Detection Result**\n\n" +
        `- **Domain**: ${parsed.domain}\n` +
        `- **Reason**: ${parsed.domainReasoning}\n`;

      if (parsed.domain === "game") {
        content +=
          "- **Domain-specific injections**: `design/phases/execute/injections/game-domain-guide.md` (Game Domain Design Guide) will be included in design prompts.\n";
      } else if (parsed.domain === "service") {
        content +=
          "- **Domain-specific injections**: `design/phases/execute/injections/service-domain-guide.md` (Service Domain Design Guide) will be included in design prompts.\n";
      }

      await chatAPI.showChatStatus("analyzed", {
        content,
        designDomain: parsed.domain,
        hasDomainInjection,
      });
    } catch (chatError) {
      console.warn(
        "[DesignDetectEnvironment] Failed to send detection result to chat UI:",
        chatError
      );
    }

    return {
      designDomain: parsed.domain,
      designDomainReasoning: parsed.domainReasoning,
    };
  } finally {
    // Ensure workflow node is marked as completed in UI
    if (state.deps?.workflowUpdate && state._httpJobId) {
      state.deps.workflowUpdate.exitNode(state._httpJobId, "detectEnvironment");
    }
  }
}

