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
    label: 'schema.repositoryName',
    type: 'text',
    required: true,
    description: 'schema.repositoryNameDesc'
  },
  {
    key: 'repoType',
    label: 'schema.repositoryType',
    type: 'select',
    required: false,
    options: ['local', 'cloud', 'github'],
    description: 'schema.repositoryTypeDesc'
  },
  {
    key: 'localPath',
    label: 'schema.localPath',
    type: 'text',
    required: false,
    description: 'schema.localPathDesc'
  },
  {
    key: 'githubRepo',
    label: 'schema.githubRepo',
    type: 'text',
    required: false,
  },
];
