import * as fs from "fs";
import * as path from "path";
import { getDefaultWorkspaceConfig } from "../core/types/workspace";
import { ensureCanonicalStructure } from '../core/utils/sessionPaths';

/**
 * Initialize a new workspace with boilerplate structure.
 *
 * 도메인 1차 분류 축(plan / architecture / visual / assets / meta / sessions /
 * codebase) 으로 정렬된 to-be 트리만 안내한다. 워크스페이스 레벨 `common/`
 * 컨테이너는 폐기 — feature 단위에서 도메인 디렉토리가 직접 산다.
 */
export function initWorkspace(workspaceName: string): void {
  // workspace is at project root (../../workspace from packages/ant-cli)
  const workspaceDir = path.join(process.cwd(), "../../workspace", workspaceName);

  if (fs.existsSync(workspaceDir)) {
    console.error(`❌ Workspace already exists: ${workspaceDir}`);
    process.exit(1);
  }

  fs.mkdirSync(workspaceDir, { recursive: true });

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
├── {feature}/              # Add features with: npm run init:feature
│   ├── plan/               # PRD/GDD 등 자유 형식 source 문서
│   ├── architecture/       # system/, spec/
│   ├── visual/             # ui/, game-art/
│   ├── assets/             # service/, game/, gen/
│   ├── meta/               # directives/, evals/
│   ├── sessions/           # 잡 체크포인트 / 디버그 / chat / feature
│   └── codebase/           # git worktree
└── config.json
\`\`\`

## Quick Start

1. Create a feature:
\`\`\`bash
npm run init:feature ${workspaceName} ui-1.0.0
\`\`\`

2. Add PRD:
\`\`\`bash
# Edit workspace/${workspaceName}/ui-1.0.0/plan/prd.md
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
  console.log(`  - workspace/${workspaceName}/config.json`);
  console.log(`  - workspace/${workspaceName}/README.md`);
  console.log("");
  console.log("🚀 Next steps:");
  console.log(`  1. Create a feature: npm run init:feature ${workspaceName} {feature-name}`);
  console.log(`  2. Edit config.json if needed`);
}

/** Template guide messages (CLI always uses English) */
const TEMPLATE_GUIDE = {
  markerGuide: 'Remove the ant:template line above after writing. The system treats this file as empty while the marker remains.',
  prdGuide: 'Write your PRD here, or use Planner mode for interactive generation.',
  directiveGuide: 'Add your directive here.',
} as const;

/**
 * Initialize a new feature in an existing workspace.
 *
 * Canonical directory/file creation is delegated to `ensureCanonicalStructure`
 * (single source of truth: `@ant/shared/canonical.ts`). This function only adds
 * the `codebase/` dir + template files that are not part of the canonical set.
 */
export async function initFeature(workspaceName: string, featureName: string): Promise<void> {
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

  // 'codebase' is excluded from CANONICAL_FEATURE_DIRS (WorktreeService may
  // replace it with a git worktree). Create it here so the directory always
  // exists post-init. mkdir -p on featureDir is a side-effect.
  fs.mkdirSync(path.join(featureDir, "codebase"), { recursive: true });

  // All canonical dirs + files (including visual/ui/{ant,figma,handoff}
  // + visual/ui/figma/figma.json) — SSOT via ensureCanonicalStructure.
  await ensureCanonicalStructure(featureDir);

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Source templates (plan/, meta/directives/)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  // ✅ PRD is canonical single file: plan/prd.md
  const prdTemplate = `<!-- ant:template -->
<!-- ${TEMPLATE_GUIDE.markerGuide} -->
# ${featureName} - PRD

<!-- ${TEMPLATE_GUIDE.prdGuide} -->
`;
  fs.writeFileSync(
    path.join(featureDir, "plan/prd.md"),
    prdTemplate,
    "utf8"
  );

  // Create placeholder directive.md files
  const directiveTemplate = `<!-- ant:template -->
<!-- ${TEMPLATE_GUIDE.markerGuide} -->
<!-- ${TEMPLATE_GUIDE.directiveGuide} -->
`;

  const directiveDirs = [
    "meta/directives/design",
    "meta/directives/code",
    "meta/directives/plan",
    "meta/directives/visual",
    "meta/directives/learn"
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
  console.log(`  - plan/prd.md (template)`);
  console.log(`  - assets/ (runtime assets; mirrored into codebase root)`);
  console.log(`  - meta/directives/{design,code,plan,visual,learn}/`);
  console.log(`  - architecture/{system,spec}/ (auto-generated by Design Job)`);
  console.log(`  - visual/{ui,game-art}/ (auto-generated by Design Job)`);
  console.log(`  - meta/evals/ (PRD/UI/System/Code 평가 리포트)`);
  console.log(`  - sessions/architect/ (design.json, code.json, learn.json)`);
  console.log(`  - sessions/architect/debug/ (prompts, plans, logs, asks - 디버깅용)`);
  console.log(`  - sessions/planner/ (plan.json)`);
  console.log("");
  console.log("🚀 Next steps:");
  console.log(`  1. Edit plan/prd.md`);
  console.log(`  2. (Optional) Configure Figma in visual/ui/figma/figma.json`);
  console.log(`  3. (Optional) Drop a free-form handoff bundle into visual/ui/handoff/`);
  console.log(`  4. Generate design: npm run dev architect design workspace/${workspaceName}/${featureName}`);
}

