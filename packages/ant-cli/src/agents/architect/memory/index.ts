import { AgentTask } from "../types";
import { MemoryPort } from "../../../core/ports";
import { getDesignQueries, getCodeQueries, getFeatureQueries, CategoryKey } from "./queries";
import { MMRReranker } from "../../../core/chunk/rerank";

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

  try {
    const queries = task === 'design' ? getDesignQueries(project) : getCodeQueries(project);
    const sections = {
      "📚 Previous Learnings": [] as string[],
      "🏗️ Architecture & Design": [] as string[],
      "💡 Project Knowledge": [] as string[],
      "📝 Feedback & Improvements": [] as string[],
      "🔍 Codebase Patterns": [] as string[],
      "🎯 Feature-Specific Context": [] as string[]
    } as Record<SectionKey, string[]>;

    // Initialize MMR reranker for diversity
    const reranker = new MMRReranker({ lambda: 0.7, k: 5 });

    // Query each category
    for (const [category, categoryQueries] of Object.entries(queries) as [CategoryKey, string[]][]) {
      const results = await Promise.all(
        categoryQueries.map(async query => {
          try {
            // Query with metadata filtering based on task type
            const queryResults = await memory.query(query, project, {
              k: 10,  // Get more results for reranking
              where: { 
                type: 'lesson'  // ✅ Changed from 'learning'
              },
              minScore: 0.5  // Filter low-quality results
            });
            
            // Rerank for diversity
            const reranked = reranker.rerank(queryResults, 5);
            
            // Extract content with scores
            const formattedResults = reranked.map((r, i) => 
              `${r.content} [relevance: ${(r.score * 100).toFixed(0)}%]`
            );
            
            const result = formattedResults.join("\n\n");
            return result ? `### ${query}\n${result}` : '';
          } catch (error) {
            console.warn(`⚠️  Failed to query "${query}":`, error instanceof Error ? error.message : error);
            return '';
          }
        })
      );
      
      const validResults = results.filter(Boolean);
      
      // Map category to section
      switch(category) {
        case 'lessons':
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
      try {
        const featureQueries = getFeatureQueries(feature);
        const featureResults = await Promise.all(
          featureQueries.map(async query => {
            try {
              // Query with feature filtering
              const queryResults = await memory.query(query, project, {
                k: 10,
                where: { 
                  type: 'lesson'
                },
                minScore: 0.5
              });
              
              // Rerank
              const reranked = reranker.rerank(queryResults, 5);
              const formattedResults = reranked.map(r => 
                `${r.content} [relevance: ${(r.score * 100).toFixed(0)}%]`
              );
              
              const result = formattedResults.join("\n\n");
              return result ? `### ${query}\n${result}` : '';
            } catch (error) {
              console.warn(`⚠️  Failed feature query "${query}":`, error instanceof Error ? error.message : error);
              return '';
            }
          })
        );

        sections["🎯 Feature-Specific Context"] = featureResults.filter(Boolean);
      } catch (error) {
        console.warn(`⚠️  Failed to query feature-specific context:`, error instanceof Error ? error.message : error);
      }
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
  } catch (error) {
    console.warn(`⚠️  Vector memory retrieval failed (continuing without memory):`, error instanceof Error ? error.message : error);
    return "";
  }
}
