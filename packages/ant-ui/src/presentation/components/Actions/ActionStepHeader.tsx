import { ChevronLeft } from 'lucide-react';
import { ACTION_VISUALS } from './actionVisuals';
import type { IntentGroup } from '@ant/shared';

interface ActionStepHeaderProps {
  actionId: IntentGroup;
  title: string;
  subtitle?: string;
  onBack: () => void;
}

export function ActionStepHeader({ actionId, title, subtitle, onBack }: ActionStepHeaderProps) {
  const visual = ACTION_VISUALS[actionId];
  if (!visual) return null;
  const Icon = visual.icon;

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={onBack}
        className="p-1 rounded-md transition-colors shrink-0"
        style={{ color: 'var(--text-3)' }}
        aria-label="Back"
      >
        <ChevronLeft className="w-5 h-5" />
      </button>
      <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${visual.bg}`}>
        <Icon className={`w-3.5 h-3.5 ${visual.text}`} />
      </div>
      <div className="min-w-0">
        <h2 className="text-base font-semibold truncate" style={{ color: 'var(--text-1)' }}>
          {title}
        </h2>
        {subtitle && (
          <p className="text-xs truncate" style={{ color: 'var(--text-3)' }}>
            {subtitle}
          </p>
        )}
      </div>
    </div>
  );
}
