import { ProjectConfig } from '@/infrastructure/http/api';

export interface ConfigField {
  key: keyof ProjectConfig;
  label: string;
  type: 'text' | 'boolean' | 'select';
  required: boolean;
  options?: string[];
  description?: string;
}

export const CONFIG_SCHEMA: ConfigField[] = [
  {
    key: 'repositoryName',
    label: 'Repository Name',
    type: 'text',
    required: true,
    description: 'Name of the codebase/repository'
  },
  {
    key: 'repoType',
    label: 'Repository Type',
    type: 'select',
    required: false,
    options: ['local', 'cloud', 'github'],
    description: 'Type of repository (local, cloud, or GitHub)'
  },
  {
    key: 'localPath',
    label: 'Local Path',
    type: 'text',
    required: false,
    description: 'Path to local repository. Supports: absolute (/Users/...), home (~/ ), or relative from ant-cli (../../../my-repo)'
  },
  {
    key: 'githubRepo',
    label: 'GitHub Repository',
    type: 'text',
    required: false,
    description: 'GitHub repository URL (for github repo type)'
  },
  {
    key: 'branchBase',
    label: 'Base Branch',
    type: 'text',
    required: true,
    description: 'Base branch name (e.g., main, master)'
  },
  {
    key: 'autoLearn',
    label: 'Auto Learn',
    type: 'boolean',
    required: true,
    description: 'Enable automatic learning from code changes'
  },
  {
    key: 'strictValidation',
    label: 'Strict Validation',
    type: 'boolean',
    required: false,
    description: 'Enable strict validation mode'
  }
];
