/**
 * Triage Data Loader
 * 
 * Loads job definitions from YAML files.
 * No i18n - all text is English, LLM handles translation.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { JobDefinition } from './types.js';

export class TriageDataLoader {
  private static instance: TriageDataLoader;
  
  private jobs: Map<string, JobDefinition> = new Map();
  private loaded = false;
  
  private constructor() {}
  
  static getInstance(): TriageDataLoader {
    if (!TriageDataLoader.instance) {
      TriageDataLoader.instance = new TriageDataLoader();
    }
    return TriageDataLoader.instance;
  }
  
  /**
   * Load all job definitions
   */
  async load(): Promise<void> {
    if (this.loaded) return;
    
    const dataDir = path.dirname(new URL(import.meta.url).pathname);
    const jobsDir = path.join(dataDir, 'jobs');
    const jobFiles = ['design.yaml', 'code.yaml', 'learn.yaml'];
    
    for (const file of jobFiles) {
      const filePath = path.join(jobsDir, file);
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, 'utf-8');
        const job = yaml.load(content) as JobDefinition;
        this.jobs.set(job.id, job);
      }
    }
    
    this.loaded = true;
  }
  
  /**
   * Get a job definition
   */
  getJob(jobId: string): JobDefinition | null {
    return this.jobs.get(jobId) || null;
  }
  
  /**
   * Get all job definitions
   */
  getAllJobs(): JobDefinition[] {
    return Array.from(this.jobs.values());
  }
  
  /**
   * Get all job IDs
   */
  getJobIds(): string[] {
    return Array.from(this.jobs.keys());
  }
  
  /**
   * Detect language from user input (for LLM response language)
   */
  detectLanguage(input: string): 'ko' | 'en' {
    const hasKorean = /[\uAC00-\uD7AF]/.test(input);
    return hasKorean ? 'ko' : 'en';
  }
}

// Export singleton accessor
export function getTriageDataLoader(): TriageDataLoader {
  return TriageDataLoader.getInstance();
}
