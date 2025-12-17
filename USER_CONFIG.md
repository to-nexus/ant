# User-Level 설정 시스템

## 📋 개요

ANT의 User-level 설정을 3개의 JSON 파일로 체계적으로 관리합니다.

## 🏗️ 디렉토리 구조

```
workspaces/
├── .ant/
│   └── encryption.key                      # 전역 암호화 키
│
└── {org}/                                  # Organization (e.g., "to.nexus")
    └── {user}/                             # User (e.g., "probe")
        ├── .ant/                           # ✅ User-level 설정
        │   ├── credentials.json            # 🔐 인증 정보 (암호화)
        │   ├── integrations.json           # 🔧 통합 설정 (평문)
        │   └── preferences.json            # 🎨 UI 개인 설정 (평문)
        │
        └── {project}/                      # Project (e.g., "my-app")
            ├── project-config.json         # 📋 Project 설정
            └── features/
                └── {feature}/
                    ├── inputs/
                    │   └── figma.md        # Figma 참조
                    ├── outputs/
                    └── sessions/
```

## 📄 파일 상세

### 1. credentials.json (🔐 암호화)

모든 서비스의 인증 정보를 암호화하여 저장합니다.

**파일 권한**: 0o600 (owner만 읽기/쓰기)
**암호화**: AES-256-GCM

```json
{
  "github": {
    "token": "encrypted:data",
    "tokenType": "pat",
    "updatedAt": "2025-12-17T12:00:00.000Z"
  },
  "figma": {
    "token": "encrypted:data",
    "tokenType": "mcp",
    "updatedAt": "2025-12-17T12:00:00.000Z"
  },
  "linear": {
    "apiKey": "encrypted:data",
    "updatedAt": "2025-12-17T12:00:00.000Z"
  },
  "slack": {
    "token": "encrypted:data",
    "tokenType": "bot",
    "updatedAt": "2025-12-17T12:00:00.000Z"
  }
}
```

**지원하는 서비스:**
- `github` - GitHub Personal Access Token
- `figma` - Figma MCP Token 또는 Personal Access Token
- `linear` - Linear API Key (향후)
- `slack` - Slack Bot Token (향후)

### 2. integrations.json (🔧 평문)

각 서비스의 통합 설정을 저장합니다. 인증 정보를 제외한 모든 설정값들입니다.

**파일 권한**: 0o644 (owner 읽기/쓰기, 타인 읽기)

```json
{
  "github": {
    "enabled": true,
    "defaultOrganization": "to-nexus",
    "defaultVisibility": "private",
    "autoCreateRepo": false,
    "autoSync": false,
    "syncInterval": 5
  },
  "figma": {
    "enabled": true,
    "serverUrl": "https://figma-mcp.figma.com",
    "serverType": "remote",
    "userId": "user123",
    "defaultFileFormat": "svg",
    "autoExtractTokens": true,
    "autoGenerateCode": false
  },
  "linear": {
    "enabled": false,
    "teamId": "team_abc",
    "defaultProjectId": "proj_123",
    "autoCreateIssues": false,
    "syncLabels": false,
    "webhookUrl": "https://..."
  },
  "slack": {
    "enabled": false,
    "workspaceId": "T1234567890",
    "defaultChannel": "#dev",
    "notifyOnJobStart": false,
    "notifyOnJobComplete": true,
    "notifyOnError": true
  }
}
```

### 3. preferences.json (🎨 평문)

사용자의 UI 개인 설정을 저장합니다.

**파일 권한**: 0o644 (owner 읽기/쓰기, 타인 읽기)

```json
{
  "theme": "dark",
  "language": "ko",
  "timezone": "Asia/Seoul",
  "editorFontSize": 14,
  "editorFontFamily": "Monaco, Menlo, 'Courier New', monospace",
  "editorTheme": "vs-dark",
  "editorTabSize": 2,
  "editorWordWrap": true,
  "defaultAgent": "architect",
  "defaultTask": "code",
  "autoSaveInterval": 5000,
  "enableNotifications": true,
  "notificationSound": false,
  "desktopNotifications": false,
  "enabledIntegrations": ["github", "figma"],
  "betaFeatures": false,
  "telemetry": true,
  "updatedAt": "2025-12-17T12:00:00.000Z"
}
```

## 💻 API 사용법

### UserConfigManager (통합 관리)

```typescript
import { UserConfigManager } from './utils/userConfig';

const userConfig = new UserConfigManager(workspaceRoot);
const userContext = { organizationId: 'to.nexus', userId: 'probe' };

// ✅ 서비스 통합 구성 (credentials + integrations + preferences 한번에)
await userConfig.configureService(
  userContext,
  'figma',
  {
    // Credentials
    token: 'figd_...',
    tokenType: 'mcp'
  },
  {
    // Integration Settings
    enabled: true,
    serverUrl: 'https://figma-mcp.figma.com',
    serverType: 'remote',
    autoExtractTokens: true
  }
);

// ✅ 서비스 상태 확인
const status = await userConfig.getServiceStatus(userContext, 'figma');
console.log(status);
// {
//   configured: true,
//   hasCredentials: true,
//   enabled: true,
//   settings: { ... }
// }

// ✅ 서비스 완전 제거
await userConfig.removeService(userContext, 'figma');

// ✅ 설정된 모든 서비스 목록
const services = await userConfig.listConfiguredServices(userContext);
console.log(services); // ['github', 'figma']

// ✅ 전체 설정 조회
const all = await userConfig.getAll(userContext);
console.log(all.credentials.github);
console.log(all.integrations.figma);
console.log(all.preferences.theme);

// ✅ 전체 초기화
await userConfig.resetAll(userContext);
```

### CredentialsStore (직접 접근)

```typescript
import { CredentialsStore, GitHubCredentials, FigmaCredentials } from './utils/userConfig';

const credStore = new CredentialsStore(workspaceRoot);

// GitHub Credential 저장
await credStore.set<GitHubCredentials>(userContext, 'github', {
  token: 'ghp_...',
  tokenType: 'pat'
});

// Figma Credential 조회
const figmaCred = await credStore.get<FigmaCredentials>(userContext, 'figma');
console.log(figmaCred?.token); // Decrypted token

// Credential 존재 확인
const hasGitHub = await credStore.has(userContext, 'github');

// Credential 삭제
await credStore.delete(userContext, 'github');

// 모든 Credential 조회
const all = await credStore.getAll(userContext);

// 설정된 서비스 목록
const services = await credStore.list(userContext); // ['github', 'figma']
```

### IntegrationsStore (직접 접근)

```typescript
import { IntegrationsStore, FigmaIntegration } from './utils/userConfig';

const integStore = new IntegrationsStore(workspaceRoot);

// Figma Integration 설정
await integStore.set<FigmaIntegration>(userContext, 'figma', {
  enabled: true,
  serverUrl: 'https://figma-mcp.figma.com',
  serverType: 'remote',
  autoExtractTokens: true
});

// Figma Integration 조회
const figmaInteg = await integStore.get<FigmaIntegration>(userContext, 'figma');
console.log(figmaInteg.serverUrl);

// 특정 서비스 활성화/비활성화
await integStore.setEnabled(userContext, 'figma', false);

// 활성화 상태 확인
const isEnabled = await integStore.isEnabled(userContext, 'figma');

// 모든 Integration 초기화
await integStore.reset(userContext);
```

### PreferencesStore (직접 접근)

```typescript
import { PreferencesStore } from './utils/userConfig';

const prefStore = new PreferencesStore(workspaceRoot);

// Preferences 조회 (기본값 포함)
const prefs = await prefStore.get(userContext);
console.log(prefs.theme); // 'system' (default)

// Preferences 업데이트 (부분 업데이트)
await prefStore.update(userContext, {
  theme: 'dark',
  language: 'ko',
  editorFontSize: 16
});

// Preferences 초기화
await prefStore.reset(userContext);
```

## 🔐 보안

### 암호화 키 관리

```bash
# 1. 자동 생성 (첫 실행 시)
# → workspaces/.ant/encryption.key 자동 생성 (0o600)

# 2. 환경 변수로 오버라이드
export ANT_ENCRYPTION_KEY=$(cat workspaces/.ant/encryption.key)

# 3. 키 재생성 (모든 credential 재입력 필요)
rm workspaces/.ant/encryption.key
# 다음 실행 시 자동 생성
```

### 파일 권한

```bash
# credentials.json: owner만 읽기/쓰기
-rw-------  1 probe  staff  credentials.json

# integrations.json, preferences.json: owner 읽기/쓰기, 타인 읽기
-rw-r--r--  1 probe  staff  integrations.json
-rw-r--r--  1 probe  staff  preferences.json

# encryption.key: owner만 읽기/쓰기
-rw-------  1 probe  staff  encryption.key
```

## 🔄 Migration

### 기존 구조에서 마이그레이션

```bash
# 마이그레이션 실행
npm run migrate:user-config

# 또는 직접 실행
ts-node scripts/migrate-user-config.ts

# 마이그레이션 확인 후 백업 파일 정리
npm run migrate:user-config:cleanup
```

**Migration 과정:**
1. `.github-credentials` → `.ant/credentials.json` (GitHub credential)
2. 기존 파일은 `.github-credentials.bak`으로 백업
3. 확인 후 백업 파일 삭제

## 🎯 설정 레벨 분리

| 레벨 | 경로 | 내용 | 공유 범위 |
|------|------|------|----------|
| **Global** | `workspaces/.ant/` | 암호화 키 | 모든 org/user |
| **User** | `{org}/{user}/.ant/` | Credentials, Integrations, Preferences | 해당 user의 모든 프로젝트 |
| **Project** | `{org}/{user}/{project}/` | Project config | 해당 프로젝트만 |
| **Feature** | `{project}/features/{feature}/` | Feature inputs | 해당 feature만 |

## 📊 장점

### 1. 명확한 관심사 분리
- **credentials.json**: 인증 정보만 (암호화 필요)
- **integrations.json**: 통합 설정만 (평문 가능)
- **preferences.json**: UI 설정만 (평문 가능)

### 2. 확장성
- 새 서비스 추가 시 `types.ts`에 interface만 추가
- 파일 구조 변경 없음

### 3. 보안
- 인증 정보만 선택적으로 암호화
- 통합 설정과 개인 설정은 평문으로 가독성 유지

### 4. 유지보수성
- `UserConfigManager`로 통합 관리
- 개별 Store로 직접 접근도 가능

## 🔮 향후 계획

### Phase 1: Core ✅
- [x] UserConfigManager
- [x] CredentialsStore
- [x] IntegrationsStore
- [x] PreferencesStore
- [x] Migration 스크립트

### Phase 2: Integration
- [ ] Figma 통합 완료
- [ ] UI 컴포넌트 구현
- [ ] API Routes 연결

### Phase 3: Expansion
- [ ] Linear 통합
- [ ] Slack 통합
- [ ] OAuth 2.0 지원
- [ ] Credential 자동 갱신

## 📚 관련 문서

- [Figma Integration](./FIGMA_INTEGRATION.md)
- [API Documentation](./docs/api/HTTP_API.md)

## 🤝 기여

User config 시스템 개선 아이디어는 GitHub Issues로 제출해주세요.

