import { DesignGraphState } from "../state";
import { LLMClient } from "../../../../../core/ports";
import { PromptEngine } from "../../../../../core/prompt/engine";

interface DetectDomainResponse {
  domain: "game" | "service";
  domainReasoning: string;
}

function parseDetectDomainResponse(raw: string): DetectDomainResponse {
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
    const domain =
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
    console.error("❌ [DesignDetectDomain] Failed to parse LLM response:", error);
    console.error("Raw response (truncated):", raw.substring(0, 500));

    // 안전 기본값: service
    return {
      domain: "service",
      domainReasoning: "Failed to parse LLM response; defaulting domain to 'service'.",
    };
  }
}

/**
 * Design graph 전용 도메인 감지 노드
 *
 * Responsibility:
 * - PRD + directive + 기존 designDoc 을 기반으로 프로젝트 도메인을 game | service 로 분류
 * - 결과는 이후 프롬프트 인젝션에서만 사용 (설계 내용은 여전히 PRD/요구를 따름)
 */
export async function detectDomain(
  state: DesignGraphState
): Promise<Partial<DesignGraphState>> {
  const llm = state.deps?.llm as LLMClient | undefined;
  const engine = state.deps?.promptEngine as PromptEngine | undefined;

  if (!llm || !engine) {
    console.warn(
      "[DesignDetectDomain] Missing llm or promptEngine dependency. Skipping domain detection."
    );
    // 기본값: service
    return {
      designDomain: "service",
      designDomainReasoning:
        "promptEngine or llm not available; defaulting design domain to 'service'.",
    };
  }

  // Directive 우선순위: overrideDirective (chat) > directive (task)
  const directive = state.overrideDirective || state.directive || "";
  const prdSpec = state.prd || "";

  // PromptEngine을 사용해 detect 프롬프트 구성
  const prompt = await engine.buildDesignDomainPrompt({
    directive,
    prdSpec
  });

  // LLM 호출 (단일 turn, 스트리밍 없이)
  let response = "";
  for await (const event of llm.stream(
    [{ role: "user", content: prompt }],
    {
      temperature: 0.2,
      maxTokens: 4096,
    }
  )) {
    if (event.text) {
      response += event.text;
    }
  }

  const parsed = parseDetectDomainResponse(response);

  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("🎯 [DesignDetectDomain] Detected design domain");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`  Domain: ${parsed.domain}`);
  console.log(`  Reason: ${parsed.domainReasoning}\n`);

  return {
    designDomain: parsed.domain,
    designDomainReasoning: parsed.domainReasoning,
  };
}

