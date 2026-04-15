import type { WizardStepDef } from './types';

interface StepHeaderProps {
  step: WizardStepDef;
  lang: 'en' | 'ko';
}

export function StepHeader({ step, lang }: StepHeaderProps) {
  return (
    <div className="mb-4">
      <h3 className="text-lg font-bold text-gray-900 dark:text-white">
        {step.title[lang] ?? step.title.en}
      </h3>
      <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
        {step.description[lang] ?? step.description.en}
      </p>
    </div>
  );
}
