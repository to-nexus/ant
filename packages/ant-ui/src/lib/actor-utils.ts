/**
 * Actor Utility Functions
 * 
 * External Actor 정보를 정규화하고 관리하는 유틸리티
 */

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
 */
const ACTOR_INFO_MAP: Record<string, ActorInfo> = {
  'llm': {
    id: 'llm',
    displayName: 'LLM',
    provider: 'Anthropic',
    model: 'Claude Sonnet 4.5',
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
    details: './workspace/{project}/{feature}/session.json',
    icon: '💾'
  },
  'file-system': {
    id: 'file-system',
    displayName: 'Workspace Files',
    provider: 'Node.js',
    model: 'FS API',
    details: './workspace/{project}/{feature}/outputs/',
    icon: '📁'
  },
  'code-repo': {
    id: 'code-repo',
    displayName: 'Code Repository',
    provider: 'Git',
    model: 'Local Repository',
    details: '~/dev/{project}',
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
 */
export function getActorInfo(actorId: string): ActorInfo | null {
  return ACTOR_INFO_MAP[actorId] || null;
}

/**
 * 여러 Actor ID들의 정보 조회
 */
export function getActorInfoList(actorIds: string[]): ActorInfo[] {
  return actorIds
    .map(id => getActorInfo(id))
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

