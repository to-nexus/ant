export type ServerMode = 'local' | 'cloud';

export type IdeRuntime = 'kubernetes' | 'docker';

export interface SystemConfigCapabilities {
  vectorDb: boolean;
  /** Commercial billing surface (credit ledger, plans, payment). OSS/local: false. */
  billing: boolean;
}

export interface SystemConfigResponse {
  recursionLimit: number;
  authMode: ServerMode;
  ideRuntime: IdeRuntime;
  capabilities: SystemConfigCapabilities;
}
