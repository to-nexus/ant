import * as fs from "fs";
import * as path from "path";
import { getDefaultWorkspaceConfig } from "../core/types/workspace";

/**
 * Initialize a new workspace with boilerplate structure
 */
export function initWorkspace(workspaceName: string): void {
  // workspace is at project root (../../workspace from packages/ant-cli)
  const workspaceDir = path.join(process.cwd(), "../../workspace", workspaceName);

  if (fs.existsSync(workspaceDir)) {
    console.error(`❌ Workspace already exists: ${workspaceDir}`);
    process.exit(1);
  }

  // Create workspace structure
  fs.mkdirSync(workspaceDir, { recursive: true });
  fs.mkdirSync(path.join(workspaceDir, "common/inputs/directives/learn"), { recursive: true });
  // Common outputs directory (no need for memory subdirectory)
  fs.mkdirSync(path.join(workspaceDir, "common/outputs/reports"), { recursive: true });

  // Create config.json using centralized default config
  const config = getDefaultWorkspaceConfig(workspaceName);
  fs.writeFileSync(
    path.join(workspaceDir, "config.json"),
    JSON.stringify(config, null, 2),
    "utf8"
  );

  // Create README
  const readme = `# ${workspaceName}

## Workspace Structure

\`\`\`
${workspaceName}/
├── common/
│   ├── inputs/
│   │   └── directives/learn/
│   └── outputs/
│       ├── memory/
│       └── reports/
├── {feature}/              # Add features with: npm run init:feature
│   ├── inputs/
│   │   ├── sources/
│   │   └── directives/
│   └── outputs/
└── config.json
\`\`\`

## Quick Start

1. Create a feature:
\`\`\`bash
npm run init:feature ${workspaceName} ui-1.0.0
\`\`\`

2. Add PRD:
\`\`\`bash
# Edit workspace/${workspaceName}/ui-1.0.0/inputs/sources/prd.md
\`\`\`

3. Generate design:
\`\`\`bash
npm run dev architect design workspace/${workspaceName}/ui-1.0.0
\`\`\`

4. Generate code:
\`\`\`bash
npm run dev architect code workspace/${workspaceName}/ui-1.0.0
\`\`\`
`;
  fs.writeFileSync(
    path.join(workspaceDir, "README.md"),
    readme,
    "utf8"
  );

  console.log(`✅ Workspace initialized: workspace/${workspaceName}/`);
  console.log("");
  console.log("📁 Created structure:");
  console.log(`  - workspace/${workspaceName}/common/`);
  console.log(`  - workspace/${workspaceName}/config.json`);
  console.log(`  - workspace/${workspaceName}/README.md`);
  console.log("");
  console.log("🚀 Next steps:");
  console.log(`  1. Create a feature: npm run init:feature ${workspaceName} {feature-name}`);
  console.log(`  2. Edit config.json if needed`);
}

/**
 * Initialize a new feature in an existing workspace
 */
export function initFeature(workspaceName: string, featureName: string): void {
  // workspace is at project root (../../workspace from packages/ant-cli)
  const workspaceDir = path.join(process.cwd(), "../../workspace", workspaceName);
  const featureDir = path.join(workspaceDir, featureName);

  // Validate workspace exists
  if (!fs.existsSync(workspaceDir)) {
    console.error(`❌ Workspace not found: ${workspaceDir}`);
    console.error(`   Run: npm run init:workspace ${workspaceName}`);
    process.exit(1);
  }

  // Check if feature already exists
  if (fs.existsSync(featureDir)) {
    console.error(`❌ Feature already exists: ${featureDir}`);
    process.exit(1);
  }

  // Create feature structure
  fs.mkdirSync(path.join(featureDir, "inputs/sources"), { recursive: true });
  fs.mkdirSync(path.join(featureDir, "inputs/directives/design"), { recursive: true });
  fs.mkdirSync(path.join(featureDir, "inputs/directives/code"), { recursive: true });
  fs.mkdirSync(path.join(featureDir, "inputs/directives/learn"), { recursive: true });
  fs.mkdirSync(path.join(featureDir, "outputs/design"), { recursive: true });
  fs.mkdirSync(path.join(featureDir, "outputs/reports"), { recursive: true });
  fs.mkdirSync(path.join(featureDir, "sessions"), { recursive: true });  // ✅ Add sessions directory
  // NOTE: outputs/code, outputs/memory, outputs/eval are NOT created
  //       - Code goes directly to repository (config.localPath)
  //       - Memory uses ChromaDB vector database
  //       - Eval is deprecated

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Inputs (sources) templates
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const sourcesDir = path.join(featureDir, "inputs/sources");

  // ✅ PRD is canonical single file: prd.md
  const prdTemplate = `<!-- ant:template -->
<!-- 작성 후 이 줄(ant:template)을 삭제하세요. 남아있으면 시스템이 "비어있는 입력"으로 취급합니다. -->

# ${featureName} - PRD

> ✅ 필수: 이 파일은 항상 존재해야 합니다. (단일 입력 파일: \`inputs/sources/prd.md\`)

## 1) 한 줄 요약
- 

## 2) 문제/목표
- **문제**:
- **목표**:
- **비목표(이번에 하지 않는 것)**:

## 3) 사용자 시나리오
- 

## 4) 요구사항 (Functional)
- 

## 5) 비기능 (Non-Functional)
- 성능:
- 접근성:
- 보안/권한:

## 6) 제약/리스크
- 
`;
  fs.writeFileSync(
    path.join(featureDir, "inputs/sources/prd.md"),
    prdTemplate,
    "utf8"
  );

  // ✅ UI spec docs (optional but recommended for UI features)
  const uiSpecTemplate = `<!-- ant:template -->
<!-- 작성 후 이 줄(ant:template)을 삭제하세요. 남아있으면 시스템이 "비어있는 입력"으로 취급합니다. -->

# ui-spec.md (UI 스펙)

> 옵션(권장): UI/FE 구현을 위한 실행 가능한 스펙

## 화면 목록
| id | 화면명 | 목적 | 상태(default/loading/empty/error/validation) |
|---|---|---|---|
| S1 |  |  |  |

## 전역 UX 규칙
- 로딩:
- 에러:
- 빈 상태:

## 인터랙션
- 

## 반응형/레이아웃
- 

## 접근성(A11y)
- 
`;
  fs.writeFileSync(path.join(sourcesDir, "ui-spec.md"), uiSpecTemplate, "utf8");

  const componentsTemplate = `<!-- ant:template -->
<!-- 작성 후 이 줄(ant:template)을 삭제하세요. 남아있으면 시스템이 "비어있는 입력"으로 취급합니다. -->

# components.md (UI 컴포넌트 인벤토리)

> 옵션(권장): 컴포넌트 variants/sizes/states를 명시해 구현 추측을 줄임

## Button
- variants:
- sizes:
- states:

## Input
- states:
- validation:
`;
  fs.writeFileSync(path.join(sourcesDir, "components.md"), componentsTemplate, "utf8");

  const tokensTemplate = `<!-- ant:template -->
<!-- 작성 후 이 줄(ant:template)을 삭제하세요. 남아있으면 시스템이 "비어있는 입력"으로 취급합니다. -->

# tokens.md (디자인 토큰)

> 옵션(권장): 색/타이포/스페이싱을 토큰으로 고정 (코드에서 바로 사용)

## Colors
| token | value | usage |
|---|---|---|
| color.bg.base |  |  |

## Typography
| token | font | size | weight | line-height | usage |
|---|---|---:|---:|---:|---|
| type.body |  |  |  |  |  |

## Spacing / Radius / Breakpoints
- 
`;
  fs.writeFileSync(path.join(sourcesDir, "tokens.md"), tokensTemplate, "utf8");

  // ✅ Optional: UI assets note file (kept empty by default)
  const uiAssetsTemplate = `<!-- ant:template -->
<!-- 작성 후 이 줄(ant:template)을 삭제하세요. 남아있으면 시스템이 "비어있는 입력"으로 취급합니다. -->

# ui-assets.md (UI 에셋 메모)

> 옵션: 이미지/아이콘 파일만으로는 의도가 불명확할 수 있어, 필요 시 캡션/주의사항을 기록

## 중요: 참고용 vs 런타임 리소스 구분
- \`inputs/references/**\`의 파일은 **참고용(레퍼런스)** 입니다. (LLM이 UI를 맞추는 용도로만 사용)
- \`inputs/assets/**\`의 파일은 **런타임 리소스** 입니다. (LLM이 타겟 앱의 정적 에셋 루트(public 등)를 선택해 복사해야 함)
  - 예(일반): \`inputs/assets/icons/logo.svg\` → \`<target-app>/public/icons/logo.svg\`
  - 대상 파일이 이미 존재하고 내용이 같으면 **복사하지 않음**, 내용이 다르면 **업데이트(덮어쓰기)** 함

## screens
- 

## components
- 

## icons
- 
`;
  fs.writeFileSync(path.join(sourcesDir, "ui-assets.md"), uiAssetsTemplate, "utf8");

  // ✅ Runtime assets folder (mirrored into codebase root)
  fs.mkdirSync(path.join(featureDir, "inputs/assets"), { recursive: true });

  // ✅ Reference images folder (may be sent to LLM as multimodal blocks)
  fs.mkdirSync(path.join(featureDir, "inputs/references/screens"), { recursive: true });
  fs.mkdirSync(path.join(featureDir, "inputs/references/components"), { recursive: true });
  // NOTE: icons are treated as runtime assets by default → place under inputs/assets/** (e.g. inputs/assets/icons/*)

  // Create placeholder directive.md files
  const directiveTemplate = `<!-- ant:template -->
<!-- Add your directive here -->
`;
  
  const directiveDirs = [
    "inputs/directives/design",
    "inputs/directives/code",
    "inputs/directives/learn"
  ];
  
  directiveDirs.forEach(dir => {
    fs.writeFileSync(
      path.join(featureDir, dir, "directive.md"),
      directiveTemplate,
      "utf8"
    );
  });

  // NOTE: No .gitkeep creation (workspace is not necessarily tracked by git)

  console.log(`✅ Feature initialized: workspace/${workspaceName}/${featureName}/`);
  console.log("");
  console.log("📁 Created structure:");
  console.log(`  - inputs/sources/prd.md (template)`);
  console.log(`  - inputs/sources/ui-spec.md (template)`);
  console.log(`  - inputs/sources/components.md (template)`);
  console.log(`  - inputs/sources/tokens.md (template)`);
  console.log(`  - inputs/sources/ui-assets.md (template)`);
  console.log(`  - inputs/assets/ (runtime assets; mirrored into codebase root)`);
  console.log(`  - inputs/references/{screens,components}/ (reference images)`);
  console.log(`  - inputs/directives/design/`);
  console.log(`  - inputs/directives/code/`);
  console.log(`  - inputs/directives/learn/`);
  console.log(`  - outputs/design/`);
  console.log(`  - outputs/reports/`);
  console.log(`  - sessions/ (for design.json, code.json, learn.json)`);
  console.log("");
  console.log("🚀 Next steps:");
  console.log(`  1. Edit inputs/sources/prd.md`);
  console.log(`  2. Add Figma link: echo "URL" > inputs/sources/figma-link.txt`);
  console.log(`  3. Add wireframes to inputs/sources/wireframes/`);
  console.log(`  4. Generate design: npm run dev architect design workspace/${workspaceName}/${featureName}`);
}

