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
  console.error("  arch-design     - PRD → System design document");
  console.error("  arch-code       - Design doc → Code (with auto-learning)");
  console.error("  arch-learn      - Explicit learning from codebase");
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
  console.error("  # workspace/my-app/ui-1.0.0/inputs/sources/prd.md");
  console.error("");
  console.error("  # 4. Generate design");
  console.error("  npm run dev arch-design workspace/my-app/ui-1.0.0");
  console.error("");
  console.error("  # 5. Generate code");
  console.error("  npm run dev arch-code workspace/my-app/ui-1.0.0");
  console.error("");
  console.error("  # 6. Apply feedback (add directive)");
  console.error("  # workspace/my-app/ui-1.0.0/inputs/directives/code/directive.md");
  console.error("  npm run dev arch-code workspace/my-app/ui-1.0.0");
  console.error("");
  console.error("Directory Structure:");
  console.error("  workspace/");
  console.error("  └── {project}/");
  console.error("      ├── {feature}/");
  console.error("      │   ├── inputs/");
  console.error("      │   │   ├── sources/      # PRD, Figma, wireframes");
  console.error("      │   │   └── directives/   # Task-specific instructions");
  console.error("      │   └── outputs/          # Generated design, code, reports");
  console.error("      └── config.json");
}

