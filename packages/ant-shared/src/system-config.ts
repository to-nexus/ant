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
  /**
   * Git SHA of the running backend build, from `ANT_BUILD_SHA` (baked at image
   * build time). `null` when unset — local runs and any image built without the
   * build arg.
   *
   * Exists so FE/BE version skew is observable: the cloud FE ships to S3 on
   * merge while the BE image only reaches ECR, so the two can diverge with no
   * other signal that a route the FE calls is absent from the running server.
   */
  buildSha?: string | null;
}
