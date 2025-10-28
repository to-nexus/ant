/**
 * Config Port
 * Interface for project configuration loading
 */

export interface ConfigPort {
  load(project: string): Promise<any>;
}

