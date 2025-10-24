import { AgentMode } from "./types";
import { queryMemory } from "../../memory";

type SectionKey = 
  | "📚 Previous Learnings"
  | "🏗️ Architecture & Design"
  | "💡 Project Knowledge"
  | "📝 Feedback & Improvements"
  | "🔍 Codebase Patterns"
  | "🎯 Feature-Specific Context";

type CategoryKey = 'codebase' | 'learnings' | 'architecture' | 'feedback' | 'project';

interface MemoryQueries {
  codebase: string[];
  learnings: string[];
  architecture: string[];
  feedback: string[];
  project: string[];
}

function getDesignQueries(project: string): MemoryQueries {
  return {
    codebase: [
      "component structure",
      "module organization",
      "integration patterns",
      "api interfaces"
    ],
    learnings: [
      "design decisions",
      "architectural learnings",
      "design improvements",
      "design feedback learnings"
    ],
    architecture: [
      "architecture principles",
      "system architecture",
      "architectural patterns",
      "design patterns"
    ],
    feedback: [
      "design feedback",
      "design improvements",
      "design revisions",
      "architectural changes"
    ],
    project: [
      `${project} architecture`,
      `${project} design patterns`,
      `${project} conventions`,
      `${project} best practices`
    ]
  };
}

function getCodeQueries(project: string): MemoryQueries {
  return {
    codebase: [
      "implementation patterns",
      "code structure",
      "import/export patterns",
      "module dependencies"
    ],
    learnings: [
      "implementation learnings",
      "code improvements",
      "bug fixes",
      "optimization learnings"
    ],
    architecture: [
      "code architecture",
      "implementation patterns",
      "coding standards",
      "best practices"
    ],
    feedback: [
      "code feedback",
      "implementation feedback",
      "code improvements",
      "refactoring suggestions"
    ],
    project: [
      `${project} implementations`,
      `${project} coding patterns`,
      `${project} code conventions`,
      `${project} common solutions`
    ]
  };
}

export async function getContextMemory(
  mode: AgentMode,
  project: string,
  feature?: string
): Promise<string> {
  const queries = mode === 'design' ? getDesignQueries(project) : getCodeQueries(project);
  const sections = {
    "📚 Previous Learnings": [] as string[],
    "🏗️ Architecture & Design": [] as string[],
    "💡 Project Knowledge": [] as string[],
    "📝 Feedback & Improvements": [] as string[],
    "🔍 Codebase Patterns": [] as string[],
    "🎯 Feature-Specific Context": [] as string[]
  } as Record<SectionKey, string[]>;

  for (const [category, categoryQueries] of Object.entries(queries) as [CategoryKey, string[]][]) {
    const results = await Promise.all(
      categoryQueries.map(async query => {
        const result = await queryMemory(query, project);
        return result ? `### ${query}\n${result}` : '';
      })
    );
    const validResults = results.filter(Boolean);
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

  if (feature) {
    const featureQueries = [
      `${feature} implementation`,
      `${feature} structure`,
      `${feature} patterns`,
      `${feature} learnings`,
      `${feature} feedback`,
      `${feature} improvements`
    ];

    const featureResults = await Promise.all(
      featureQueries.map(async query => {
        const result = await queryMemory(query, project);
        return result ? `### ${query}\n${result}` : '';
      })
    );

    sections["🎯 Feature-Specific Context"] = featureResults.filter(Boolean);
  }

  return Object.entries(sections)
    .filter(([_, results]) => results.length > 0)
    .map(([title, results]) => `
${title}
${"-".repeat(title.length)}
${results.join('\n\n')}
`)
    .join('\n\n');
}
