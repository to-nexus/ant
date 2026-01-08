/**
 * Project Environment Types
 * 
 * Defines the execution environment of a project to enable
 * environment-aware prompt selection and code generation.
 */

/**
 * Primary execution environment of the project
 */
export enum ProjectEnvironment {
  /** Browser-based frontend (React, Vue, Angular, Next.js, Remix - SSR or CSR) */
  BROWSER = 'browser',
  
  /** Node.js API server (Express, Fastify, NestJS - backend only) */
  NODE_API = 'node-api',
  
  /** Node.js CLI tools and scripts */
  NODE_CLI = 'node-cli',
  
  /** Fullstack project (Backend server + Frontend in same repo, e.g., Express + React monorepo) */
  FULLSTACK = 'fullstack',
  
  /** Config files (vite.config, webpack.config, etc.) */
  CONFIG = 'config'
}

/**
 * Backend API framework detection
 */
export type BackendFramework = 'express' | 'fastify' | 'nestjs' | 'koa' | 'hapi' | 'none';

/**
 * Frontend framework detection
 * Note: SSR frameworks (Next.js, Remix, etc.) are frontend frameworks, not fullstack
 */
export type FrontendFramework = 'react' | 'vue' | 'angular' | 'svelte' | 'nextjs' | 'remix' | 'sveltekit' | 'nuxt' | 'none';

/**
 * Fullstack framework detection
 * Note: This is for REAL fullstack (backend + frontend in same repo), not SSR frameworks
 */
export type FullstackFramework = 'monorepo-fullstack' | 'none';

/**
 * Environment detection result
 */
export interface EnvironmentDetection {
  /** Primary environment (most dominant) */
  primary: ProjectEnvironment;
  
  /** Secondary environments (for monorepos or hybrid projects) */
  secondary?: ProjectEnvironment[];
  
  /** Confidence level of detection */
  confidence: 'high' | 'medium' | 'low';
  
  /** Evidence/indicators that led to this detection */
  indicators: string[];
  
  /** Detected framework (if any) */
  framework?: {
    backend?: BackendFramework;
    frontend?: FrontendFramework;
    fullstack?: FullstackFramework;
  };
}

/**
 * Signals for environment detection
 */
export interface EnvironmentSignals {
  /** Browser environment indicators */
  frontend: {
    frameworks: string[];
    patterns: string[];
    hasHtmlEntry: boolean;
    hasBrowserAPIs: boolean;
  };
  
  /** Node.js API server indicators */
  backend: {
    frameworks: string[];
    patterns: string[];
    hasServerStructure: boolean;
    hasDatabaseLayer: boolean;
  };
  
  /** Fullstack framework indicators */
  fullstack: {
    frameworks: string[];
    hasSSR: boolean;
    hasAPIRoutes: boolean;
  };
  
  /** Config file indicators */
  isConfig: boolean;
}

/**
 * File structure patterns for environment detection
 */
export interface FileStructure {
  /** All file paths in the project */
  paths: string[];
  
  /** Directories present */
  directories: Set<string>;
  
  /** File extensions count */
  extensions: Map<string, number>;
  
  /** Key files present */
  keyFiles: {
    hasPackageJson: boolean;
    hasIndexHtml: boolean;
    hasTsConfig: boolean;
    hasViteConfig: boolean;
    hasNextConfig: boolean;
  };
}

