import type { WizardStepDef } from './types';

interface StepHeaderProps {
  step: WizardStepDef;
  lang: 'en' | 'ko';
}

export function StepHeader({ step, lang }: StepHeaderProps) {
  return (
    <div className="mb-4">
      <h3 className="text-lg font-bold" style={{ color: 'var(--text-1)' }}>
        {step.title[lang] ?? step.title.en}
      </h3>
      <p className="text-sm mt-0.5" style={{ color: 'var(--text-3)' }}>
        {step.description[lang] ?? step.description.en}
      </p>
    </div>
  );
}
