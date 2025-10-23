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
  // 코드베이스 관련
  codebase: string[];
  // 이전 작업 경험/학습
  learnings: string[];
  // 아키텍처/디자인 관련
  architecture: string[];
  // 피드백/수정사항 관련
  feedback: string[];
  // 프로젝트 특화 지식
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
  // 1. 쿼리 선택 및 준비
  const queries = mode === 'design' ? getDesignQueries(project) : getCodeQueries(project);
  const sections = {
    "📚 Previous Learnings": [] as string[],
    "🏗️ Architecture & Design": [] as string[],
    "💡 Project Knowledge": [] as string[],
    "📝 Feedback & Improvements": [] as string[],
    "🔍 Codebase Patterns": [] as string[],
    "🎯 Feature-Specific Context": [] as string[]
  } satisfies Record<SectionKey, string[]>;

  // 2. 각 카테고리별 쿼리 실행
  for (const [category, categoryQueries] of Object.entries(queries) as [CategoryKey, string[]][]) {
    const results = await Promise.all(
      categoryQueries.map(async query => {
        const result = await queryMemory(query, project);
        return result ? `### ${query}\n${result}` : '';
      })
    );
    
    const validResults = results.filter(Boolean);
    
    // 결과를 적절한 섹션에 매핑
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

  // 3. 특정 기능/컴포넌트 관련 추가 쿼리
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

  // 4. 결과 조합
  return Object.entries(sections)
    .filter(([_, results]) => results.length > 0)
    .map(([title, results]) => `
${title}
${"-".repeat(title.length)}
${results.join('\n\n')}
`)
    .join('\n\n');
}
