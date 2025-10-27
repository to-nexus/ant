/**
 * Display CLI help message
 */
export function showHelp(): void {
  console.error("Usage:");
  console.error("  pnpm tsx src/index.ts <mode> <inputPath> [options]");
  console.error("");
  console.error("Modes:");
  console.error("  arch-design     - PRD → System design document");
  console.error("  arch-code       - Design doc → Code (staged, with learning & report)");
  console.error("  arch-learn      - Analyze and learn from codebase");
  console.error("  review          - Code review");
  console.error("  plan            - Sprint planning");
  console.error("  doc             - Documentation generation");
  console.error("");
  console.error("Options:");
  console.error("  --directive [file] - Apply directive (auto-detect latest or use specified file)");
  console.error("");
  console.error("Examples:");
  console.error("  # Generate design from PRD");
  console.error("  pnpm tsx src/index.ts arch-design projects/cross-ramp/ui-1.2.0/prd/spec.md");
  console.error("");
  console.error("  # Generate code (always with learning & report)");
  console.error("  pnpm tsx src/index.ts arch-code projects/cross-ramp/ui-1.2.0");
  console.error("  pnpm tsx src/index.ts arch-code projects/cross-ramp/ui-1.2.0 --directive");
  console.error("");
  console.error("  # Learn from codebase");
  console.error("  pnpm tsx src/index.ts arch-learn projects/cross-ramp/ui-1.2.0");
  console.error("");
  console.error("Note: arch-code ALWAYS learns and generates reports");
}

