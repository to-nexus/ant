import * as fs from "fs";
import * as path from "path";

/**
 * Initialize a new workspace with boilerplate structure
 */
export function initWorkspace(workspaceName: string): void {
  const workspaceDir = path.join(process.cwd(), "workspace", workspaceName);

  if (fs.existsSync(workspaceDir)) {
    console.error(`❌ Workspace already exists: ${workspaceDir}`);
    process.exit(1);
  }

  // Create workspace structure
  fs.mkdirSync(workspaceDir, { recursive: true });
  fs.mkdirSync(path.join(workspaceDir, "common/inputs/directives/learn"), { recursive: true });
  fs.mkdirSync(path.join(workspaceDir, "common/outputs/memory"), { recursive: true });
  fs.mkdirSync(path.join(workspaceDir, "common/outputs/reports"), { recursive: true });

  // Create config.json
  const config = {
    projectName: workspaceName,
    branchBase: "main",
    autoLearn: true,
    llmProvider: "anthropic",
    llmModel: "claude-3-5-sonnet-20241022"
  };
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
  const workspaceDir = path.join(process.cwd(), "workspace", workspaceName);
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
  fs.mkdirSync(path.join(featureDir, "outputs/code"), { recursive: true });
  fs.mkdirSync(path.join(featureDir, "outputs/reports"), { recursive: true });
  fs.mkdirSync(path.join(featureDir, "outputs/memory"), { recursive: true });

  // Create PRD template
  const prdTemplate = `# ${featureName} - Product Requirements

## Overview
Describe the feature and its purpose.

## Goals
- Goal 1
- Goal 2

## User Stories
- As a [user type], I want [goal] so that [benefit]

## Requirements

### Functional Requirements
1. Requirement 1
2. Requirement 2

### Non-Functional Requirements
- Performance: 
- Security: 
- Accessibility: 

## Design References
- Figma: (add link in inputs/sources/figma-link.txt)
- Wireframes: (add images in inputs/sources/wireframes/)

## Technical Constraints
- Technology stack: 
- Dependencies: 

## Success Metrics
- Metric 1:
- Metric 2:
`;
  fs.writeFileSync(
    path.join(featureDir, "inputs/sources/prd.md"),
    prdTemplate,
    "utf8"
  );

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

  // Create .gitkeep for output directories
  const outputDirs = [
    "outputs/design",
    "outputs/code",
    "outputs/reports",
    "outputs/memory"
  ];
  
  outputDirs.forEach(dir => {
    fs.writeFileSync(
      path.join(featureDir, dir, ".gitkeep"),
      "",
      "utf8"
    );
  });

  console.log(`✅ Feature initialized: workspace/${workspaceName}/${featureName}/`);
  console.log("");
  console.log("📁 Created structure:");
  console.log(`  - inputs/sources/prd.md (template)`);
  console.log(`  - inputs/directives/design/`);
  console.log(`  - inputs/directives/code/`);
  console.log(`  - inputs/directives/learn/`);
  console.log(`  - outputs/design/`);
  console.log(`  - outputs/code/`);
  console.log(`  - outputs/reports/`);
  console.log(`  - outputs/memory/`);
  console.log("");
  console.log("🚀 Next steps:");
  console.log(`  1. Edit inputs/sources/prd.md`);
  console.log(`  2. Add Figma link: echo "URL" > inputs/sources/figma-link.txt`);
  console.log(`  3. Add wireframes to inputs/sources/wireframes/`);
  console.log(`  4. Generate design: npm run dev architect design workspace/${workspaceName}/${featureName}`);
}

