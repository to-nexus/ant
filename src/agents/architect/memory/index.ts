import { AgentTask } from "../types";
import { MemoryPort } from "../../../core/ports";
import { getDesignQueries, getCodeQueries, getFeatureQueries, CategoryKey } from "./queries";

type SectionKey = 
  | "📚 Previous Learnings"
  | "🏗️ Architecture & Design"
  | "💡 Project Knowledge"
  | "📝 Feedback & Improvements"
  | "🔍 Codebase Patterns"
  | "🎯 Feature-Specific Context";

/**
 * Retrieve relevant context from vector memory based on agent task
 * 
 * @param task - Agent task (design, code, or learn)
 * @param project - Project name
 * @param feature - Optional feature name for feature-specific context
 * @param deps - Optional memory port dependency
 * @returns Formatted context string with categorized memory results
 */
export async function retrieve(
  task: AgentTask,
  project: string,
  feature?: string,
  deps?: { memory: MemoryPort }
): Promise<string> {
  const memory = deps?.memory;
  if (!memory) return "";

  const queries = task === 'design' ? getDesignQueries(project) : getCodeQueries(project);
  const sections = {
    "📚 Previous Learnings": [] as string[],
    "🏗️ Architecture & Design": [] as string[],
    "💡 Project Knowledge": [] as string[],
    "📝 Feedback & Improvements": [] as string[],
    "🔍 Codebase Patterns": [] as string[],
    "🎯 Feature-Specific Context": [] as string[]
  } as Record<SectionKey, string[]>;

  // Query each category
  for (const [category, categoryQueries] of Object.entries(queries) as [CategoryKey, string[]][]) {
    const results = await Promise.all(
      categoryQueries.map(async query => {
        const arr = await memory.query(query, project, 5);
        const result = arr.join("\n\n");
        return result ? `### ${query}\n${result}` : '';
      })
    );
    
    const validResults = results.filter(Boolean);
    
    // Map category to section
    switch(category) {
      case 'learnings':
        sections["📚 Previous Learnings"].push(...validResults);
        break;
      case 'architecture':
        sections["🏗️ Architecture & Design"].push(...validResults);
        break;
      case 'project':
        sections["💡 Project Knowledge"].push(...validResults);
        break;
      case 'feedback':
        sections["📝 Feedback & Improvements"].push(...validResults);
        break;
      case 'codebase':
        sections["🔍 Codebase Patterns"].push(...validResults);
        break;
    }
  }

  // Add feature-specific context if feature is provided
  if (feature) {
    const featureQueries = getFeatureQueries(feature);
    const featureResults = await Promise.all(
      featureQueries.map(async query => {
        const arr = await memory.query(query, project, 5);
        const result = arr.join("\n\n");
        return result ? `### ${query}\n${result}` : '';
      })
    );

    sections["🎯 Feature-Specific Context"] = featureResults.filter(Boolean);
  }

  // Format output
  return Object.entries(sections)
    .filter(([_, results]) => results.length > 0)
    .map(([title, results]) => `
${title}
${"-".repeat(title.length)}
${results.join('\n\n')}
`)
    .join('\n\n');
}
