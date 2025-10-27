import { MemoryPort } from "../../../core/ports";

/**
 * Store learnings from execution to vector memory
 */
export async function storeLearnings(
  learnings: string,
  project: string,
  feature: string,
  deps?: { memory: MemoryPort }
): Promise<void> {
  const memory = deps?.memory;
  if (!memory) return;
  
  await memory.store([
    { 
      content: learnings, 
      metadata: { 
        type: "learning", 
        project, 
        feature, 
        timestamp: new Date().toISOString() 
      } 
    }
  ], project);
}
