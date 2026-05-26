
import { useTranslation } from 'react-i18next';
import { ProjectConfig, JobLLMConfig } from '@/infrastructure/http/api';
import { AvailableModel } from '../hooks/useAvailableModels';
import { ModelSelectChip } from './ModelSelectChip';
import { SectionCard, type SectionAccent } from '../aurora';
import * as LucideIcons from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

interface LLMModelsSectionProps {
  editedConfig: ProjectConfig;
  availableModels: AvailableModel[];
  isLoadingModels: boolean;
  onModelChange: (job: string, nodeType: string, modelId: string) => void;
}

type JobKey = 'plan' | 'design' | 'code' | 'learn' | 'visual';
type NodeKey = keyof JobLLMConfig;

interface JobDef {
  jobKey: JobKey;
  jobLabel: string;
  agentLabel: string;
  accent: SectionAccent;
  icon: string;
  /** Map of node-column → i18n description key. `default` always present. */
  nodes: Partial<Record<NodeKey, string>>;
}

const JOB_DEFS: JobDef[] = [
  {
    jobKey: 'plan',
    jobLabel: 'Plan',
    agentLabel: 'Planner',
    accent: 'cool',
    icon: 'Compass',
    nodes: { default: 'llmModels.defaultPlanDesc' },
  },
  {
    jobKey: 'design',
    jobLabel: 'Design',
    agentLabel: 'Architect',
    accent: 'violet-pink',
    icon: 'Beaker',
    nodes: {
      default: 'llmModels.defaultDesignDesc',
      decompose: 'llmModels.decomposeDesc',
      docGen: 'llmModels.docGenDesc',
      plan: 'llmModels.planDesc',
    },
  },
  {
    jobKey: 'code',
    jobLabel: 'Code',
    agentLabel: 'Architect',
    accent: 'pink-orange',
    icon: 'Terminal',
    nodes: {
      default: 'llmModels.defaultCodeDesc',
      decompose: 'llmModels.decomposeDesc',
      execute: 'llmModels.codeExecuteDesc',
      plan: 'llmModels.planDesc',
    },
  },
  {
    jobKey: 'learn',
    jobLabel: 'Learn',
    agentLabel: 'Architect',
    accent: 'aurora',
    icon: 'Book',
    nodes: { default: 'llmModels.defaultLearnDesc' },
  },
  {
    jobKey: 'visual',
    jobLabel: 'Visual',
    agentLabel: 'Creator',
    accent: 'sunset',
    icon: 'Palette',
    nodes: {
      default: 'llmModels.defaultVisualDesc',
      direct: 'llmModels.directDesc',
      sketch: 'llmModels.sketchDesc',
      render: 'llmModels.renderDesc',
      engrave: 'llmModels.engraveDesc',
    },
  },
];

const NODE_COLUMNS: NodeKey[] = [
  'decompose',
  'docGen',
  'plan',
  'execute',
  'direct',
  'sketch',
  'render',
  'engrave',
];

const NODE_LABEL: Record<NodeKey, string> = {
  default: 'Default',
  decompose: 'Decompose',
  docGen: 'Doc Gen',
  plan: 'Plan',
  execute: 'Execute',
  direct: 'Direct',
  sketch: 'Sketch',
  render: 'Render',
  engrave: 'Engrave',
  tool: 'Tool',
  validate: 'Validate',
  learn: 'Learn',
  detect: 'Detect',
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
}: LLMModelsSectionProps) {
  const { t } = useTranslation('config');

  const gridTemplate = `200px 150px ${NODE_COLUMNS.map(() => 'minmax(130px, 1fr)').join(' ')}`;

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
                minWidth: 720,
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
                }}
              >
                Default · Job 전체
              </div>
              {NODE_COLUMNS.map((col) => (
                <div key={col} style={HEAD_CELL}>
                  {NODE_LABEL[col] || col}
                </div>
              ))}

              {/* Body rows */}
              {JOB_DEFS.map((job) => {
                const jobConfig = editedConfig.llmModels?.[job.jobKey];
                const inheritedDefault = (() => {
                  const id = jobConfig?.default;
                  if (!id) return undefined;
                  const m = availableModels.find((x) => x.id === id);
                  return m
                    ? { id: m.id, displayName: m.displayName, provider: m.provider }
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
                    t={t}
                  />
                );
              })}
            </div>
          </div>

          {/* Legend strip */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 16,
              flexWrap: 'wrap',
              padding: '8px 18px',
              borderTop: '1px solid var(--border-1)',
              background: 'oklch(from var(--bg-surface-2) l c h / 0.45)',
              fontSize: 10.5,
              color: 'var(--text-4)',
              fontFamily: 'var(--font-display)',
            }}
          >
            <LegendDot
              label="Default"
              color="var(--violet-700)"
              dotBg="oklch(94% 0.06 290 / 0.8)"
              dotBorder="oklch(72% 0.16 290)"
            />
            <LegendDot
              label="inherited"
              color="var(--text-3)"
              dotBg="transparent"
              dotBorder="var(--border-2)"
              dashed
            />
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <span
                aria-hidden
                style={{
                  display: 'inline-block',
                  fontSize: 11,
                  color: 'var(--text-4)',
                  fontWeight: 700,
                }}
              >
                —
              </span>
              <span>not applicable</span>
            </span>
          </div>
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
  t: (key: string, opts?: Record<string, unknown>) => string;
}

function JobRow({
  job,
  Icon,
  jobConfig,
  inheritedDefault,
  availableModels,
  onModelChange,
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
          fill
          compact
        />
      </div>

      {/* Override cells */}
      {NODE_COLUMNS.map((col) => {
        const applicable = !!job.nodes[col];
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
              fill
              compact
            />
          </div>
        );
      })}
    </>
  );
}

interface LegendDotProps {
  label: string;
  color: string;
  dotBg: string;
  dotBorder: string;
  dashed?: boolean;
}

function LegendDot({ label, color, dotBg, dotBorder, dashed = false }: LegendDotProps) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <span
        aria-hidden
        style={{
          width: 9,
          height: 9,
          borderRadius: '50%',
          background: dotBg,
          border: `${dashed ? '1px dashed' : '1.5px solid'} ${dotBorder}`,
        }}
      />
      <span style={{ color }}>{label}</span>
    </span>
  );
}
