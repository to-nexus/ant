export type ServerMode = 'local' | 'cloud';

export type IdeRuntime = 'kubernetes' | 'docker';

export interface SystemConfigCapabilities {
  vectorDb: boolean;
}

export interface SystemConfigResponse {
  recursionLimit: number;
  authMode: ServerMode;
  ideRuntime: IdeRuntime;
  capabilities: SystemConfigCapabilities;
}
