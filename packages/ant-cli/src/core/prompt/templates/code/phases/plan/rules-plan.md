## Your Task

Generate a **concrete implementation plan** for this task.

────────────────────────────────────────────────────────────────────────────────
## 🎯 Plan과 CodeGen의 책임 분리
────────────────────────────────────────────────────────────────────────────────

Plan과 CodeGen은 서로 다른 종류의 결정을 담당합니다.

### 📋 Plan이 결정하는 것 (구조적 결정 - CodeGen이 반드시 따름)

| 결정 영역 | 예시 | 왜 Plan이 결정? |
|----------|------|----------------|
| **파일 경로/이름** | `components/Hero.tsx` | 중복 방지, 일관성 |
| **통합 지점** | "page.tsx에서 import" | 전체 구조 파악 필요 |
| **교체 대상** | "lines 15-45 교체" | 기존 코드 분석 필요 |
| **컴포넌트 분리** | "Hero와 About 분리" | 아키텍처 결정 |
| **에셋 복사 경로** | "public/images/로 복사" | 프로젝트 구조 일관성 |

### 🔧 CodeGen이 스스로 판단하는 것 (구현적 결정)

| 결정 영역 | 예시 | 왜 CodeGen이 결정? |
|----------|------|-------------------|
| **변수/함수명** | `handleClick`, `isLoading` | 구현 맥락에서 결정 |
| **타입 정의** | `interface HeroProps {}` | 실제 코드 작성 시 결정 |
| **CSS/스타일링** | Tailwind 클래스 선택 | UI 구현 세부사항 |
| **에러 핸들링** | try-catch 범위 | 런타임 맥락 필요 |
| **최적화** | useMemo, useCallback | 성능 맥락 필요 |
| **import 문 형식** | 상대경로 vs 절대경로 | 기존 코드 패턴 따름 |

### ⚠️ 경계 상황: Plan이 힌트를 주되 CodeGen이 최종 결정

| 상황 | Plan이 할 일 | CodeGen이 할 일 |
|------|-------------|----------------|
| **상태 관리 필요 여부** | "상태 관리 필요할 수 있음" 힌트 | useState/useReducer 선택 |
| **추가 유틸 필요** | "헬퍼 함수 필요할 수 있음" 힌트 | 같은 파일 내 정의 또는 별도 파일 |
| **Plan에 없는 파일 필요** | - | 생성하되 명시적으로 보고 |

────────────────────────────────────────────────────────────────────────────────

### What to Include:

1. **API Integration** (if applicable):
   - EXACT endpoint paths from API Contract (copy verbatim)
   - EXACT request/response types
   - Example: "Call `POST /rooms/create` with `CreateRoomRequest { name, maxPlayers }`"

2. **Dependencies** (if new ones needed):
   - Library names and purpose

3. **Implementation Approach**:
   - Key components/functions
   - Data flow

### Rules:

- ✅ Copy API Contract specifications EXACTLY (endpoints, field names, types)
- ✅ Be specific and concrete
- ✅ Reference existing code when modifying
- ✅ Follow existing directory structure (no duplicates)
- ❌ DO NOT simplify endpoint paths (`/rooms/create` → `/rooms`)
- ❌ DO NOT rename fields for "consistency"
- ❌ DO NOT apply "best practices" that differ from spec

────────────────────────────────────────────────────────────────────────────────
## 📋 MANDATORY OUTPUT: FILES CONTRACT
────────────────────────────────────────────────────────────────────────────────

**EVERY plan MUST end with a structured FILES CONTRACT section.**

This section is PARSED by the system and passed to CodeGen as binding instructions.

```
═══════════════════════════════════════════════════════════════════════════════
## FILES CONTRACT
═══════════════════════════════════════════════════════════════════════════════

### CREATE FILES:
┌─────────────────────────────────────────────────────────────────────────────┐
│ 1. path: components/sections/Hero.tsx                                        │
│    purpose: Hero section with background image and CTA                       │
│    integrates_in: app/page.tsx                                               │
│    replaces: "hardcoded hero section (lines 15-45)" OR "nothing"            │
├─────────────────────────────────────────────────────────────────────────────┤
│ 2. path: components/sections/About.tsx                                       │
│    purpose: About section with feature cards                                 │
│    integrates_in: app/page.tsx                                               │
│    replaces: "hardcoded about section (lines 47-80)" OR "nothing"           │
└─────────────────────────────────────────────────────────────────────────────┘

### MODIFY FILES:
┌─────────────────────────────────────────────────────────────────────────────┐
│ 1. path: app/page.tsx                                                        │
│    action: Import and use new components                                     │
│    changes:                                                                  │
│      - Add: import Hero from './components/sections/Hero'                   │
│      - Add: import About from './components/sections/About'                 │
│      - Replace lines 15-45 with: <Hero />                                   │
│      - Replace lines 47-80 with: <About />                                  │
└─────────────────────────────────────────────────────────────────────────────┘

### ASSET OPERATIONS (if any):
┌─────────────────────────────────────────────────────────────────────────────┐
│ 1. cp features/.../hero-bg.png → public/images/hero-bg.png                  │
│ 2. cp features/.../logo.svg → public/logos/logo.svg                         │
└─────────────────────────────────────────────────────────────────────────────┘

═══════════════════════════════════════════════════════════════════════════════
```

**CONTRACT RULES (CodeGen이 따를 것):**
- ✅ 명시된 파일은 정확히 그 경로/이름으로 생성
- ✅ 명시된 통합 단계는 반드시 수행
- ✅ 명시된 교체 대상은 반드시 교체
- ❌ 다른 이름의 파일로 대체 금지 (Hero.tsx → HeroSection.tsx)

**CodeGen 자율 영역 (Plan이 간섭하지 않음):**
- 구현 세부사항 (변수명, 타입, 로직)
- 스타일링 세부사항 (CSS 클래스, 반응형 처리)
- Plan에 명시되지 않은 보조 작업 (헬퍼 함수, 타입 파일 등) - 필요시 생성 가능

────────────────────────────────────────────────────────────────────────────────

### Output Format:

{{#if hasUiDoc}}
**FOR UI TASKS - Your plan MUST include these sections IN ORDER:**

#### 1. 📂 CODEBASE STRUCTURE ANALYSIS

**FIRST**, analyze the existing codebase structure to maintain consistency:

```
## Codebase Structure Analysis

Existing files found:
- [List key existing component files and their paths]

Pattern detected:
- Components location: `components/` or `app/components/` or `src/components/`
- Sections location: `components/sections/` or `app/sections/`

**DECISION**: New files for this task will follow [specify the exact pattern]
```

**CRITICAL**: 
- Check `projectCodeContext` to see existing file locations
- DO NOT create duplicate directory structures
- Follow the existing pattern for similar files

#### 2. 📦 ASSET INVENTORY
- Search ui-assets.json for assets related to this section/component
- List ALL assets with exact paths: `asset-id: source → destination`
- Count total: `Total: N assets`
- If none found: "✓ No assets in ui-assets.json for this section"

#### 3. 📐 LAYOUT & COMPONENT SPECS
- Extract layout structure from ui-spec.json (grid/flex, responsive breakpoints)
- List each component with visual properties, typography, interactive states
- Note design token references

#### 4. 📋 FILES CONTRACT (MANDATORY)

**This is the BINDING CONTRACT for CodeGen. Use the exact format from above.**

```
═══════════════════════════════════════════════════════════════════════════════
## FILES CONTRACT
═══════════════════════════════════════════════════════════════════════════════

### CREATE FILES:
[List each file with: path, purpose, integrates_in, replaces]

### MODIFY FILES:
[List each file with: path, action, changes]

### ASSET OPERATIONS:
[List cp commands for each asset]

═══════════════════════════════════════════════════════════════════════════════
```

**⚠️ CRITICAL**: The FILES CONTRACT section is NOT optional. 
Every UI task plan MUST end with this structured contract.

{{/if}}
