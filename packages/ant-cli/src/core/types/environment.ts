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
  /** Browser-based SPA (React, Vue, Angular) */
  BROWSER = 'browser',
  
  /** Node.js API server (Express, Fastify, NestJS) */
  NODE_API = 'node-api',
  
  /** Node.js CLI tools and scripts */
  NODE_CLI = 'node-cli',
  
  /** Fullstack frameworks with SSR (Next.js, Remix, SvelteKit) */
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
 */
export type FrontendFramework = 'react' | 'vue' | 'angular' | 'svelte' | 'none';

/**
 * Fullstack framework detection
 */
export type FullstackFramework = 'nextjs' | 'remix' | 'sveltekit' | 'nuxt' | 'none';

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

