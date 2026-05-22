import { useState, type CSSProperties } from 'react';
import { Compass, Code2, Check, X } from 'lucide-react';

interface StepProjectSetupProps {
  t: (key: string) => string;
  mode: 'design' | 'code';
  onModeChange: (mode: 'design' | 'code') => void;
  existingProjectId?: string;
  projectName: string;
  onProjectNameChange: (v: string) => void;
  featureName: string;
  onFeatureNameChange: (v: string) => void;
  projectNameExists: boolean;
  featureNameExists: boolean;
  projectNameInvalid: boolean;
  featureNameInvalid: boolean;
}

export function StepProjectSetup({
  t, mode, onModeChange, existingProjectId,
  projectName, onProjectNameChange,
  featureName, onFeatureNameChange,
  projectNameExists, featureNameExists,
  projectNameInvalid, featureNameInvalid,
}: StepProjectSetupProps) {
  const projectNameError = projectNameExists || projectNameInvalid;
  const featureNameError = featureNameExists || featureNameInvalid;

  return (
    <>
      {/* Mode cards — C1 actionchip pattern: full gradient when selected,
          watermark icon + slight rotate; neutral surface when unselected. */}
      <div className="grid grid-cols-2 gap-3">
        <ModeCard
          selected={mode === 'design'}
          onClick={() => onModeChange('design')}
          gradient="var(--gradient-aurora)"
          Icon={Compass}
          title={t('quickstart.projectWizard.modeDesign')}
          desc={t('quickstart.projectWizard.modeDesignDesc')}
        />
        <ModeCard
          selected={mode === 'code'}
          onClick={() => onModeChange('code')}
          gradient="var(--gradient-pink-orange)"
          Icon={Code2}
          title={t('quickstart.projectWizard.modeCode')}
          desc={t('quickstart.projectWizard.modeCodeDesc')}
        />
      </div>

      {/* Project name */}
      <NameField
        label={t('quickstart.projectWizard.projectName')}
        value={projectName}
        onChange={onProjectNameChange}
        disabled={!!existingProjectId}
        readOnly={!!existingProjectId}
        placeholder="my-project"
        hasError={projectNameError}
        showStatusIcon={!existingProjectId && !!projectName.trim()}
        errorMessage={
          projectNameExists
            ? t('quickstart.projectWizard.nameExists')
            : projectNameInvalid
              ? t('quickstart.projectWizard.nameInvalid')
              : undefined
        }
      />

      {/* Feature name */}
      <NameField
        label={t('quickstart.projectWizard.featureName')}
        value={featureName}
        onChange={onFeatureNameChange}
        placeholder="feature-name"
        hasError={featureNameError}
        showStatusIcon={!!featureName.trim()}
        errorMessage={
          featureNameExists
            ? t('quickstart.projectWizard.nameExists')
            : featureNameInvalid
              ? t('quickstart.projectWizard.nameInvalid')
              : undefined
        }
        hint={
          !featureNameError ? t('quickstart.projectWizard.featureNameHint') : undefined
        }
      />
    </>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────

interface ModeCardProps {
  selected: boolean;
  onClick: () => void;
  gradient: string;
  Icon: typeof Compass;
  title: string;
  desc: string;
}

function ModeCard({ selected, onClick, gradient, Icon, title, desc }: ModeCardProps) {
  const [hover, setHover] = useState(false);

  const style: CSSProperties = selected
    ? {
        background: gradient,
        backgroundSize: '180% 180%',
        border: '1.5px solid transparent',
        color: 'white',
        transform: 'rotate(-1deg) scale(1.02)',
        boxShadow: 'var(--shadow-glow-aurora)',
      }
    : {
        background: 'var(--bg-surface)',
        border: hover ? '1.5px solid var(--border-3)' : '1.5px solid var(--border-1)',
        color: 'var(--text-1)',
        transform: 'none',
      };

  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className="relative flex items-center gap-3 p-3.5 text-left transition-all overflow-hidden"
      style={{
        borderRadius: 'var(--r-xl, 14px)',
        ...style,
      }}
    >
      {/* Watermark icon */}
      <Icon
        aria-hidden
        style={{
          position: 'absolute',
          right: -8,
          bottom: -10,
          width: 72,
          height: 72,
          opacity: selected ? 0.18 : 0.08,
          transform: 'rotate(-8deg) scale(1)',
          color: selected ? 'white' : 'var(--text-3)',
          pointerEvents: 'none',
        }}
      />
      <div
        className="flex items-center justify-center shrink-0 relative"
        style={{
          width: 36,
          height: 36,
          borderRadius: 'var(--r-lg, 10px)',
          background: selected
            ? 'oklch(100% 0 0 / 0.22)'
            : 'var(--bg-surface-2)',
          color: selected ? 'white' : 'var(--text-3)',
        }}
      >
        <Icon className="w-5 h-5" />
      </div>
      <div className="min-w-0 relative">
        <div
          className="text-sm font-semibold"
          style={{ color: selected ? 'white' : 'var(--text-1)' }}
        >
          {title}
        </div>
        <div
          className="text-[11px] leading-snug"
          style={{
            color: selected ? 'oklch(100% 0 0 / 0.85)' : 'var(--text-3)',
          }}
        >
          {desc}
        </div>
      </div>
    </button>
  );
}

interface NameFieldProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  disabled?: boolean;
  readOnly?: boolean;
  hasError: boolean;
  showStatusIcon: boolean;
  errorMessage?: string;
  hint?: string;
}

function NameField({
  label, value, onChange, placeholder, disabled, readOnly,
  hasError, showStatusIcon, errorMessage, hint,
}: NameFieldProps) {
  const [focused, setFocused] = useState(false);

  const borderColor = disabled
    ? 'var(--border-1)'
    : hasError
      ? 'var(--red-500, oklch(70% 0.18 25))'
      : focused
        ? 'var(--violet-500)'
        : 'var(--border-2)';

  const boxShadow = focused && !hasError && !disabled
    ? '0 0 0 3px oklch(64% 0.20 290 / 0.18)'
    : focused && hasError
      ? '0 0 0 3px oklch(70% 0.18 25 / 0.18)'
      : 'none';

  return (
    <div>
      <label
        className="block text-sm font-medium mb-1.5"
        style={{ color: 'var(--text-2)' }}
      >
        {label}
      </label>
      <div className="relative">
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          readOnly={readOnly}
          placeholder={placeholder}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          className="w-full px-3 py-2 pr-9 text-sm outline-none transition-all"
          style={{
            background: disabled ? 'var(--bg-surface-2)' : 'var(--bg-surface)',
            color: disabled ? 'var(--text-3)' : 'var(--text-1)',
            border: `1.5px solid ${borderColor}`,
            borderRadius: 'var(--r-lg, 10px)',
            boxShadow,
            cursor: disabled ? 'not-allowed' : 'text',
          }}
        />
        {showStatusIcon && (
          <span className="absolute right-2.5 top-1/2 -translate-y-1/2">
            {hasError
              ? <X className="w-4 h-4" style={{ color: 'var(--status-error-fg)' }} />
              : <Check className="w-4 h-4" style={{ color: 'var(--emerald-500, oklch(65% 0.16 155))' }} />}
          </span>
        )}
      </div>
      {errorMessage ? (
        <p className="mt-1 text-[11px]" style={{ color: 'var(--status-error-fg)' }}>
          {errorMessage}
        </p>
      ) : hint ? (
        <p className="mt-1 text-[11px]" style={{ color: 'var(--text-3)' }}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}
