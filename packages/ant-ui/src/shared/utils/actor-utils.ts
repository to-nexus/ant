/**
 * Actor Utility Functions
 *
 * External Actor 정보를 정규화하고 관리하는 유틸리티
 */

import { DEFAULT_MODELS, ModelNodeKey } from '@ant/shared';
import type { ProjectConfig } from '@/infrastructure/http/api/config';

export interface ActorInfo {
  id: string;
  displayName: string;      // 간단한 표시명 (예: LLM, Vector DB)
  provider: string;          // 실제 프로바이더 (예: Anthropic, Chroma)
  model: string;             // 실제 모델/시스템 (예: Claude Sonnet 4.5)
  details?: string;          // 추가 상세정보 (예: 파일 경로)
  icon: string;
}

/**
 * Actor ID → 정규화된 정보 매핑
 * Note: local-storage, file-system, code-repo의 details는 동적으로 생성되므로 템플릿만 제공
 */
const ACTOR_INFO_MAP: Record<string, ActorInfo> = {
  'llm': {
    id: 'llm',
    displayName: 'LLM',
    provider: 'Anthropic',  // Default (overridden by config)
    model: DEFAULT_MODELS.anthropic.sonnet,     // Default (overridden by config)
    icon: '🤖'
  },
  'embedding-model': {
    id: 'embedding-model',
    displayName: 'Embedding',
    provider: 'OpenAI',
    model: 'text-embedding-3-small',
    icon: '🧠'
  },
  'vector-db': {
    id: 'vector-db',
    displayName: 'Vector DB',
    provider: 'Chroma',
    model: 'ChromaDB v0.4.x',
    details: 'Local instance',
    icon: '🗄️'
  },
  'local-storage': {
    id: 'local-storage',
    displayName: 'Storage',
    provider: 'File System',
    model: 'JSON Session Files',
    // details will be set dynamically based on project/feature
    icon: '💾'
  },
  'file-system': {
    id: 'file-system',
    displayName: 'Workspace Files',
    provider: 'Node.js',
    model: 'FS API',
    // details will be set dynamically based on project/feature
    icon: '📁'
  },
  'code-repo': {
    id: 'code-repo',
    displayName: 'Code Repository',
    provider: 'Git',
    model: 'Local Repository',
    // details will be set dynamically based on config
    icon: '💻'
  },
  'tool': {
    id: 'tool',
    displayName: 'Build Tools',
    provider: 'System',
    model: 'npm / pnpm',
    details: 'Package manager and build tools',
    icon: '🔧'
  }
};

/**
 * Actor ID로 정보 조회
 * @param actorId - Actor ID (e.g., 'llm', 'vector-db')
 * @param llmInfo - (Optional) 서버에서 받은 실제 LLM 정보
 */
export function getActorInfo(actorId: string, llmInfo?: { provider: string; model: string }): ActorInfo | null {
  const info = ACTOR_INFO_MAP[actorId];
  
  // ✅ LLM인 경우, 서버에서 받은 실제 정보로 업데이트
  if (actorId === 'llm' && llmInfo && info) {
    return {
      ...info,
      provider: llmInfo.provider === 'anthropic' ? 'Anthropic'
              : llmInfo.provider === 'google' ? 'Google'
              : 'OpenAI',
      model: llmInfo.model
    };
  }
  
  return info || null;
}

/**
 * 여러 Actor ID들의 정보 조회
 * @param actorIds - Actor IDs 배열
 * @param llmInfo - (Optional) 서버에서 받은 실제 LLM 정보
 */
export function getActorInfoList(actorIds: string[], llmInfo?: { provider: string; model: string }): ActorInfo[] {
  return actorIds
    .map(id => getActorInfo(id, llmInfo))
    .filter((info): info is ActorInfo => info !== null);
}

/**
 * Actor 표시명 조회 (간단한 이름)
 */
export function getActorDisplayName(actorId: string): string {
  return ACTOR_INFO_MAP[actorId]?.displayName || actorId;
}

/**
 * Actor 상세 정보 포맷팅
 */
export function formatActorDetails(info: ActorInfo): string {
  const parts = [info.provider, info.model];
  if (info.details) {
    parts.push(info.details);
  }
  return parts.join(' • ');
}

/**
 * Infer provider tag from a model id using prefix heuristics.
 * Mirrors BE `LLMClientFactory.detectProviderFromModel`
 * (LLMClientFactory.ts:71-100) so FE config-fallback resolves the same
 * provider tag the BE would assign.
 */
function detectProviderFromModel(modelId: string): string {
  if (modelId.startsWith('claude')) return 'anthropic';
  if (modelId.startsWith('gpt') || modelId.startsWith('o1') || modelId.startsWith('o3')) return 'openai';
  if (modelId.startsWith('gemini')) return 'google';
  if (modelId.startsWith('deepseek')) return 'deepseek';
  if (modelId.startsWith('glm')) return 'glm';
  if (modelId.startsWith('kimi')) return 'kimi';
  return 'anthropic';
}

/**
 * Resolve LLM info ({ provider, model }) from workspace config using the
 * same priority as BE `resolveModelForContext` (LLMClientFactory.ts:114-156):
 *   1. per-node override: config.llmModels[jobType][nodeType]
 *   2. job default:       config.llmModels[jobType].default
 *   3. hardcoded fallback: DEFAULT_MODELS.anthropic.sonnet
 *
 * Returns null only when config / llmModels / jobConfig is entirely absent
 * (spec T6 cases c, d) — the hardcoded fallback (step 3) always yields a
 * non-null value so the hook's `?? null` chain still works.
 */
export function resolveLLMInfoFromConfig(
  config: ProjectConfig | null | undefined,
  jobType: string,
  nodeType: ModelNodeKey | undefined,
): { provider: string; model: string } | null {
  if (!config) return null;
  if (!config.llmModels) return null;

  const jobConfig = config.llmModels[jobType as keyof typeof config.llmModels];
  if (!jobConfig) return null;

  let modelId: string;

  if (nodeType && jobConfig[nodeType]) {
    modelId = jobConfig[nodeType]!;
  } else if (jobConfig.default) {
    modelId = jobConfig.default;
  } else {
    modelId = DEFAULT_MODELS.anthropic.sonnet;
  }

  return { provider: detectProviderFromModel(modelId), model: modelId };
}

