
import { useTranslation } from 'react-i18next';
import { ProjectConfig, JobLLMConfig } from '@/infrastructure/http/api';
import {
  OVERRIDABLE_MODEL_SLOTS,
  AUXILIARY_MODEL_KEYS,
  type ModelJobKey,
  type ModelNodeKey,
  type AuxiliaryModelKey,
} from '@ant/shared';
import { AvailableModel } from '../hooks/useAvailableModels';
import { ModelSelectChip } from './ModelSelectChip';
import { resolveModelDisplay } from '../utils/resolveModelDisplay';
import { SectionCard, type SectionAccent } from '../aurora';
import * as LucideIcons from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

interface LLMModelsSectionProps {
  editedConfig: ProjectConfig;
  availableModels: AvailableModel[];
  isLoadingModels: boolean;
  onModelChange: (job: string, nodeType: string, modelId: string) => void;
  /** Providers whose API key is configured on the server. `undefined` = server
   * did not report → no warnings shown. */
  configuredProviders?: string[];
}

interface JobDef {
  jobKey: ModelJobKey;
  jobLabel: string;
  agentLabel: string;
  accent: SectionAccent;
  icon: string;
}

// Presentation only — which nodes are overridable per job is owned by
// OVERRIDABLE_MODEL_SLOTS (@ant/shared), reconciled against the compiled graph
// by tests/config/llm-model-slots-coverage.test.ts.
const JOB_DEFS: JobDef[] = [
  { jobKey: 'plan', jobLabel: 'Plan', agentLabel: 'Planner', accent: 'cool', icon: 'Compass' },
  { jobKey: 'design', jobLabel: 'Design', agentLabel: 'Architect', accent: 'violet-pink', icon: 'Beaker' },
  { jobKey: 'code', jobLabel: 'Code', agentLabel: 'Architect', accent: 'pink-orange', icon: 'Terminal' },
  { jobKey: 'learn', jobLabel: 'Learn', agentLabel: 'Architect', accent: 'aurora', icon: 'Book' },
  { jobKey: 'visual', jobLabel: 'Visual', agentLabel: 'Creator', accent: 'sunset', icon: 'Palette' },
];

// Left-to-right column order for the picker. The rendered columns are the union
// of overridable slots across all jobs, filtered to this order — so a new slot
// in OVERRIDABLE_MODEL_SLOTS surfaces automatically once added to this order.
const COLUMN_ORDER: ModelNodeKey[] = [
  'decompose',
  'plan',
  'execute',
  'direct',
  'sketch',
  'render',
  'engrave',
  'explain',
];

const ALL_SLOTS = new Set<ModelNodeKey>(Object.values(OVERRIDABLE_MODEL_SLOTS).flat());
const NODE_COLUMNS: ModelNodeKey[] = COLUMN_ORDER.filter((c) => ALL_SLOTS.has(c));

const NODE_LABEL: Record<ModelNodeKey, string> = {
  default: 'Default',
  decompose: 'Decompose',
  plan: 'Plan',
  execute: 'Execute',
  direct: 'Direct',
  // BE-only value keys (never in OVERRIDABLE_MODEL_SLOTS / COLUMN_ORDER) —
  // present only to satisfy the exhaustive Record type.
  subagent: 'Subagent',
  agent: 'Agent',
  sketch: 'Sketch',
  render: 'Render',
  engrave: 'Engrave',
  explain: 'Explain',
  tool: 'Tool',
  validate: 'Validate',
  learn: 'Learn',
  detect: 'Detect',
};

// Auxiliary (non-graph) model slots — default-only rows rendered below the job
// grid. Owned by AUXILIARY_MODEL_KEYS (@ant/shared); these keys deliberately
// live outside OVERRIDABLE_MODEL_SLOTS (no agent graph). Presentation-only meta.
const AUX_DEFS: Record<AuxiliaryModelKey, { label: string; desc: string; icon: string }> = {
  commit: {
    label: 'Commit message',
    desc: 'ant-authored git commit messages',
    icon: 'GitCommitHorizontal',
  },
};

const ACCENT_GRAD: Record<SectionAccent, string> = {
  aurora: 'var(--gradient-aurora)',
  cool: 'var(--gradient-cool)',
  'violet-pink': 'var(--gradient-violet-pink)',
  'pink-orange': 'var(--gradient-pink-orange)',
  sunset: 'var(--gradient-sunset)',
};

const HEAD_CELL: React.CSSProperties = {
  padding: '10px 12px',
  fontSize: 10,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  color: 'var(--text-3)',
  background: 'oklch(from var(--bg-surface-2) l c h / 0.4)',
  borderBottom: '1px solid var(--border-1)',
};

const BODY_CELL: React.CSSProperties = {
  padding: '10px 12px',
  borderBottom: '1px solid var(--border-1)',
  display: 'flex',
  alignItems: 'center',
  minWidth: 0,
};

function resolveIcon(name: string): LucideIcon | null {
  const registry = LucideIcons as unknown as Record<string, LucideIcon>;
  const icon = registry[name];
  return typeof icon === 'function' || (icon && typeof icon === 'object') ? icon : null;
}

export function LLMModelsSection({
  editedConfig,
  availableModels,
  isLoadingModels,
  onModelChange,
  configuredProviders,
}: LLMModelsSectionProps) {
  const { t } = useTranslation('config');

  // Providers that back a selectable model but have no API key on the server.
  // Only computed when the server reported `configuredProviders` (else empty).
  const unconfiguredProviders = Array.isArray(configuredProviders)
    ? Array.from(new Set(availableModels.map((m) => m.provider))).filter(
        (p) => !configuredProviders.includes(p),
      )
    : [];

  // Column widths sized so model chips fit their (suffix-free) display names
  // without truncation; the outer overflowX:auto still scrolls when all node
  // columns exceed the viewport.
  const gridTemplate = `minmax(120px, 140px) minmax(150px, 1fr) ${NODE_COLUMNS.map(() => 'minmax(150px, 1fr)').join(' ')}`;

  return (
    <SectionCard
      id="c3p-llm"
      icon="Brain"
      title={t('llmModels.title')}
      description={t('projectEditor.llmDescription')}
      accent="aurora"
      padded={false}
    >
      {isLoadingModels ? (
        <div style={{ padding: '14px 18px', fontSize: 12, color: 'var(--text-3)' }}>
          {t('llmModels.loading')}
        </div>
      ) : (
        <>
          <div style={{ overflowX: 'auto' }}>
            <div
              style={{
                minWidth: 760,
                display: 'grid',
                gridTemplateColumns: gridTemplate,
                fontFamily: 'var(--font-display)',
              }}
            >
              {/* Header row */}
              <div style={HEAD_CELL}>Job</div>
              <div
                style={{
                  ...HEAD_CELL,
                  color: 'var(--violet-700)',
                  textAlign: 'center',
                }}
              >
                Default · Job 전체
              </div>
              {NODE_COLUMNS.map((col) => (
                <div key={col} style={{ ...HEAD_CELL, textAlign: 'center' }}>
                  {NODE_LABEL[col] || col}
                </div>
              ))}

              {/* Body rows */}
              {JOB_DEFS.map((job) => {
                const jobConfig = editedConfig.llmModels?.[job.jobKey];
                const inheritedDefault = (() => {
                  const r = resolveModelDisplay(jobConfig?.default ?? '', availableModels);
                  return r
                    ? { id: r.id, displayName: r.displayName, provider: r.provider }
                    : undefined;
                })();
                const Icon = resolveIcon(job.icon);

                return (
                  <JobRow
                    key={job.jobKey}
                    job={job}
                    Icon={Icon}
                    jobConfig={jobConfig}
                    inheritedDefault={inheritedDefault}
                    availableModels={availableModels}
                    onModelChange={onModelChange}
                    configuredProviders={configuredProviders}
                    t={t}
                  />
                );
              })}
            </div>
          </div>

          {/* Auxiliary (non-graph) models — default-only single-model rows. */}
          {AUXILIARY_MODEL_KEYS.length > 0 && (
            <div style={{ borderTop: '1px solid var(--border-1)' }}>
              <div
                style={{
                  ...HEAD_CELL,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                Auxiliary · one-shot
              </div>
              {AUXILIARY_MODEL_KEYS.map((key) => {
                const def = AUX_DEFS[key];
                const AuxIcon = resolveIcon(def.icon);
                return (
                  <div
                    key={key}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'minmax(200px, 260px) minmax(150px, 1fr)',
                      fontFamily: 'var(--font-display)',
                    }}
                  >
                    <div style={{ ...BODY_CELL, gap: 10, paddingLeft: 18 }}>
                      <div
                        style={{
                          width: 26,
                          height: 26,
                          borderRadius: 'var(--r-md)',
                          background: 'var(--bg-surface)',
                          border: '1px solid var(--border-1)',
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: 'var(--text-2)',
                          flexShrink: 0,
                        }}
                      >
                        {AuxIcon ? <AuxIcon size={14} strokeWidth={2} /> : null}
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, lineHeight: 1.2 }}>
                        <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text-1)' }}>
                          {def.label}
                        </span>
                        <span style={{ fontSize: 10, color: 'var(--text-4)' }}>{def.desc}</span>
                      </div>
                    </div>
                    <div style={BODY_CELL}>
                      <ModelSelectChip
                        value={editedConfig.llmModels?.[key]?.default || ''}
                        models={availableModels}
                        onChange={(id) => onModelChange(key, 'default', id)}
                        placeholder={t('projectEditor.selectModel')}
                        configuredProviders={configuredProviders}
                        fill
                        compact
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {unconfiguredProviders.length > 0 && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '9px 18px',
                borderTop: '1px solid oklch(75% 0.15 65 / 0.4)',
                background: 'oklch(94% 0.07 65 / 0.4)',
                fontSize: 11.5,
                lineHeight: 1.5,
                color: 'oklch(45% 0.12 55)',
                fontFamily: 'var(--font-display)',
              }}
            >
              <span aria-hidden style={{ fontSize: 13, flexShrink: 0 }}>
                ⚠
              </span>
              <span>
                {t('llmModels.unconfiguredProvidersWarning', {
                  providers: unconfiguredProviders.join(', '),
                })}
              </span>
            </div>
          )}
        </>
      )}
    </SectionCard>
  );
}

interface JobRowProps {
  job: JobDef;
  Icon: LucideIcon | null;
  jobConfig: JobLLMConfig | undefined;
  inheritedDefault: { id: string; displayName: string; provider: string } | undefined;
  availableModels: AvailableModel[];
  onModelChange: (job: string, nodeType: string, modelId: string) => void;
  configuredProviders?: string[];
  t: (key: string, opts?: Record<string, unknown>) => string;
}

function JobRow({
  job,
  Icon,
  jobConfig,
  inheritedDefault,
  availableModels,
  onModelChange,
  configuredProviders,
  t,
}: JobRowProps) {
  return (
    <>
      {/* Job header cell */}
      <div
        style={{
          ...BODY_CELL,
          position: 'relative',
          paddingLeft: 18,
          background: 'oklch(from var(--bg-surface-2) l c h / 0.25)',
        }}
      >
        <span
          aria-hidden
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            bottom: 0,
            width: 3,
            background: ACCENT_GRAD[job.accent],
            opacity: 0.7,
          }}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          <div
            style={{
              width: 26,
              height: 26,
              borderRadius: 'var(--r-md)',
              background: 'var(--bg-surface)',
              border: '1px solid var(--border-1)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--text-2)',
              flexShrink: 0,
            }}
          >
            {Icon ? <Icon size={14} strokeWidth={2} /> : null}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, lineHeight: 1.2 }}>
            <span
              style={{
                fontSize: 12.5,
                fontWeight: 700,
                color: 'var(--text-1)',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {job.jobLabel}
            </span>
            <span
              style={{
                fontSize: 10,
                color: 'var(--text-4)',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {job.agentLabel}
            </span>
          </div>
        </div>
      </div>

      {/* Default cell */}
      <div
        style={{
          ...BODY_CELL,
          background: 'oklch(94% 0.06 290 / 0.15)',
        }}
      >
        <ModelSelectChip
          value={jobConfig?.default || ''}
          models={availableModels}
          onChange={(id) => onModelChange(job.jobKey, 'default', id)}
          placeholder={t('projectEditor.selectModel')}
          configuredProviders={configuredProviders}
          fill
          compact
        />
      </div>

      {/* Override cells */}
      {NODE_COLUMNS.map((col) => {
        const applicable = OVERRIDABLE_MODEL_SLOTS[job.jobKey].includes(col);
        if (!applicable) {
          return (
            <div
              key={col}
              style={{
                ...BODY_CELL,
                justifyContent: 'center',
                color: 'var(--text-4)',
                fontWeight: 700,
              }}
            >
              —
            </div>
          );
        }
        return (
          <div key={col} style={BODY_CELL}>
            <ModelSelectChip
              value={jobConfig?.[col] || ''}
              models={availableModels}
              onChange={(id) => onModelChange(job.jobKey, col, id)}
              inheritedModel={inheritedDefault}
              placeholder={t('projectEditor.useJobDefault')}
              configuredProviders={configuredProviders}
              fill
              compact
            />
          </div>
        );
      })}
    </>
  );
}

