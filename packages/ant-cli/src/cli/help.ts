/**
 * Display CLI help message
 */
export function showHelp(): void {
  console.error("AI Dev Framework - Automated Architecture & Code Generation");
  console.error("");
  console.error("=== INITIALIZATION ===");
  console.error("  npm run init:workspace <name>           - Create new workspace");
  console.error("  npm run init:feature <workspace> <name> - Create new feature");
  console.error("");
  console.error("=== DEVELOPMENT ===");
  console.error("Usage: npm run dev <mode> <workspace-path>");
  console.error("");
  console.error("Modes:");
  console.error("  architect design (or arch design)  - PRD → System design document");
  console.error("  architect code (or arch code)      - Design doc → Code (with auto-learning)");
  console.error("  architect learn (or arch learn)    - Explicit learning from codebase");
  console.error("  review          - Code review");
  console.error("  plan            - Sprint planning");
  console.error("  doc             - Documentation generation");
  console.error("");
  console.error("Examples:");
  console.error("  # 1. Initialize workspace");
  console.error("  npm run init:workspace my-app");
  console.error("");
  console.error("  # 2. Create feature");
  console.error("  npm run init:feature my-app ui-1.0.0");
  console.error("");
  console.error("  # 3. Edit PRD");
  console.error("  # workspace/my-app/ui-1.0.0/plan/prd.md");
  console.error("");
  console.error("  # 4. Generate design");
  console.error("  npm run dev architect design workspace/my-app/ui-1.0.0");
  console.error("");
  console.error("  # 5. Generate code");
  console.error("  npm run dev architect code workspace/my-app/ui-1.0.0");
  console.error("");
  console.error("  # 6. Apply feedback (add directive)");
  console.error("  # workspace/my-app/ui-1.0.0/meta/directives/code/directive.md");
  console.error("  npm run dev architect code workspace/my-app/ui-1.0.0 --eval");
  console.error("");
  console.error("Directory Structure:");
  console.error("  workspace/");
  console.error("  └── {project}/");
  console.error("      ├── {feature}/");
  console.error("      │   ├── plan/             # PRD / GDD (text plan documents)");
  console.error("      │   ├── architecture/     # system/, spec/ design docs");
  console.error("      │   ├── visual/           # ui/, game-art/ design artifacts");
  console.error("      │   ├── assets/           # service/, game/, gen/ runtime assets");
  console.error("      │   └── meta/             # directives/, evals/");
  console.error("      └── config.json");
}

