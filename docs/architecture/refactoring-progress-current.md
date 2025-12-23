# 리팩토링 진행 상황 (중간 보고)

## ✅ 완료된 작업 (7/12)

1. ✅ Design graph state에 workspaceResolver 추가
2. ✅ LocalWorkspaceResolver 생성자 파라미터 수정 (optional workspacesPath)
3. ✅ architectAgent에 fileSystem 파라미터 추가 및 전달
4. ✅ context/loader.ts fileSystem 전역변수 → 파라미터로 수정
5. ✅ diagnostics 노드 fileSystem 파라미터 추가
6. ✅ plan 노드 gitPort.readFile → fileSystem.readFile 수정
7. ✅ design 노드 gitPort 메서드 → fileSystem 메서드 수정
8. ✅ FileSystemPort export 추가 (core/ports/index.ts)
9. ✅ runtimeValidate fileSystem 중복 선언 제거
10. ✅ validate.ts fileSystem 추가

## 🚧 진행 중 (5/12)

### 현재 빌드 에러: 117개 (초기 152개에서 35개 감소)

### 남은 주요 작업

#### 1. Helper 함수들에 fileSystem 파라미터 추가 필요
이 함수들은 state 접근이 없어서 fileSystem을 파라미터로 받아야 함:

- `qualityReport.ts`:
  - `loadRequirements()` - gitPort만 받음, fileSystem 추가 필요
  - `saveReport()` - gitPort만 받음, fileSystem 추가 필요
  - `checkQualityThresholds()` - gitPort만 받음, fileSystem 추가 필요
  
- `design/resolve.ts`: fileSystem 전역 변수 사용 (state 없음)
- `learn/resolve.ts`: fileSystem 전역 변수 사용 (state 없음)
- `filePathResolver.ts`: gitPort.fileExists() 사용

#### 2. FileRenderer에 fileSystem 프로퍼티 추가
- `FileRenderer` 클래스에 fileSystem 멤버 변수 추가
- 생성자에서 받아서 저장
- 사용처에서 this.fileSystem으로 접근

#### 3. ArtifactService fileSystem 수정
- 전역 fileSystem 사용 → 인스턴스 변수로 변경

#### 4. 기타 undefined 체크
- `installDeps.ts`: fileSystem! 또는 체크 추가
- `resolve.ts` (code): fileSystem! 또는 체크 추가
- 기타 'possibly undefined' 에러들

## 📋 수정 전략

### 단계 1: Helper 함수 시그니처 수정
모든 helper 함수에 fileSystem 파라미터 추가:
```typescript
async function loadRequirements(
  project: string, 
  featureFolder: string,
  featurePath: string, 
  gitPort: GitPort,
  fileSystem: FileSystemPort  // ✅ 추가
): Promise<...> {
  // fileSystem 사용
}
```

### 단계 2: 호출처 수정
Helper 함수를 호출하는 곳에서 fileSystem 전달:
```typescript
const fileSystem = state.deps?.fileSystem;
if (!fileSystem) throw new Error(...);

const report = await loadRequirements(project, feature, path, gitPort, fileSystem);
```

### 단계 3: 클래스 멤버 변수 추가
FileRenderer, ArtifactService 등:
```typescript
class FileRenderer {
  private fileSystem: FileSystemPort;
  
  constructor(..., fileSystem: FileSystemPort) {
    this.fileSystem = fileSystem;
  }
}
```

## 🎯 예상 완료 시간

- 단계 1-3: 약 30-40분 (helper 함수 20개+ 수정)
- 빌드 확인 및 수정: 10-15분
- 최종 테스트: 5-10분

**총 예상 시간**: 45-65분

## 💡 개선 방안 (다음 단계)

현재 패턴의 문제점:
- fileSystem을 모든 함수에 파라미터로 전달하는 것이 번거로움
- state.deps?.fileSystem 체크가 반복됨

향후 개선:
1. Context 객체 도입: `{ gitPort, fileSystem, ... }` 하나의 객체로 전달
2. DI Container 사용: 의존성 자동 주입
3. Facade 패턴: 여러 포트를 하나로 wrapping

하지만 지금은 완벽한 동작이 우선이므로 현재 방식 유지!

