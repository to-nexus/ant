# DevServerService Module

**개발서버 관리 서비스 - 모듈화된 구조**

## 📂 디렉토리 구조

```
DevServerService/
├── DevServerService.ts          # Main service (orchestrator)
├── index.ts                      # Public exports
├── types.ts                      # Type definitions
├── utils/
│   └── serverKeyUtils.ts        # Server key utilities
├── detectors/
│   └── PackageDetector.ts       # Package & framework detection
├── validators/
│   ├── ProjectValidator.ts      # Project validation orchestrator
│   ├── ReactValidator.ts        # React basename validation
│   └── VueValidator.ts          # Vue Router validation
└── managers/
    └── LogManager.ts            # Log storage & retrieval
```

## 🎯 책임 분리 (Separation of Concerns)

### **DevServerService.ts** (Main Orchestrator - ~800 lines)
- 개발서버 라이프사이클 관리
- 프로세스 관리 (spawn, kill, health check)
- 프로젝트 구조 감지 (fullstack, monorepo)
- 의존성 설치
- SSE 통합

### **PackageDetector** (~100 lines)
- `isFrontendPackage()`: Frontend 프로젝트 감지
- `isBackendPackage()`: Backend 프로젝트 감지
- `detectFrameworkType()`: React/Vue/Next 등 프레임워크 감지

### **ProjectValidator** (~70 lines)
- Frontend 프로젝트의 basename 설정 검증
- Framework별 validator로 위임

### **ReactValidator** (~100 lines)
- React Router의 `<BrowserRouter basename>` 검증
- `window.__BASENAME__` 타입 선언 검증
- 누락 시 상세한 수정 가이드 제공

### **VueValidator** (~70 lines)
- Vue Router의 `createWebHistory` basename 검증
- 누락 시 상세한 수정 가이드 제공

### **LogManager** (~50 lines)
- 로그 저장 (최대 1000줄, FIFO)
- 로그 조회
- 로그 정리

### **serverKeyUtils** (~20 lines)
- `createServerKey()`: tenantId:userId:projectId:feature 형식 생성
- `parseServerKey()`: 서버 키 파싱

## 🔄 리팩토링 전후 비교

### Before (1개 파일)
```
DevServerService.ts  (1,075 lines)
```

### After (8개 파일)
```
DevServerService.ts       (~800 lines)  ✅ 25% 감소
+ 7 module files          (~410 lines)
────────────────────────────────────
Total:                    (~1,210 lines)
```

**추가된 라인은 명확한 책임 분리와 재사용성을 위한 투자입니다.**

## 🚀 사용 예제

```typescript
// Before (모든 로직이 DevServerService에)
const service = new DevServerService(portManager, portRegistry, callbacks, sseService);
const isValid = await service.validateDevServerSetup(codebasePath);

// After (동일한 API, 내부는 모듈화)
const service = new DevServerService(portManager, portRegistry, callbacks, sseService);
const isValid = await service.validateDevServerSetup(codebasePath);  // ProjectValidator로 위임

// 개별 모듈 직접 사용 가능
import { PackageDetector, ProjectValidator, LogManager } from './DevServerService';

const detector = new PackageDetector();
if (detector.isFrontendPackage(packageJson)) {
  const framework = detector.detectFrameworkType(packageJson);
  // ...
}
```

## ✅ 이점

1. **가독성**: 각 파일이 단일 책임 (SRP)
2. **테스트 용이성**: 각 모듈을 독립적으로 테스트 가능
3. **재사용성**: `PackageDetector`, `LogManager` 등을 다른 서비스에서도 사용 가능
4. **유지보수성**: 특정 기능 수정 시 해당 파일만 수정
5. **확장성**: 새로운 프레임워크 validator 추가가 쉬움 (e.g., `SvelteValidator`)

## 📝 향후 개선 계획

- [ ] `ProcessManager` 분리 (spawn, health check, 프로세스 관리)
- [ ] `ProjectStructureDetector` 분리 (monorepo, fullstack 감지)
- [ ] `DependencyInstaller` 분리 (npm/pnpm/yarn 설치)
- [ ] Unit tests for each module
- [ ] `SvelteValidator`, `AngularValidator` 추가

## 🔗 관련 문서

- [Dev Server Management Architecture](../../../../../docs/architecture/02-dev-server-management.md)
- [Dev Server Setup Guide](../../core/prompt/templates/code/base/injections/dev-server-setup.md)

