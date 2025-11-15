/**
 * Workspace Path Utilities
 * 
 * "workspaces/" 디렉토리 내 경로를 생성하는 중앙화된 유틸리티
 * 
 * ## 용어 정리
 * - **"workspaces"** (복수, 디렉토리): 전체 workspace 저장소 디렉토리
 * - **"workspace"** (단수, 개념): 한 프로젝트의 작업 공간
 * 
 * ## 경로 범위
 * 이 유틸리티는 `workspaces/` 디렉토리 내의 모든 경로를 다룹니다:
 * - ✅ 프로젝트 레벨: config.json, codebase/ (프로젝트 설정 및 코드베이스)
 * - ✅ 피처 레벨: inputs/, outputs/, sessions/ (작업용 파일)
 * 
 * ⚠️ **Local 모드 실제 코드베이스 경로는 별도!**
 * - Local Mode에서 config.repoType='local'인 경우
 * - 실제 코드는 config.localPath에 있음 (예: ~/dev/my-project)
 * - workspaces/.../codebase는 사용되지 않음
 * 
 * ## Path Structures
 * 
 * ### Local Mode
 * ```
 * workspaces/local/
 *   └── {project}/
 *       ├── config.json           # 프로젝트 설정
 *       ├── codebase/             # 코드베이스 (Cloud에서 사용)
 *       └── features/             # 피처들
 *           └── {feature}/
 *               ├── inputs/
 *               ├── outputs/
 *               └── sessions/
 * ```
 * 
 * ### Cloud Mode
 * ```
 * workspaces/{org}/{user}/
 *   └── {project}/
 *       ├── config.json           # 프로젝트 설정
 *       ├── codebase/             # 코드베이스 (실제 코드 저장)
 *       └── features/             # 피처들
 *           └── {feature}/
 *               ├── inputs/
 *               ├── outputs/
 *               └── sessions/
 * ```
 */

import { getApiBase } from '@/infrastructure/http/api';

const CLOUD_BACKEND_BASE = import.meta.env.VITE_CLOUD_BACKEND_BASE;

/**
 * Backend Mode 판별
 * - getApiBase()가 CLOUD_BACKEND_BASE이면 'cloud'
 * - 아니면 'local'
 */
export function getBackendMode(): 'local' | 'cloud' {
  const apiBase = getApiBase();
  return apiBase === CLOUD_BACKEND_BASE ? 'cloud' : 'local';
}

/**
 * User Context 정보
 */
export interface UserContext {
  organization?: string;
  userId?: string;
}

/**
 * Get user context from localStorage
 */
function getUserContext(): UserContext {
  try {
    const email = localStorage.getItem('ant-ui:user-email');
    const org = localStorage.getItem('ant-ui:user-organization');
    
    if (email && org) {
      const parsedEmail = JSON.parse(email);
      const parsedOrg = JSON.parse(org);
      
      // Extract userId from email (e.g., alice@to.nexus -> alice)
      const userId = parsedEmail.split('@')[0];
      
      return {
        organization: parsedOrg,
        userId
      };
    }
  } catch (error) {
    console.warn('[workspace-path] Failed to get user context:', error);
  }
  
  return {};
}

/**
 * Get workspace root path
 * 
 * Local: `workspaces/local`
 * Cloud: `workspaces/{org}/{user}`
 */
export function getWorkspaceRootPath(): string {
  const mode = getBackendMode();
  
  if (mode === 'cloud') {
    const { organization, userId } = getUserContext();
    if (!organization || !userId) {
      throw new Error('[workspace-path] User context not available in cloud mode');
    }
    return `workspaces/${organization}/${userId}`;
  }
  
  return 'workspaces/local';
}

/**
 * Get project path
 * 
 * Local: `workspaces/local/{project}`
 * Cloud: `workspaces/{org}/{user}/{project}`
 * 
 * @example
 * const projectPath = getProjectPath('my-project');
 * const configPath = `${projectPath}/config.json`;
 * const codebasePath = `${projectPath}/codebase`;
 */
export function getProjectPath(projectId: string): string {
  const root = getWorkspaceRootPath();
  return `${root}/${projectId}`;
}

/**
 * Get feature path
 * 
 * Local: `workspaces/local/{project}/features/{feature}`
 * Cloud: `workspaces/{org}/{user}/{project}/features/{feature}`
 * 
 * @example
 * const featurePath = getFeaturePath('my-project', 'auth');
 * const inputsPath = `${featurePath}/inputs`;
 * const outputsPath = `${featurePath}/outputs`;
 */
export function getFeaturePath(projectId: string, featureId: string): string {
  const projectPath = getProjectPath(projectId);
  return `${projectPath}/features/${featureId}`;
}

/**
 * Get codebase path
 * 
 * 코드베이스 경로는 Backend 모드에 따라 결정됩니다:
 * 
 * **Backend Local:**
 * - config.localPath 사용 (예: ~/dev/my-project)
 * - Local 머신의 실제 코드 저장소
 * 
 * **Backend Cloud:**
 * - workspaces/{org}/{user}/{project}/codebase 사용
 * - Cloud 서버 내부의 코드 저장소
 * 
 * @param projectId - 프로젝트 ID
 * @param config - 프로젝트 설정 (localPath 확인용)
 * @returns 코드베이스 경로
 * 
 * @example
 * // Backend Local
 * const config = await fetchProjectConfig(projectId);
 * const codebase = getCodebasePath(projectId, config);
 * // → ~/dev/my-project
 * 
 * // Backend Cloud
 * const codebase = getCodebasePath(projectId);
 * // → workspaces/nexus/alice/my-project/codebase
 */
export function getCodebasePath(
  projectId: string, 
  config?: { localPath?: string }
): string {
  const mode = getBackendMode();
  
  if (mode === 'local') {
    // Local 백엔드: 항상 config.localPath 사용
    // Local 머신의 실제 코드 저장소에 접근
    return config?.localPath || `~/dev/${projectId}`;
  }
  
  // Cloud 백엔드: 항상 workspaces 내부 codebase 사용
  // Cloud 서버 내부의 코드 저장소에 접근
  const projectPath = getProjectPath(projectId);
  return `${projectPath}/codebase`;
}

/**
 * Display path for UI (relative path with ./)
 * 
 * Feature 레벨 경로의 UI 표시용 버전
 * 
 * Local: `./workspace/{project}/{feature}/outputs/session.json`
 * Cloud: `./workspaces/{org}/{user}/{project}/{feature}/outputs/session.json`
 * 
 * @example
 * getDisplayPath('my-project', 'auth', 'outputs/session.json')
 * // Local: ./workspace/my-project/auth/outputs/session.json
 */
export function getDisplayPath(
  projectId: string, 
  featureId: string, 
  subPath: string = 'outputs/session.json'
): string {
  const mode = getBackendMode();
  
  if (mode === 'cloud') {
    const { organization, userId } = getUserContext();
    if (!organization || !userId) {
      return `./workspaces/{org}/{user}/${projectId}/features/${featureId}/${subPath}`;
    }
    return `./workspaces/${organization}/${userId}/${projectId}/features/${featureId}/${subPath}`;
  }
  
  // Local mode - keep backward compatible display (단수 'workspace')
  return `./workspace/${projectId}/${featureId}/${subPath}`;
}

