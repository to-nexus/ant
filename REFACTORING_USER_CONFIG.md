# User Config 리팩토링 완료

## 📋 개요

User-level 설정 시스템을 완전히 리팩토링하여 credential, integration settings, preferences를 체계적으로 분리하고 통합 관리하도록 개선했습니다.

## ✅ 완료된 작업

### 1. Legacy 코드 완전 제거

**삭제된 파일:**
- ❌ `utils/credentialStore.ts` (deprecated wrapper)
- ❌ `utils/userCredentialStore.ts` (구 credential store)
- ❌ `utils/credentialMigration.ts` (일회성 migration)
- ❌ `utils/userPreferences.ts` (구 preferences store)

### 2. 새로운 User Config 시스템 구축

**새로 생성된 파일:**

```
packages/ant-cli/src/utils/userConfig/
├── types.ts                    # 모든 타입 정의
├── CredentialsStore.ts         # 인증 정보 관리 (암호화)
├── IntegrationsStore.ts        # 통합 설정 관리 (평문)
├── PreferencesStore.ts         # UI 개인 설정 관리 (평문)
├── UserConfigManager.ts        # 통합 Facade
└── index.ts                    # Exports
```

### 3. 파일 구조 개선

**변경 전 (분산됨):**
```
workspaces/{org}/{user}/
├── .github-credentials         # ❌ GitHub only
└── {projects}/
```

**변경 후 (통합):**
```
workspaces/{org}/{user}/.ant/
├── credentials.json            # ✅ 모든 서비스 인증 정보 (암호화)
├── integrations.json           # ✅ 모든 서비스 통합 설정 (평문)
└── preferences.json            # ✅ UI 개인 설정 (평문)
```

### 4. 관심사 분리

| 파일 | 내용 | 암호화 | 권한 |
|------|------|--------|------|
| `credentials.json` | 인증 정보 (token, apiKey) | ✅ AES-256-GCM | 0o600 |
| `integrations.json` | 통합 설정 (URL, 자동화 옵션) | ❌ 평문 | 0o644 |
| `preferences.json` | UI 설정 (테마, 언어) | ❌ 평문 | 0o644 |

### 5. Figma MCP 통합

**새로 구현된 파일:**
- ✅ `core/ports/figma.ts` - Figma 인터페이스 정의
- ✅ `periphery/adapters/figma/FigmaMCPAdapter.ts` - MCP 클라이언트
- ✅ `periphery/adapters/http/routes/figma.routes.ts` - API 엔드포인트

**API 엔드포인트:**
- `POST /api/figma/config` - Figma 통합 구성
- `GET /api/figma/config` - Figma 설정 조회
- `DELETE /api/figma/config` - Figma 통합 제거
- `POST /api/figma/validate` - 연결 테스트
- `GET /api/figma/files/:fileKey` - Figma 파일 조회
- `GET /api/figma/files/:fileKey/design-tokens` - 디자인 토큰 추출
- `POST /api/figma/parse-url` - Figma URL 파싱

### 6. Migration 스크립트

**생성된 파일:**
- ✅ `scripts/migrate-user-config.ts` - 마이그레이션 스크립트

**사용법:**
```bash
# 마이그레이션 실행
npm run migrate:user-config

# 백업 파일 정리
npm run migrate:user-config:cleanup
```

### 7. 문서 정비

**생성된 문서:**
- ✅ `USER_CONFIG.md` - User config 시스템 전체 가이드
- ✅ `FIGMA_INTEGRATION.md` - Figma MCP 통합 가이드

**삭제된 문서:**
- ❌ `USER_LEVEL_SETTINGS.md` (통합됨)

## 🎯 주요 개선사항

### 1. 단일 진입점 (UserConfigManager)

**Before:**
```typescript
// 여러 store를 직접 사용
const credentialStore = new CredentialStore(root);
const preferenceStore = new UserPreferencesStore(root);

await credentialStore.savePAT(userContext, 'ghp_...');
await preferenceStore.updatePreferences(userContext, { theme: 'dark' });
```

**After:**
```typescript
// 통합 manager로 간편하게
const userConfig = new UserConfigManager(root);

// 서비스 전체 구성 (credentials + settings + preferences 한번에)
await userConfig.configureService(
  userContext,
  'github',
  { token: 'ghp_...', tokenType: 'pat' },
  { enabled: true, autoSync: true }
);
```

### 2. 타입 안전성 강화

```typescript
// Credential 타입별로 타입 안전하게 관리
await userConfig.credentials.set<GitHubCredentials>(
  userContext, 
  'github', 
  { token: 'ghp_...', tokenType: 'pat' }
);

await userConfig.credentials.set<FigmaCredentials>(
  userContext,
  'figma',
  { token: 'figd_...', tokenType: 'mcp' }
);
```

### 3. 확장성 개선

**새 서비스 추가 시:**
1. `types.ts`에 interface 추가만 하면 됨
2. 파일 구조 변경 불필요
3. UserConfigManager가 자동으로 처리

```typescript
// types.ts에 추가
export interface LinearCredentials {
  apiKey: string;
  updatedAt: string;
}

export interface LinearIntegration {
  enabled: boolean;
  teamId?: string;
  defaultProjectId?: string;
}

// 바로 사용 가능!
await userConfig.configureService(
  userContext,
  'linear',
  { apiKey: 'lin_...' },
  { enabled: true, teamId: 'team_123' }
);
```

### 4. 보안 강화

- 인증 정보만 선택적으로 암호화
- 통합 설정과 개인 설정은 평문으로 가독성 유지
- 파일 권한 명확히 분리 (0o600 vs 0o644)

## 📊 비교표

| 항목 | Before | After |
|------|--------|-------|
| **파일 개수** | 분산 (서비스당 1개) | 통합 (3개 파일) |
| **암호화** | 전체 파일 암호화 | 인증 정보만 암호화 |
| **확장성** | 새 서비스마다 파일 추가 | 타입만 추가 |
| **타입 안전성** | Weak | Strong (Generic) |
| **관리 복잡도** | 높음 | 낮음 (Facade 패턴) |
| **가독성** | 낮음 (모두 암호화) | 높음 (설정은 평문) |

## 🔄 Migration 가이드

### 자동 마이그레이션

```bash
# 1. 마이그레이션 실행
npm run migrate:user-config

# 출력 예시:
# 🚀 Starting user config migration...
# Found 1 organizations
# Organization: to.nexus (1 users)
#   ✅ to.nexus/probe - Migrated
# 📊 Migration Summary:
#   Migrated: 1
#   Skipped: 0
#   Errors: 0

# 2. 확인
ls -la workspaces/to.nexus/probe/.ant/
# credentials.json (암호화됨)
# integrations.json
# preferences.json

# 3. 백업 파일 정리
npm run migrate:user-config:cleanup
```

### 수동 확인

```typescript
import { UserConfigManager } from './utils/userConfig';

const userConfig = new UserConfigManager(workspaceRoot);
const userContext = { organizationId: 'to.nexus', userId: 'probe' };

// GitHub credential 확인
const githubCred = await userConfig.credentials.get('github');
console.log(githubCred?.token); // 기존 PAT (decrypted)

// 서비스 목록 확인
const services = await userConfig.listConfiguredServices(userContext);
console.log(services); // ['github']
```

## 🔮 다음 단계

### Phase 1: Backend 완료 ✅
- [x] UserConfigManager
- [x] CredentialsStore
- [x] IntegrationsStore
- [x] PreferencesStore
- [x] Figma MCP Adapter
- [x] Figma API Routes
- [x] Migration 스크립트

### Phase 2: Frontend 구현 (다음)
- [ ] User Config UI 컴포넌트
- [ ] Figma Config Modal
- [ ] Figma File Picker
- [ ] Figma Preview
- [ ] GlobalNavBar 통합

### Phase 3: Agent 통합
- [ ] inputs/figma.md 파서
- [ ] Architect Agent Figma 컨텍스트 주입
- [ ] Code Generation with Design Tokens

### Phase 4: 추가 통합
- [ ] Linear 통합
- [ ] Slack 통합
- [ ] OAuth 2.0 지원
- [ ] Credential 자동 갱신

## 📚 참고 문서

- [USER_CONFIG.md](./USER_CONFIG.md) - User config 시스템 전체 가이드
- [FIGMA_INTEGRATION.md](./FIGMA_INTEGRATION.md) - Figma MCP 통합 가이드
- [API Documentation](./docs/api/HTTP_API.md)

## 💡 핵심 개념

### 1. User Config = Credentials + Integrations + Preferences

```
User Config
├── Credentials (암호화)
│   ├── github.token
│   ├── figma.token
│   └── linear.apiKey
├── Integrations (평문)
│   ├── github.{enabled, autoSync, ...}
│   ├── figma.{enabled, serverUrl, ...}
│   └── linear.{enabled, teamId, ...}
└── Preferences (평문)
    ├── theme
    ├── language
    └── editorSettings
```

### 2. Facade Pattern으로 통합 관리

```
UserConfigManager (Facade)
├── credentials: CredentialsStore
├── integrations: IntegrationsStore
└── preferences: PreferencesStore

// 한 줄로 서비스 전체 구성
await userConfig.configureService('figma', creds, settings);
```

### 3. 타입 안전성 with Generics

```typescript
// 각 서비스별로 타입 안전하게
await userConfig.credentials.set<GitHubCredentials>(...);
await userConfig.credentials.set<FigmaCredentials>(...);
await userConfig.integrations.set<FigmaIntegration>(...);
```

## 🎉 완료!

User-level 설정 시스템이 완전히 리팩토링되었습니다. 이제 Figma MCP 통합을 포함하여 모든 서비스 통합을 체계적으로 관리할 수 있습니다.

