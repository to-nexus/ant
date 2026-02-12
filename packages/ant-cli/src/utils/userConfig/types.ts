/**
 * User-Level Configuration Types
 * 
 * User 설정은 3개의 JSON 파일로 관리됩니다:
 * 1. credentials.json - 인증 정보 (암호화)
 * 2. integrations.json - 통합 설정 (평문)
 * 3. preferences.json - UI 개인 설정 (평문)
 */

// ============================================
// 1. Credentials (암호화 저장)
// ============================================

export interface UserCredentials {
  github?: GitHubCredentials;
  figma?: FigmaCredentials;
  linear?: LinearCredentials;
  slack?: SlackCredentials;
  // 향후 추가될 서비스들...
}

export interface GitHubCredentials {
  token: string;              // Personal Access Token (암호화됨)
  tokenType?: 'pat' | 'oauth';
  username?: string;          // GitHub username (auto-detected from PAT validation)
  updatedAt: string;
}

export interface FigmaCredentials {
  accessToken: string;        // OAuth Access Token (암호화됨)
  refreshToken?: string;      // OAuth Refresh Token (암호화됨)
  userId?: string;            // Figma User ID
  email?: string;             // Figma User Email
  expiresAt?: string;         // Token expiration time
  updatedAt: string;
}

export interface LinearCredentials {
  apiKey: string;             // Linear API Key (암호화됨)
  updatedAt: string;
}

export interface SlackCredentials {
  token: string;              // Bot Token (암호화됨)
  tokenType: 'bot' | 'user';
  updatedAt: string;
}

// ============================================
// 2. Integrations (평문 저장)
// ============================================

export interface UserIntegrations {
  github?: GitHubIntegration;
  figma?: FigmaIntegration;
  linear?: LinearIntegration;
  slack?: SlackIntegration;
  // 향후 추가될 서비스들...
}

export interface GitHubIntegration {
  enabled: boolean;
  defaultOrganization?: string;
  defaultVisibility?: 'public' | 'private';
  autoCreateRepo?: boolean;
  autoSync?: boolean;
  syncInterval?: number;        // minutes
}

export interface FigmaIntegration {
  enabled: boolean;
  defaultFileFormat?: 'svg' | 'png' | 'pdf';
  autoExtractTokens?: boolean;  // 자동으로 디자인 토큰 추출
  autoGenerateCode?: boolean;   // 자동으로 컴포넌트 코드 생성
}

export interface LinearIntegration {
  enabled: boolean;
  teamId?: string;
  defaultProjectId?: string;
  autoCreateIssues?: boolean;
  syncLabels?: boolean;
  webhookUrl?: string;
}

export interface SlackIntegration {
  enabled: boolean;
  workspaceId?: string;
  defaultChannel?: string;
  notifyOnJobStart?: boolean;
  notifyOnJobComplete?: boolean;
  notifyOnError?: boolean;
}

// ============================================
// 3. Preferences (평문 저장)
// ============================================

export interface UserPreferences {
  // UI Settings
  theme?: 'light' | 'dark' | 'system';
  language?: string;
  timezone?: string;
  
  // Editor Settings
  editorFontSize?: number;
  editorFontFamily?: string;
  editorTheme?: string;
  editorTabSize?: number;
  editorWordWrap?: boolean;
  
  // Workflow Settings
  defaultAgent?: string;
  defaultTask?: string;
  autoSaveInterval?: number;      // milliseconds
  
  // Notification Settings
  enableNotifications?: boolean;
  notificationSound?: boolean;
  desktopNotifications?: boolean;
  
  // Integration Toggles (간단한 on/off)
  enabledIntegrations?: string[]; // ['github', 'figma', 'linear']
  
  // Advanced
  betaFeatures?: boolean;
  telemetry?: boolean;
  
  // Metadata
  updatedAt?: string;
}

// ============================================
// Service Types
// ============================================

export type ServiceType = 'github' | 'figma' | 'linear' | 'slack';

export const SERVICE_TYPES: ServiceType[] = ['github', 'figma', 'linear', 'slack'];
