import * as fs from "fs";
import * as path from "path";
import { getDefaultWorkspaceConfig } from "../core/types/workspace";
import { getInitFeatureDirs } from '../core/utils/sessionPaths';

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

/** Template guide messages (CLI always uses English) */
const TEMPLATE_GUIDE = {
  markerGuide: 'Remove the ant:template line above after writing. The system treats this file as empty while the marker remains.',
  prdGuide: 'Write your PRD here, or use Planner mode for interactive generation.',
  directiveGuide: 'Add your directive here.',
} as const;

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

  // Create all canonical directories (single source of truth: CANONICAL_FEATURE_DIRS)
  for (const dir of getInitFeatureDirs(featureDir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  
  // NOTE: outputs/code, outputs/memory are NOT created
  //       - Code goes directly to repository (config.localPath)
  //       - Memory uses ChromaDB vector database

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Inputs (sources) templates
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const sourcesDir = path.join(featureDir, "inputs/sources");

  // ✅ PRD is canonical single file: prd.md
  const prdTemplate = `<!-- ant:template -->
<!-- ${TEMPLATE_GUIDE.markerGuide} -->
# ${featureName} - PRD

<!-- ${TEMPLATE_GUIDE.prdGuide} -->
`;
  fs.writeFileSync(
    path.join(featureDir, "inputs/sources/prd.md"),
    prdTemplate,
    "utf8"
  );

  // NOTE: UI documents (ui-spec.json, ui-tokens.json, ui-assets.json) are auto-generated
  // by Design Job into outputs/design/. No placeholders needed.

  // ✅ Runtime assets folder (mirrored into codebase root)
  fs.mkdirSync(path.join(featureDir, "inputs/assets"), { recursive: true });

  // ✅ Reference images folder (may be sent to LLM as multimodal blocks)
  fs.mkdirSync(path.join(featureDir, "inputs/references"), { recursive: true });

  // ✅ Empty figma.json (Figma integration placeholder)
  const { createEmptyFigmaData, FIGMA_FILENAME } = require('@ant/shared');
  fs.writeFileSync(
    path.join(featureDir, "inputs", FIGMA_FILENAME),
    JSON.stringify(createEmptyFigmaData(), null, 2),
    "utf8"
  );

  // Create placeholder directive.md files
  const directiveTemplate = `<!-- ant:template -->
<!-- ${TEMPLATE_GUIDE.markerGuide} -->
<!-- ${TEMPLATE_GUIDE.directiveGuide} -->
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
  console.log(`  - inputs/assets/ (runtime assets; mirrored into codebase root)`);
  console.log(`  - inputs/references/{screens,components}/ (reference images)`);
  console.log(`  - inputs/directives/{design,code,learn}/`);
  console.log(`  - outputs/design/ (ui-spec.json, ui-tokens.json, ui-assets.json auto-generated by Design Job)`);
  console.log(`  - outputs/evals/ (PRD/UI/System/Code 평가 리포트)`);
  console.log(`  - sessions/architect/ (design.json, code.json, learn.json)`);
  console.log(`  - sessions/architect/debug/ (prompts, plans, logs, asks - 디버깅용)`);
  console.log(`  - sessions/planner/ (plan.json)`);
  console.log("");
  console.log("🚀 Next steps:");
  console.log(`  1. Edit inputs/sources/prd.md`);
  console.log(`  2. (Optional) Configure Figma in inputs/figma.json`);
  console.log(`  3. Add reference images to inputs/references/`);
  console.log(`  4. Generate design: npm run dev architect design workspace/${workspaceName}/${featureName}`);
}

