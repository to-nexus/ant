import { storeMemory } from "../../memory/index";
import { CodebaseNode, BranchMetadata } from "./types";

export async function storeCodebase(
  nodes: CodebaseNode[], 
  metadata: BranchMetadata,
  project: string
): Promise<void> {
  const chunks = nodes.map(node => ({
    content: JSON.stringify({
      path: node.path,
      imports: node.imports,
      exports: node.exports,
      type: "codebase_structure"
    }),
    metadata: {
      ...metadata,
      path: node.path,
      type: "codebase_structure"
    }
  }));

  await storeMemory(chunks, project, { type: "batch_store", timestamp: new Date().toISOString() });
}

export async function storeLearnings(
  learnings: string,
  project: string,
  feature: string
): Promise<void> {
  await storeMemory(learnings, project, {
    type: "learning",
    project,
    feature,
    timestamp: new Date().toISOString()
  });
}

export function logStoredData(
  metadata: BranchMetadata,
  nodes: CodebaseNode[],
  learnings?: string
): void {
  console.log("\n📚 Stored in ChromaDB:");
  console.log("=".repeat(80));
  console.log("Codebase Metadata:", JSON.stringify(metadata, null, 2));
  console.log("\nFiles analyzed:");
  nodes.forEach(node => {
    console.log(`\n📄 ${node.path}`);
    console.log(`   Imports (${node.imports.length}): ${node.imports.join(", ")}`);
    console.log(`   Exports (${node.exports.length}): ${node.exports.join(", ")}`);
  });
  if (learnings) {
    console.log("\nLearnings:", learnings);
  }
  console.log("=".repeat(80));
}
