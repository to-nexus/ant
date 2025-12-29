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
  const prdTemplate = `# ${featureName} - PRD

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
  const uiSpecTemplate = `# ui-spec.md (UI 스펙)

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

  const componentsTemplate = `# components.md (UI 컴포넌트 인벤토리)

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

  const tokensTemplate = `# tokens.md (디자인 토큰)

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
  const uiAssetsTemplate = `# ui-assets.md (UI 에셋 메모)

> 옵션: 이미지/아이콘 파일만으로는 의도가 불명확할 수 있어, 필요 시 캡션/주의사항을 기록

## screens
- 

## components
- 

## icons
- 
`;
  fs.writeFileSync(path.join(sourcesDir, "ui-assets.md"), uiAssetsTemplate, "utf8");

  // ✅ Assets folders
  fs.mkdirSync(path.join(sourcesDir, "assets/screens"), { recursive: true });
  fs.mkdirSync(path.join(sourcesDir, "assets/components"), { recursive: true });
  fs.mkdirSync(path.join(sourcesDir, "assets/icons"), { recursive: true });

  // Create placeholder directive.md files
  const directiveTemplate = `<!-- Add your directive here -->
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
  console.log(`  - inputs/sources/assets/{screens,components,icons}/`);
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

