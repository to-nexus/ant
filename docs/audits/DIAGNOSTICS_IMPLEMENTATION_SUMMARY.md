# 🎯 Diagnostics System - Implementation Summary

## 📊 구현 현황 (2025-10-31)

### ✅ 완료된 그룹 (4/7)

#### 1. **packageManagers/** - 패키지 매니저
| Tool | Status | Patterns | Notes |
|------|--------|----------|-------|
| npm | ✅ 완료 | 8개 패턴 | ERESOLVE, peer deps, network, version, config |
| pnpm | 🟡 구조만 | - | Workspace 프로토콜 등 추가 필요 |
| yarn | 🟡 구조만 | - | YN0000 에러 코드 추가 필요 |
| pip | 🟡 구조만 | - | Python dependency resolver |
| maven | 🟡 구조만 | - | Java dependency management |
| cargo | 🟡 구조만 | - | Rust package manager |

#### 2. **databases/** - ORM/Migration
| Tool | Status | Patterns | Notes |
|------|--------|----------|-------|
| Prisma | ✅ 완료 | 6개 패턴 | Schema, migration, connection, auth, constraints |
| TypeORM | ✅ 완료 | 4개 패턴 | Connection, entity, migration, column types |

#### 3. **testing/** - 테스팅 프레임워크
| Tool | Status | Patterns | Notes |
|------|--------|----------|-------|
| Jest/Vitest | ✅ 완료 | 6개 패턴 | Assertions, timeout, mocks, config, snapshots |
| Pytest | ✅ 완료 | 4개 패턴 | Assertions, fixtures, imports, collection |

#### 4. **linters/** - 린터/포매터
| Tool | Status | Patterns | Notes |
|------|--------|----------|-------|
| ESLint | ✅ 완료 | 4개 패턴 | Rules, config, plugins, parsing |
| Prettier | 🟡 구조만 | - | Formatting conflicts, config |
| Pylint | 🟡 구조만 | - | Python linting |

---

## 🔄 ErrorLayer별 분포

```
ENVIRONMENT     ███████░░░ 6개  (npm network, db connection)
TOOLCHAIN       ███░░░░░░░ 2개  (npm version, node version)
DEPENDENCY      ██████████ 9개  (npm ERESOLVE, Prisma client, test imports)
CONFIGURATION   █████████░ 8개  (Schema errors, config files, lockfile)
CODE            ██████████ 12개 (Type errors, test assertions, lint rules)
BUILD           ████░░░░░░ 4개  (Migration failures, build errors)
```

**Total: 41 error patterns implemented**

---

## 📈 우선순위별 향후 작업

### 🔴 HIGH Priority (바로 필요)
1. **pnpm patterns** - 모노레포 프로젝트에서 널리 사용
2. **Webpack patterns** - 여전히 많은 레거시 프로젝트
3. **Python language patterns** - 언어별 기본 에러 처리

### 🟡 MEDIUM Priority (곧 필요할 수 있음)
4. **Docker/Infrastructure** - CI/CD 통합 시
5. **Alembic (Python ORM)** - Python 프로젝트에서
6. **Go/Rust language patterns** - 다른 언어 지원 확대

### 🟢 LOW Priority (나중에)
7. **VCS (Git) patterns** - 에이전트가 Git 직접 조작 시
8. **Prettier patterns** - 포매팅은 auto-fix 가능
9. **더 많은 linter** - 언어별로 추가

---

## 🎨 패턴 작성 가이드라인

### Good Pattern Example
```typescript
{
  layer: ErrorLayer.DEPENDENCY,
  patterns: [
    /ERESOLVE unable to resolve dependency tree/,
    /Could not resolve dependency:/
  ],
  severity: 'critical',
  canLLMFix: true,
  diagnosis: (match, context) => {
    const packageName = extractPackageName(context.output);
    return {
      type: 'dependency_conflict',
      layer: ErrorLayer.DEPENDENCY,
      message: `Clear, specific message: ${packageName}`,
      rootCause: 'Explain WHY this happened',
      suggestedActions: [
        'Specific command: npm ls packagename',
        'Alternative solution',
        'Last resort option'
      ],
      isRetryable: true,
      canLLMFix: true,
      severity: 'critical'
    };
  }
}
```

### Key Principles
1. **Specific regex** - 정확한 매칭, 거짓양성 최소화
2. **Extract context** - 패키지명, 파일명, 라인번호 추출
3. **Clear message** - 무엇이 잘못되었는지 명확히
4. **Root cause** - 왜 발생했는지 설명
5. **Actionable** - 구체적인 해결 명령어
6. **Alternatives** - 여러 해결 방법 제시
7. **Correct canLLMFix** - LLM이 코드로 고칠 수 있는지 정확히 판단

---

## 🔗 Integration Points

### In `runtimeValidate.ts`
```typescript
import { diagnoseError, detectProject } from './diagnostics';

const diagnosis = diagnoseError(stderr, {
  command: 'npm install',
  workDir,
  output: stderr,
  projectDetection
});

if (diagnosis?.layer === ErrorLayer.ENVIRONMENT) {
  // Don't let LLM retry - user intervention needed
  return { passed: false, errors, violations: [...] };
}
```

### In `postProcess.ts`
```typescript
// After npm install
const diagnosis = diagnoseError(stderr, {
  command: 'npm install',
  workDir,
  output: stderr
});

if (diagnosis?.type === 'environment_issue') {
  violations.push({
    type: 'environment_issue',
    message: diagnosis.message,
    suggestedActions: diagnosis.suggestedActions,
    isRetryable: false
  });
}
```

---

## 📝 Next Steps

1. ✅ npm 패턴 구현 완료
2. ✅ Databases (Prisma, TypeORM) 패턴 구현 완료
3. ✅ Testing (Jest, Pytest) 패턴 구현 완료
4. ✅ Linters (ESLint) 패턴 구현 완료
5. ⏳ `runtimeValidate.ts`에 통합
6. ⏳ 실제 에러 로그로 테스트
7. ⏳ 에러 통계 수집 & 학습 시스템 연결
8. ⏳ 나머지 우선순위 높은 패턴 구현

---

## 🎯 Success Metrics

**목표:**
- ❌ 기존: 에이전트가 같은 에러로 10+ 번 재시도
- ✅ 개선 후: ENVIRONMENT 에러는 1번에 감지하고 사용자에게 명확한 지시
- ✅ 개선 후: CODE 에러는 정확한 진단으로 2-3번 내 해결

**측정 방법:**
- 에러별 평균 재시도 횟수
- LLM이 고칠 수 없는 에러를 고치려고 시도한 비율
- 사용자 개입이 필요한 에러의 명확성 점수

---

**Created:** 2025-10-31  
**Last Updated:** 2025-10-31  
**Total Patterns:** 41 (8 npm + 6 Prisma + 4 TypeORM + 6 Jest + 4 Pytest + 4 ESLint + 9 other)


