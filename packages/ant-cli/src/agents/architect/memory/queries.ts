/**
 * Memory query configurations for different agent modes
 */

export type CategoryKey = 'codebase' | 'lessons' | 'architecture' | 'feedback' | 'project';

export interface MemoryQueries {
  codebase: string[];
  lessons: string[];
  architecture: string[];
  feedback: string[];
  project: string[];
}

/**
 * Design mode queries - focused on architecture and system design
 */
export function getDesignQueries(project: string): MemoryQueries {
  return {
    codebase: [
      "component structure",
      "module organization",
      "integration patterns",
      "api interfaces"
    ],
    lessons: [
      "design decisions",
      "architectural lessons",
      "design improvements",
      "design feedback lessons"
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

/**
 * Code mode queries - focused on implementation and code patterns
 */
export function getCodeQueries(project: string): MemoryQueries {
  return {
    codebase: [
      "implementation patterns",
      "code structure",
      "import/export patterns",
      "module dependencies"
    ],
    lessons: [
      "implementation lessons",
      "code improvements",
      "bug fixes",
      "optimization lessons"
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

/**
 * Feature-specific queries
 */
export function getFeatureQueries(feature: string): string[] {
  return [
    `${feature} implementation`,
    `${feature} structure`,
    `${feature} patterns`,
    `${feature} lessons`,
    `${feature} feedback`,
    `${feature} improvements`
  ];
}

