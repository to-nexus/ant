# Figma MCP 통합 가이드

## 📋 개요

ANT에 Figma MCP (Model Context Protocol)를 통합하여 디자인 파일을 직접 참조하고 디자인 토큰을 추출하여 코드 생성에 활용합니다.

## 🏗️ 아키텍처

### User-Level 설정

```
workspaces/{org}/{user}/.ant/
├── credentials.json          # Figma MCP Token (암호화)
├── integrations.json         # Figma 통합 설정
└── preferences.json          # UI 설정
```

### Feature-Level 참조

```
workspaces/{org}/{user}/{project}/features/{feature}/
└── inputs/
    └── figma.md             # Figma 디자인 URL 참조
```

## 🔧 구성 방법

### 1. Figma MCP Token 발급

1. [Figma MCP Catalog](https://www.figma.com/ko-kr/mcp-catalog/) 방문
2. "대기자 명단에 등록하기" 클릭
3. Remote MCP Server 액세스 승인 대기
4. Token 발급 받기

### 2. ANT에서 Figma 설정

```bash
POST /api/figma/config
Content-Type: application/json

{
  "token": "figd_...",
  "serverUrl": "https://figma-mcp.figma.com",
  "serverType": "remote",
  "userId": "user123",
  "autoExtractTokens": true,
  "autoGenerateCode": false,
  "defaultFileFormat": "svg"
}
```

**저장되는 파일:**
- `credentials.json`: token (암호화)
- `integrations.json`: serverUrl, serverType, userId, 기타 설정

### 3. Feature에서 Figma 참조

`inputs/figma.md` 파일 생성:

```markdown
# Figma Design Reference

## 프로젝트 정보
- **Figma 파일**: https://www.figma.com/file/ABC123/My-Design
- **프레임**: "Login Screen"
- **업데이트일**: 2025-12-17

## 디자인 참조

### 컴포넌트 리스트
- https://www.figma.com/file/ABC123?node-id=123:456 (Button Component)
- https://www.figma.com/file/ABC123?node-id=123:789 (Input Field)

### 디자인 토큰
- Primary color: #007AFF
- Font: Inter, 16px
- Border radius: 8px
- Spacing: 16px grid

### 구현 노트
- 반응형 디자인 (mobile-first)
- Dark mode 지원
- Accessibility (WCAG 2.1 AA)
```

## 📡 API 사용 예제

### 1. Figma 설정 조회

```bash
GET /api/figma/config
Authorization: Bearer {userToken}
```

**응답:**

```json
{
  "configured": true,
  "enabled": true,
  "serverUrl": "https://figma-mcp.figma.com",
  "serverType": "remote",
  "userId": "user123",
  "autoExtractTokens": true,
  "autoGenerateCode": false,
  "defaultFileFormat": "svg",
  "updatedAt": "2025-12-17T12:00:00.000Z"
}
```

### 2. Figma 파일 조회

```bash
GET /api/figma/files/ABC123
Authorization: Bearer {userToken}
```

**응답:**

```json
{
  "success": true,
  "file": {
    "name": "My Design",
    "lastModified": "2025-12-17T12:00:00.000Z",
    "version": "1.0",
    "document": { ... }
  }
}
```

### 3. 디자인 토큰 추출

```bash
GET /api/figma/files/ABC123/design-tokens
Authorization: Bearer {userToken}
```

**응답:**

```json
{
  "success": true,
  "tokens": {
    "colors": {
      "primary": {
        "value": "#007AFF",
        "type": "solid",
        "description": "Primary brand color"
      },
      "secondary": {
        "value": "#5856D6",
        "type": "solid"
      }
    },
    "typography": {
      "heading-1": {
        "fontFamily": "Inter",
        "fontSize": 32,
        "fontWeight": 700,
        "lineHeight": 40
      },
      "body": {
        "fontFamily": "Inter",
        "fontSize": 16,
        "fontWeight": 400,
        "lineHeight": 24
      }
    },
    "spacing": {
      "small": 8,
      "medium": 16,
      "large": 24,
      "xlarge": 32
    },
    "borderRadius": {
      "small": 4,
      "medium": 8,
      "large": 16
    },
    "shadows": {
      "card": {
        "x": 0,
        "y": 2,
        "blur": 8,
        "color": "rgba(0, 0, 0, 0.1)",
        "type": "drop"
      }
    }
  }
}
```

### 4. Figma URL 파싱

```bash
POST /api/figma/parse-url
Content-Type: application/json

{
  "url": "https://www.figma.com/file/ABC123/My-Design?node-id=123:456"
}
```

**응답:**

```json
{
  "success": true,
  "fileKey": "ABC123",
  "nodeId": "123:456"
}
```

## 🎯 워크플로우

### 1. 디자이너가 Figma에서 디자인 완료

### 2. 개발자가 ANT에서 Feature 생성

```
features/login-screen/
└── inputs/
    └── figma.md
```

### 3. Figma URL을 `figma.md`에 입력

### 4. Architect Agent 실행

Agent가 자동으로:
1. `inputs/figma.md` 파일 감지
2. Figma URL에서 fileKey, nodeId 추출
3. Figma MCP를 통해 디자인 데이터 조회
4. 디자인 토큰 추출 (colors, typography, spacing 등)
5. LLM Prompt에 디자인 컨텍스트 주입
6. 디자인과 일치하는 코드 생성

### 5. 생성된 코드 확인

```css
/* 자동 생성된 CSS Variables */
:root {
  --color-primary: #007AFF;
  --color-secondary: #5856D6;
  --font-family-body: Inter, sans-serif;
  --font-size-h1: 32px;
  --spacing-medium: 16px;
  --border-radius-medium: 8px;
  --shadow-card: 0 2px 8px rgba(0, 0, 0, 0.1);
}
```

```typescript
// 자동 생성된 React Component
export const LoginButton = () => {
  return (
    <button
      style={{
        backgroundColor: 'var(--color-primary)',
        color: 'white',
        padding: 'var(--spacing-medium)',
        borderRadius: 'var(--border-radius-medium)',
        fontFamily: 'var(--font-family-body)',
        fontSize: '16px',
        fontWeight: 600
      }}
    >
      로그인
    </button>
  );
};
```

## 🔐 보안

### Credential 암호화

- Figma MCP Token은 AES-256-GCM으로 암호화
- 파일 권한: 0o600 (owner만 읽기/쓰기)
- 암호화 키: `workspaces/.ant/encryption.key`

### 저장 형식

**credentials.json (암호화):**
```json
{
  "figma": {
    "token": "encrypted:iv:authTag:data",
    "tokenType": "mcp",
    "updatedAt": "2025-12-17T12:00:00.000Z"
  }
}
```

**integrations.json (평문):**
```json
{
  "figma": {
    "enabled": true,
    "serverUrl": "https://figma-mcp.figma.com",
    "serverType": "remote",
    "userId": "user123",
    "autoExtractTokens": true,
    "autoGenerateCode": false,
    "defaultFileFormat": "svg"
  }
}
```

## 🔮 향후 계획

### Phase 1: 기본 인프라 ✅
- [x] FigmaPort 인터페이스
- [x] UserConfigManager 통합
- [x] FigmaMCPAdapter 기본 구현
- [x] API Routes

### Phase 2: UI 구현 (진행 중)
- [ ] FigmaConfigModal
- [ ] FigmaFilePicker
- [ ] FigmaPreview
- [ ] GlobalNavBar 통합

### Phase 3: Agent 통합
- [ ] inputs/figma.md 파서
- [ ] Architect Agent 컨텍스트 주입
- [ ] Code Generation 프롬프트 확장
- [ ] 디자인 토큰 → 코드 자동 변환

### Phase 4: 고급 기능
- [ ] Figma Webhooks (디자인 변경 알림)
- [ ] Dev Mode Code Connect 통합
- [ ] 양방향 동기화 (코드 → Figma)
- [ ] 디자인 시스템 자동 생성

## 💻 코드 사용 예제

### UserConfigManager로 Figma 설정

```typescript
import { UserConfigManager } from './utils/userConfig';

const userConfig = new UserConfigManager(workspaceRoot);
const userContext = { organizationId: 'to.nexus', userId: 'probe' };

// Figma 통합 구성
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
    userId: 'user123',
    autoExtractTokens: true,
    autoGenerateCode: false,
    defaultFileFormat: 'svg'
  }
);

// Figma 상태 확인
const status = await userConfig.getServiceStatus(userContext, 'figma');
console.log(status.configured); // true
console.log(status.settings.serverUrl); // https://figma-mcp.figma.com

// Figma 통합 제거
await userConfig.removeService(userContext, 'figma');
```

### FigmaMCPAdapter 직접 사용

```typescript
import { FigmaMCPAdapter } from './adapters/figma';

const adapter = new FigmaMCPAdapter();

// 연결
await adapter.connect('figd_...', 'https://figma-mcp.figma.com');

// 파일 조회
const file = await adapter.getFile('ABC123');
console.log(file.name);

// 디자인 토큰 추출
const tokens = await adapter.extractDesignTokens('ABC123');
console.log(tokens.colors.primary.value); // #007AFF

// 연결 해제
await adapter.disconnect();
```

## 📚 참고 자료

- [Figma MCP Catalog](https://www.figma.com/ko-kr/mcp-catalog/)
- [Figma REST API](https://www.figma.com/developers/api)
- [Model Context Protocol](https://modelcontextprotocol.io/)
- [User Config System](./USER_CONFIG.md)

## 🤝 기여

Figma 통합 개선 아이디어나 버그 리포트는 GitHub Issues로 제출해주세요.

