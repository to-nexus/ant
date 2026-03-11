export type WizardStep = 1 | 2 | 3;

export type ExecStepId = 'project' | 'config' | 'gitClone' | 'gitInit' | 'feature' | 'upload' | 'job';
export type ExecStepStatus = 'pending' | 'active' | 'done' | 'error';

export interface ExecStepState {
  id: ExecStepId;
  status: ExecStepStatus;
  error?: string;
}
