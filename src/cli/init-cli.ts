#!/usr/bin/env node
import { initWorkspace, initFeature } from "./init";

const args = process.argv.slice(2);
const command = args[0];

if (command === "workspace") {
  const workspaceName = args[1];
  if (!workspaceName) {
    console.error("Usage: npm run init:workspace <workspace-name>");
    console.error("Example: npm run init:workspace my-app");
    process.exit(1);
  }
  initWorkspace(workspaceName);
} else if (command === "feature") {
  const workspaceName = args[1];
  const featureName = args[2];
  if (!workspaceName || !featureName) {
    console.error("Usage: npm run init:feature <workspace-name> <feature-name>");
    console.error("Example: npm run init:feature my-app ui-1.0.0");
    process.exit(1);
  }
  initFeature(workspaceName, featureName);
} else {
  console.error("Unknown command:", command);
  console.error("");
  console.error("Available commands:");
  console.error("  npm run init:workspace <name>           - Create new workspace");
  console.error("  npm run init:feature <workspace> <name> - Create new feature");
  process.exit(1);
}

