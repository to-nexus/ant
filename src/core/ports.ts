export interface LLMClient {
  invoke(messages: Array<{ role: string; content: string }>, options?: Record<string, any>): Promise<string>;
}

export interface MemoryPort {
  store(documents: Array<{ content: string; metadata?: Record<string, any> }>, namespace: string): Promise<void>;
  query(query: string, namespace: string, k?: number): Promise<string[]>;
}

export interface GitPort {
  getRepoRoot(): Promise<string>;
  createBranch(name: string, base: string): Promise<void>;
  getChangedFiles(): Promise<string[]>;
  getHeadFile(path: string): Promise<string | null>;
  writeFile(path: string, content: string): Promise<void>;
}

export interface PromptLoader {
  load(name: string): Promise<string>; // e.g., 'plan', 'code'
}

export interface ReporterPort {
  writeReport(path: string, content: string): Promise<string>;
  writeRunLog(path: string, data: any): Promise<string>;
}

export interface ValidationPort {
  validate(filePath: string, content: string, original?: string): Promise<{ violations: string[]; score: number }>;
}
