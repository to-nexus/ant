import { AgentJob } from "../../core/types";
import { MemoryPort } from "../../core/ports";
import { MMRReranker } from "../../core/chunk/rerank";

/**
 * Retrieve Memory for Agent
 * 
 * Common function to retrieve relevant context from vector memory
 * based on agent job. Each agent has its own query strategy.
 * 
 * @param agentJob - Type of agent job (design, code, review, etc.)
 * @param project - Project name
 * @param feature - Optional feature name
 * @param deps - Dependencies including memory port
 * @returns Formatted context string with categorized memory results
 */
export async function retrieveMemoryForAgent(
  agentJob: AgentJob,
  project: string,
  feature?: string,
  deps?: { memory?: MemoryPort }
): Promise<string> {
  const memory = deps?.memory;
  if (!memory) {
    console.log("⚠️  No memory adapter provided, skipping memory retrieval");
    return "";
  }
  
  // Get queries based on agent job
  const queries = getQueriesForAgent(agentJob, project);
  if (queries.length === 0) {
    console.log(`⚠️  No queries defined for agent job: ${agentJob}`);
    return "";
  }
  
  // Initialize reranker for diversity
  const reranker = new MMRReranker({ lambda: 0.7, k: 5 });
  
  // Execute queries and collect results
  const allResults: string[] = [];
  
  for (const query of queries) {
    try {
      const queryResults = await memory.query(query, project, {
        k: 10,
        where: {
          type: 'lesson',
          job: agentJob
        },
        minScore: 0.5
      });
      
      // Rerank for diversity
      const reranked = reranker.rerank(queryResults, 5);
      
      // Format results
      const formatted = reranked.map(r => 
        `${r.content} [relevance: ${(r.score * 100).toFixed(0)}%]`
      );
      
      if (formatted.length > 0) {
        allResults.push(`### ${query}\n${formatted.join('\n\n')}`);
      }
    } catch (error) {
      console.warn(`Failed to query memory for: ${query}`, error);
    }
  }
  
  // Add feature-specific context if feature is provided
  if (feature) {
    try {
      const featureQueries = getFeatureQueries(feature);
      for (const query of featureQueries) {
        const queryResults = await memory.query(query, project, {
          k: 10,
          where: {
            feature: feature,
            type: 'lesson'
          },
          minScore: 0.5
        });
        
        const reranked = reranker.rerank(queryResults, 5);
        const formatted = reranked.map(r => 
          `${r.content} [relevance: ${(r.score * 100).toFixed(0)}%]`
        );
        
        if (formatted.length > 0) {
          allResults.push(`### 🎯 ${query}\n${formatted.join('\n\n')}`);
        }
      }
    } catch (error) {
      console.warn(`Failed to query feature-specific memory`, error);
    }
  }
  
  if (allResults.length === 0) {
    return "";
  }
  
  // Format output with header
  return `
📚 Relevant Context from Previous Work
${"=".repeat(50)}

${allResults.join('\n\n')}
`;
}

/**
 * Get queries for specific agent job
 */
function getQueriesForAgent(agentJob: AgentJob, project: string): string[] {
  switch (agentJob) {
    case 'design':
      return [
        "What design patterns were used?",
        "What architecture decisions were made?",
        "System architecture and component structure",
        "Project goals and requirements"
      ];
      
    case 'code':
      return [
        "What code patterns were implemented?",
        "What refactorings were done?",
        "Coding conventions and style guide",
        "Common patterns and utilities"
      ];
      
    case 'review':
      return [
        "Code review guidelines and standards",
        "Common code quality issues",
        "Security and performance patterns",
        "Best practices for this project"
      ];
      
    case 'plan':
      return [
        "Sprint planning patterns",
        "Task estimation approaches",
        "Project velocity and capacity",
        "Risk mitigation strategies"
      ];
      
    case 'doc':
      return [
        "Documentation style and format",
        "API documentation standards",
        "Common documentation patterns",
        "Technical writing guidelines"
      ];
      
    case 'learn':
      // Learn task doesn't retrieve memory (it stores)
      return [];
      
    default:
      console.warn(`Unknown agent job: ${agentJob}`);
      return [];
  }
}

/**
 * Get feature-specific queries
 */
function getFeatureQueries(feature: string): string[] {
  return [
    `${feature} feature patterns and approaches`,
    `Lessons learned from ${feature} implementation`,
    `${feature} specific requirements and constraints`
  ];
}

